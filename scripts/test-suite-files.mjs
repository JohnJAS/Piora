import { execFileSync } from "node:child_process";
import { globSync } from "node:fs";
import { readFile } from "node:fs/promises";

const applicationRoots = ["app", "components", "desktop", "extensions", "hooks", "lib", "scripts", "services", "tests"];
const excludedDirectories = new Set(["node_modules", ".next", ".verification", "fixtures", "__fixtures__", "dist", "release"]);

export function discoverTestFiles(root = process.cwd()) {
  return globSync(applicationRoots.map(directory => directory + "/**/*.test.mjs"), {
    cwd: root,
    exclude: file => file.split(/[\\/]/).some(segment => excludedDirectories.has(segment)),
  })
    .map(file => file.replaceAll("\\", "/")).sort();
}

export function verifyTestOwnership(tracked, application, website) {
  const owners = [new Set(application), new Set(website)];
  const failures = tracked.filter(file => /\.test\.[^/]+$/.test(file))
    .filter(file => owners.filter(suite => suite.has(file)).length !== 1);
  if (failures.length) throw new Error("Tracked tests must belong to exactly one CI suite:\n" + failures.join("\n"));
}

export function checkTrackedTestOwnership(root = process.cwd()) {
  const git = options => execFileSync("git", options, { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).split("\0");
  const removed = new Set(git(["ls-files", "--deleted", "-z"]));
  const tracked = git(["ls-files", "--cached", "--deduplicate", "-z"]).filter(file => !removed.has(file));
  verifyTestOwnership(tracked, discoverTestFiles(root), globSync("website/tests/*.test.mjs", { cwd: root }).map(file => file.replaceAll("\\", "/")));
}

export function partitionTests(files, count, timings = {}, resourceOverheadMs = 60_000) {
  if (!Number.isInteger(count) || count < 1) throw new Error("Invalid test shard count");
  const bins = Array.from({ length: count }, (_, index) => ({ files: [], ms: index === 0 ? resourceOverheadMs : 0 }));
  const weight = file => Number.isFinite(timings[file]) && timings[file] > 0 ? timings[file] : 500;
  // Longest first, deterministic tie breaks; include shard 1's existing Shell tests.
  for (const file of [...files].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b, "en"))) {
    const target = bins.reduce((best, bin) => bin.ms < best.ms ? bin : best);
    target.files.push(file); target.ms += weight(file);
  }
  return bins.map(bin => ({ ...bin, files: bin.files.sort() }));
}

export async function readTestTimings() {
  return JSON.parse(await readFile(new URL("./test-shard-timings.json", import.meta.url), "utf8")).files;
}

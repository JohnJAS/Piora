import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { generateLicenseInventory } from "./generate-license-inventory.mjs";

// Test-only versions: never tag, publish, or commit the modified checkout.
export async function prepareBrandCiVersion(root, sequence) {
  if (!["1", "2"].includes(sequence)) throw new Error("CI fixture sequence must be 1 or 2");
  const version = `0.0.0-beta.${sequence}`;
  const inputs = await Promise.all(["package.json", "desktop/package.json", "package-lock.json"].map(async file => [file, JSON.parse(await readFile(resolve(root, file), "utf8"))]));
  const lock = inputs[2][1];
  if (!lock.packages?.[""] || !lock.packages?.desktop) throw new Error("Missing workspace lockfile records");
  const changelog = await readFile(resolve(root, "CHANGELOG.md"), "utf8");
  if (!changelog.includes("## [Unreleased]")) throw new Error("Missing Unreleased heading");
  for (const [file, value] of inputs) {
    value.version = version;
    if (file === "package-lock.json") {
      value.packages[""].version = version;
      value.packages.desktop.version = version;
    }
    await writeFile(resolve(root, file), JSON.stringify(value, null, 2) + "\n");
  }
  await writeFile(resolve(root, "CHANGELOG.md"), changelog.replace("## [Unreleased]", `## [Unreleased]\n\n## [${version}]\n\n- 仅供 CI 品牌安装升级验收的测试版本 ${sequence}，禁止发布。`));
  await generateLicenseInventory({ projectRoot: root });
  return version;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.env.GITHUB_ACTIONS !== "true") throw new Error("CI fixture version rewriting is only allowed in GitHub Actions");
  console.log(await prepareBrandCiVersion(resolve(import.meta.dirname, ".."), process.argv[2]));
}

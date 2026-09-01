import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import type { HarmonyProjectComponent, HarmonyProjectInventory, HarmonyProjectModule } from "./types";

const MAX_SCAN_FILES = 4_000;
const MAX_SCAN_DEPTH = 7;
const SKIP_DIRECTORIES = new Set([".git", ".next", "node_modules", "oh_modules", "build", ".preview", ".idea"]);

function portablePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function walkFiles(root: string, options: { maxDepth: number; extension?: string }): { files: string[]; scanned: number; truncated: boolean } {
  const files: string[] = [];
  let scanned = 0;
  let truncated = false;
  const visit = (directory: string, depth: number) => {
    if (depth > options.maxDepth || truncated) return;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = join(directory, entry.name);
      scanned += 1;
      if (scanned > MAX_SCAN_FILES) {
        truncated = true;
        return;
      }
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) visit(fullPath, depth + 1);
      } else if (entry.isFile() && (!options.extension || entry.name.toLowerCase().endsWith(options.extension))) {
        files.push(fullPath);
      }
    }
  };
  visit(root, 0);
  return { files, scanned: Math.min(scanned, MAX_SCAN_FILES), truncated };
}

function moduleFromManifest(projectRoot: string, manifestPath: string): HarmonyProjectModule {
  const mainDirectory = dirname(manifestPath);
  const sourceDirectory = dirname(mainDirectory);
  const moduleRoot = dirname(sourceDirectory);
  const etsRoot = join(mainDirectory, "ets");
  const resourceRoot = join(mainDirectory, "resources");
  const componentScan = existsSync(etsRoot) ? walkFiles(etsRoot, { maxDepth: 8, extension: ".ets" }) : { files: [], scanned: 0, truncated: false };
  const components: HarmonyProjectComponent[] = componentScan.files.map((filePath) => ({
    name: basename(filePath, ".ets"),
    relativePath: portablePath(relative(projectRoot, filePath)),
  }));
  return {
    name: basename(moduleRoot),
    relativePath: portablePath(relative(projectRoot, moduleRoot)) || ".",
    ...(existsSync(etsRoot) ? { sourceRoot: portablePath(relative(projectRoot, etsRoot)) } : {}),
    ...(existsSync(resourceRoot) ? { resourceRoot: portablePath(relative(projectRoot, resourceRoot)) } : {}),
    components,
  };
}

export function analyzeHarmonyProject(projectRootValue: string): HarmonyProjectInventory {
  const projectRoot = resolve(projectRootValue);
  const scan = walkFiles(projectRoot, { maxDepth: MAX_SCAN_DEPTH });
  const manifests = scan.files.filter((filePath) => {
    const relativePath = `/${portablePath(relative(projectRoot, filePath)).toLowerCase()}`;
    return basename(filePath).toLowerCase() === "module.json5" && relativePath.endsWith("/src/main/module.json5");
  });
  const modules = manifests
    .map((manifest) => moduleFromManifest(projectRoot, manifest))
    .sort((left, right) => left.name.localeCompare(right.name) || left.relativePath.localeCompare(right.relativePath));
  const selectedModule = modules.find((module) => module.name.toLowerCase() === "entry")?.name ?? modules[0]?.name;
  return {
    schemaVersion: 1,
    projectRoot,
    modules,
    ...(selectedModule ? { selectedModule } : {}),
    scannedFiles: scan.scanned,
    truncated: scan.truncated,
  };
}

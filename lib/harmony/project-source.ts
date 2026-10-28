import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const IGNORE_DIRECTORIES = new Set([".git", ".hvigor", ".idea", ".preview", "build", "node_modules", "oh_modules"]);

export function findHarmonyProjectRoot(start: string): string | null {
  let current = resolve(start);
  try { if (!statSync(current).isDirectory()) current = dirname(current); } catch { return null; }
  while (true) {
    if (existsSync(join(current, "build-profile.json5"))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function pathInside(child: string, root: string): boolean {
  const value = relative(root, child);
  return value === "" || (!value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value));
}

export function collectArktsFiles(projectRoot: string, requested?: string[]): string[] {
  if (requested?.length) {
    const realRoot = realpathSync(projectRoot);
    const files = requested.map((file) => resolve(projectRoot, file));
    for (const file of files) {
      let realFile: string;
      try { realFile = realpathSync(file); } catch { throw new Error(`ArkTS file does not exist: ${file}`); }
      if (!pathInside(realFile, realRoot) || !file.toLowerCase().endsWith(".ets") || !statSync(realFile).isFile()) {
        throw new Error(`ArkTS file must be an existing .ets file inside the project: ${file}`);
      }
    }
    return [...new Set(files)].slice(0, 500);
  }
  const files: string[] = [];
  const visit = (directory: string) => {
    if (files.length >= 500) return;
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      if (IGNORE_DIRECTORIES.has(item.name)) continue;
      const path = join(directory, item.name);
      if (item.isDirectory()) visit(path);
      else if (item.isFile() && item.name.toLowerCase().endsWith(".ets")) files.push(path);
      if (files.length >= 500) break;
    }
  };
  visit(projectRoot);
  return files;
}

export function sourceFingerprint(projectRoot: string): string {
  const hash = createHash("sha256");
  for (const file of collectArktsFiles(projectRoot).sort()) {
    hash.update(relative(projectRoot, file).replace(/\\/g, "/")).update("\0").update(readFileSync(file)).update("\n");
  }
  const visitConfig = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory() && !IGNORE_DIRECTORIES.has(entry.name)) visitConfig(path);
      else if (entry.isFile() && (["build-profile.json5", "oh-package.json5", "oh-package-lock.json5", "code-linter.json5", "module.json5", "app.json5", "hvigorfile.ts"].includes(entry.name) || entry.name.endsWith(".d.ts"))) {
        hash.update(relative(projectRoot, path).replace(/\\/g, "/")).update("\0").update(readFileSync(path));
      }
    }
  };
  visitConfig(projectRoot);
  return hash.digest("hex");
}

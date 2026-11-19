import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function declaresDesktopExtension(value: unknown): boolean {
  if (!object(value) || object(value.pi)) return false;
  const dsh = value.dsh;
  return object(value.pioraDesktopExtension)
    || object(dsh) && (object(dsh.bundle) || object(dsh.client) || object(dsh.desktop));
}

export function isDesktopExtensionPackage(root: string | undefined): boolean {
  if (!root) return false;
  const manifest = join(root, "package.json");
  try {
    const info = statSync(manifest);
    return info.isFile() && info.size <= 1024 * 1024 && declaresDesktopExtension(JSON.parse(readFileSync(manifest, "utf8")));
  } catch { return false; }
}

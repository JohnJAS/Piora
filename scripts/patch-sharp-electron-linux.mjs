import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Electron exposes system GLib symbols. Bind only sharp's glibc addon to its
// own libvips dependency scope; never change the loader flags for other addons.
// https://github.com/electron/electron/issues/46323
export function sharpLinuxLoader(platform, version, patched = true) {
  const binding = `./lib/sharp-${platform}-${version}.node`;
  const prefix = `try { require.resolve('@img/sharp-libvips-${platform}/binary'); } catch {}\n`;
  const original = `module.exports = require('${binding}');`;
  if (!patched) return prefix + original;
  return prefix + `// Piora: isolate sharp from Electron's system GLib symbols.
if (process.platform === 'linux' && process.versions.electron) {
  const { constants } = require('node:os');
  const { RTLD_NOW, RTLD_DEEPBIND } = constants.dlopen;
  if (!RTLD_DEEPBIND) throw new Error('sharp on Linux Electron requires RTLD_DEEPBIND');
  process.dlopen(module, require.resolve('${binding}'), RTLD_NOW | RTLD_DEEPBIND);
} else {
  ${original}
}
`;
}

export async function patchSharpElectronLinux(root) {
  const scope = join(root, "node_modules", "@img");
  const entries = await readdir(scope);
  const patched = [];
  for (const name of entries.filter(name => /^sharp-linux-(?:arm|arm64|ppc64|riscv64|s390x|x64)$/.test(name))) {
    const directory = join(scope, name);
    const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    if (manifest.name !== `@img/${name}` || manifest.version !== "0.35.5") {
      throw new Error(`Review Electron GLib isolation for ${manifest.name}@${manifest.version}`);
    }
    const file = join(directory, "index.cjs");
    const source = (await readFile(file, "utf8")).replaceAll("\r\n", "\n");
    const platform = name.slice("sharp-".length);
    const replacement = sharpLinuxLoader(platform, manifest.version);
    if (source === replacement) continue;
    if (source.trimEnd() !== sharpLinuxLoader(platform, manifest.version, false)) {
      throw new Error(`Unexpected sharp native loader: ${file}`);
    }
    await writeFile(file, replacement);
    patched.push(manifest.name);
  }
  return { patched };
}

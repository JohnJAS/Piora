import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

function symbols(file) {
  return execFileSync("nm", ["-D", "--format=posix", file], { encoding: "utf8" })
    .trim().split("\n").map(line => line.split(/\s+/)).filter(parts => parts.length >= 2);
}

export function glibSymbolMap(entries, restore = false) {
  const prefix = restore ? "piora_g_" : "g_";
  return entries.filter(([name, type]) => name.startsWith(prefix) && type !== "U")
    .map(([name]) => [name, restore ? name.slice(6) : `piora_${name}`]);
}

// Rename both the libvips exports and sharp's imports. Unlike DEEPBIND this
// leaves Electron's allocator interposition intact, while GLib objects stay
// with the GLib implementation that created them. No runtime loader hooks.
export async function patchSharpElectronLinux(root, { restore = false } = {}) {
  if (process.platform !== "linux") return { patched: [] };
  const scope = join(root, "node_modules", "@img");
  const entries = await readdir(scope);
  const patched = [];
  const packages = entries.filter(name => /^sharp-linux-(?:arm|arm64|ppc64|riscv64|s390x|x64)$/.test(name));
  if (packages.length) {
    // Older patchelf can move .init without updating DT_INIT (upstream #639),
    // producing an ELF that passes symbol checks but crashes during dlopen.
    const version = execFileSync("patchelf", ["--version"], { encoding: "utf8" }).match(/(\d+)\.(\d+)\.(\d+)/);
    if (!version || (Number(version[1]) === 0 && (Number(version[2]) < 19 || (Number(version[2]) === 19 && Number(version[3]) < 2)))) {
      throw new Error("Linux sharp isolation requires patchelf >= 0.19.2; see README.md");
    }
  }
  for (const name of packages) {
    const directory = join(scope, name);
    const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    const platform = name.slice(6);
    const vipsDirectory = join(scope, `sharp-libvips-${platform}`);
    const vipsManifest = JSON.parse(await readFile(join(vipsDirectory, "package.json"), "utf8"));
    if (manifest.name !== `@img/${name}` || manifest.version !== "0.35.5" || vipsManifest.version !== "1.3.4") {
      throw new Error(`Review sharp GLib isolation for ${manifest.name}@${manifest.version}, libvips ${vipsManifest.version}`);
    }
    const addon = join(directory, "lib", `sharp-${platform}-${manifest.version}.node`);
    const vips = join(vipsDirectory, "lib", "libvips-cpp.so.8.18.7");
    let exports;
    try { exports = symbols(vips); } catch (error) {
      throw new Error("Linux sharp isolation requires binutils and patchelf >= 0.19.2; see README.md", { cause: error });
    }
    const addonSymbols = symbols(addon);
    const imported = new Set(addonSymbols.filter(([, type]) => type === "U").map(([symbol]) => symbol));
    const mapping = glibSymbolMap(exports, restore).filter(([symbol]) => imported.has(symbol));
    if (!mapping.length) {
      const opposite = glibSymbolMap(exports, !restore);
      if (!opposite.length) throw new Error(`Missing expected GLib symbols in ${vips}`);
      const wrongPrefix = restore ? "piora_g_" : "g_";
      if (symbols(addon).some(([symbol]) => symbol.startsWith(wrongPrefix))) throw new Error("Inconsistent sharp/libvips isolation; reinstall dependencies");
      continue;
    }
    const names = new Set(mapping.map(([symbol]) => symbol));
    for (const [symbol] of symbols(addon).filter(([symbol]) => symbol.startsWith(restore ? "piora_g_" : "g_"))) {
      if (!names.has(symbol)) throw new Error(`libvips does not export sharp's GLib dependency ${symbol}`);
    }
    const temporary = await mkdtemp(join(directory, ".piora-glib-"));
    try {
      const mapFile = join(temporary, "symbols.txt");
      await writeFile(mapFile, mapping.map(pair => pair.join(" ")).join("\n") + "\n");
      const files = [vips, addon];
      for (const [index, file] of files.entries()) {
        const staged = join(temporary, `${index}.elf`);
        await cp(file, staged);
        try { execFileSync("patchelf", ["--no-clobber-old-sections", "--rename-dynamic-symbols", mapFile, staged], { encoding: "utf8" }); } catch (error) {
          throw new Error("Linux sharp isolation requires patchelf >= 0.19.2 with --rename-dynamic-symbols support", { cause: error });
        }
        if (symbols(staged).some(([symbol]) => names.has(symbol))) throw new Error(`GLib symbol isolation failed for ${file}`);
      }
      // Only replace installed binaries after both staged files validate.
      for (const [index, file] of files.entries()) await rename(join(temporary, `${index}.elf`), file);
      patched.push(manifest.name);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
  return { patched };
}

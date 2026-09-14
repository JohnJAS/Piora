import { createHash } from "node:crypto";
import { cp, readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const jiti = createJiti(import.meta.url);
const catalog = await jiti.import("../lib/speech-pack-catalog.ts");
const manager = await jiti.import("../lib/speech-pack-manager.ts");

export async function verifyStagedSpeech(root) {
  const pack = join(root, manager.PACK_DIRECTORY_NAME);
  const manifest = JSON.parse(await readFile(join(pack, "manifest.json"), "utf8"));
  const runtime = catalog.getSpeechRuntimeSource("win32", "x64");
  if (manifest.version !== catalog.SPEECH_PACK_VERSION || manifest.platformKey !== "win32-x64"
    || manifest.runtimePackage !== runtime.packageName) throw new Error("Bundled speech manifest mismatch");
  for (const source of [catalog.SENSEVOICE_MODEL_SOURCE, catalog.SENSEVOICE_TOKENS_SOURCE]) {
    const bytes = await readFile(join(pack, "model", source.name));
    if (bytes.length !== source.bytes || createHash(source.algorithm).update(bytes).digest(source.encoding) !== source.digest) {
      throw new Error(`Bundled speech checksum mismatch: ${source.name}`);
    }
  }
  for (const source of [catalog.SHERPA_NODE_SOURCE, runtime]) {
    const dir = join(pack, "runtime", "node_modules", source.packageName);
    const info = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    if (info.name !== source.packageName || info.version !== "1.13.6") throw new Error("Bundled speech runtime mismatch");
    if (source === runtime && !(await readdir(dir)).some(name => name.endsWith(".node"))) throw new Error("Bundled speech native addon is missing");
  }
  for (const name of ["LICENSE", "MODEL_LICENSE", "SHERPA-LICENSE", "ONNXRUNTIME-LICENSE", "ONNXRUNTIME-NOTICES", "SOURCE.md"]) await stat(join(pack, "licenses", name));
  return pack;
}

export async function stageSpeech(root = projectRoot) {
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Stage the Windows speech pack on a Windows x64 runner");
  const target = join(root, "desktop", "build", "speech");
  // Reuse the application's pinned downloads and checksum verification. This
  // build-only operation does not enable speech or modify user settings.
  await manager.installSpeechPack({ enabled: false, packDirectory: target, customPackDirectory: true });
  await cp(join(root, "third_party", "sensevoice"), join(target, manager.PACK_DIRECTORY_NAME, "licenses"), { recursive: true });
  await verifyStagedSpeech(target);
  return target;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  stageSpeech().then(root => console.log(`Verified bundled offline speech: ${root}`)).catch(error => { console.error(error); process.exitCode = 1; });
}

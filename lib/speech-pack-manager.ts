import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createReadStream } from "node:fs";
import {
  access,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import * as tar from "tar";
import {
  detectSpeechHardware,
  getSpeechRuntimeSource,
  SENSEVOICE_MODEL_SOURCE,
  SENSEVOICE_TOKENS_SOURCE,
  SHERPA_NODE_SOURCE,
  SPEECH_PACK_APPROXIMATE_DOWNLOAD_BYTES,
  SPEECH_PACK_VERSION,
  speechRuntimeKey,
  type SpeechDownloadSource,
  type SpeechRuntimeSource,
} from "./speech-pack-catalog";
import { readSpeechSettings, writeSpeechSettings, type SpeechSettings } from "./speech-settings";
import {
  LOCAL_SPEECH_PACK_ID,
  type SpeechInstallState,
  type SpeechStatus,
} from "./speech-types";

const PACK_DIRECTORY_NAME = `${LOCAL_SPEECH_PACK_ID}-${SPEECH_PACK_VERSION}`;
const MANIFEST_NAME = "manifest.json";

interface InstalledSpeechManifest {
  schema: "piora-local-speech-pack-v1";
  packId: typeof LOCAL_SPEECH_PACK_ID;
  version: string;
  engine: "sherpa-onnx";
  platformKey: string;
  runtimePackage: string;
  installedBytes: number;
  installedAt: string;
  sources: Array<{ name: string; algorithm: string; digest: string }>;
}

interface SpeechInstallGlobal {
  state: SpeechInstallState;
  running: Promise<void> | null;
}

type SpeechInstallGlobalThis = typeof globalThis & {
  __pioraSpeechPackInstall?: SpeechInstallGlobal;
};

function newInstallState(phase: SpeechInstallState["phase"] = "idle"): SpeechInstallState {
  return {
    phase,
    downloadedBytes: 0,
    totalBytes: SPEECH_PACK_APPROXIMATE_DOWNLOAD_BYTES,
    updatedAt: new Date().toISOString(),
  };
}

function installGlobal(): SpeechInstallGlobal {
  const target = globalThis as SpeechInstallGlobalThis;
  target.__pioraSpeechPackInstall ??= { state: newInstallState(), running: null };
  return target.__pioraSpeechPackInstall;
}

function updateInstallState(update: Partial<SpeechInstallState>): void {
  const global = installGlobal();
  global.state = {
    ...global.state,
    ...update,
    updatedAt: new Date().toISOString(),
  };
}

export function speechPackPath(settings: Pick<SpeechSettings, "packDirectory">): string {
  return resolve(settings.packDirectory, PACK_DIRECTORY_NAME);
}

function assertManagedChild(root: string, path: string): void {
  if (dirname(resolve(path)) !== resolve(root)) {
    throw new Error("Refusing to modify a path outside the speech pack directory");
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readInstalledManifest(packPath: string): Promise<InstalledSpeechManifest | null> {
  try {
    const parsed = JSON.parse(await readFile(join(packPath, MANIFEST_NAME), "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const manifest = parsed as Partial<InstalledSpeechManifest>;
    if (
      manifest.schema !== "piora-local-speech-pack-v1"
      || manifest.packId !== LOCAL_SPEECH_PACK_ID
      || manifest.version !== SPEECH_PACK_VERSION
      || manifest.engine !== "sherpa-onnx"
      || manifest.platformKey !== speechRuntimeKey()
      || typeof manifest.runtimePackage !== "string"
      || typeof manifest.installedBytes !== "number"
    ) return null;

    const required = [
      join(packPath, "model", "model.int8.onnx"),
      join(packPath, "model", "tokens.txt"),
      join(packPath, "runtime", "package.json"),
      join(packPath, "runtime", "node_modules", "sherpa-onnx-node", "package.json"),
      join(packPath, "runtime", "node_modules", manifest.runtimePackage, "package.json"),
    ];
    if (!(await Promise.all(required.map(pathExists))).every(Boolean)) return null;
    return manifest as InstalledSpeechManifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function getSpeechStatus(): Promise<SpeechStatus> {
  const settings = await readSpeechSettings();
  const packPath = speechPackPath(settings);
  const manifest = await readInstalledManifest(packPath);
  const hardware = detectSpeechHardware();
  return {
    enabled: settings.enabled,
    available: settings.enabled && manifest !== null && hardware.supported,
    installed: manifest !== null,
    engine: "sherpa-onnx",
    model: "SenseVoiceSmall INT8",
    packId: LOCAL_SPEECH_PACK_ID,
    packVersion: SPEECH_PACK_VERSION,
    packDirectory: settings.packDirectory,
    packPath,
    approximateDownloadBytes: SPEECH_PACK_APPROXIMATE_DOWNLOAD_BYTES,
    installedBytes: manifest?.installedBytes ?? null,
    languages: ["zh", "en", "yue", "ja", "ko"],
    hardware,
    install: { ...installGlobal().state },
  };
}

function digestMatches(source: SpeechDownloadSource, digest: Buffer): boolean {
  const actual = source.encoding === "hex" ? digest.toString("hex") : digest.toString("base64");
  return actual === source.digest;
}

async function downloadVerified(source: SpeechDownloadSource, destination: string): Promise<void> {
  updateInstallState({ currentFile: source.name });
  const temporary = `${destination}.partial`;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      let existingBytes = 0;
      try { existingBytes = (await stat(temporary)).size; } catch { /* Start a new partial download. */ }
      const response = await fetch(source.url, {
        cache: "no-store",
        redirect: "follow",
        ...(existingBytes > 0 ? { headers: { range: `bytes=${existingBytes}-` } } : {}),
      });
      if ((!response.ok && response.status !== 206) || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }
      const append = existingBytes > 0 && response.status === 206;
      if (!append && existingBytes > 0) {
        const global = installGlobal();
        updateInstallState({ downloadedBytes: Math.max(0, global.state.downloadedBytes - existingBytes) });
        existingBytes = 0;
      }
      const hash = createHash(source.algorithm);
      if (append) {
        for await (const chunk of createReadStream(temporary)) hash.update(chunk as Buffer);
      }
      const handle = await open(temporary, append ? "a" : "w", 0o600);
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          hash.update(value);
          await handle.write(value);
          const global = installGlobal();
          updateInstallState({
            downloadedBytes: Math.min(
              global.state.totalBytes,
              global.state.downloadedBytes + value.byteLength,
            ),
          });
        }
      } finally {
        reader.releaseLock();
        await handle.close();
      }
      const digest = hash.digest();
      if (!digestMatches(source, digest)) throw new Error("checksum mismatch");
      await rename(temporary, destination);
      return;
    } catch (error) {
      lastError = error;
      if (error instanceof Error && error.message === "checksum mismatch") {
        try {
          const invalidBytes = (await stat(temporary)).size;
          const global = installGlobal();
          updateInstallState({ downloadedBytes: Math.max(0, global.state.downloadedBytes - invalidBytes) });
          await rm(temporary, { force: true });
        } catch { /* The partial file may already be gone. */ }
      }
      if (attempt < 4) await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 1_000));
    }
  }
  await rm(temporary, { force: true });
  const cause = lastError && typeof lastError === "object" && "cause" in lastError
    ? (lastError as { cause?: { code?: unknown; message?: unknown } }).cause
    : undefined;
  const detail = typeof cause?.code === "string"
    ? cause.code
    : lastError instanceof Error
      ? lastError.message
      : "unknown error";
  throw new Error(`Unable to download or checksum-verify ${source.name} after 4 attempts (${detail})`);
}

function archiveEntryIsSafe(path: string, entryType: unknown): boolean {
  const normalized = path.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) return false;
  if (normalized.split("/").some((part) => part === "..")) return false;
  return entryType !== "SymbolicLink" && entryType !== "Link";
}

async function extractRuntimeArchive(
  archive: string,
  runtimeRoot: string,
  source: SpeechRuntimeSource,
): Promise<void> {
  const destination = join(runtimeRoot, "node_modules", source.packageName);
  await mkdir(destination, { recursive: true });
  await tar.x({
    file: archive,
    cwd: destination,
    strip: 1,
    preservePaths: false,
    filter: (path, entry) => archiveEntryIsSafe(path, (entry as { type?: unknown }).type),
  });
}

async function installSpeechPack(settings: SpeechSettings): Promise<void> {
  const runtimeSource = getSpeechRuntimeSource();
  if (!runtimeSource) {
    throw new Error(`Local speech is not available for ${process.platform}/${process.arch}`);
  }
  const root = resolve(settings.packDirectory);
  const target = speechPackPath(settings);
  assertManagedChild(root, target);
  if (await readInstalledManifest(target)) return;

  await mkdir(root, { recursive: true });
  const staging = join(root, `.${PACK_DIRECTORY_NAME}.${randomUUID()}.staging`);
  const backup = join(root, `.${PACK_DIRECTORY_NAME}.${randomUUID()}.backup`);
  assertManagedChild(root, staging);
  assertManagedChild(root, backup);
  const downloads = join(staging, "downloads");
  const modelRoot = join(staging, "model");
  const runtimeRoot = join(staging, "runtime");
  await mkdir(downloads, { recursive: true });
  await mkdir(modelRoot, { recursive: true });
  await mkdir(join(runtimeRoot, "node_modules"), { recursive: true });

  let movedOldPack = false;
  try {
    const nodeArchive = join(downloads, SHERPA_NODE_SOURCE.name);
    const platformArchive = join(downloads, runtimeSource.name);
    await downloadVerified(SHERPA_NODE_SOURCE, nodeArchive);
    await downloadVerified(runtimeSource, platformArchive);
    await downloadVerified(SENSEVOICE_MODEL_SOURCE, join(modelRoot, SENSEVOICE_MODEL_SOURCE.name));
    await downloadVerified(SENSEVOICE_TOKENS_SOURCE, join(modelRoot, SENSEVOICE_TOKENS_SOURCE.name));

    updateInstallState({ phase: "installing", currentFile: undefined });
    await extractRuntimeArchive(nodeArchive, runtimeRoot, SHERPA_NODE_SOURCE);
    await extractRuntimeArchive(platformArchive, runtimeRoot, runtimeSource);
    await writeFile(join(runtimeRoot, "package.json"), `${JSON.stringify({ private: true })}\n`, "utf8");
    await rm(downloads, { recursive: true, force: true });

    const installedBytes = SENSEVOICE_MODEL_SOURCE.bytes
      + SENSEVOICE_TOKENS_SOURCE.bytes
      + SHERPA_NODE_SOURCE.unpackedBytes
      + runtimeSource.unpackedBytes;
    const manifest: InstalledSpeechManifest = {
      schema: "piora-local-speech-pack-v1",
      packId: LOCAL_SPEECH_PACK_ID,
      version: SPEECH_PACK_VERSION,
      engine: "sherpa-onnx",
      platformKey: speechRuntimeKey(),
      runtimePackage: runtimeSource.packageName,
      installedBytes,
      installedAt: new Date().toISOString(),
      sources: [SHERPA_NODE_SOURCE, runtimeSource, SENSEVOICE_MODEL_SOURCE, SENSEVOICE_TOKENS_SOURCE]
        .map((source) => ({ name: source.name, algorithm: source.algorithm, digest: source.digest })),
    };
    await writeFile(join(staging, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    if (await pathExists(target)) {
      await rename(target, backup);
      movedOldPack = true;
    }
    await rename(staging, target);
    if (movedOldPack) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    if (movedOldPack && !(await pathExists(target)) && await pathExists(backup)) {
      await rename(backup, target).catch(() => {});
    }
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export function startSpeechPackInstall(): SpeechInstallState {
  const global = installGlobal();
  if (global.running) return { ...global.state };
  updateInstallState(newInstallState("downloading"));
  global.running = readSpeechSettings()
    .then(installSpeechPack)
    .then(() => {
      updateInstallState({
        phase: "complete",
        currentFile: undefined,
        error: undefined,
        downloadedBytes: installGlobal().state.totalBytes,
      });
    })
    .catch((error: unknown) => {
      updateInstallState({
        phase: "error",
        currentFile: undefined,
        error: error instanceof Error ? error.message : "Speech pack installation failed",
      });
    })
    .finally(() => {
      installGlobal().running = null;
    });
  return { ...global.state };
}

export async function updateSpeechSettings(input: {
  enabled?: boolean;
  packDirectory?: string | null;
}): Promise<SpeechStatus> {
  const current = await readSpeechSettings();
  const directoryChanged = input.packDirectory !== undefined
    && resolve(input.packDirectory?.trim() || current.packDirectory) !== resolve(current.packDirectory);
  const nextEnabled = directoryChanged ? false : input.enabled ?? current.enabled;
  if (nextEnabled) {
    const packDirectory = input.packDirectory?.trim() || current.packDirectory;
    const manifest = await readInstalledManifest(speechPackPath({ packDirectory }));
    if (!manifest) throw new Error("Download the local speech pack before enabling speech recognition");
  }
  await writeSpeechSettings({
    enabled: nextEnabled,
    packDirectory: input.packDirectory === undefined
      ? (current.customPackDirectory ? current.packDirectory : null)
      : input.packDirectory,
  });
  return getSpeechStatus();
}

export async function removeSpeechPack(): Promise<SpeechStatus> {
  const settings = await readSpeechSettings();
  const target = speechPackPath(settings);
  assertManagedChild(settings.packDirectory, target);
  await writeSpeechSettings({
    enabled: false,
    packDirectory: settings.customPackDirectory ? settings.packDirectory : null,
  });
  await rm(target, { recursive: true, force: true });
  updateInstallState(newInstallState());
  return getSpeechStatus();
}

export function createExternalSpeechRequire(packPath: string): NodeJS.Require {
  return createRequire(join(packPath, "runtime", "package.json"));
}

export async function verifiedSpeechPackPath(): Promise<{
  path: string;
  settings: SpeechSettings;
}> {
  const settings = await readSpeechSettings();
  const path = speechPackPath(settings);
  if (!settings.enabled) throw new Error("Local speech recognition is disabled");
  if (!(await readInstalledManifest(path))) throw new Error("Local speech pack is not installed");
  return { path, settings };
}

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import JSZip from "jszip";
import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";

export const WHISPER_CPP_VERSION = "v1.9.2";
export const WHISPER_MODEL_NAME = "ggml-base-q5_1.bin";

const BINARY_ARCHIVE = {
  url: `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_CPP_VERSION}/whisper-bin-x64.zip`,
  size: 8_194_445,
  sha256: "49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a",
};

const MODEL = {
  url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/f281eb45af861ab5e5297d23694b7d46e090c02c/ggml-base-q5_1.bin?download=true",
  size: 59_707_625,
  sha256: "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898",
};

async function sha256File(filePath) {
  const bytes = await readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

async function isVerifiedFile(filePath, expected) {
  try {
    const bytes = await readFile(filePath);
    return bytes.byteLength === expected.size
      && createHash("sha256").update(bytes).digest("hex") === expected.sha256;
  } catch {
    return false;
  }
}

async function downloadVerifiedFile(source, destination) {
  if (await isVerifiedFile(destination, source)) return destination;
  await mkdir(dirname(destination), { recursive: true });
  const temporaryPath = `${destination}.${process.pid}.tmp`;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const dispatcher = new EnvHttpProxyAgent();
    try {
      await rm(temporaryPath, { force: true });
      const response = await undiciFetch(source.url, {
        dispatcher,
        redirect: "follow",
        headers: { "User-Agent": "Piora-whisper-resource-builder" },
      });
      if (!response.ok || !response.body) {
        throw new Error(`Unable to download ${source.url}: HTTP ${response.status}`);
      }
      await pipeline(
        Readable.fromWeb(response.body),
        createWriteStream(temporaryPath, { flags: "wx" }),
      );
      if (!await isVerifiedFile(temporaryPath, source)) {
        throw new Error(`Downloaded resource failed verification: ${source.url}`);
      }
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      await rm(temporaryPath, { force: true });
    } finally {
      await dispatcher.close();
    }
  }
  if (lastError) throw lastError;
  await rm(destination, { force: true });
  await rename(temporaryPath, destination);
  return destination;
}

async function extractWindowsRuntime(archivePath, outputDirectory) {
  const archive = await JSZip.loadAsync(await readFile(archivePath));
  const runtimeEntries = Object.values(archive.files).filter((entry) => {
    if (entry.dir || !/^Release\//i.test(entry.name)) return false;
    const name = basename(entry.name);
    return name === "whisper-cli.exe" || /\.dll$/i.test(name);
  });
  if (!runtimeEntries.some((entry) => basename(entry.name) === "whisper-cli.exe")) {
    throw new Error("Pinned whisper.cpp archive does not contain Release/whisper-cli.exe");
  }

  await mkdir(outputDirectory, { recursive: true });
  await Promise.all(runtimeEntries.map(async (entry) => {
    const target = join(outputDirectory, basename(entry.name));
    await writeFile(target, await entry.async("nodebuffer"));
  }));
}

export async function prepareWhisperResources(options = {}) {
  const projectRoot = resolve(options.projectRoot ?? fileURLToPath(new URL("..", import.meta.url)));
  const outputDirectory = resolve(options.outputDirectory ?? join(projectRoot, "desktop", "build", "whisper"));
  const cacheDirectory = resolve(options.cacheDirectory ?? join(projectRoot, "desktop", "build", "whisper-downloads"));
  const archivePath = join(cacheDirectory, `whisper-bin-x64-${WHISPER_CPP_VERSION}.zip`);
  const modelPath = join(outputDirectory, WHISPER_MODEL_NAME);

  await mkdir(cacheDirectory, { recursive: true });
  await downloadVerifiedFile(BINARY_ARCHIVE, archivePath);
  await downloadVerifiedFile(MODEL, modelPath);
  await extractWindowsRuntime(archivePath, outputDirectory);
  await access(join(outputDirectory, "whisper-cli.exe"));

  const manifest = {
    schema: "piora-whisper-resources-v1",
    whisperCppVersion: WHISPER_CPP_VERSION,
    model: WHISPER_MODEL_NAME,
    modelSize: MODEL.size,
    modelSha256: await sha256File(modelPath),
    runtimeArchiveSha256: BINARY_ARCHIVE.sha256,
  };
  await writeFile(join(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { outputDirectory, manifest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await prepareWhisperResources();
  process.stdout.write(`Prepared Whisper resources in ${result.outputDirectory}\n`);
}

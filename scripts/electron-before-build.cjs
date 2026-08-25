/* eslint-disable @typescript-eslint/no-require-imports -- electron-builder loads beforeBuild hooks as CommonJS. */
const { createHash } = require("node:crypto");
const { mkdir, readFile, rm, writeFile } = require("node:fs/promises");
const { dirname, join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const STOCK_PORTABLE_TEMPLATE_SHA256 = "80fa75cf8cb68f4999eb92afc9f37f8e5b605cb1c3a077821bbc350a9b907a48";
const PRIOR_PIORA_TEMPLATE_SHA256 = "9bbc69b6315e9c1a06e056d2859a95f791794be3358d7ca27b6f417befc90015";

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

module.exports = async function prepareDesktopBuild(context) {
  const projectRoot = resolve(context.appDir, "..");
  const targetPlatform = context.electronPlatformName ?? process.platform;
  if (targetPlatform === "win32") {
    const whisperScriptUrl = pathToFileURL(
      join(projectRoot, "scripts", "prepare-whisper-resources.mjs"),
    ).href;
    const { prepareWhisperResources } = await import(whisperScriptUrl);
    await prepareWhisperResources({ projectRoot });
  } else {
    // The pinned upstream runtime archive is Windows-only. Keep Linux builds
    // deterministic and let the speech API report unavailable instead of
    // packaging a non-executable binary or downloading at runtime.
    const whisperDirectory = join(projectRoot, "desktop", "build", "whisper");
    await rm(whisperDirectory, { recursive: true, force: true });
    await mkdir(whisperDirectory, { recursive: true });
    await writeFile(join(whisperDirectory, "manifest.json"), `${JSON.stringify({
      schema: "piora-whisper-resources-v1",
      platform: targetPlatform,
      available: false,
      reason: "No reviewed bundled whisper.cpp runtime is available for this platform.",
    }, null, 2)}\n`, "utf8");
  }

  if (targetPlatform !== "win32") return false;
  const customTemplatePath = join(projectRoot, "desktop", "build", "portable-cache.nsi");
  const builderPackagePath = require.resolve("app-builder-lib/package.json", { paths: [projectRoot] });
  const stockTemplatePath = join(dirname(builderPackagePath), "templates", "nsis", "portable.nsi");
  const [customTemplate, currentTemplate] = await Promise.all([
    readFile(customTemplatePath),
    readFile(stockTemplatePath),
  ]);
  const currentHash = sha256(currentTemplate);
  const customHash = sha256(customTemplate);
  const isPioraCacheTemplate = currentTemplate.toString("utf8").includes(
    "# PIORA_PORTABLE_CACHE_TEMPLATE_V1",
  );
  if (
    currentHash !== STOCK_PORTABLE_TEMPLATE_SHA256
    && currentHash !== PRIOR_PIORA_TEMPLATE_SHA256
    && currentHash !== customHash
    && !isPioraCacheTemplate
  ) {
    throw new Error(
      `Unsupported electron-builder portable template (${currentHash}); review the cached-runtime override before packaging.`,
    );
  }
  if (currentHash !== customHash) await writeFile(stockTemplatePath, customTemplate);

  // electron-builder discovers the npm workspace root and would otherwise
  // copy Piora's complete web dependency tree into app.asar in addition to
  // the already-traced standalone service in extraResources/web. Returning
  // false declares that this desktop shell owns its dependencies externally.
  return false;
};

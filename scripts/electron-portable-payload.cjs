/* eslint-disable @typescript-eslint/no-require-imports -- electron-builder hooks are CommonJS. */
const { copyFile, mkdir, writeFile } = require("node:fs/promises");
const { join, resolve } = require("node:path");
const { createPayloadManifest } = require("./portable-payload.cjs");
const contexts = new Map();

async function writePayloadManifest(context) {
  const manifest = await createPayloadManifest(context.appOutDir, {
    version: context.packager.appInfo.version,
    executable: `${context.packager.appInfo.productFilename}.exe`,
  });
  await writeFile(join(context.packager.projectDir, "build", "portable-payload-x64.json"), manifest);
}

function registerPayloadContext(context) {
  if (context.electronPlatformName !== "win32") return;
  if (context.arch !== 1) throw new Error("Portable payload supports only the reviewed Windows x64 target");
  contexts.set(resolve(context.appOutDir), { context, generation: null });
}
async function prepareArtifactPayload(event) {
  if (!["nsis", "portable"].includes(event.targetPresentableName)) return;
  if (contexts.size !== 1) throw new Error("Expected exactly one finalized Windows payload before NSIS compression");
  for (const entry of contexts.values()) {
    const { context } = entry;
    // artifactBuildStarted is emitted by NsisTarget before packArch; this runs
    // after platformPackager's fuses/resource editing/signing, even unsigned.
    entry.generation ??= (async () => {
      // electron-builder 26.18 injects the signed helper after archiving and
      // copies it into win-unpacked only after all targets finish. Stage the
      // same bytes before hashing so both installer and portable payloads are
      // covered by the manifest, then suppress its duplicate archive injection.
      const targets = context.targets.filter(target => ["nsis", "portable"].includes(target.name));
      const helper = targets[0]?.packageHelper?.elevateHelper;
      if (require("app-builder-lib/package.json").version !== "26.18.0" || !targets.length || targets.length !== context.targets.length
        || typeof helper?.resolve !== "function" || typeof helper?.addToArchive !== "function"
        || targets.some(target => target.packageHelper?.elevateHelper !== helper || target.packager !== context.packager)
        || targets.some(target => (target.options.signAndEditExecutable !== false) !== (targets[0].options.signAndEditExecutable !== false))) {
        throw new Error("Unsupported electron-builder NSIS payload lifecycle");
      }
      const paths = await Promise.all(targets.map(target => helper.resolve(target)));
      if (paths.some(path => path !== paths[0])) throw new Error("NSIS targets require different elevation helpers");
      if (paths[0]) {
        const resources = join(context.appOutDir, "resources");
        await mkdir(resources, { recursive: true });
        const staged = join(resources, "elevate.exe");
        await copyFile(paths[0], staged);
        if (targets[0].options.signAndEditExecutable !== false) await context.packager.signIf(staged);
      }
      const addToArchive = helper.addToArchive.bind(helper);
      helper.addToArchive = async (archive, target, format, options, appOutDir) => {
        if (resolve(appOutDir) === resolve(context.appOutDir) && targets.includes(target)) return;
        return addToArchive(archive, target, format, options, appOutDir);
      };
      await writePayloadManifest(context);
    })();
    await entry.generation;
  }
}
async function afterAllArtifactBuild() {
  // --dir has no artifactBuildStarted event. Finalize only directory-only builds
  // here, after resource edits/fuses/signing (afterSign does not run unsigned).
  // Installer payloads retain their pre-compression manifest and elevate helper.
  for (const entry of contexts.values()) {
    const { context } = entry;
    // WinPackager.createTargets drops "dir", so Windows --dir supplies [];
    // the common target factory can instead supply an explicit NoOpTarget.
    if (!context.targets.every(target => target.name === "dir")) continue;
    entry.generation ??= writePayloadManifest(context);
    await entry.generation;
  }
  return [];
}
module.exports = prepareArtifactPayload;
module.exports.registerPayloadContext = registerPayloadContext;
module.exports.afterAllArtifactBuild = afterAllArtifactBuild;

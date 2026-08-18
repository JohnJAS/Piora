/* eslint-disable @typescript-eslint/no-require-imports -- electron-builder loads afterPack hooks as CommonJS. */
const { lstat, mkdir, readFile, rename, rm, writeFile } = require("node:fs/promises");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

module.exports = async function generatePackagedLicenses(context) {
  const scriptUrl = pathToFileURL(resolve(__dirname, "package-license-bundle.mjs")).href;
  const { generatePackageLicenseBundle } = await import(scriptUrl);
  const resourcesRoot = join(context.appOutDir, "resources");
  const webRoot = join(resourcesRoot, "web");
  const result = await generatePackageLicenseBundle({
    webRoot,
    outputRoot: join(resourcesRoot, "licenses"),
  });
  console.log(
    `Generated packaged license bundle for ${result.packageCount} package copies ` +
    `(${result.uniqueLicenseTextCount} unique license texts).`,
  );

  // The portable NSIS launcher otherwise has to materialize thousands of tiny
  // files before it can show the application. Keep the complete standalone
  // runtime in one ASAR so ESM packages resolve through their normal ancestor
  // node_modules chain. A tiny external launcher points Next at the archive.
  // Licenses are generated first while the exact loose tree is inspectable.
  const runtimeArchive = join(webRoot, "runtime.asar");
  const temporaryArchive = join(resourcesRoot, `.web-runtime-${process.pid}.asar`);
  const originalServerSource = await readFile(join(webRoot, "server.js"), "utf8");
  const launcherSource = originalServerSource.replace(
    "const dir = path.join(__dirname)",
    "const dir = path.join(__dirname, 'runtime.asar')",
  );
  if (launcherSource === originalServerSource) {
    throw new Error("Unable to create the packaged ASAR server launcher");
  }
  const { createPackage } = require("@electron/asar");
  await rm(temporaryArchive, { force: true });
  await createPackage(webRoot, temporaryArchive);
  const archiveEntry = await lstat(temporaryArchive);
  if (!archiveEntry.isFile() || archiveEntry.size < 1_000_000) {
    throw new Error(`Packaged web runtime archive is missing or unexpectedly small: ${temporaryArchive}`);
  }
  await rm(webRoot, { recursive: true, force: true });
  await mkdir(webRoot, { recursive: true });
  await rename(temporaryArchive, runtimeArchive);
  await writeFile(join(webRoot, "server.js"), launcherSource, "utf8");
  console.log(`Archived the packaged web runtime into runtime.asar (${archiveEntry.size} bytes).`);
};

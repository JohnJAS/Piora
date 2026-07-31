/* eslint-disable @typescript-eslint/no-require-imports -- electron-builder loads afterPack hooks as CommonJS. */
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

module.exports = async function generatePackagedLicenses(context) {
  const scriptUrl = pathToFileURL(resolve(__dirname, "package-license-bundle.mjs")).href;
  const { generatePackageLicenseBundle } = await import(scriptUrl);
  const resourcesRoot = join(context.appOutDir, "resources");
  const result = await generatePackageLicenseBundle({
    webRoot: join(resourcesRoot, "web"),
    outputRoot: join(resourcesRoot, "licenses"),
  });
  console.log(
    `Generated packaged license bundle for ${result.packageCount} package copies ` +
    `(${result.uniqueLicenseTextCount} unique license texts).`,
  );
};

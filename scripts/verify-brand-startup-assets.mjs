import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { loadBranding, runtimeBranding } from "./branding-config.mjs";

export async function verifyBrandStartupAssets(projectRoot, resourcesRoot, requestedBrand) {
  const brand = await loadBranding(projectRoot, requestedBrand);
  const runtime = JSON.parse(await readFile(join(resourcesRoot, "brand.json"), "utf8"));
  if (JSON.stringify(runtime) !== JSON.stringify(runtimeBranding(brand))) throw new Error("Packaged startup brand configuration mismatch");
  const expected = new Map([["icon.png", join(projectRoot, ".branding/resources/icon.png")]]);
  if (brand.assets.startupVideo) expected.set("polaris-rover.mp4", brand.assets.startupVideo);
  if (brand.assets.startupPoster) expected.set("polaris-rover.jpg", brand.assets.startupPoster);
  const entries = await readdir(join(resourcesRoot, "startup"), { withFileTypes: true });
  if (entries.length !== expected.size || entries.some(entry => !entry.isFile() || !expected.has(entry.name))) {
    throw new Error("Packaged startup assets contain missing or unexpected brand media");
  }
  for (const [name, sourcePath] of expected) {
    const [source, packaged] = await Promise.all([readFile(sourcePath), readFile(join(resourcesRoot, "startup", name))]);
    if (!source.equals(packaged)) throw new Error(`Packaged startup asset differs from brand source: ${name}`);
  }
}

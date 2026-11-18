import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createJiti } from "jiti";
import { readFileSync } from "node:fs";
import { prepareDevelopmentBranding } from "./prepare-development.mjs";

// Local, read-only preview of the exact desktop document. No application state.
const standalone = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (standalone && !process.argv[3]) await prepareDevelopmentBranding();
const { createStartupDocument, loadStartupMedia } = await createJiti(import.meta.url).import("../desktop/src/startup-scene.ts");
const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
export function startupPreviewAsset(directory, url) {
  if (new URL(url, "http://127.0.0.1").pathname !== "/") return undefined;
  const body = createStartupDocument({ chinese: true, updated: true, version, ...loadStartupMedia(directory) });
  return { contentType: "text/html; charset=utf-8", body };
}

if (standalone) {
  const port = Number(process.argv[2] ?? 31043);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid preview port");
  const directory = resolve(process.argv[3] ?? ".branding/resources/startup");
  createServer((request, response) => {
    const asset = startupPreviewAsset(directory, request.url);
    if (!asset) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { "Content-Type": asset.contentType, "Cache-Control": "no-store" });
    response.end(asset.body);
  }).listen(port, "127.0.0.1", () => console.log(`Startup preview: http://127.0.0.1:${port}/`));
}

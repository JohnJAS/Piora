import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function extractVersionNotes(changelog, requestedTag) {
  const version = requestedTag.trim().replace(/^v/i, "");
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Invalid release tag: ${requestedTag}`);
  }
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const heading = new RegExp(`^## \\[${escapedVersion}\\][^\\r\\n]*\\r?\\n`, "m");
  const match = heading.exec(changelog);
  const remainder = match ? changelog.slice(match.index + match[0].length) : "";
  const nextHeadingIndex = remainder.search(/^## \[/m);
  const notes = (nextHeadingIndex >= 0 ? remainder.slice(0, nextHeadingIndex) : remainder).trim();
  if (!notes) throw new Error(`CHANGELOG.md does not contain release notes for ${version}`);
  return `${notes}\n\n### Downloads\n\n- Windows x64 installer (recommended): choose an installation directory and receive future in-app updates.\n- Windows x64 ZIP: extract, then run Piora.exe.\n- Windows x64 portable EXE: run the single executable directly; install the recommended edition to enable automatic updates.\n- Linux x64 AppImage: mark executable, then run it.\n\nPackages are not code-signed. Verify the selected package against SHA256SUMS.txt before running.\n`;
}

async function main() {
  const [, , requestedTag, outputPath] = process.argv;
  if (!requestedTag || !outputPath) {
    throw new Error("Usage: node scripts/create-release-notes.mjs <tag> <output-path>");
  }
  const changelog = await readFile(resolve("CHANGELOG.md"), "utf8");
  await writeFile(resolve(outputPath), extractVersionNotes(changelog, requestedTag), "utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

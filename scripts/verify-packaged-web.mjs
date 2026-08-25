#!/usr/bin/env node

import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { extractAll, listPackage } from "@electron/asar";
import { generateLicenseInventory } from "./generate-license-inventory.mjs";
import { generatePackageLicenseBundle } from "./package-license-bundle.mjs";
import {
  createIsolatedProcessEnvironment,
  prepareIsolatedEnvironment,
} from "./isolated-process-env.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const suppliedWebRoot = process.argv.find((argument, index) => index > 1 && !argument.startsWith("--"));
const packagedWebRoot = resolve(
  projectRoot,
  suppliedWebRoot ?? "desktop/release/win-unpacked/resources/web",
);
const requireElectronShell = !suppliedWebRoot || process.argv.includes("--require-electron-shell");
const token = "piora-package-verification";
const fixturePackageName = "@piora/packaged-extension-verification-fixture";
const fixtureCommandName = "packaged-extension-probe";
const fixtureToolName = "packaged_extension_probe";
const fixtureSkillName = "packaged-package-probe";
const fixtureSourceRoot = join(projectRoot, "scripts", "fixtures", "packaged-pi-extension");
const backgroundAssetRoot = "themes/dream-backgrounds";
const backgroundManifestName = "manifest.json";
const expectedBackgroundCount = 20;
const safeBackgroundAsset = /^\/themes\/dream-backgrounds\/[A-Za-z0-9][A-Za-z0-9._-]*\.webp$/;
const bundledPetRelativeRoot = "companion-pets/bundled/pekka-pal.codex-pet";
const bundledPetId = "pekka-pal.codex-pet";
const packagedRuntimeArchive = join(packagedWebRoot, "runtime.asar");
let activeServerStderr = "";

export const forbiddenPackagedDependencies = Object.freeze([
  "@giscus/react",
  "@lobehub/ui",
  "@splinetool/runtime",
  // Playwright's optional Electron-driver path is not used by Piora's
  // Chromium-only browser extension. Shipping it would duplicate Electron's
  // complete runtime inside the portable payload.
  "electron",
  "@electron/get",
  "@electron-internal/extract-zip",
]);

const requiredPaths = [
  "server.js",
  "extensions/piora-browser.ts",
  "extensions/piora-file-changes.ts",
  "extensions/piora-harmony.ts",
  "extensions/piora-goal.ts",
  "extensions/piora-plan.ts",
  "extensions/piora-room.ts",
  "lib/plan-artifact-registry.ts",
  "lib/team-agent-templates.ts",
  "lib/team-prompt-context.ts",
  "lib/team-run-store.ts",
  "lib/team-tool-service.ts",
  ".next/server/app/desktop-pet/page_client-reference-manifest.js",
  "node_modules/next/package.json",
  "node_modules/@earendil-works/pi-agent-core/package.json",
  "node_modules/@earendil-works/pi-ai/package.json",
  "node_modules/@earendil-works/pi-coding-agent/package.json",
  "node_modules/@earendil-works/pi-tui/package.json",
  "node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/dark.json",
];

async function assertFile(path) {
  const entry = await stat(path).catch(() => undefined);
  if (!entry?.isFile()) throw new Error(`Required packaged file is missing: ${path}`);
}

async function assertRegularFile(path, description) {
  const entry = await lstat(path).catch(() => undefined);
  if (!entry || entry.isSymbolicLink() || !entry.isFile()) {
    throw new Error(`${description} must be a regular file: ${path}`);
  }
}

/**
 * Verify the final packaged theme manifest and every declared preset image
 * byte-for-byte against the reviewed source assets. This runs against the
 * copied web payload, so a stale or incomplete Electron artifact cannot pass.
 */
export async function verifyPackagedBackgroundAssets(
  webRootInput,
  sourcePublicRootInput = join(projectRoot, "public"),
) {
  const webRoot = resolve(webRootInput);
  const sourcePublicRoot = resolve(sourcePublicRootInput);
  const sourceBackgroundRoot = join(sourcePublicRoot, backgroundAssetRoot);
  const packagedBackgroundRoot = join(webRoot, "public", backgroundAssetRoot);
  const sourceManifestPath = join(sourceBackgroundRoot, backgroundManifestName);
  const packagedManifestPath = join(packagedBackgroundRoot, backgroundManifestName);

  await assertRegularFile(sourceManifestPath, "Source background manifest");
  await assertRegularFile(packagedManifestPath, "Packaged background manifest");
  const [sourceManifestBytes, packagedManifestBytes] = await Promise.all([
    readFile(sourceManifestPath),
    readFile(packagedManifestPath),
  ]);
  if (!sourceManifestBytes.equals(packagedManifestBytes)) {
    throw new Error("Packaged background manifest differs from the source manifest");
  }

  let manifest;
  try {
    manifest = JSON.parse(sourceManifestBytes.toString("utf8"));
  } catch (error) {
    throw new Error("Source background manifest is not valid JSON", { cause: error });
  }
  if (manifest?.artworkStatus !== "complete" || !Array.isArray(manifest.presets)) {
    throw new Error("Source background manifest must declare a complete presets array");
  }
  if (manifest.presets.length !== expectedBackgroundCount) {
    throw new Error(
      `Source background manifest must declare exactly ${expectedBackgroundCount} presets`,
    );
  }

  const presetIds = new Set();
  const assetNames = new Set();
  for (const preset of manifest.presets) {
    if (typeof preset?.id !== "string" || !preset.id || presetIds.has(preset.id)) {
      throw new Error("Source background manifest contains a missing or duplicate preset id");
    }
    presetIds.add(preset.id);
    if (preset.artworkStatus !== "available" || !safeBackgroundAsset.test(preset.asset)) {
      throw new Error(`Background preset ${preset.id} does not reference a safe available WebP asset`);
    }
    const assetName = preset.asset.slice("/themes/dream-backgrounds/".length);
    if (assetNames.has(assetName)) {
      throw new Error(`Source background manifest contains a duplicate asset: ${assetName}`);
    }
    assetNames.add(assetName);
    const sourceAssetPath = join(sourceBackgroundRoot, assetName);
    const packagedAssetPath = join(packagedBackgroundRoot, assetName);
    await assertRegularFile(sourceAssetPath, "Source background asset");
    await assertRegularFile(packagedAssetPath, "Packaged background asset");
    const [sourceBytes, packagedBytes] = await Promise.all([
      readFile(sourceAssetPath),
      readFile(packagedAssetPath),
    ]);
    if (!sourceBytes.equals(packagedBytes)) {
      throw new Error(`Packaged background asset differs from source: ${assetName}`);
    }
  }

  const packagedEntries = await readdir(packagedBackgroundRoot, { withFileTypes: true });
  for (const entry of packagedEntries) {
    if (entry.isSymbolicLink()) {
      throw new Error(`Packaged background directory must not contain symlinks: ${entry.name}`);
    }
  }
  const packagedWebpNames = packagedEntries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".webp"))
    .map((entry) => entry.name)
    .sort();
  const expectedWebpNames = [...assetNames].sort();
  if (JSON.stringify(packagedWebpNames) !== JSON.stringify(expectedWebpNames)) {
    throw new Error(
      `Packaged background WebP set differs from the ${expectedBackgroundCount} manifest assets`,
    );
  }

  return { backgroundCount: expectedBackgroundCount };
}

export async function verifyPackagedCompanionAssets(
  webRootInput,
  sourcePublicRootInput = join(projectRoot, "public"),
) {
  const webRoot = resolve(webRootInput);
  const sourcePublicRoot = resolve(sourcePublicRootInput);
  const sourcePetRoot = join(sourcePublicRoot, bundledPetRelativeRoot);
  const packagedPetRoot = join(webRoot, "public", bundledPetRelativeRoot);

  for (const fileName of ["pet.json", "spritesheet.webp"]) {
    const sourcePath = join(sourcePetRoot, fileName);
    const packagedPath = join(packagedPetRoot, fileName);
    await assertRegularFile(sourcePath, `Source bundled pet ${fileName}`);
    await assertRegularFile(packagedPath, `Packaged bundled pet ${fileName}`);
    const [sourceBytes, packagedBytes] = await Promise.all([
      readFile(sourcePath),
      readFile(packagedPath),
    ]);
    if (!sourceBytes.equals(packagedBytes)) {
      throw new Error(`Packaged bundled pet asset differs from source: ${fileName}`);
    }
  }

  const manifest = JSON.parse(await readFile(join(sourcePetRoot, "pet.json"), "utf8"));
  if (
    manifest?.id !== bundledPetId
    || manifest?.spritesheetPath !== "spritesheet.webp"
    || manifest?.frame?.width !== 192
    || manifest?.frame?.height !== 208
    || manifest?.frame?.columns !== 8
    || manifest?.frame?.rows !== 11
  ) {
    throw new Error("Bundled companion manifest does not match the reviewed default pet geometry");
  }

  return {
    id: bundledPetId,
    spritesheetBytes: (await stat(join(packagedPetRoot, "spritesheet.webp"))).size,
  };
}

/**
 * Find forbidden packages at every nested node_modules boundary without
 * following symlinks. The walk is intentionally rooted at the packaged web
 * tree so it cannot inspect or reject dependencies from the developer checkout.
 */
export async function findForbiddenPackagedDependencies(
  root,
  dependencyNames = forbiddenPackagedDependencies,
) {
  const matches = [];
  const archivePath = join(resolve(root), "node_modules.asar");
  const archiveEntry = await stat(archivePath).catch(() => undefined);
  if (archiveEntry?.isFile()) {
    const archivePaths = new Set(
      listPackage(archivePath).map((entry) => entry.replace(/^[/\\]+/, "").replaceAll("\\", "/")),
    );
    for (const dependency of dependencyNames) {
      const match = [...archivePaths].find(
        (entry) => entry === dependency || entry.endsWith(`/node_modules/${dependency}`),
      );
      if (match) matches.push({ dependency, path: `${archivePath}!/${match}` });
    }
  }

  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const entryPath = join(directory, entry.name);
      if (entry.name === "node_modules") {
        for (const dependency of dependencyNames) {
          const dependencyPath = join(entryPath, ...dependency.split("/"));
          const dependencyEntry = await stat(dependencyPath).catch(() => undefined);
          if (dependencyEntry?.isDirectory()) {
            matches.push({ dependency, path: dependencyPath });
          }
        }
      }
      await walk(entryPath);
    }
  }

  await walk(resolve(root));
  return matches;
}

async function inspectElectronShell(webRoot, required) {
  // Supplying a web root explicitly verifies the standalone payload only.
  // Pass --require-electron-shell (or use the default path) to also require
  // app.asar, the platform executable, and bundled license notices.
  if (!required) return { checked: false, executable: null, executablePath: null };

  const resourcesRoot = dirname(webRoot);
  const unpackedRoot = dirname(resourcesRoot);
  const appAsarPath = join(resourcesRoot, "app.asar");
  const isWindowsPackage = /(^|-)win(?:32)?-unpacked$/i.test(unpackedRoot.split(/[\\/]/).at(-1) ?? "");
  const trayIconPath = join(resourcesRoot, isWindowsPackage ? "tray-icon.ico" : "tray-icon.png");
  const appAsar = await stat(appAsarPath).catch(() => undefined);

  if (!appAsar?.isFile()) {
    throw new Error(`Electron app.asar is missing beside the packaged web tree: ${appAsarPath}`);
  }
  await assertFile(trayIconPath);

  await generateLicenseInventory({ projectRoot, check: true });
  for (const fileName of ["LICENSE", "NOTICE", "THIRD_PARTY_LICENSES.md"]) {
    const sourcePath = join(projectRoot, fileName);
    const packagedPath = join(resourcesRoot, "licenses", fileName);
    await assertFile(packagedPath);
    const [sourceBytes, packagedBytes] = await Promise.all([
      readFile(sourcePath),
      readFile(packagedPath),
    ]);
    if (!sourceBytes.equals(packagedBytes)) {
      throw new Error(`Packaged project license material is stale or modified: ${fileName}`);
    }
  }
  const codexAttributionRoot = join(projectRoot, "third_party", "openai-codex");
  const packagedCodexAttributionRoot = join(resourcesRoot, "licenses", "openai-codex");
  for (const fileName of ["LICENSE", "NOTICE", "SOURCE.md"]) {
    const sourcePath = join(codexAttributionRoot, fileName);
    const packagedPath = join(packagedCodexAttributionRoot, fileName);
    await assertFile(sourcePath);
    await assertFile(packagedPath);
    const [sourceBytes, packagedBytes] = await Promise.all([
      readFile(sourcePath),
      readFile(packagedPath),
    ]);
    if (!sourceBytes.equals(packagedBytes)) {
      throw new Error(`Packaged OpenAI Codex attribution is stale or modified: ${fileName}`);
    }
  }
  const openPetsAttributionRoot = join(projectRoot, "third_party", "openpets");
  const packagedOpenPetsAttributionRoot = join(resourcesRoot, "licenses", "openpets");
  for (const fileName of ["LICENSE", "SOURCE.md"]) {
    const sourcePath = join(openPetsAttributionRoot, fileName);
    const packagedPath = join(packagedOpenPetsAttributionRoot, fileName);
    await assertFile(sourcePath);
    await assertFile(packagedPath);
    const [sourceBytes, packagedBytes] = await Promise.all([
      readFile(sourcePath),
      readFile(packagedPath),
    ]);
    if (!sourceBytes.equals(packagedBytes)) {
      throw new Error(`Packaged OpenPets attribution is stale or modified: ${fileName}`);
    }
  }
  for (const licensePath of [
    join(unpackedRoot, "LICENSE.electron.txt"),
    join(unpackedRoot, "LICENSES.chromium.html"),
  ]) {
    await assertFile(licensePath);
  }

  const packageLicenses = await generatePackageLicenseBundle({
    webRoot,
    outputRoot: join(resourcesRoot, "licenses"),
    check: true,
  });

  const executableCandidates = (await readdir(unpackedRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && (isWindowsPackage ? entry.name.toLowerCase().endsWith(".exe") : true))
    .map((entry) => entry.name);
  const expectedExecutable = isWindowsPackage ? "piora.exe" : "piora";
  const executable = executableCandidates.find((name) => name.toLowerCase() === expectedExecutable);
  if (!executable) {
    throw new Error(`The packaged Piora application executable was not found in ${unpackedRoot}`);
  }

  return {
    checked: true,
    executable,
    executablePath: join(unpackedRoot, executable),
    packageLicenses,
  };
}

async function fetchJson(origin, path, init = {}) {
  const response = await fetch(`${origin}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "X-Pi-Desktop-Token": token,
      ...init.headers,
    },
  });
  const responseText = await response.text();
  let body;
  try {
    body = JSON.parse(responseText);
  } catch {
    body = { error: responseText || "Response did not contain JSON" };
  }
  if (!response.ok) {
    throw new Error(
      `${path} returned HTTP ${response.status}: ${JSON.stringify(body)}` +
      (activeServerStderr ? `\nPackaged server stderr:\n${activeServerStderr}` : ""),
    );
  }
  return { response, body };
}

async function postJson(origin, path, body) {
  return fetchJson(origin, path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
    },
    body: JSON.stringify(body),
  });
}

function requireArrayEntry(items, predicate, description) {
  const match = items.find(predicate);
  if (!match) throw new Error(`Packaged Pi capability was not discovered: ${description}`);
  return match;
}

async function allocatePort() {
  return new Promise((resolvePort, rejectPort) => {
    const socket = createServer();
    socket.unref();
    socket.once("error", rejectPort);
    socket.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
      const address = socket.address();
      if (!address || typeof address === "string") {
        socket.close();
        rejectPort(new Error("Unable to allocate a verification port"));
        return;
      }
      socket.close((error) => error ? rejectPort(error) : resolvePort(address.port));
    });
  });
}

async function waitForHealth(origin, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/api/health`, {
        headers: { "X-Pi-Desktop-Token": token },
      });
      if (response.ok) return response;
      lastError = new Error(`Health endpoint returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
  }
  throw new Error("Packaged server did not become healthy", { cause: lastError });
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
  child.kill("SIGTERM");
  const stopped = await Promise.race([
    exited.then(() => true),
    new Promise((resolveDelay) => setTimeout(() => resolveDelay(false), 3_000)),
  ]);
  if (!stopped && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await Promise.race([
      exited,
      new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000)),
    ]);
  }
}

async function main() {
  await assertFile(packagedRuntimeArchive);
  await assertFile(join(packagedWebRoot, "server.js"));
  const packagedWebEntries = (await readdir(packagedWebRoot)).sort();
  if (JSON.stringify(packagedWebEntries) !== JSON.stringify(["runtime.asar", "server.js"])) {
    throw new Error(`Packaged web container must contain only the launcher and runtime archive: ${packagedWebEntries.join(", ")}`);
  }
  const launcherSource = await readFile(join(packagedWebRoot, "server.js"), "utf8");
  if (
    !launcherSource.includes("const dir = path.join(__dirname, 'runtime.asar')")
    || !launcherSource.includes("process.env.PIORA_WEB_RUNTIME_ROOT")
  ) {
    throw new Error("Packaged web launcher does not point Next and Piora capabilities at runtime.asar");
  }
  const inspectionDirectory = await mkdtemp(join(tmpdir(), "piora-runtime-inspection-"));
  const runtimeWebRoot = join(inspectionDirectory, "web");
  await extractAll(packagedRuntimeArchive, runtimeWebRoot);
  try {
  for (const requiredPath of requiredPaths) {
    await assertFile(join(runtimeWebRoot, requiredPath));
  }
  const patchedBundledDependencies = [
    { name: "brace-expansion", version: "5.0.9" },
    { name: "undici", version: "8.9.0" },
  ];
  for (const expected of patchedBundledDependencies) {
    const manifestPath = [
      "node_modules",
      "@earendil-works",
      "pi-coding-agent",
      "node_modules",
      expected.name,
      "package.json",
    ].join("/");
    await assertFile(join(runtimeWebRoot, ...manifestPath.split("/")));
    const manifest = JSON.parse(await readFile(join(runtimeWebRoot, ...manifestPath.split("/")), "utf8"));
    if (manifest?.name !== expected.name || manifest?.version !== expected.version) {
      throw new Error(
        `Packaged Pi runtime must contain the reviewed ${expected.name}@${expected.version}.`,
      );
    }
  }
  const looseNodeModules = await stat(join(packagedWebRoot, "node_modules")).catch(() => undefined);
  if (looseNodeModules) {
    throw new Error("Packaged web dependencies must be archived; loose node_modules would regress portable startup");
  }
  await assertFile(join(fixtureSourceRoot, "package.json"));
  await assertFile(join(fixtureSourceRoot, "extensions", "package-probe.js"));
  await assertFile(join(fixtureSourceRoot, "skills", "package-probe", "SKILL.md"));
  const packagedBackgrounds = await verifyPackagedBackgroundAssets(runtimeWebRoot);
  const packagedCompanion = await verifyPackagedCompanionAssets(runtimeWebRoot);

  const electronShell = await inspectElectronShell(packagedWebRoot, requireElectronShell);
  const forbiddenDependencyCopies = await findForbiddenPackagedDependencies(runtimeWebRoot);
  if (forbiddenDependencyCopies.length > 0) {
    throw new Error(
      `Packaged output contains development-only dependencies:\n${forbiddenDependencyCopies
        .map(({ dependency, path }) => `- ${dependency}: ${path}`)
        .join("\n")}`,
    );
  }

  const temporaryRoot = resolve(tmpdir());
  const temporaryDirectory = await mkdtemp(join(temporaryRoot, "piora-package-"));
  const temporaryRelativePath = relative(temporaryRoot, temporaryDirectory);
  if (
    !temporaryRelativePath
    || temporaryRelativePath === ".."
    || temporaryRelativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
    || isAbsolute(temporaryRelativePath)
  ) {
    throw new Error(`Refusing to use an unsafe verification directory: ${temporaryDirectory}`);
  }

  const isolatedWebRoot = join(temporaryDirectory, "web");
  let child;
  let stderr = "";
  try {
    await prepareIsolatedEnvironment(temporaryDirectory);
    await cp(packagedWebRoot, isolatedWebRoot, {
      recursive: true,
      dereference: true,
      force: true,
    });
    const isolatedAgentDir = join(temporaryDirectory, "agent");
    const isolatedHomeDir = join(temporaryDirectory, "home");
    const isolatedProjectDir = join(temporaryDirectory, "project");
    const isolatedFixturePackage = join(temporaryDirectory, "external-pi-package");
    const extensionMarker = join(temporaryDirectory, "extension-loaded.marker");
    await Promise.all([
      mkdir(isolatedAgentDir, { recursive: true }),
      mkdir(isolatedHomeDir, { recursive: true }),
      mkdir(isolatedProjectDir, { recursive: true }),
    ]);
    await cp(fixtureSourceRoot, isolatedFixturePackage, {
      recursive: true,
      dereference: true,
      force: true,
    });
    await writeFile(
      join(isolatedAgentDir, "settings.json"),
      `${JSON.stringify({
        enableSkillCommands: true,
        packages: [isolatedFixturePackage],
      }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(join(isolatedProjectDir, "README.md"), "# Package verification project\n", "utf8");

    const port = await allocatePort();
    const origin = `http://127.0.0.1:${port}`;
    const fixtureRuntimeExecutable = electronShell.executablePath ?? process.execPath;
    const fixtureRuntime = electronShell.executablePath
      ? "packaged-electron-run-as-node"
      : "host-node";
    child = spawn(fixtureRuntimeExecutable, ["server.js"], {
      cwd: isolatedWebRoot,
      env: createIsolatedProcessEnvironment(temporaryDirectory, {
        ...(electronShell.executablePath ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
        HOSTNAME: "127.0.0.1",
        PORT: String(port),
        NODE_ENV: "production",
        NODE_PATH: join(isolatedWebRoot, "runtime.asar", "node_modules"),
        NEXT_TELEMETRY_DISABLED: "1",
        HOME: isolatedHomeDir,
        USERPROFILE: isolatedHomeDir,
        PIORA_HOME: isolatedHomeDir,
        PI_CODING_AGENT_DIR: isolatedAgentDir,
        PI_PACKAGE_VERIFY_MARKER: extensionMarker,
        PI_WEB_ALLOWED_HOSTS: "127.0.0.1",
        PI_WEB_HOSTNAME: "127.0.0.1",
        PI_WEB_NO_OPEN: "1",
        PI_WEB_PASSWORD: "",
        PI_DESKTOP_TOKEN: token,
      }),
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-16_384);
      activeServerStderr = stderr;
    });

    const earlyExit = new Promise((_, rejectExit) => {
      child.once("error", rejectExit);
      child.once("exit", (code, signal) => {
        rejectExit(new Error(
          `Packaged server exited early (code=${String(code)}, signal=${String(signal)})\n${stderr}`,
        ));
      });
    });
    await Promise.race([waitForHealth(origin, 30_000), earlyExit]);

    const unauthorized = await fetch(`${origin}/api/health`);
    if (unauthorized.status !== 403) {
      throw new Error(`Health endpoint without a desktop token returned ${unauthorized.status}`);
    }
    const rootResponse = await fetch(`${origin}/`, {
      headers: { "X-Pi-Desktop-Token": token },
    });
    if (!rootResponse.ok) throw new Error(`Packaged root page returned ${rootResponse.status}`);
    const companionPageResponse = await fetch(`${origin}/desktop-pet`, {
      headers: { "X-Pi-Desktop-Token": token },
    });
    if (!companionPageResponse.ok) {
      throw new Error(`Packaged companion page returned ${companionPageResponse.status}`);
    }

    const { response: newSessionResponse, body: newSession } = await postJson(
      origin,
      "/api/agent/new",
      { cwd: isolatedProjectDir, type: "ensure_session" },
    );
    if (typeof newSession.sessionId !== "string" || !newSession.sessionId) {
      throw new Error(`Packaged agent session did not return a session id: ${JSON.stringify(newSession)}`);
    }

    await assertFile(extensionMarker);

    const { body: plugins } = await fetchJson(
      origin,
      `/api/plugins?cwd=${encodeURIComponent(isolatedProjectDir)}`,
    );
    const fixturePackage = requireArrayEntry(
      Array.isArray(plugins.packages) ? plugins.packages : [],
      (entry) => entry.packageName === fixturePackageName,
      `Pi package ${fixturePackageName}`,
    );
    if (fixturePackage.status !== "loaded") {
      throw new Error(`Fixture Pi package was discovered but is not loaded: ${JSON.stringify(fixturePackage)}`);
    }
    if (fixturePackage.counts?.extensions !== 1 || fixturePackage.counts?.skills !== 1) {
      throw new Error(`Fixture Pi package resource counts are incorrect: ${JSON.stringify(fixturePackage.counts)}`);
    }

    const { body: skills } = await fetchJson(
      origin,
      `/api/skills?cwd=${encodeURIComponent(isolatedProjectDir)}`,
    );
    requireArrayEntry(
      Array.isArray(skills.skills) ? skills.skills : [],
      (entry) => entry.name === fixtureSkillName,
      `Pi package skill ${fixtureSkillName}`,
    );

    const { body: extensionInventory } = await fetchJson(
      origin,
      `/api/extensions?cwd=${encodeURIComponent(isolatedProjectDir)}`,
    );
    const extensionDiagnostics = Array.isArray(extensionInventory.diagnostics)
      ? extensionInventory.diagnostics
      : [];
    if (extensionDiagnostics.length > 0) {
      throw new Error(`Packaged first-party extensions failed to load: ${JSON.stringify(extensionDiagnostics)}`);
    }

    const agentPath = `/api/agent/${encodeURIComponent(newSession.sessionId)}`;
    const { body: commandResult } = await postJson(origin, agentPath, { type: "get_commands" });
    const commands = Array.isArray(commandResult.data?.commands) ? commandResult.data.commands : [];
    requireArrayEntry(
      commands,
      (entry) => entry.name === fixtureCommandName && entry.source === "extension",
      `extension command /${fixtureCommandName}`,
    );
    requireArrayEntry(
      commands,
      (entry) => entry.name === `skill:${fixtureSkillName}` && entry.source === "skill",
      `skill command /skill:${fixtureSkillName}`,
    );

    const { body: toolResult } = await postJson(origin, agentPath, { type: "get_tools" });
    const tools = Array.isArray(toolResult.data) ? toolResult.data : [];
    const fixtureTool = requireArrayEntry(
      tools,
      (entry) => entry.name === fixtureToolName,
      `extension tool ${fixtureToolName}`,
    );
    if (!fixtureTool.active) {
      throw new Error(`Fixture extension tool is loaded but inactive: ${JSON.stringify(fixtureTool)}`);
    }

    const harmonyTools = [
      "harmony_list_devices",
      "harmony_acquire_control",
      "harmony_observe_screen",
      "harmony_tap",
      "harmony_double_tap",
      "harmony_long_press",
      "harmony_swipe",
      "harmony_fling",
      "harmony_drag",
      "harmony_input_text",
      "harmony_back",
      "harmony_home",
      "harmony_recent_apps",
      "harmony_enter",
      "harmony_launch_app",
      "harmony_wait_for",
      "harmony_wait_until_stable",
      "harmony_wait",
      "harmony_list_processes",
      "harmony_get_raw_logs",
      "harmony_read_logs",
      "harmony_release_control",
    ];
    const coreExtensionTools = [
      "browser",
      ...harmonyTools,
      "piora_goal",
      "piora_plan",
      "piora_plan_execution",
      "piora_room",
    ].map((name) => {
      const tool = tools.find((entry) => entry.name === name);
      return { name, loaded: Boolean(tool), active: tool?.active === true };
    });
    const unavailableCoreTools = coreExtensionTools.filter((tool) => !tool.loaded || !tool.active);
    if (unavailableCoreTools.length > 0) {
      throw new Error(`Packaged first-party tools are unavailable: ${JSON.stringify(unavailableCoreTools)}`);
    }

    const pioraOwnedSubagentEntries = [...commands, ...tools].filter((entry) => (
      typeof entry.name === "string" && /^(?:pi[-_]?gui)[-_]?sub[-_]?agents?$/i.test(entry.name)
    ));
    if (pioraOwnedSubagentEntries.length > 0) {
      throw new Error(`Unexpected Piora-owned SubAgent capability: ${JSON.stringify(pioraOwnedSubagentEntries)}`);
    }

    console.log(JSON.stringify({
      isolated: true,
      dependencyChecks: requiredPaths.length,
      patchedBundledDependencies: patchedBundledDependencies.map(({ name, version }) => `${name}@${version}`),
      forbiddenDependencyChecks: forbiddenPackagedDependencies.length,
      packagedBackgrounds: packagedBackgrounds.backgroundCount,
      packagedCompanion,
      electronShellChecked: electronShell.checked,
      executable: electronShell.executable,
      fixtureRuntime,
      licensedPackageCopies: electronShell.packageLicenses?.packageCount ?? null,
      uniquePackagedLicenseTexts: electronShell.packageLicenses?.uniqueLicenseTextCount ?? null,
      unauthorizedStatus: unauthorized.status,
      healthStatus: 200,
      rootStatus: rootResponse.status,
      companionPageStatus: companionPageResponse.status,
      agentSessionStatus: newSessionResponse.status,
      piPackage: fixturePackageName,
      extensionCommand: fixtureCommandName,
      extensionTool: fixtureToolName,
      coreExtensionTools,
      skill: fixtureSkillName,
      pioraOwnedSubagentFeatures: 0,
    }));
  } finally {
    if (child) await stopChild(child);
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  } finally {
    await rm(inspectionDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}

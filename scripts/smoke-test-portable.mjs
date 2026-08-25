#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import {
  createIsolatedProcessEnvironment,
  prepareIsolatedEnvironment,
} from "./isolated-process-env.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STRICT_VERSION = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
// The first launch prepares the artifact-specific Electron runtime cache. On
// slower Windows disks that one-time copy can take several minutes, while the
// repeat-launch path is independently capped at three seconds below.
export const DEFAULT_PORTABLE_SMOKE_TIMEOUT_MS = 900_000;
export const MAX_PORTABLE_STARTUP_MS = 3_000;

export function getPortableDisplayEnvironment(
  hostEnvironment = process.env,
  platform = process.platform,
) {
  if (platform !== "linux") return {};
  return Object.fromEntries(
    ["DISPLAY", "XAUTHORITY"]
      .map((key) => [key, hostEnvironment[key]])
      .filter(([, value]) => typeof value === "string" && value),
  );
}

export function validateStartupMarker(markerText) {
  let marker;
  try {
    const normalizedText = markerText.replace(/^\uFEFF/, "").replaceAll("\0", "");
    marker = JSON.parse(normalizedText);
  } catch (error) {
    throw new Error(`Portable EXE wrote malformed startup JSON: ${markerText}`, { cause: error });
  }
  if (
    marker?.schema !== "piora-startup-v1"
    || marker?.ready !== true
    || !["electron-shell", "portable-splash"].includes(marker?.surface)
  ) {
    throw new Error(`Portable EXE wrote an invalid startup marker: ${markerText}`);
  }
  return marker;
}

export function normalizeExpectedVersion(value) {
  if (value === undefined) return undefined;
  const match = STRICT_VERSION.exec(value);
  if (!match) {
    throw new Error(`Expected version must match X.Y.Z or vX.Y.Z: ${value}`);
  }
  return value.startsWith("v") ? value.slice(1) : value;
}

export function validatePortableSmokeMarker(markerText, expectedVersion) {
  let marker;
  try {
    marker = JSON.parse(markerText);
  } catch (error) {
    throw new Error(`Portable EXE wrote malformed smoke-test JSON: ${markerText}`, { cause: error });
  }
  if (
    marker?.schema !== "piora-portable-smoke-v1"
    || marker?.ok !== true
    || typeof marker?.appVersion !== "string"
    || !marker.appVersion
    || marker?.rendererLoaded !== true
    || marker?.preloadBridgeReady !== true
    || marker?.appShellReady !== true
  ) {
    throw new Error(`Portable EXE wrote an invalid smoke-test marker: ${markerText}`);
  }
  const normalizedExpectedVersion = normalizeExpectedVersion(expectedVersion);
  if (normalizedExpectedVersion && marker.appVersion !== normalizedExpectedVersion) {
    throw new Error(
      `Portable EXE version ${marker.appVersion} does not match expected version ${normalizedExpectedVersion}.`,
    );
  }
  return marker;
}

export async function findPortableExecutable(releaseRoot) {
  const entries = await readdir(releaseRoot, { withFileTypes: true });
  const portable = entries
    .filter((entry) => entry.isFile() && /-portable\.exe$/i.test(entry.name))
    .map((entry) => resolve(releaseRoot, entry.name));
  if (portable.length !== 1) {
    throw new Error(`Expected exactly one portable EXE in ${releaseRoot}; found ${portable.length}.`);
  }
  return portable[0];
}

function assertSafeTemporaryDirectory(directory) {
  const temporaryRoot = resolve(tmpdir());
  const relativePath = relative(temporaryRoot, directory);
  if (
    !relativePath
    || relativePath === ".."
    || relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
    || isAbsolute(relativePath)
  ) {
    throw new Error(`Refusing to use an unsafe smoke-test directory: ${directory}`);
  }
}

async function waitForMarker(markerPath, timeoutMs, signal, markerName = "healthy-service") {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal.aborted) throw new Error("Portable EXE marker wait was cancelled.");
    const marker = await readFile(markerPath, "utf8").catch(() => undefined);
    if (marker !== undefined) return marker;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
  }
  throw new Error(`Portable EXE did not write its ${markerName} marker within ${timeoutMs} ms.`);
}

async function terminateChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
  child.kill("SIGKILL");
  await Promise.race([
    exited,
    new Promise((resolveDelay) => setTimeout(resolveDelay, 3_000)),
  ]);
}

async function terminateExtractedPortableProcesses(temporaryDirectory) {
  if (process.platform !== "win32") return;

  const script = [
    "$root = [System.IO.Path]::GetFullPath($env:PIORA_SMOKE_PROCESS_ROOT)",
    "$prefix = $root.TrimEnd('\\') + '\\'",
    "Get-CimInstance Win32_Process | Where-Object { ($_.ExecutablePath -and [System.IO.Path]::GetFullPath($_.ExecutablePath).StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) -or ($_.CommandLine -and $_.CommandLine.IndexOf($root, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
  ].join("; ");

  await new Promise((resolveTermination, rejectTermination) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      {
        env: {
          ...process.env,
          PIORA_SMOKE_PROCESS_ROOT: temporaryDirectory,
        },
        windowsHide: true,
      },
      (error) => {
        if (error) rejectTermination(error);
        else resolveTermination();
      },
    );
  });
}

async function preparePortableRuntimeCache({
  executable,
  temporaryDirectory,
  paths,
  timeoutMs,
  expectedVersion,
}) {
  const markerPath = join(temporaryDirectory, "cache-preparation.json");
  const startupMarkerPath = join(temporaryDirectory, "cache-preparation-startup.json");
  const markerAbort = new AbortController();
  let child;

  try {
    child = spawn(executable, ["--smoke-test", `--user-data-dir=${paths.userData}`], {
      cwd: temporaryDirectory,
      env: createIsolatedProcessEnvironment(temporaryDirectory, {
        ...getPortableDisplayEnvironment(),
        PIORA_SMOKE_TEST: "1",
        PIORA_SMOKE_MARKER: markerPath,
        PIORA_SMOKE_STARTUP_MARKER: startupMarkerPath,
        PIORA_SMOKE_USER_DATA: paths.userData,
        PI_CODING_AGENT_DIR: join(temporaryDirectory, "agent"),
        NEXT_TELEMETRY_DISABLED: "1",
      }),
      shell: false,
      windowsHide: true,
      stdio: "ignore",
    });
    const markerText = await waitForMarker(
      markerPath,
      timeoutMs,
      markerAbort.signal,
      "cache-preparation",
    );
    validatePortableSmokeMarker(markerText, expectedVersion);
  } finally {
    markerAbort.abort();
    if (child) await terminateChild(child);
    await terminateExtractedPortableProcesses(temporaryDirectory);
  }
}

export async function smokeTestPortableExecutable(
  executablePath,
  {
    timeoutMs = DEFAULT_PORTABLE_SMOKE_TIMEOUT_MS,
    expectedVersion,
    preparePortableCache = true,
    startupBudgetMs = MAX_PORTABLE_STARTUP_MS,
  } = {},
) {
  const executable = resolve(executablePath);
  if (!(await stat(executable).catch(() => undefined))?.isFile()) {
    throw new Error(`Portable EXE does not exist: ${executable}`);
  }

  const temporaryDirectory = await mkdtemp(join(resolve(tmpdir()), "piora-portable-smoke-"));
  assertSafeTemporaryDirectory(temporaryDirectory);
  const paths = await prepareIsolatedEnvironment(temporaryDirectory);
  await mkdir(join(temporaryDirectory, "agent"), { recursive: true });
  const markerPath = join(temporaryDirectory, "healthy-service.json");
  const startupMarkerPath = join(temporaryDirectory, "startup-window.json");
  let stdout = "";
  let stderr = "";
  let child;
  const markerAbort = new AbortController();

  try {
    if (preparePortableCache) {
      // The single-file wrapper necessarily extracts Electron once. That cold
      // preparation is allowed the overall smoke timeout; the user-visible
      // repeat-launch path below must then reach the Electron shell in 3 s.
      await preparePortableRuntimeCache({
        executable,
        temporaryDirectory,
        paths,
        timeoutMs,
        expectedVersion,
      });
    }

    const launchedAt = performance.now();
    child = spawn(executable, ["--smoke-test", `--user-data-dir=${paths.userData}`], {
      cwd: temporaryDirectory,
      env: createIsolatedProcessEnvironment(temporaryDirectory, {
        ...getPortableDisplayEnvironment(),
        PIORA_SMOKE_TEST: "1",
        PIORA_SMOKE_MARKER: markerPath,
        PIORA_SMOKE_STARTUP_MARKER: startupMarkerPath,
        PIORA_SMOKE_USER_DATA: paths.userData,
        PI_CODING_AGENT_DIR: join(temporaryDirectory, "agent"),
        NEXT_TELEMETRY_DISABLED: "1",
      }),
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk).slice(-16_384); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-16_384); });

    const markerStartup = waitForMarker(
      startupMarkerPath,
      startupBudgetMs,
      markerAbort.signal,
      "startup-window",
    ).then(validateStartupMarker);
    // A pre-extraction NSIS splash is useful immediate feedback, but it must
    // not satisfy the performance gate by itself: the Electron-owned shell
    // must replace it inside the same three-second budget.
    const startupSurface = await markerStartup;
    const startupMs = performance.now() - launchedAt;
    if (startupMs > startupBudgetMs) {
      throw new Error(`Portable EXE cached launch took ${startupMs.toFixed(0)} ms; budget is ${startupBudgetMs} ms.`);
    }

    // The electron-builder portable wrapper can remain alive while its
    // extracted Electron process is already healthy (and can also outlive the
    // app during NSIS cleanup). The marker is the actual end-to-end contract:
    // it is written only after the bundled service, preload bridge, renderer,
    // and app shell are all ready. Once validated, the test owns cleanup of
    // both the wrapper and every extracted process under its isolated root.
    const markerText = await waitForMarker(markerPath, timeoutMs, markerAbort.signal);
    const marker = validatePortableSmokeMarker(markerText, expectedVersion);
    return {
      executable,
      appVersion: marker.appVersion,
      expectedVersion: normalizeExpectedVersion(expectedVersion) ?? null,
      isolatedUserData: true,
      bundledServiceHealthy: true,
      rendererLoaded: marker.rendererLoaded,
      preloadBridgeReady: marker.preloadBridgeReady,
      appShellReady: marker.appShellReady,
      startupMs: Math.round(startupMs),
      startupBudgetMs,
      startupSurface: startupSurface.surface,
    };
  } catch (error) {
    const logCandidates = [
      join(paths.userData, "logs", "piora.log"),
      join(paths.appData, "Piora", "logs", "piora.log"),
    ];
    const logs = [];
    for (const logPath of logCandidates) {
      const content = await readFile(logPath, "utf8").catch(() => undefined);
      if (content) logs.push(`${logPath}:\n${content.slice(-16_384)}`);
    }
    const diagnostic = [stderr, stdout, ...logs].filter(Boolean).join("\n");
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      diagnostic ? `${message}\n${diagnostic}` : message,
      { cause: error },
    );
  } finally {
    markerAbort.abort();
    if (child) await terminateChild(child);
    await terminateExtractedPortableProcesses(temporaryDirectory);
    await rm(temporaryDirectory, {
      recursive: true,
      force: true,
      maxRetries: process.platform === "win32" ? 20 : 0,
      retryDelay: 250,
    });
  }
}

async function main() {
  const arguments_ = process.argv.slice(2);
  let suppliedExecutable;
  let expectedVersion;
  let packagedRuntime = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--expected-version") {
      expectedVersion = arguments_[index + 1];
      if (!expectedVersion) throw new Error("--expected-version requires X.Y.Z or vX.Y.Z");
      index += 1;
    } else if (argument === "--packaged-runtime") {
      packagedRuntime = true;
    } else if (argument.startsWith("--")) {
      throw new Error(`Unknown argument: ${argument}`);
    } else if (suppliedExecutable) {
      throw new Error(`Unexpected additional executable path: ${argument}`);
    } else {
      suppliedExecutable = argument;
    }
  }
  const executable = suppliedExecutable
    ? resolve(projectRoot, suppliedExecutable)
    : await findPortableExecutable(resolve(projectRoot, "desktop", "release"));
  const result = await smokeTestPortableExecutable(executable, {
    expectedVersion,
    preparePortableCache: !packagedRuntime,
    startupBudgetMs: packagedRuntime ? 10_000 : MAX_PORTABLE_STARTUP_MS,
  });
  console.log(JSON.stringify(result));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}

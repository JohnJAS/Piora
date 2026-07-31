#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createIsolatedProcessEnvironment,
  prepareIsolatedEnvironment,
} from "./isolated-process-env.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STRICT_VERSION = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
// The portable NSIS wrapper must unpack and later remove the complete Electron
// payload. On slower Windows disks that cleanup alone can exceed 90 seconds,
// even after the renderer has written a healthy marker.
export const DEFAULT_PORTABLE_SMOKE_TIMEOUT_MS = 300_000;

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
    marker?.schema !== "pigui-portable-smoke-v1"
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

function waitForExit(child, timeoutMs) {
  return new Promise((resolveExit, rejectExit) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      rejectExit(new Error(`Portable EXE did not exit within ${timeoutMs} ms.`));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectExit(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolveExit({ code, signal });
    });
  });
}

async function waitForMarker(markerPath, timeoutMs, signal) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal.aborted) throw new Error("Portable EXE marker wait was cancelled.");
    const marker = await readFile(markerPath, "utf8").catch(() => undefined);
    if (marker !== undefined) return marker;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
  }
  throw new Error(`Portable EXE did not write its healthy-service marker within ${timeoutMs} ms.`);
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

export async function smokeTestPortableExecutable(
  executablePath,
  { timeoutMs = DEFAULT_PORTABLE_SMOKE_TIMEOUT_MS, expectedVersion } = {},
) {
  const executable = resolve(executablePath);
  if (!(await stat(executable).catch(() => undefined))?.isFile()) {
    throw new Error(`Portable EXE does not exist: ${executable}`);
  }

  const temporaryDirectory = await mkdtemp(join(resolve(tmpdir()), "pigui-portable-smoke-"));
  assertSafeTemporaryDirectory(temporaryDirectory);
  const paths = await prepareIsolatedEnvironment(temporaryDirectory);
  await mkdir(join(temporaryDirectory, "agent"), { recursive: true });
  const markerPath = join(temporaryDirectory, "healthy-service.json");
  let stdout = "";
  let stderr = "";
  let child;
  const markerAbort = new AbortController();

  try {
    child = spawn(executable, ["--smoke-test", `--user-data-dir=${paths.userData}`], {
      cwd: temporaryDirectory,
      env: createIsolatedProcessEnvironment(temporaryDirectory, {
        PI_GUI_SMOKE_TEST: "1",
        PI_GUI_SMOKE_MARKER: markerPath,
        PI_GUI_SMOKE_USER_DATA: paths.userData,
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

    const [exit, markerText] = await Promise.all([
      waitForExit(child, timeoutMs),
      waitForMarker(markerPath, timeoutMs, markerAbort.signal),
    ]);
    if (exit.code !== 0) {
      throw new Error(
        `Portable EXE smoke test failed (code=${String(exit.code)}, signal=${String(exit.signal)}).\n${stderr || stdout}`,
      );
    }
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
    };
  } finally {
    markerAbort.abort();
    if (child) await terminateChild(child);
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function main() {
  const arguments_ = process.argv.slice(2);
  let suppliedExecutable;
  let expectedVersion;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--expected-version") {
      expectedVersion = arguments_[index + 1];
      if (!expectedVersion) throw new Error("--expected-version requires X.Y.Z or vX.Y.Z");
      index += 1;
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
  const result = await smokeTestPortableExecutable(executable, { expectedVersion });
  console.log(JSON.stringify(result));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}

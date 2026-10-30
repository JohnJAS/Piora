import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { x } from "tar";
import { DSH_PET_VERSION, type DshPetProgress } from "./dsh-pet-types.js";

const NPM_VERSION = "11.6.2";
const NPM_INTEGRITY = "7iKzNfy8lWYs3zq4oFPa8EXZz5xt9gQNKJZau3B1ErLBb6bF7sBJ00x09485DOvRT2l5Gerbl3VlZNT57MxJVA==";
const PET_INTEGRITY = "E1ymE0/a1k2MJco2JDcWeqwMttjWNZWt5yMEN+jjKwWD+H2XT5OMUDmazMLhNnN5grmL9+lbE94iyEQMn5p+JA==";

export function verifyDownload(bytes: Uint8Array, integrity: string): void {
  if (createHash("sha512").update(bytes).digest("base64") !== integrity) throw new Error("Download integrity check failed");
}

async function download(url: string, file: string, integrity: string, maxBytes: number, signal: AbortSignal, progress: (received: number, total: number | null) => void): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(1_200_000)]) });
  if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status}`);
  const total = Number(response.headers.get("content-length")) || null;
  progress(0, total);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > maxBytes) { await response.body.cancel().catch(() => {}); throw new Error("Download too large"); }
    chunks.push(chunk);
    progress(size, total);
  }
  const bytes = Buffer.concat(chunks);
  verifyDownload(bytes, integrity);
  await writeFile(file, bytes);
}

/** Only paths below this extension's private root can be removed. */
export async function removePetDirectory(root: string, target: string): Promise<void> {
  if (!resolve(target).startsWith(resolve(root) + sep)) throw new Error("Invalid extension directory");
  await rm(target, { recursive: true, force: true });
}

export function petEnvironment(root: string, environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  // Keep OS/display/network essentials, never inherit provider credentials or Pi/DSH overrides.
  const allowed = /^(path|pathext|systemroot|windir|comspec|temp|tmp|home|userprofile|appdata|localappdata|programfiles(?:\(x86\))?|programw6432|systemdrive|processor_architecture|processor_identifier|number_of_processors|lang|lc_all|display|xauthority|wayland_display|xdg_runtime_dir|dbus_session_bus_address|https?_proxy|all_proxy|no_proxy|node_extra_ca_certs|ssl_cert_file|ssl_cert_dir)$/i;
  const env = Object.fromEntries(Object.entries(environment).filter(([key, value]) => allowed.test(key) && typeof value === "string"));
  return { ...env, NODE_ENV: "production", ELECTRON_RUN_AS_NODE: "1", DSH_HOME: join(root, "home"),
    NPM_CONFIG_CACHE: join(root, "npm-cache"), NPM_CONFIG_USERCONFIG: join(root, "npmrc"),
    NPM_CONFIG_GLOBALCONFIG: join(root, "npmrc-global") };
}

/** A narrow, version-pinned adaptation: upstream otherwise shares Chromium data with an existing DSH install. */
export function isolateHelper(source: string): string {
  const anchor = "app.setName('dsh-pet-electron-helper');";
  if (source.split(anchor).length !== 2) throw new Error("Unsupported dsh-pet helper layout");
  return source.replace(anchor, `${anchor}\n// Piora adaptation: isolate this helper from other DSH installations.\napp.setPath('userData', path.join(process.env.DSH_HOME, 'electron-profile'));`);
}

export async function installPet(root: string, signal: AbortSignal, progress: (value: DshPetProgress) => void = () => {}): Promise<void> {
  const staging = join(root, "staging");
  await removePetDirectory(root, staging);
  await mkdir(join(staging, "npm"), { recursive: true });
  await mkdir(join(root, "home", "electron-profile"), { recursive: true });
  await writeFile(join(root, "npmrc"), "registry=https://registry.npmjs.org/\n");
  await writeFile(join(root, "npmrc-global"), "");
  try {
    progress({ stage: "installer", received: 0, total: null });
    await download(`https://registry.npmjs.org/npm/-/npm-${NPM_VERSION}.tgz`, join(staging, "npm.tgz"), NPM_INTEGRITY, 20 * 1024 * 1024, signal,
      (received, total) => progress({ stage: "installer", received, total }));
    await x({ file: join(staging, "npm.tgz"), cwd: join(staging, "npm"), strip: 1,
      filter: (name, entry) => !name.split(/[\\/]/).includes("..") && "type" in entry && ["File", "Directory"].includes(entry.type) });
    progress({ stage: "package", received: 0, total: null });
    await download(`https://registry.npmjs.org/dsh-pet/-/dsh-pet-${DSH_PET_VERSION}.tgz`, join(staging, "pet.tgz"), PET_INTEGRITY, 100 * 1024 * 1024, signal,
      (received, total) => progress({ stage: "package", received, total }));
    progress({ stage: "dependencies", received: 0, total: null });
    await writeFile(join(staging, "package.json"), JSON.stringify({ name: "piora-dsh-pet-runtime", private: true }));
    await new Promise<void>((resolveInstall, reject) => {
      const child = spawn(process.execPath, [join(staging, "npm", "bin", "npm-cli.js"), "install", "./pet.tgz",
        "--ignore-scripts", "--legacy-peer-deps", "--omit=dev", "--no-audit", "--no-fund", "--workspaces=false"],
      { cwd: staging, env: petEnvironment(root), windowsHide: true, stdio: ["ignore", "ignore", "pipe"], signal: AbortSignal.any([signal, AbortSignal.timeout(600_000)]) });
      let error = "";
      child.stderr?.on("data", data => { error = (error + String(data)).slice(-2000); });
      // Abort emits error before exit: wait for the writer to stop before removing staging.
      let failure: Error | undefined;
      child.once("error", cause => { failure = cause; if (!child.pid) reject(cause); });
      child.once("close", code => failure ? reject(failure) : code === 0 ? resolveInstall() : reject(new Error(`Dependency installation failed (${code}): ${error}`)));
    });
    signal.throwIfAborted();
    const packageRoot = join(staging, "node_modules", "dsh-pet");
    for (const file of ["lib/standalone.js", "runtime/electron-helper/shared-core.js"]) await readFile(join(packageRoot, file));
    const helper = join(packageRoot, "runtime", "electron-helper", "main.js");
    await writeFile(helper, isolateHelper(await readFile(helper, "utf8")));
    await writeFile(join(staging, "piora-adapter.json"), JSON.stringify({ version: DSH_PET_VERSION, adapter: 1 }));
    // Installation is only offered while absent: an existing working version is never deleted first.
    await rename(staging, join(root, "installed"));
  } finally {
    await removePetDirectory(root, staging);
  }
}

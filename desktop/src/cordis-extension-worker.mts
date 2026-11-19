import { Context, FiberState, Inject, type Plugin } from "@deepseek-ai/cordis";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { isAssetPath, isRpcName, makeJson, type CordisPackage, type Json } from "./cordis-extension-contract.js";
import type { CordisBoot, HostCancel, HostRequest, HostResponse, HostService, HostServiceRequest } from "./cordis-host-protocol.js";

const ctx = new Context();
const methods = new Map<string, (payload: Json, signal: AbortSignal) => unknown>();
const requests = new Map<number, AbortController>();
const services = new Map<number, { finish: (value: HostResponse) => void }>();
const shutdown = new AbortController();
const activeRequest = new AsyncLocalStorage<AbortSignal>();
let sequence = 0;
let version: string | undefined;
let disposal: Promise<void> | undefined;
let booting = false;

function send(message: HostResponse | HostServiceRequest | HostCancel) {
  if (process.connected) process.send?.(message, () => { /* Disconnect owns cleanup. */ });
}

function call(service: HostService, input?: unknown, signal?: AbortSignal): Promise<Json> {
  const scope = activeRequest.getStore();
  const deadline = AbortSignal.any([shutdown.signal, AbortSignal.timeout(service === "model" ? 120_000 : 10_000),
    ...(scope ? [scope] : []), ...(signal ? [signal] : [])]);
  deadline.throwIfAborted();
  if (services.size >= 16) throw new Error("The extension has too many pending service calls");
  const payload = makeJson(input, service === "model" ? 18 * 1024 * 1024 : 64 * 1024);
  return new Promise<Json>((resolve, reject) => {
    const id = ++sequence;
    const abort = () => {
      services.delete(id);
      send({ type: "cancel", id });
      reject(deadline.reason);
    };
    deadline.addEventListener("abort", abort, { once: true });
    services.set(id, { finish: response => {
      services.delete(id);
      deadline.removeEventListener("abort", abort);
      if (response.error) reject(new Error(response.error));
      else resolve(response.value ?? null);
    } });
    send({ type: "service", id, service, input: payload });
  });
}

export function extensionStorage(root: string) {
  const path = (key: string) => {
    if (!isRpcName(key) || !isAssetPath(key)) throw new Error("Invalid extension storage key");
    return join(root, key + ".json");
  };
  return {
    async read(key: string): Promise<Json> {
      try {
        const file = path(key);
        if ((await stat(file)).size > 256 * 1024) throw new Error("Extension data exceeds its size limit");
        return JSON.parse(await readFile(file, "utf8")) as Json;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async write(key: string, input: unknown): Promise<void> {
      const file = path(key);
      const data = makeJson(input, 256 * 1024);
      const temporary = file + "." + randomUUID() + ".tmp";
      try {
        await writeFile(temporary, JSON.stringify(data), { flag: "wx", flush: true });
        await rename(temporary, file);
      } finally { await rm(temporary, { force: true }); }
    },
  };
}

function packageRoot(boot: CordisBoot, name: string) { return join(boot.slot, "node_modules", name); }

async function bootHost(boot: CordisBoot, signal: AbortSignal) {
  const release = boot.release;
  const storage = extensionStorage(boot.data);
  const bridge = {
    pioraTasks: { list: () => call("tasks") },
    pioraModels: { complete: (input: unknown, signal?: AbortSignal) => call("model", input, signal) },
    pioraNotifications: { show: (input: unknown) => call("notify", input) },
    pioraWindows: { open: () => call("openPanel"), close: () => call("closePanel") },
    pioraStorage: storage,
    pioraResources: {
      async read(name: string, path: string): Promise<string> {
        const pkg = release.packages.find(item => item.name === name);
        const declared = pkg?.source.kind === "bundled" && pkg.source.files.some(file => file.path === path)
          || release.panel?.package === name && release.panel.asset === path;
        if (!declared || !isAssetPath(path)) throw new Error("Unknown extension resource");
        const file = join(packageRoot(boot, name), path);
        if ((await stat(file)).size > 512 * 1024) throw new Error("Extension resource exceeds its size limit");
        return (await readFile(file)).toString("base64");
      },
    },
    pioraLog: { write: (message: string) => call("log", message) },
    pioraPanel: {
      register(name: string, listener: (payload: Json, signal: AbortSignal) => unknown) {
        if (!isRpcName(name) || typeof listener !== "function" || methods.has(name) || methods.size >= 100) {
          throw new Error("Invalid or duplicate extension RPC handler");
        }
        methods.set(name, listener);
        return () => { methods.delete(name); };
      },
    },
  };
  // Health probes use the same scoped registration path as client handlers.
  ctx.provide("pioraPanel", bridge.pioraPanel);
  for (const service of release.services) if (service !== "pioraPanel") ctx.provide(service, bridge[service]);

  type Migration = (storage: ReturnType<typeof extensionStorage>, from: number, to: number) => unknown;
  const plugins: { pkg: CordisPackage; entry: Plugin; migrate?: Migration }[] = [];
  for (const pkg of release.packages) {
    signal.throwIfAborted();
    if (!pkg.entry) continue;
    const module = await import(pathToFileURL(join(packageRoot(boot, pkg.name), pkg.entry)).href);
    const entry = (module.default ?? module) as Plugin;
    if (typeof entry !== "function" && typeof entry?.apply !== "function") throw new Error("Invalid Cordis entry: " + pkg.name);
    const actual = Object.keys(Inject.resolve(entry.inject));
    const undeclared = actual.find(service => !pkg.inject?.includes(service));
    if (undeclared) throw new Error(pkg.name + " requests undeclared service: " + undeclared);
    const migrate = module.migrate ?? (entry as { migrate?: Migration }).migrate;
    plugins.push({ pkg, entry, ...(typeof migrate === "function" ? { migrate: migrate as Migration } : {}) });
  }
  if (boot.fromSchema !== undefined && boot.fromSchema !== release.schema) {
    const migration = plugins.find(plugin => plugin.pkg.name === release.migrationPackage)?.migrate;
    if (!migration || !release.migrateFrom?.includes(boot.fromSchema)) throw new Error("No verified data migration");
    await migration(storage, boot.fromSchema, release.schema);
  }
  signal.throwIfAborted();
  const fibers = plugins.map(plugin => ctx.plugin(plugin.entry, plugin.pkg.config));
  while (fibers.some(fiber => fiber.state === FiberState.LOADING || fiber.inertia)) await delay(15, undefined, { signal });
  const broken = fibers.find(fiber => fiber.state !== FiberState.ACTIVE);
  if (broken) throw new Error("Cordis plugin did not activate: " + broken.name + " (" + broken.state + ")");
  for (const { pkg } of plugins) for (const service of pkg.provides ?? []) {
    if (ctx.get(service) === undefined) throw new Error("Cordis service was not provided: " + service);
  }
  const health = methods.get(release.health.method);
  if (!health) throw new Error("The extension did not register its health check");
  const result = await health(null, signal) as { ready?: unknown; version?: unknown } | null;
  if (result?.ready !== true || result.version !== release.version) throw new Error("The extension did not confirm the expected runtime version");
  if (release.panel?.methods.some(method => !methods.has(method))) throw new Error("The extension is missing a declared panel RPC method");
  version = release.version;
  return version;
}

function disposeHost(): Promise<void> {
  disposal ??= (async () => {
    shutdown.abort();
    for (const controller of requests.values()) controller.abort();
    await ctx.fiber.dispose();
    methods.clear();
  })();
  return disposal;
}

async function request(message: HostRequest) {
  const controller = new AbortController();
  requests.set(message.id, controller);
  try {
    let value: unknown;
    if (message.action === "boot" && !booting && !disposal) {
      booting = true;
      value = await activeRequest.run(controller.signal, () => bootHost(message.input, controller.signal));
    } else if (message.action === "invoke" && version && !disposal) {
      const listener = methods.get(message.input.method);
      if (!listener) throw new Error("Unknown extension RPC method");
      value = await activeRequest.run(controller.signal, () => listener(message.input.payload, controller.signal));
    } else if (message.action === "dispose") await disposeHost();
    else throw new Error("Extension host is not ready");
    send({ type: "result", id: message.id, value: makeJson(value) });
  } catch (error) {
    send({ type: "result", id: message.id, error: (error instanceof Error ? error.message : String(error)).slice(0, 700) });
  } finally { requests.delete(message.id); }
}

process.on("message", (message: HostRequest | HostResponse | HostCancel) => {
  if (message.type === "request") void request(message);
  else if (message.type === "result") services.get(message.id)?.finish(message);
  else requests.get(message.id)?.abort();
});
process.once("disconnect", () => {
  void disposeHost().then(() => process.exit(0), () => process.exit(1));
});

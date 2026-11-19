import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test, { after, before } from "node:test";
import { createJiti } from "jiti";
import { create as createTar } from "tar";
import ts from "typescript";

const root = resolve(import.meta.dirname, "..");
const jiti = createJiti(import.meta.url);
const scratch = join(root, ".verification");
const sha = (algorithm, content, encoding = "hex") => createHash(algorithm).update(content).digest(encoding);
let build, CordisExtensionManager, bundledCordisCatalog, parseCordisDiscovery, cordisCompatibility, petNetwork;

before(async () => {
  await mkdir(scratch, { recursive: true });
  build = await mkdtemp(join(scratch, "cordis-host-build-"));
  const source = join(root, "desktop", "src");
  const compile = ts.createProgram([join(source, "cordis-extension-worker.mts")], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.Node16,
    rootDir: source,
    outDir: build,
    types: ["node"],
    skipLibCheck: true,
    noEmitOnError: true,
  });
  const result = compile.emit();
  assert.equal(result.emitSkipped, false, ts.formatDiagnosticsWithColorAndContext(result.diagnostics, {
    getCurrentDirectory: () => root, getCanonicalFileName: name => name, getNewLine: () => "\n",
  }));
  ({ CordisExtensionManager } = await jiti.import("../desktop/src/cordis-extension-manager.ts"));
  ({ bundledCordisCatalog, parseCordisDiscovery } = await jiti.import("../desktop/src/cordis-extension-catalog.ts"));
  ({ cordisCompatibility } = await jiti.import("../desktop/src/cordis-extension-contract.ts"));
  ({ petNetwork } = await jiti.import("../desktop/src/dsh-pet-network.ts"));
});

after(async () => { if (build) await rm(build, { recursive: true, force: true }); });

async function localFixture(context, options = {}) {
  const directory = await mkdtemp(join(scratch, "cordis-profile-test-"));
  const assets = options.assets ?? join(directory, "assets");
  await mkdir(assets, { recursive: true });
  const panels = new Map();
  let catalog;
  const managers = [];
  const makeManager = (catalogue = catalog) => {
    const manager = new CordisExtensionManager({
      root: join(directory, "profiles"), worker: join(build, "cordis-extension-worker.mjs"), assets,
      catalog: catalogue, dedicated: new Map(),
      network: options.network ?? (() => petNetwork({})),
      tasks: async () => [{ running: true, awaitingApproval: false }], model: options.model ?? (async input => input),
      notify() {}, openPanel: async panel => { panels.set(panel.id, panel); }, closePanel: id => { panels.delete(id); },
    });
    managers.push(manager);
    return manager;
  };
  const data = (profile, slot) => join(directory, "profiles", profile, "data", slot);
  const activeState = id => readFile(join(directory, "profiles", id, "state.json"), "utf8").then(JSON.parse);
  async function bundled(name, version, blob, otherFiles = {}) {
    const sources = { "index.cjs": blob, ...otherFiles };
    const files = await Promise.all(Object.entries(sources).map(async ([path, content]) => {
      const source = name + "-" + version + "-" + path;
      await writeFile(join(assets, source), content);
      return { path, source, sha256: sha("sha256", content) };
    }));
    return { name, version, license: "MIT", entry: "index.cjs", source: { kind: "bundled", files } };
  }
  context.after(async () => {
    await Promise.allSettled(managers.map(manager => manager.dispose()));
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, assets, panels, makeManager, setCatalog(value) { catalog = value; }, bundled, data, activeState };
}

async function until(check, message, timeout = 30_000) {
  const end = Date.now() + timeout;
  do {
    const result = await check();
    if (result) return result;
    await delay(40);
  } while (Date.now() < end);
  assert.fail(message);
}

const stateFor = (manager, id) => manager.list().find(profile => profile.id === id).state;
async function waitState(manager, id, predicate) {
  try {
    return await until(() => {
      const state = stateFor(manager, id);
      return !state.progress && predicate(state) && state;
    }, "Extension failed to reach the expected state");
  } catch (error) { throw new Error(error.message + ": " + JSON.stringify(stateFor(manager, id))); }
}

async function openPanel(manager, fixture, id) {
  manager.action(id, "panel");
  return until(() => fixture.panels.get(id), "The panel did not open");
}

const invoke = (panel, method, value) => panel.invoke(method, value, new AbortController().signal);

async function extensionRelease(fixture, version, options = {}) {
  const schema = options.schema ?? 1;
  const provider = await fixture.bundled("sample-provider", version, [
    'const { writeFileSync, rmSync } = require("node:fs");',
    'const { join } = require("node:path");',
    'const runtimeVersion = require("./package.json").version;',
    'exports.inject = ["pioraStorage"];',
    'exports.apply = (ctx, conf) => {',
    '  const storage = ctx.get("pioraStorage");',
    '  const marker = join(process.env.DSH_HOME, "lifecycle");',
    '  ctx.effect(() => {',
    '    writeFileSync(marker, "live " + runtimeVersion);',
    '    return () => writeFileSync(marker, "disposed " + runtimeVersion);',
    '  });',
    '  ctx.provide("sampleService", { version: runtimeVersion, profile: conf.profile, storage });',
    '};',
    'exports.migrate = async storage => {',
    '  await storage.write("settings", { marker: "candidate changed its copy" });',
    options.failMigration ? '  throw new Error("migration failed after writing candidate data");' : '',
    '};',
  ].join("\n"));
  const consumer = await fixture.bundled("sample-consumer", version, [
    'exports.inject = ["sampleService", "pioraPanel", "pioraModels"];',
    'exports.apply = ctx => {',
    '  const { storage, profile, version } = ctx.get("sampleService");',
    '  const panel = ctx.get("pioraPanel");',
    '  ctx.effect(() => panel.register("health", () => ({ ready: ' + !options.failHealth + ', version })));',
    '  ctx.effect(() => panel.register("version", () => ({ profile, version })));',
    '  ctx.effect(() => panel.register("read", () => storage.read("settings")));',
    '  ctx.effect(() => panel.register("write", value => storage.write("settings", value)));',
    '  ctx.effect(() => panel.register("crash", () => { setImmediate(() => process.exit(23)); }));',
    '  ctx.effect(() => panel.register("model", (payload, signal) => ctx.get("pioraModels").complete(payload, signal)));',
    '};',
  ].join("\n"), { "panel.html": "<!doctype html><title>Test Cordis panel</title>" });
  return {
    version, schema, cordis: "4.1.0", hostApi: 1, bundle: "simple-insert",
    ...(schema > 1 ? { migrateFrom: [1], migrationPackage: provider.name } : {}),
    services: ["pioraStorage", "pioraPanel", "pioraModels"],
    // Mount consumer first to prove the real dependency resolver waits for its peer.
    packages: [
      { ...consumer, inject: ["sampleService", "pioraPanel", "pioraModels"] },
      { ...provider, inject: ["pioraStorage"], provides: ["sampleService"], config: { profile: options.profile ?? "primary" } },
    ],
    health: { package: consumer.name, method: "health" },
    panel: { package: consumer.name, asset: "panel.html", protocol: 1, methods: ["version", "read", "write", "crash", "model"] },
  };
}

const profile = (id, releases) => ({
  id, name: id, source: "https://github.com/kexijiang/pi-desktop",
  description: { en: "Isolated test group", zh: "测试扩展" }, assetsLicense: null, releases,
});

async function installAndStart(manager, fixture, id, version) {
  manager.action(id, "install", version);
  await waitState(manager, id, state => state.version === version && state.phase === "stopped");
  manager.action(id, "start");
  await waitState(manager, id, state => state.runningVersion === version && state.phase === "running");
  return openPanel(manager, fixture, id);
}

test("real Cordis inject, effects, group isolation, RPC cancellation and host exit", async context => {
  let modelSignal;
  const fixture = await localFixture(context, { model: async (_payload, signal) => {
    modelSignal = signal;
    await delay(30_000, undefined, { signal });
  } });
  const first = await extensionRelease(fixture, "1.0.0");
  const second = await extensionRelease(fixture, "2.0.0", { profile: "secondary" });
  fixture.setCatalog([profile("primary", [first]), profile("secondary", [second])]);
  const manager = fixture.makeManager();
  const primary = await installAndStart(manager, fixture, "primary", "1.0.0");
  const secondary = await installAndStart(manager, fixture, "secondary", "2.0.0");
  assert.deepEqual(await invoke(primary, "version"), { profile: "primary", version: "1.0.0" });
  assert.deepEqual(await invoke(secondary, "version"), { profile: "secondary", version: "2.0.0" });

  const active = (await fixture.activeState("primary")).active;
  const marker = join(fixture.data("primary", active.data.id), "lifecycle");
  assert.equal(await readFile(marker, "utf8"), "live 1.0.0");
  const cancel = new AbortController();
  const request = primary.invoke("model", { text: "fixture content" }, cancel.signal);
  const rejected = assert.rejects(request, /abort/i);
  await until(() => modelSignal, "model bridge did not receive the request");
  cancel.abort();
  await rejected;
  await until(() => modelSignal.aborted, "the underlying model call was not cancelled");

  manager.action("primary", "stop");
  await waitState(manager, "primary", state => state.phase === "stopped");
  assert.equal(await readFile(marker, "utf8"), "disposed 1.0.0");
  assert.equal(fixture.panels.has("primary"), false);
  await assert.rejects(invoke(primary, "version"), /unsupported/i);
  manager.action("primary", "start");
  await waitState(manager, "primary", state => state.phase === "running");
  const reopened = await openPanel(manager, fixture, "primary");
  await invoke(reopened, "crash").catch(() => {});
  const failed = await waitState(manager, "primary", state => state.phase === "error");
  assert.match(failed.error, /Cordis process exited \(23\)/);
  assert.equal(fixture.panels.has("primary"), false);
  assert.equal(stateFor(manager, "secondary").phase, "running");
  assert.equal((await invoke(secondary, "version")).version, "2.0.0");
});

test("failed candidate startup and partially written migration both recover the original program and data", async context => {
  const fixture = await localFixture(context);
  const good = await extensionRelease(fixture, "1.0.0");
  const badHealth = await extensionRelease(fixture, "1.1.0", { failHealth: true });
  const badMigration = await extensionRelease(fixture, "2.0.0", { schema: 2, failMigration: true });
  fixture.setCatalog([profile("primary", [badMigration, badHealth, good])]);
  const manager = fixture.makeManager();
  let panel = await installAndStart(manager, fixture, "primary", good.version);
  const saved = { marker: "old data survives" };
  await invoke(panel, "write", saved);
  const baseline = await fixture.activeState("primary");
  for (const [release, error] of [[badHealth, /expected runtime version/], [badMigration, /migration failed after writing/]]) {
    manager.action("primary", "update", release.version);
    const result = await waitState(manager, "primary", state => state.operation?.outcome === "rolled-back" && error.test(state.error ?? ""));
    assert.equal(result.runningVersion, good.version);
    const disk = await fixture.activeState("primary");
    assert.deepEqual(disk.active, baseline.active);
    assert.equal(disk.pending, null);
    panel = await openPanel(manager, fixture, "primary");
    assert.deepEqual(await invoke(panel, "read"), saved);
  }
});

test("pinned package dependency errors, streaming cancellation and shutdown preserve the installed version", async context => {
  let body, hanging, network;
  const fixture = await localFixture(context, { network: () => network });
  const server = createServer((request, response) => {
    if (request.url.includes("streaming-package")) {
      hanging = true;
      response.writeHead(200, { "Content-Length": 99999 });
      response.write("header-less incomplete data");
    } else response.end(body);
  });
  await new Promise(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
  context.after(() => { server.closeAllConnections(); server.close(); });
  network = { ...petNetwork({}), registry: "http://127.0.0.1:" + server.address().port + "/" };
  const packageDir = join(fixture.directory, "package");
  await mkdir(packageDir);
  await writeFile(join(packageDir, "package.json"), JSON.stringify({
    name: "dependency-fixture", version: "1.0.0", dependencies: { "not-in-the-pinned-plan": "5.0.0" },
  }));
  const tar = join(fixture.directory, "package.tgz");
  await createTar({ file: tar, gzip: true, cwd: fixture.directory }, ["package"]);
  body = await readFile(tar);

  const good = await extensionRelease(fixture, "1.0.0");
  const candidate = (version, name) => ({
    ...good, version, packages: [...good.packages, { name, version: "1.0.0", license: "MIT", source: { kind: "npm", integrity: "sha512-" + sha("sha512", body, "base64") } }],
  });
  fixture.setCatalog([profile("primary", [candidate("3.0.0", "streaming-package"), candidate("2.0.0", "dependency-fixture"), good])]);
  let manager = fixture.makeManager();
  const panel = await installAndStart(manager, fixture, "primary", good.version);
  await invoke(panel, "write", { preserved: "yes" });
  await manager.autoStart("primary", true);
  manager.action("primary", "update", "2.0.0");
  const failure = await waitState(manager, "primary", state => state.operation?.outcome === "rolled-back");
  assert.match(failure.error, /Missing pinned dependency/);
  assert.equal(failure.runningVersion, good.version);
  manager.action("primary", "update", "3.0.0");
  await until(() => hanging, "the streaming download never started");
  manager.action("primary", "cancel");
  await waitState(manager, "primary", state => state.operation?.outcome === "cancelled" && state.phase === "running");
  hanging = false;
  manager.action("primary", "update", "3.0.0");
  await until(() => hanging, "the second streaming download never started");
  await manager.dispose();
  manager = fixture.makeManager();
  await manager.restore();
  await waitState(manager, "primary", state => state.phase === "running" && state.runningVersion === good.version);
  assert.deepEqual(await invoke(await openPanel(manager, fixture, "primary"), "read"), { preserved: "yes" });
});

test("on relaunch, a durable interrupted-update journal is recovered before autostart", async context => {
  const fixture = await localFixture(context, { assets: join(root, "desktop", "cordis-plugins") });
  fixture.setCatalog(bundledCordisCatalog);
  const id = "piora-task-monitor";
  const manager = fixture.makeManager();
  const panel = await installAndStart(manager, fixture, id, "1.0.0");
  await invoke(panel, "monitor.set-compact", true);
  await manager.autoStart(id, true);
  await manager.dispose();
  const transaction = await fixture.activeState(id);
  const pending = randomUUID();
  const data = fixture.data(id, pending);
  const files = join(fixture.directory, "profiles", id, "versions", pending);
  await Promise.all([mkdir(files), mkdir(data)]);
  await writeFile(join(data, "preferences.json"), '{"compact":false}');
  await writeFile(join(fixture.directory, "profiles", id, "state.json"), JSON.stringify({ ...transaction, pending }));

  const restarted = fixture.makeManager();
  await restarted.restore();
  const restored = await waitState(restarted, id, state => state.phase === "running");
  assert.equal(restored.operation.outcome, "interrupted");
  assert.equal(restored.runningVersion, "1.0.0");
  assert.deepEqual(await fixture.activeState(id), { ...transaction, pending: null, operation: { outcome: "interrupted" } });
  await assert.rejects(access(files), { code: "ENOENT" });
  await assert.rejects(access(data), { code: "ENOENT" });
  assert.equal((await invoke(await openPanel(restarted, fixture, id), "monitor.snapshot")).compact, true);
});

test("a compatible npm archive is verified, loaded and callable without adding host code", async context => {
  let network;
  const fixture = await localFixture(context, { network: () => network });
  const directory = join(fixture.directory, "package");
  await mkdir(directory);
  await writeFile(join(directory, "package.json"), '{"name":"external-cordis-sample","version":"1.0.0","license":"MIT","type":"module"}');
  await writeFile(join(directory, "entry.mjs"), [
    'export const inject = ["pioraPanel"];',
    'export const apply = ctx => {',
    '  const panel = ctx.get("pioraPanel");',
    '  ctx.effect(() => panel.register("health", () => ({ ready: true, version: "1.0.0" })));',
    '  ctx.effect(() => panel.register("message", () => "loaded from the pinned archive"));',
    '};',
  ].join("\n"));
  await writeFile(join(directory, "panel.html"), "<!doctype html><title>External plugin sample</title>");
  const tar = join(fixture.directory, "external.tgz");
  await createTar({ file: tar, gzip: true, cwd: fixture.directory }, ["package"]);
  const bytes = await readFile(tar);
  const server = createServer((_request, response) => response.end(bytes));
  await new Promise(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
  context.after(() => { server.closeAllConnections(); server.close(); });
  network = { ...petNetwork({}), registry: "http://127.0.0.1:" + server.address().port + "/" };
  const name = "external-cordis-sample";
  const plan = {
    version: "1.0.0", schema: 1, cordis: "4.1.0", hostApi: 1, bundle: "simple-insert",
    services: ["pioraPanel"],
    packages: [{ name, version: "1.0.0", license: "MIT", entry: "entry.mjs",
      inject: ["pioraPanel"], source: { kind: "npm", integrity: "sha512-" + sha("sha512", bytes, "base64") } }],
    health: { package: name, method: "health" },
    panel: { package: name, asset: "panel.html", protocol: 1, methods: ["message"] },
  };
  const invalid = { ...plan, version: "2.0.0", packages: [{ ...plan.packages[0],
    source: { kind: "npm", integrity: "sha512-" + sha("sha512", "different bytes", "base64") } }] };
  fixture.setCatalog([profile("external", [invalid, plan])]);
  const manager = fixture.makeManager();
  const panel = await installAndStart(manager, fixture, "external", plan.version);
  assert.equal(await invoke(panel, "message"), "loaded from the pinned archive");
  manager.action("external", "update", invalid.version);
  const rejected = await waitState(manager, "external", state => state.operation?.outcome === "rolled-back");
  assert.match(rejected.error, /integrity check failed/i);
  assert.equal(rejected.runningVersion, plan.version);
  assert.equal(await invoke(panel, "message"), "loaded from the pinned archive");
});

test("unsupported bundles and services are rejected and discovery cannot grant install authority", () => {
  const [taskMonitor] = bundledCordisCatalog;
  const [release] = taskMonitor.releases;
  assert.equal(cordisCompatibility(taskMonitor, release), null);
  for (const bundle of ["carrier", "cross"]) assert.match(cordisCompatibility(taskMonitor, { ...release, bundle }), /simple bundle/);
  assert.match(cordisCompatibility(taskMonitor, { ...release, packages: [
    ...release.packages, { ...release.packages[0], name: "foreign", inject: ["webServer"], provides: [] },
  ] }), /Missing required service: webServer/);
  assert.match(cordisCompatibility(taskMonitor, { ...release, panel: { ...release.panel, protocol: 2 } }), /Unsupported client/);
  const data = parseCordisDiscovery({ plugins: [
    { name: "Piora task monitor", npm: "piora-task-monitor-panel", version: "1.1.0" },
    { name: "Unknown update", npm: "piora-task-monitor-panel", version: "9.0.0", page: "javascript:alert(1)" },
    { name: "DSH Market", npm: "dshmarket", version: "1.0.0", url: "https://github.com/dsh-market/dsh-market" },
    { name: "DSH Pet", npm: "dsh-pet", version: "0.3.8" },
  ] }, bundledCordisCatalog, new Map([["dsh-pet", "0.3.8"]]));
  assert.deepEqual(data.map(entry => entry.compatibility), ["verified", "unverified", "incompatible", "dedicated"]);
  assert.equal(data[1].source, null);
  const listings = Array.from({ length: 2101 }, (_, index) => ({ name: "Directory entry " + index }));
  const completeDirectory = parseCordisDiscovery({ plugins: listings }, bundledCordisCatalog, new Map());
  assert.equal(completeDirectory.length, listings.length);
  assert.equal(completeDirectory.at(-1).name, "Directory entry 2100");
});

test("Pi package routing uses explicit desktop metadata and keeps dual-purpose and ordinary packages available", () => {
  const { declaresDesktopExtension } = jiti("./desktop-extension-package.ts");
  assert.equal(declaresDesktopExtension({ name: "dsh-false-positive" }), false);
  assert.equal(declaresDesktopExtension({ pi: { extensions: [] }, dsh: { client: { platform: "web" } } }), false);
  assert.equal(declaresDesktopExtension({ dsh: { bundle: { patch: "bundle.yaml" } } }), true);
  assert.equal(declaresDesktopExtension({ pioraDesktopExtension: { apiVersion: 1 } }), true);
});

import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { cordisCompatibility, isExtensionId, isExtensionVersion, isPackageName, isRpcName, makeJson, type CordisAction, type CordisCheckResult, type CordisEntry, type CordisPhase, type CordisProfile, type CordisRelease, type CordisService, type Json } from "./cordis-extension-contract.js";
import { checkCommunityPackage } from "./cordis-community-registry.js";
import { discoverCordisExtensions } from "./cordis-extension-catalog.js";
import { extensionPackageDir, readCommunityClient, stageCordisPackages, verifyCordisFiles } from "./cordis-extension-install.js";
import type { PanelRequest } from "./cordis-panel-windows.js";
import { CordisHostProcess } from "./cordis-host-process.js";
import type { HostService, HostServiceRequest } from "./cordis-host-protocol.js";
import { CordisProfileStore, type InstalledSlot } from "./cordis-profile-store.js";
import { petEnvironment } from "./dsh-pet-install.js";
import type { PetNetwork } from "./dsh-pet-network.js";

interface ManagerOptions {
  root: string;
  assets: string;
  worker: string;
  catalog: readonly CordisProfile[];
  dedicated: ReadonlyMap<string, string>;
  network: () => PetNetwork;
  tasks: (signal: AbortSignal) => Promise<unknown>;
  model: (input: Json, signal: AbortSignal) => Promise<unknown>;
  notify: (title: string, body: string) => void;
  openPanel: (panel: PanelRequest, signal?: AbortSignal) => Promise<void>;
  closePanel: (id: string) => void | Promise<void>;
}

const capability: Record<HostService, CordisService> = {
  tasks: "pioraTasks", model: "pioraModels", notify: "pioraNotifications",
  openPanel: "pioraWindows", closePanel: "pioraWindows", log: "pioraLog",
};

const userError = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 700);

class ProfileRuntime {
  private store: CordisProfileStore | undefined;
  private host: { instance: CordisHostProcess; version: string } | undefined;
  private phase: CordisPhase = "stopped";
  private error: string | null = null;
  private logs: string[] = [];
  private progress: CordisEntry["state"]["progress"] = null;
  private controller: AbortController | undefined;
  private operation: Promise<void> | undefined;
  private disposed = false;
  private readonly recovered: Promise<void>;

  constructor(private readonly profile: CordisProfile, private readonly options: ManagerOptions) {
    try {
      this.store = new CordisProfileStore(join(options.root, profile.id));
      this.recovered = this.store.recover().catch(error => {
        this.recordError(error);
        this.store = undefined;
      });
    } catch (error) {
      this.recordError(error);
      this.recovered = Promise.resolve();
    }
  }

  status(): CordisEntry {
    const { profile } = this;
    const active = this.store?.state.active;
    const release = (active ? this.findRelease(active.version) : undefined) ?? profile.releases[0];
    if (!release) throw new Error("The desktop extension has no configured release");
    const phase = !active && this.phase === "stopped" ? "absent" : this.phase;
    return {
      id: profile.id, name: profile.name, description: profile.description, source: profile.source, assetsLicense: profile.assetsLicense,
      ...(profile.community ? { community: profile.community } : {}),
      releases: profile.releases.map(release => ({ version: release.version, packages: release.packages.map(pkg => ({
        name: pkg.name, version: pkg.version, license: pkg.license,
        source: pkg.source.kind === "npm" ? "https://www.npmjs.com/package/" + pkg.name + "/v/" + pkg.version : profile.source,
        integrity: pkg.source.kind === "npm" ? pkg.source.integrity : pkg.source.files.map(file => "sha256-" + file.sha256).join(", "),
      })) })),
      compatibility: {
        cordis: release.cordis, hostApi: release.hostApi, bundle: release.bundle, services: release.services,
        panel: Boolean(release.panel || release.communityClient),
        reason: active && !this.findRelease(active.version) ? "The installed version is no longer verified" : cordisCompatibility(profile, release),
      },
      state: {
        phase, version: active?.version ?? null, runningVersion: this.host?.version ?? null,
        previousVersion: this.store?.state.previous?.version ?? null, autoStart: this.store?.state.autoStart ?? false,
        operation: this.store?.state.operation ?? null, error: this.error, progress: this.progress,
        logs: this.logs.slice(),
      },
    };
  }

  private findRelease(version: string) { return this.profile.releases.find(release => release.version === version); }

  private checkedRelease(version: string): CordisRelease {
    const release = this.findRelease(version);
    if (!release) throw new Error("The requested version is not in the verified desktop directory");
    const reason = cordisCompatibility(this.profile, release);
    if (reason) throw new Error(reason);
    return release;
  }

  async restore(): Promise<void> {
    await this.recovered;
    if (!this.disposed && this.store?.state.autoStart && this.store.state.active && !this.operation) this.action("start");
  }

  async autoStart(enabled: boolean): Promise<CordisEntry> {
    await this.recovered;
    if (this.disposed || this.operation || !this.store?.state.active) throw new Error("Autostart is unavailable while the profile is changing");
    this.store.write({ autoStart: enabled });
    return this.status();
  }

  action(action: CordisAction, version?: string): CordisEntry {
    if (this.disposed) throw new Error("The desktop extension is shutting down");
    if (action === "cancel") {
      if (["installing", "updating", "starting"].includes(this.phase)) this.controller?.abort();
      return this.status();
    }
    if (this.operation) throw new Error("The desktop extension is busy");
    const controller = this.controller = new AbortController();
    this.error = null;
    this.operation = Promise.resolve().then(() => this.perform(action, version, controller.signal))
      .catch(error => { this.recordError(error, this.host?.instance.alive ? "running" : "error"); })
      .finally(() => { this.operation = undefined; this.controller = undefined; this.progress = null; });
    return this.status();
  }

  private log(message: string) {
    this.logs = [...this.logs.slice(-23), message.slice(0, 700)];
  }

  private recordError(error: unknown, phase: CordisPhase = "error") {
    this.phase = phase;
    this.error = userError(error);
    this.log(this.error);
  }

  private async perform(action: CordisAction, version: string | undefined, signal: AbortSignal) {
    await this.recovered;
    const store = this.store;
    if (!store) throw new Error("The desktop extension's saved state is unavailable");
    if (store.state.pending) await store.recover();
    const active = store.state.active;
    if (action === "install" || action === "update") {
      if ((action === "install") !== !active) throw new Error("The requested operation does not match the installed state");
      const candidate = this.checkedRelease(version ?? this.profile.releases[0]!.version);
      if (active?.version === candidate.version) throw new Error("This version is already installed");
      await this.install(store, candidate, signal);
      return;
    }
    if (action === "uninstall" || action === "stop") {
      this.phase = "stopping";
      await this.stopHost();
      if (action === "uninstall" && active) {
        const previous = store.state.previous;
        store.write({ active: null, previous: null, retained: active.data, autoStart: false, operation: null });
        await store.removeFiles(active.id);
        if (previous) await store.removeFiles(previous.id);
      }
      this.phase = "stopped";
      return;
    }
    if (!active) throw new Error("Install the desktop extension first");
    if (action === "start" && !this.host?.instance.alive) {
      this.phase = "starting";
      this.host = await this.startHost(store, active, undefined, signal);
      this.phase = "running";
    }
    if (action === "panel") await this.openPanel(store, active);
  }

  private async install(store: CordisProfileStore, release: CordisRelease, signal: AbortSignal) {
    const old = store.state.active;
    const oldData = old?.data ?? store.state.retained;
    const obsolete = store.state.previous;
    const id = randomUUID();
    const candidate: InstalledSlot = { id, version: release.version, data: { id, schema: release.schema } };
    const running = Boolean(this.host?.instance.alive);
    let trial: Awaited<ReturnType<ProfileRuntime["startHost"]>> | undefined;
    let journaled = false;
    this.phase = old ? "updating" : "installing";
    try {
      if (oldData && oldData.schema !== release.schema && !release.migrateFrom?.includes(oldData.schema)) {
        throw new Error("The extension does not declare a compatible data migration");
      }
      store.write({ pending: id, operation: null });
      journaled = true;
      await store.prepareParents();
      this.progress = { stage: "package", received: 0, total: null };
      await stageCordisPackages({
        slot: store.files(id), assets: this.options.assets, networkRoot: store.root, network: this.options.network,
        release, signal, progress: progress => { this.progress = progress; },
      });
      signal.throwIfAborted();
      await this.stopHost();
      this.progress = { stage: "data", received: 0, total: null };
      await store.prepareData(id, oldData ?? undefined);
      signal.throwIfAborted();
      this.progress = { stage: "health", received: 0, total: null };
      trial = await this.startHost(store, candidate, oldData?.schema, signal);
      if (!running) await trial.instance.stop();
      signal.throwIfAborted();
      if (running && !trial.instance.alive) throw new Error("The updated extension exited before activation");
      store.write({
        active: candidate, previous: old, retained: null, pending: null,
        operation: { outcome: old ? "updated" : "installed" },
      });
      this.host = running ? trial : undefined;
      this.phase = running ? "running" : "stopped";
    } catch (error) {
      await trial?.instance.stop().catch(stopError => this.log(userError(stopError)));
      let cleaned = true;
      if (journaled) {
        await store.removeCandidate(id).catch(cleanupError => { cleaned = false; this.log(userError(cleanupError)); });
      }
      const detail = userError(error);
      let restored = !running || Boolean(this.host?.instance.alive);
      if (running && old && !restored && !this.disposed) {
        try {
          this.host = await this.startHost(store, old, undefined, AbortSignal.timeout(25_000));
          restored = true;
        } catch (restoreError) { this.log(userError(restoreError)); }
      }
      const outcome = signal.aborted ? "cancelled" : old && restored ? "rolled-back" : "failed";
      store.write({ ...(cleaned ? { pending: null } : {}), operation: { outcome, detail } });
      if (signal.aborted && restored) this.phase = this.host?.instance.alive ? "running" : "stopped";
      else this.recordError(error, this.host?.instance.alive ? "running" : "error");
      return;
    }
    if (obsolete && obsolete.id !== old?.id) await store.removeCandidate(obsolete.id).catch(error => this.log(userError(error)));
  }

  private async startHost(store: CordisProfileStore, slot: InstalledSlot, fromSchema: number | undefined, signal: AbortSignal) {
    const release = this.checkedRelease(slot.version);
    await verifyCordisFiles(store.files(slot.id), release);
    signal.throwIfAborted();
    const data = store.data(slot.data.id);
    const env = petEnvironment(store.root, process.env, this.options.network());
    env.DSH_HOME = data;
    let modelBusy = false;
    const instance = new CordisHostProcess({
      worker: this.options.worker, cwd: store.files(slot.id), env,
      onExit: reason => {
        if (this.host?.instance !== instance) return;
        this.host = undefined;
        void this.options.closePanel(this.profile.id);
        this.recordError(new Error(reason));
      },
      receiveService: async (message, signal) => {
        if (!release.services.includes(capability[message.service])) throw new Error("The profile has no permission for this host service");
        if (message.service === "model") {
          if (modelBusy) throw new Error("The profile already has a model request running");
          modelBusy = true;
          try { return makeJson(await this.options.model(message.input, signal)); }
          finally { modelBusy = false; }
        }
        return this.receiveService(store, slot, message, signal);
      },
    });
    try {
      const actual = await instance.request({
        action: "boot", input: { release, slot: store.files(slot.id), data, ...(fromSchema !== undefined ? { fromSchema } : {}) },
      }, signal, 20_000);
      if (actual !== slot.version) throw new Error("The Cordis process reported another version");
      if (release.communityClient) await this.openCommunityPanel(store, slot, release.communityClient, instance, true, signal);
      else await delay(120, undefined, { signal });
      if (!instance.alive) throw new Error("The Cordis process exited during the health check");
      return { instance, version: slot.version };
    } catch (error) {
      await instance.stop().catch(stopError => this.log(userError(stopError)));
      throw error;
    }
  }

  private async receiveService(store: CordisProfileStore, slot: InstalledSlot, message: HostServiceRequest, signal: AbortSignal): Promise<Json> {
    signal.throwIfAborted();
    if (message.service === "tasks") return makeJson(await this.options.tasks(signal));
    if (message.service === "log" && typeof message.input === "string") { this.log(message.input); return null; }
    if (message.service === "notify" && message.input && typeof message.input === "object" && !Array.isArray(message.input)) {
      const { title, body } = message.input;
      if (typeof title !== "string" || typeof body !== "string" || !title.trim()) throw new Error("Invalid extension notification");
      this.options.notify(this.profile.name + " · " + title.slice(0, 100), body.slice(0, 240));
      return null;
    }
    if (message.service === "openPanel") {
      await this.openPanel(store, slot);
      return null;
    }
    if (message.service === "closePanel") {
      await this.options.closePanel(this.profile.id);
      return null;
    }
    throw new Error("Invalid extension service request");
  }

  private async openPanel(store: CordisProfileStore, slot: InstalledSlot) {
    const host = this.host;
    const { panel, communityClient } = this.checkedRelease(slot.version);
    if (!host?.instance.alive || store.state.active?.id !== slot.id) throw new Error("Start the profile before opening its panel");
    if (communityClient) return this.openCommunityPanel(store, slot, communityClient, host.instance, false, this.controller?.signal);
    if (!panel) throw new Error("This extension does not have a panel");
    const path = join(extensionPackageDir(store.files(slot.id), panel.package), panel.asset);
    if ((await stat(path)).size > 512 * 1024) throw new Error("The extension panel is too large");
    const html = await readFile(path, "utf8");
    if (this.host !== host || !host.instance.alive) throw new Error("The extension stopped while opening its panel");
    await this.options.openPanel({
      id: this.profile.id, title: this.profile.name, html,
      invoke: async (method, input, signal) => {
        if (this.host !== host || !isRpcName(method) || !panel.methods.includes(method)) throw new Error("Unsupported panel action");
        return host.instance.request({ action: "invoke", input: { method, payload: makeJson(input) } }, signal, 125_000);
      },
    });
  }

  private async openCommunityPanel(store: CordisProfileStore, slot: InstalledSlot,
    client: NonNullable<CordisRelease["communityClient"]>, instance: CordisHostProcess, probe: boolean, signal?: AbortSignal) {
    const source = (await readCommunityClient(store.files(slot.id), client)).toString("base64");
    if (!instance.alive) throw new Error("The extension stopped while opening its panel");
    await this.options.openPanel({
      id: probe ? this.profile.id + "-health" : this.profile.id,
      title: this.profile.name,
      community: { package: client.package, version: slot.version, source, slots: client.slots, note: this.profile.community!.note, probe },
      invoke: (method, input, signal) => {
        if (!instance.alive || !(method === "community.storage.read" || method === "community.storage.write" && !probe)) {
          throw new Error("Unsupported community panel action");
        }
        return instance.request({ action: "invoke", input: { method, payload: makeJson(input) } }, signal, 8_000);
      },
    }, signal);
  }

  private async stopHost() {
    await this.options.closePanel(this.profile.id);
    const active = this.host;
    if (!active) return;
    await active.instance.stop();
    if (this.host === active) this.host = undefined;
  }

  async dispose() {
    this.disposed = true;
    this.controller?.abort();
    await this.recovered;
    await this.operation;
    await this.stopHost();
  }
}

const allowedActions: readonly CordisAction[] = ["install", "update", "start", "stop", "cancel", "uninstall", "panel"];

export class CordisExtensionManager {
  private readonly entries = new Map<string, ProfileRuntime>();
  private readonly shutdown = new AbortController();
  private discovery: ReturnType<typeof discoverCordisExtensions> | undefined;
  private readonly checks = new Map<string, Promise<CordisCheckResult>>();

  constructor(private readonly options: ManagerOptions) {
    for (const profile of options.catalog) {
      if (!isExtensionId(profile.id) || !profile.releases.length || this.entries.has(profile.id)) throw new Error("Invalid Cordis profile ID");
      this.entries.set(profile.id, new ProfileRuntime(profile, options));
    }
  }

  list() { return Array.from(this.entries.values(), runtime => runtime.status()); }
  restore() { return Promise.allSettled(Array.from(this.entries.values(), runtime => runtime.restore())); }

  private profile(id: unknown) {
    const runtime = typeof id === "string" ? this.entries.get(id) : undefined;
    if (this.shutdown.signal.aborted || !runtime) throw new Error("The desktop extension profile is unavailable");
    return runtime;
  }

  action(id: unknown, action: unknown, version?: unknown) {
    if (typeof action !== "string" || !allowedActions.includes(action as CordisAction)
      || version !== undefined && (typeof version !== "string" || version.length > 64)) throw new Error("Unsupported extension action");
    return this.profile(id).action(action as CordisAction, version as string | undefined);
  }

  autoStart(id: unknown, enabled: unknown) {
    if (typeof enabled !== "boolean") throw new Error("Invalid extension autostart preference");
    return this.profile(id).autoStart(enabled);
  }

  discover() {
    this.shutdown.signal.throwIfAborted();
    this.discovery ??= discoverCordisExtensions(this.options.root, this.options.network(), this.options.catalog, this.options.dedicated, this.shutdown.signal)
      .finally(() => { this.discovery = undefined; });
    return this.discovery;
  }

  async check(name: unknown, version: unknown): Promise<CordisCheckResult> {
    this.shutdown.signal.throwIfAborted();
    if (typeof name !== "string" || !isPackageName(name)) return { compatibility: "unavailable", reasons: [{ code: "missingNpm" }] };
    if (typeof version !== "string" || !isExtensionVersion(version)) return { compatibility: "unavailable", reasons: [{ code: "missingVersion" }] };
    if (this.options.dedicated.get(name) === version || this.options.catalog.some(profile =>
      profile.community?.package === name && profile.releases.some(release => release.version === version && !cordisCompatibility(profile, release)))) {
      return { compatibility: "verified", reasons: [] };
    }
    const key = name + "@" + version;
    const existing = this.checks.get(key);
    if (existing) return existing;
    if (this.checks.size >= 6) throw new Error("Too many compatibility checks. Try again after the current checks finish.");
    const result = checkCommunityPackage(name, version, this.options.network(), this.shutdown.signal)
      .finally(() => { this.checks.delete(key); });
    this.checks.set(key, result);
    return result;
  }

  async dispose() {
    this.shutdown.abort();
    const results = await Promise.allSettled(Array.from(this.entries.values(), runtime => runtime.dispose()));
    await this.discovery?.catch(() => {});
    await Promise.allSettled(this.checks.values());
    const failures = results.filter(result => result.status === "rejected");
    if (failures.length) throw new AggregateError(failures.map(failure => failure.reason), "Could not stop all Cordis hosts");
  }
}

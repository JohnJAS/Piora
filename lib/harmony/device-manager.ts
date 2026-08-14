import { randomBytes } from "node:crypto";

import { asHarmonyError, HarmonyError } from "./errors";
import { createHdcBackend } from "./hdc-backend";
import {
  defaultHarmonyConfigPath,
  readHarmonyConfig,
  writeHarmonyConfig,
} from "./runtime";
import type {
  BackendDevice,
  HarmonyAutomationBackend,
  HarmonyConfig,
  HarmonyDevice,
  HarmonyDiagnostics,
  HarmonyInputTextOptions,
  HarmonyLaunchAppOptions,
  HarmonyLease,
  HarmonyLeaseOwner,
  HarmonyManagerEvent,
  HarmonyManagerState,
  HarmonyOperationResult,
  HarmonyPressKeyOptions,
  HarmonySnapshot,
  HarmonySnapshotOptions,
  HarmonySwipeOptions,
  HarmonyTapOptions,
  HarmonyTapRefOptions,
  HarmonyUiNode,
} from "./types";

const DEFAULT_LEASE_TTL_MS = 5 * 60_000;
const MIN_LEASE_TTL_MS = 5_000;
const MAX_LEASE_TTL_MS = 30 * 60_000;
const DEVICE_REFRESH_TTL_MS = 2_000;

export interface AcquireLeaseOptions {
  serial: string;
  owner: HarmonyLeaseOwner;
  ttlMs?: number;
  signal?: AbortSignal;
}

export interface HarmonyDeviceManagerOptions {
  backend?: HarmonyAutomationBackend;
  backendFactory?: (config: HarmonyConfig) => HarmonyAutomationBackend;
  configPath?: string;
  now?: () => number;
  token?: () => string;
}

type Listener = (event: HarmonyManagerEvent) => void;

interface StoredSnapshot extends HarmonySnapshot {
  nodeByRef: Map<string, HarmonyUiNode>;
}

function iso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function validateSerial(serial: string): void {
  if (typeof serial !== "string" || serial.length < 1 || serial.length > 256) {
    throw new HarmonyError("INVALID_ARGUMENT", "A valid device serial is required");
  }
}

function validateOwner(owner: HarmonyLeaseOwner): void {
  if (!owner || !["agent", "manual"].includes(owner.kind) || typeof owner.id !== "string" || !owner.id.trim()) {
    throw new HarmonyError("INVALID_ARGUMENT", "A valid lease owner is required");
  }
  if (owner.id.length > 512 || (owner.sessionId?.length ?? 0) > 512) {
    throw new HarmonyError("INVALID_ARGUMENT", "Lease owner identity is too long");
  }
}

export class HarmonyDeviceManager {
  private backend?: HarmonyAutomationBackend;
  private readonly injectedBackend: boolean;
  private readonly backendFactory: (config: HarmonyConfig) => HarmonyAutomationBackend;
  private readonly configPath: string;
  private config: HarmonyConfig;
  private readonly now: () => number;
  private readonly token: () => string;
  private readonly devices = new Map<string, HarmonyDevice>();
  private readonly generations = new Map<string, number>();
  private readonly presentLastRefresh = new Set<string>();
  private readonly leasesBySerial = new Map<string, HarmonyLease>();
  private readonly leasesByToken = new Map<string, HarmonyLease>();
  private readonly snapshots = new Map<string, StoredSnapshot>();
  private readonly snapshotRevisions = new Map<string, number>();
  private readonly listeners = new Set<Listener>();
  private runtimeError?: HarmonyError;
  private queueTail: Promise<void> = Promise.resolve();
  private pending = 0;
  private active = false;
  private queueEpoch = 0;
  private operationId = 0;
  private readonly activeControllers = new Set<AbortController>();
  private readonly controllersByOwner = new Map<string, Set<AbortController>>();
  private disposed = false;
  private lastDeviceRefreshAt = Number.NEGATIVE_INFINITY;

  constructor(options: HarmonyDeviceManagerOptions = {}) {
    this.configPath = options.configPath ?? defaultHarmonyConfigPath();
    this.config = readHarmonyConfig(this.configPath);
    this.now = options.now ?? Date.now;
    this.token = options.token ?? (() => randomBytes(24).toString("base64url"));
    this.backendFactory = options.backendFactory ?? ((config) => createHdcBackend({ resolve: { config } }));
    this.injectedBackend = Boolean(options.backend);
    this.backend = options.backend;
    if (!this.backend) this.tryCreateBackend();
  }

  private tryCreateBackend(): void {
    try {
      this.backend = this.backendFactory(this.config);
      this.runtimeError = undefined;
    } catch (error) {
      this.backend = undefined;
      this.runtimeError = asHarmonyError(error);
    }
  }

  private requireBackend(): HarmonyAutomationBackend {
    if (this.disposed) throw new HarmonyError("INTERNAL_ERROR", "Harmony device manager is disposed");
    if (!this.backend) throw this.runtimeError ?? new HarmonyError("HDC_NOT_FOUND", "HDC is unavailable");
    return this.backend;
  }

  private emit(event: HarmonyManagerEvent): void {
    for (const listener of [...this.listeners]) {
      try { listener(event); } catch { /* A broken SSE client must not break device control. */ }
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private withAbort(parent?: AbortSignal, ownerId?: string): { controller: AbortController; cleanup: () => void } {
    const controller = new AbortController();
    const abort = () => controller.abort(parent?.reason);
    if (parent?.aborted) controller.abort(parent.reason);
    else parent?.addEventListener("abort", abort, { once: true });
    this.activeControllers.add(controller);
    if (ownerId) {
      const owned = this.controllersByOwner.get(ownerId) ?? new Set<AbortController>();
      owned.add(controller);
      this.controllersByOwner.set(ownerId, owned);
    }
    return {
      controller,
      cleanup: () => {
        parent?.removeEventListener("abort", abort);
        this.activeControllers.delete(controller);
        if (ownerId) {
          const owned = this.controllersByOwner.get(ownerId);
          owned?.delete(controller);
          if (owned?.size === 0) this.controllersByOwner.delete(ownerId);
        }
      },
    };
  }

  private enqueue<T>(
    operation: string,
    task: (signal: AbortSignal, operationId: number) => Promise<T>,
    parentSignal?: AbortSignal,
    ownerId?: string,
  ): Promise<T> {
    if (this.disposed) return Promise.reject(new HarmonyError("INTERNAL_ERROR", "Harmony device manager is disposed"));
    const epoch = this.queueEpoch;
    const operationId = ++this.operationId;
    const abort = this.withAbort(parentSignal, ownerId);
    this.pending += 1;
    let resolveResult!: (value: T | PromiseLike<T>) => void;
    let rejectResult!: (reason?: unknown) => void;
    const result = new Promise<T>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });

    this.queueTail = this.queueTail
      .catch(() => undefined)
      .then(async () => {
        this.pending -= 1;
        if (epoch !== this.queueEpoch || abort.controller.signal.aborted) {
          abort.cleanup();
          rejectResult(new HarmonyError("COMMAND_ABORTED", "Device operation was cancelled by emergency stop", { retryable: true }));
          return;
        }
        this.active = true;
        try {
          const value = await task(abort.controller.signal, operationId);
          resolveResult(value);
        } catch (error) {
          rejectResult(asHarmonyError(error));
        } finally {
          abort.cleanup();
          this.active = false;
        }
      });
    return result;
  }

  private sweepExpiredLeases(): void {
    const now = this.now();
    for (const lease of [...this.leasesByToken.values()]) {
      if (Date.parse(lease.expiresAt) <= now) this.removeLease(lease, "expired");
    }
  }

  private removeLease(lease: HarmonyLease, reason: string): void {
    this.leasesByToken.delete(lease.token);
    if (this.leasesBySerial.get(lease.serial)?.token === lease.token) this.leasesBySerial.delete(lease.serial);
    this.emit({
      type: "lease_released",
      timestamp: iso(this.now()),
      serial: lease.serial,
      ownerId: lease.owner.id,
      reason,
    });
  }

  private requireLease(serial: string, token: string | undefined): HarmonyLease {
    this.sweepExpiredLeases();
    if (!token) throw new HarmonyError("LEASE_REQUIRED", "An active device lease is required");
    const lease = this.leasesByToken.get(token);
    if (!lease || lease.serial !== serial) {
      throw new HarmonyError("LEASE_REQUIRED", "The device lease is missing or belongs to another device");
    }
    if (Date.parse(lease.expiresAt) <= this.now()) {
      this.removeLease(lease, "expired");
      throw new HarmonyError("LEASE_EXPIRED", "The device lease has expired", { retryable: true });
    }
    return lease;
  }

  private duration(ttlMs?: number): number {
    const value = ttlMs ?? DEFAULT_LEASE_TTL_MS;
    if (!Number.isFinite(value) || value < MIN_LEASE_TTL_MS || value > MAX_LEASE_TTL_MS) {
      throw new HarmonyError("INVALID_ARGUMENT", `Lease TTL must be between ${MIN_LEASE_TTL_MS} and ${MAX_LEASE_TTL_MS} ms`);
    }
    return Math.round(value);
  }

  private normalizeDevices(devices: BackendDevice[]): HarmonyDevice[] {
    const timestamp = iso(this.now());
    const presentNow = new Set<string>();
    const normalized: HarmonyDevice[] = [];
    for (const device of devices) {
      validateSerial(device.serial);
      if (presentNow.has(device.serial)) continue;
      presentNow.add(device.serial);
      const previous = this.devices.get(device.serial);
      const wasPresent = this.presentLastRefresh.has(device.serial);
      let generation = this.generations.get(device.serial) ?? 0;
      if (generation === 0) generation = 1;
      else if (!wasPresent || previous?.state !== device.state) generation += 1;
      this.generations.set(device.serial, generation);
      const current: HarmonyDevice = { ...device, generation, lastSeenAt: timestamp };
      this.devices.set(device.serial, current);
      normalized.push(current);
      if (!previous || previous.generation !== generation) this.snapshots.delete(device.serial);
    }
    for (const serial of [...this.presentLastRefresh]) {
      if (!presentNow.has(serial)) {
        this.snapshots.delete(serial);
        const lease = this.leasesBySerial.get(serial);
        if (lease) this.removeLease(lease, "device_disconnected");
      }
    }
    this.presentLastRefresh.clear();
    for (const serial of presentNow) this.presentLastRefresh.add(serial);
    for (const [serial] of this.devices) if (!presentNow.has(serial)) this.devices.delete(serial);
    return normalized;
  }

  private async refreshDevices(signal?: AbortSignal): Promise<HarmonyDevice[]> {
    const backend = this.requireBackend();
    try {
      const devices = this.normalizeDevices(await backend.listDevices(signal));
      this.lastDeviceRefreshAt = this.now();
      this.runtimeError = undefined;
      this.emit({ type: "devices", timestamp: iso(this.now()), devices });
      return devices;
    } catch (error) {
      this.runtimeError = asHarmonyError(error);
      throw this.runtimeError;
    }
  }

  async listDevices(signal?: AbortSignal): Promise<HarmonyDevice[]> {
    return await this.enqueue("list_devices", async (queuedSignal) => await this.refreshDevices(queuedSignal), signal);
  }

  private async onlineDevice(serial: string, signal?: AbortSignal): Promise<HarmonyDevice> {
    const cached = this.devices.get(serial);
    const device = cached?.state === "online" && this.now() - this.lastDeviceRefreshAt < DEVICE_REFRESH_TTL_MS
      ? cached
      : (await this.refreshDevices(signal)).find((candidate) => candidate.serial === serial);
    if (!device) throw new HarmonyError("DEVICE_NOT_FOUND", "Harmony device is not connected", { retryable: true });
    if (device.state !== "online") throw new HarmonyError("DEVICE_OFFLINE", "Harmony device is not online or authorized", { retryable: true });
    return device;
  }

  async acquireLease(options: AcquireLeaseOptions): Promise<HarmonyLease> {
    validateSerial(options.serial);
    validateOwner(options.owner);
    const ttl = this.duration(options.ttlMs);
    return await this.enqueue("acquire_lease", async (signal) => {
      await this.onlineDevice(options.serial, signal);
      this.sweepExpiredLeases();
      const existing = this.leasesBySerial.get(options.serial);
      if (existing) {
        if (existing.owner.id !== options.owner.id) {
          throw new HarmonyError("LEASE_CONFLICT", "The device is controlled by another owner", {
            details: { ownerKind: existing.owner.kind, expiresAt: existing.expiresAt },
            retryable: true,
          });
        }
        const renewed: HarmonyLease = { ...existing, expiresAt: iso(this.now() + ttl) };
        this.leasesBySerial.set(options.serial, renewed);
        this.leasesByToken.set(renewed.token, renewed);
        return renewed;
      }
      const acquiredAt = iso(this.now());
      const lease: HarmonyLease = {
        token: this.token(),
        serial: options.serial,
        owner: { ...options.owner },
        acquiredAt,
        expiresAt: iso(this.now() + ttl),
      };
      this.leasesBySerial.set(options.serial, lease);
      this.leasesByToken.set(lease.token, lease);
      this.emit({ type: "lease_acquired", timestamp: acquiredAt, lease });
      return lease;
    }, options.signal, options.owner.id);
  }

  renewLease(token: string, ttlMs?: number): HarmonyLease {
    this.sweepExpiredLeases();
    const lease = this.leasesByToken.get(token);
    if (!lease) throw new HarmonyError("LEASE_EXPIRED", "The device lease is missing or expired", { retryable: true });
    const renewed = { ...lease, expiresAt: iso(this.now() + this.duration(ttlMs)) };
    this.leasesByToken.set(token, renewed);
    this.leasesBySerial.set(lease.serial, renewed);
    return renewed;
  }

  releaseLease(token: string): boolean {
    const lease = this.leasesByToken.get(token);
    if (!lease) return false;
    this.removeLease(lease, "released");
    return true;
  }

  releaseOwner(ownerId: string): number {
    let count = 0;
    for (const lease of [...this.leasesByToken.values()]) {
      if (lease.owner.id === ownerId) {
        this.removeLease(lease, "owner_released");
        count += 1;
      }
    }
    for (const controller of this.controllersByOwner.get(ownerId) ?? []) controller.abort("owner_released");
    return count;
  }

  async snapshot(options: HarmonySnapshotOptions): Promise<HarmonySnapshot> {
    validateSerial(options.serial);
    const includeTree = options.includeTree ?? true;
    const includeScreenshot = options.includeScreenshot ?? true;
    return await this.enqueue("snapshot", async (signal) => {
      if (options.leaseToken) this.requireLease(options.serial, options.leaseToken);
      const device = await this.onlineDevice(options.serial, signal);
      const raw = await this.requireBackend().snapshot(options.serial, { includeTree, includeScreenshot, signal });
      const revision = (this.snapshotRevisions.get(options.serial) ?? 0) + 1;
      this.snapshotRevisions.set(options.serial, revision);
      const nodes: HarmonyUiNode[] | undefined = includeTree ? raw.nodes?.map((node, index, all) => ({
        ...node,
        ref: `g${device.generation}-r${revision}-n${index}`,
        ...(node.parentIndex === undefined
          ? {}
          : { parentRef: `g${device.generation}-r${revision}-n${Math.min(node.parentIndex, all.length - 1)}` }),
        parentIndex: undefined,
      })) : undefined;
      const snapshot: StoredSnapshot = {
        serial: options.serial,
        generation: device.generation,
        revision,
        capturedAt: iso(this.now()),
        tree: includeTree ? raw.tree : undefined,
        nodes,
        screenshot: includeScreenshot ? raw.screenshot : undefined,
        nodeByRef: new Map((nodes ?? []).map((node) => [node.ref, node])),
      };
      // Live-view screenshot polling must not replace the latest UI-tree refs.
      // A later tree capture still invalidates those refs by advancing revision.
      if (includeTree) this.snapshots.set(options.serial, snapshot);
      this.emit({ type: "snapshot", timestamp: snapshot.capturedAt, serial: options.serial, generation: device.generation, revision });
      const { nodeByRef, ...publicSnapshot } = snapshot;
      void nodeByRef;
      return publicSnapshot;
    }, options.signal);
  }

  private async action(
    operation: string,
    serial: string,
    leaseToken: string,
    generation: number | undefined,
    signal: AbortSignal | undefined,
    invoke: (backend: HarmonyAutomationBackend, queuedSignal: AbortSignal) => Promise<void>,
  ): Promise<HarmonyOperationResult> {
    validateSerial(serial);
    const lease = this.requireLease(serial, leaseToken);
    return await this.enqueue(operation, async (queuedSignal, operationId) => {
      this.requireLease(serial, leaseToken);
      const device = await this.onlineDevice(serial, queuedSignal);
      if (generation !== undefined && generation !== device.generation) {
        throw new HarmonyError("STALE_SNAPSHOT", "The device reconnected after this snapshot was captured", {
          details: { expectedGeneration: device.generation, receivedGeneration: generation },
          retryable: true,
        });
      }
      await invoke(this.requireBackend(), queuedSignal);
      this.emit({ type: "operation", timestamp: iso(this.now()), serial, operation, operationId });
      return { serial, operationId, generation: device.generation, completedAt: iso(this.now()) };
    }, signal, lease.owner.id);
  }

  async tap(options: HarmonyTapOptions): Promise<HarmonyOperationResult> {
    return await this.action("tap", options.serial, options.leaseToken, options.generation, options.signal,
      async (backend, signal) => await backend.tap(options.serial, options.x, options.y, signal));
  }

  async tapRef(options: HarmonyTapRefOptions): Promise<HarmonyOperationResult> {
    const snapshot = this.snapshots.get(options.serial);
    if (!snapshot || snapshot.generation !== options.generation) {
      throw new HarmonyError("STALE_SNAPSHOT", "The referenced snapshot is no longer current", { retryable: true });
    }
    const node = snapshot.nodeByRef.get(options.ref);
    if (!node?.bounds) throw new HarmonyError("INVALID_ARGUMENT", "UI reference does not have tappable bounds");
    if (node.enabled === false || node.visible === false) throw new HarmonyError("INVALID_ARGUMENT", "UI reference is not enabled or visible");
    const x = Math.round((node.bounds.left + node.bounds.right) / 2);
    const y = Math.round((node.bounds.top + node.bounds.bottom) / 2);
    return await this.action("tap_ref", options.serial, options.leaseToken, options.generation, options.signal,
      async (backend, signal) => {
        const current = this.snapshots.get(options.serial);
        if (!current || current.revision !== snapshot.revision || !current.nodeByRef.has(options.ref)) {
          throw new HarmonyError("STALE_SNAPSHOT", "The UI reference was replaced by a newer snapshot", { retryable: true });
        }
        await backend.tap(options.serial, x, y, signal);
      });
  }

  async swipe(options: HarmonySwipeOptions): Promise<HarmonyOperationResult> {
    return await this.action("swipe", options.serial, options.leaseToken, options.generation, options.signal,
      async (backend, signal) => await backend.swipe(
        options.serial, options.fromX, options.fromY, options.toX, options.toY, options.durationMs, signal,
      ));
  }

  async inputText(options: HarmonyInputTextOptions): Promise<HarmonyOperationResult> {
    return await this.action("input_text", options.serial, options.leaseToken, undefined, options.signal,
      async (backend, signal) => await backend.inputText(options.serial, options.text, signal));
  }

  async pressKey(options: HarmonyPressKeyOptions): Promise<HarmonyOperationResult> {
    return await this.action("press_key", options.serial, options.leaseToken, undefined, options.signal,
      async (backend, signal) => await backend.pressKey(options.serial, options.key, signal));
  }

  async launchApp(options: HarmonyLaunchAppOptions): Promise<HarmonyOperationResult> {
    return await this.action("launch_app", options.serial, options.leaseToken, undefined, options.signal,
      async (backend, signal) => await backend.launchApp(options.serial, options.bundleName, options.abilityName, signal));
  }

  getConfig(): HarmonyConfig {
    return { ...this.config };
  }

  async updateConfig(patch: { hdcPath?: string | null; vision?: HarmonyConfig["vision"] | null }): Promise<HarmonyConfig> {
    if (this.injectedBackend) throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Injected Harmony backends cannot be reconfigured");
    const next: HarmonyConfig = { ...this.config };
    if (patch.hdcPath === null || patch.hdcPath === "") delete next.hdcPath;
    else if (patch.hdcPath !== undefined) next.hdcPath = patch.hdcPath;
    if (patch.vision === null) delete next.vision;
    else if (patch.vision !== undefined) next.vision = patch.vision;
    const normalized = writeHarmonyConfig(next, this.configPath);
    const runtimeChanged = normalized.hdcPath !== this.config.hdcPath;
    this.config = normalized;
    if (runtimeChanged) {
      await this.emergencyStop("configuration_changed");
      await this.backend?.dispose?.();
      this.backend = undefined;
      this.tryCreateBackend();
      if (!this.backend) throw this.runtimeError;
    }
    return this.getConfig();
  }

  async getDiagnostics(): Promise<HarmonyDiagnostics> {
    this.sweepExpiredLeases();
    return {
      timestamp: iso(this.now()),
      config: this.getConfig(),
      runtime: {
        status: this.runtimeError ? "error" : this.backend ? "ready" : "unresolved",
        ...(this.backend?.hdcPath ? { hdcPath: this.backend.hdcPath } : {}),
        ...(this.backend ? { backendKind: this.backend.kind } : {}),
        ...(this.runtimeError ? { error: this.runtimeError.toJSON() } : {}),
      },
      deviceCount: this.devices.size,
      onlineDeviceCount: [...this.devices.values()].filter((device) => device.state === "online").length,
      activeLeaseCount: this.leasesByToken.size,
      queue: { pending: this.pending, active: this.active, epoch: this.queueEpoch },
    };
  }

  getState(serial?: string): HarmonyManagerState {
    this.sweepExpiredLeases();
    const devices = [...this.devices.values()].filter((device) => !serial || device.serial === serial);
    return {
      runtime: {
        status: this.runtimeError ? "error" : this.backend ? "ready" : "unresolved",
        ...(this.backend?.hdcPath ? { hdcPath: this.backend.hdcPath } : {}),
        ...(this.runtimeError ? { error: this.runtimeError.toJSON() } : {}),
      },
      devices,
      leases: [...this.leasesByToken.values()].filter((lease) => !serial || lease.serial === serial),
      snapshots: [...this.snapshots.values()]
        .filter((snapshot) => !serial || snapshot.serial === serial)
        .map((snapshot) => ({
          serial: snapshot.serial,
          generation: snapshot.generation,
          revision: snapshot.revision,
          capturedAt: snapshot.capturedAt,
          hasTree: snapshot.tree !== undefined,
          hasScreenshot: snapshot.screenshot !== undefined,
        })),
    };
  }

  async emergencyStop(reason = "emergency_stop"): Promise<void> {
    this.queueEpoch += 1;
    this.lastDeviceRefreshAt = Number.NEGATIVE_INFINITY;
    for (const controller of this.activeControllers) controller.abort(reason);
    for (const lease of [...this.leasesByToken.values()]) this.removeLease(lease, reason);
    this.snapshots.clear();
    for (const [serial, generation] of this.generations) {
      const nextGeneration = generation + 1;
      this.generations.set(serial, nextGeneration);
      const device = this.devices.get(serial);
      if (device) this.devices.set(serial, { ...device, generation: nextGeneration });
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    await this.emergencyStop("disposed");
    await this.queueTail.catch(() => undefined);
    this.disposed = true;
    await this.backend?.dispose?.();
    this.listeners.clear();
  }
}

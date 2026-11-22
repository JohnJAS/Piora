import { randomBytes } from "node:crypto";
import { rm, statfs } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { saveHarmonyScreenshot } from "./artifacts";
import type { AudioOutput } from "./audio/acoustic-provider";
import type { AppTestPairing } from "./audio/app-test-provider";
import type { HarmonyDoctorReport } from "./contracts/capabilities";
import type { HarmonyFileScope } from "./device-files";
import type { DeviceTextEncoding, DeviceTextReadEncoding, WritableDeviceNewline } from "./device-text";
import { createSupportBundle, saveSupportBundle } from "./diagnostics/support-bundle";
import { asHarmonyError, HarmonyError } from "./errors";
import { createHybridHarmonyBackend } from "./hybrid-backend";
import { deviceFingerprint } from "./input/calibration-store";
import type { PhysicalKey } from "./input/key-catalog";
import type { HarmonyGeometry } from "./observation/geometry";
import { observationQuality, requireValidObservation } from "./observation/quality";
import { resolveRetainedTarget } from "./observation/target-resolver";
import { HarmonyOperationTasks } from "./operation-tasks";
import { defaultHarmonyConfigPath, readHarmonyConfig, writeHarmonyConfig } from "./runtime";
import { acquireDeviceLock } from "./runtime/device-lock";
import { fencedBackend } from "./runtime/dispatch-fence";
import { importDeviceFileArtifact } from "./runtime/file-artifact";
import { importHapArtifact } from "./runtime/hap-artifact";
import { HarmonyRecoveryStore } from "./runtime/recovery-store";
import { boundedCleanup } from "./runtime/resource-scope";
import { runHarmonyScenario, validateHarmonyScenario } from "./scenario-executor";
import { ScenarioExecutionStore, observationFingerprint } from "./scenario/execution-store";
import { collectScenarioLogs } from "./scenario/report-logs";
import { validateTcpDeviceAddress } from "./tcp-device";
import type {
  BackendDevice,
  HarmonyAutomationBackend,
  HarmonyConfig,
  HarmonyDevice,
  HarmonyDiagnostics,
  HarmonyDragOptions,
  HarmonyFlingOptions,
  HarmonyInputTextOptions,
  HarmonyInstallAppOptions,
  HarmonyLaunchAppOptions,
  HarmonyLease,
  HarmonyLogEntry,
  HarmonyLogOptions,
  HarmonyManagerEvent,
  HarmonyManagerState,
  HarmonyMediaArtifact,
  HarmonyOperationResult,
  HarmonyPointGestureOptions,
  HarmonyPressKeyOptions,
  HarmonyProcess,
  HarmonyRecordingState,
  HarmonyScenarioOptions,
  HarmonyScenarioResult,
  HarmonySnapshot,
  HarmonySnapshotOptions,
  HarmonySwipeOptions,
  HarmonyTapOptions,
  HarmonyTapRefOptions,
  HarmonyUiNode,
  HarmonyUiSelector,
  HarmonyVideoConnection,
} from "./types";
import { HarmonyAudioVoiceController, type VoiceInputOptions } from "./manager/audio-voice-controller";
import { HarmonyDoctorRunner } from "./manager/doctor-runner";
import { HarmonyManualPointerController } from "./manager/manual-pointer-controller";
import { HarmonyMediaStreamController } from "./manager/media-stream-controller";
import { HarmonyRecordingController } from "./manager/recording-controller";
import {
  awaitSharedOperation,
  DEVICE_MISSING_GRACE_REFRESHES,
  DEVICE_REFRESH_TTL_MS,
  iso,
  MAX_LEASE_TTL_MS,
  MAX_RETAINED_REFERENCE_SNAPSHOTS,
  normalizeLeaseDuration,
  validateOwner,
  validateSerial,
  type AcquireLeaseOptions,
  type HarmonyDeviceManagerOptions,
  type HarmonyManagerListener,
  type OperationLane,
  type StoredReferenceSnapshot,
  type StoredSnapshot,
} from "./manager/shared";

export type { AcquireLeaseOptions, HarmonyDeviceManagerOptions };

export class HarmonyDeviceManager {
  readonly operationTasks: HarmonyOperationTasks;
  private backend?: HarmonyAutomationBackend;
  private readonly injectedBackend: boolean;
  private readonly backendFactory: (config: HarmonyConfig) => HarmonyAutomationBackend;
  private readonly configPath: string;
  private config: HarmonyConfig;
  private readonly now: () => number;
  private readonly freeDiskBytes: (directory: string) => Promise<number>;
  private readonly token: () => string;
  private readonly devices = new Map<string, HarmonyDevice>();
  private readonly generations = new Map<string, number>();
  private readonly presentLastRefresh = new Set<string>();
  private readonly missingRefreshCounts = new Map<string, number>();
  private readonly leasesBySerial = new Map<string, HarmonyLease>();
  private readonly leasesByToken = new Map<string, HarmonyLease>();
  private readonly snapshots = new Map<string, StoredSnapshot>();
  private readonly referenceSnapshots = new Map<string, StoredReferenceSnapshot[]>();
  private readonly inputOnlyStops = new Set<string>();
  private readonly snapshotRevisions = new Map<string, number>();
  private readonly listeners = new Set<HarmonyManagerListener>();
  private runtimeError?: HarmonyError;
  private readonly operationLanes = new Map<string, OperationLane>();
  private pending = 0;
  private activeCount = 0;
  private queueEpoch = 0;
  private operationId = 0;
  private readonly activeControllers = new Set<AbortController>();
  private readonly controllersByOwner = new Map<string, Set<AbortController>>();
  private readonly controllersByLease = new Map<string, Set<AbortController>>();
  private readonly controllersByDevice = new Map<string, Set<AbortController>>();
  private readonly controllersByMedia = new Map<string, Set<AbortController>>();
  private readonly leaseTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly stoppingDevices = new Map<string, "stopping" | "recovering">();
  private readonly stopPromises = new Map<string, Promise<{ dispatchBlocked: true; cleanup: "complete" | "uncertain" }>>();
  private readonly recoveryStore?: HarmonyRecoveryStore;
  private readonly uncertainInput = new Set<string>();
  private readonly cleanupUnsettled = new Set<string>();
  private readonly cleanupWork = new Map<string, Promise<unknown>>();
  private readonly inputCleanupWork = new Map<string, Promise<void>>();
  private readonly physicalLocks = new Map<string, ReturnType<typeof acquireDeviceLock>>();
  private readonly arbitrationDirectory?: string;
  private readonly cleanupTimeoutMs: number;
  private leaseEpoch = 0;
  private readonly scenarioStore?: ScenarioExecutionStore;
  private stoppingAll = false;
  private disposed = false;
  private lastDeviceRefreshAt = Number.NEGATIVE_INFINITY;
  private deviceRefreshPromise?: Promise<HarmonyDevice[]>;
  private deviceListPromise?: Promise<HarmonyDevice[]>;
  private deviceRefreshController?: AbortController;

  private readonly recordingController: HarmonyRecordingController;
  private readonly mediaController: HarmonyMediaStreamController;
  private readonly doctorRunner: HarmonyDoctorRunner;
  private readonly audioVoice: HarmonyAudioVoiceController;
  private readonly manualPointer: HarmonyManualPointerController;

  constructor(options: HarmonyDeviceManagerOptions = {}) {
    this.arbitrationDirectory = options.arbitrationDirectory;
    this.cleanupTimeoutMs = options.cleanupTimeoutMs ?? 2_000;
    this.configPath = options.configPath ?? defaultHarmonyConfigPath();
    this.config = readHarmonyConfig(this.configPath);
    this.now = options.now ?? Date.now;
    this.freeDiskBytes = options.freeDiskBytes ?? (async directory => { const space = await statfs(directory); return space.bavail * space.bsize; });
    const persistent = !options.backend || Boolean(options.configPath);
    this.operationTasks = new HarmonyOperationTasks(
      persistent ? join(dirname(this.configPath), "harmony-operation-tasks.json") : undefined,
      this.now,
    );
    if (persistent) {
      this.scenarioStore = new ScenarioExecutionStore(join(dirname(this.configPath), "harmony-executions"));
      this.scenarioStore.recoverInterrupted();
      this.recoveryStore = new HarmonyRecoveryStore(join(dirname(this.configPath), "harmony-recovery"));
      for (const record of this.recoveryStore.interrupted()) {
        // An owned recording is a local stream subscription, not phone input.
        // The exited process cannot keep recording; exact forward evidence stays
        // in the backend journal. Only physical input needs release confirmation.
        const resources = record.resources ?? { [record.kind]: record.state };
        this.recoveryStore.clear(record.serial, "recording");
        if (resources.input) { this.uncertainInput.add(record.serial); this.stoppingDevices.set(record.serial, "recovering"); }
      }
    }
    this.token = options.token ?? (() => randomBytes(24).toString("base64url"));
    this.backendFactory = options.backendFactory ?? ((config) => createHybridHarmonyBackend({ resolve: { config } }));
    this.injectedBackend = Boolean(options.backend);
    this.backend = options.backend;

    this.recordingController = new HarmonyRecordingController({
      configPath: this.configPath,
      persistentDrafts: persistent,
      operationTasks: this.operationTasks,
      recoveryStore: this.recoveryStore,
      now: this.now,
      freeDiskBytes: this.freeDiskBytes,
      getConfig: () => this.config,
      requireBackend: () => this.requireBackend(),
      requireAdmission: (serial, passive) => this.requireAdmission(serial, passive),
      requireLease: (serial, token) => this.requireLease(serial, token),
      onlineDevice: (serial, signal) => this.onlineDevice(serial, signal),
      enqueue: (operation, task, parentSignal, ownerId, serial, leaseToken, laneName) =>
        this.enqueue(operation, task, parentSignal, ownerId, serial, leaseToken, laneName),
      emit: (event) => this.emit(event),
      getState: () => this.getState(),
      setRuntimeError: (error) => { this.runtimeError = error; },
      markDeviceRecovering: (serial) => { this.stoppingDevices.set(serial, "recovering"); },
      clearStoppingIfIdle: (serial) => {
        if (!this.cleanupWork.has(serial) && !this.stopPromises.has(serial) && !this.uncertainInput.has(serial)) {
          this.stoppingDevices.delete(serial);
        }
      },
    });

    this.mediaController = new HarmonyMediaStreamController({
      cleanupTimeoutMs: this.cleanupTimeoutMs,
      now: this.now,
      isDisposed: () => this.disposed,
      getDevice: (serial) => this.devices.get(serial),
      getGeneration: (serial) => this.generations.get(serial),
      requireBackend: () => this.requireBackend(),
      requireAdmission: (serial, passive) => this.requireAdmission(serial, passive),
      onlineDevice: (serial, signal) => this.onlineDevice(serial, signal),
      enqueue: (operation, task, parentSignal, ownerId, serial, leaseToken, laneName) =>
        this.enqueue(operation, task, parentSignal, ownerId, serial, leaseToken, laneName),
    });

    this.audioVoice = new HarmonyAudioVoiceController({
      configPath: this.configPath,
      onlineDevice: (serial, signal) => this.onlineDevice(serial, signal),
      requireLease: (serial, token) => this.requireLease(serial, token),
      snapshot: (snapshotOptions) => this.snapshot(snapshotOptions),
      captureSnapshotNow: (serial, includeTree, includeScreenshot, signal) =>
        this.captureSnapshotNow(serial, includeTree, includeScreenshot, signal),
      resolveInputPoint: (pointOptions, x, y, signal) => this.mediaController.resolveInputPoint(pointOptions, x, y, signal),
      findGeometryById: (geometryId) => this.mediaController.findGeometryById(geometryId),
      action: (operation, serial, leaseToken, generation, signal, invoke) =>
        this.action(operation, serial, leaseToken, generation, signal, invoke),
    });

    this.doctorRunner = new HarmonyDoctorRunner({
      injectedBackend: this.injectedBackend,
      operationTasks: this.operationTasks,
      now: this.now,
      getConfig: () => this.config,
      hasBackend: () => Boolean(this.backend),
      tryCreateBackend: () => this.tryCreateBackend(),
      requireBackend: () => this.requireBackend(),
      onlineDevice: (serial, signal) => this.onlineDevice(serial, signal),
      enqueue: (operation, task, parentSignal, ownerId, serial, leaseToken, laneName) =>
        this.enqueue(operation, task, parentSignal, ownerId, serial, leaseToken, laneName),
      listAcousticOutputs: (signal) => this.audioVoice.audioOutputs(signal),
      listVoiceProfileIds: (device) => this.audioVoice.listVoiceProfileIds(device),
      getFrameCapturedAt: (key) => this.mediaController.getFrameCapturedAt(key),
    });

    this.manualPointer = new HarmonyManualPointerController({
      now: this.now,
      getGeneration: (serial) => this.generations.get(serial),
      requireLease: (serial, token) => this.requireLease(serial, token),
      requireBackend: () => this.requireBackend(),
      getGeometry: (key) => this.mediaController.getGeometry(key),
      getFrameCapturedAt: (key) => this.mediaController.getFrameCapturedAt(key),
      getFrameGeometry: (serial, space, signal) => this.mediaController.getFrameGeometry(serial, space, signal),
      resolveInputPoint: (pointOptions, x, y, signal) => this.mediaController.resolveInputPoint(pointOptions, x, y, signal),
      action: (operation, serial, leaseToken, generation, signal, invoke) =>
        this.action(operation, serial, leaseToken, generation, signal, invoke),
    });

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

  private forgetDeviceSnapshots(serial: string): void {
    this.snapshots.delete(serial);
    this.referenceSnapshots.delete(serial);
    this.mediaController.forgetDeviceFrameState(serial);
  }

  private retainSnapshotReferences(serial: string, snapshot: StoredSnapshot): void {
    const history = (this.referenceSnapshots.get(serial) ?? [])
      .filter((entry) => entry.generation === snapshot.generation && entry.revision !== snapshot.revision);
    history.push({
      capturedAt: snapshot.capturedAt,
      quality: snapshot.quality,
      generation: snapshot.generation,
      revision: snapshot.revision,
      nodeByRef: snapshot.nodeByRef,
    });
    if (history.length > MAX_RETAINED_REFERENCE_SNAPSHOTS) {
      history.splice(0, history.length - MAX_RETAINED_REFERENCE_SNAPSHOTS);
    }
    this.referenceSnapshots.set(serial, history);
  }

  subscribe(listener: HarmonyManagerListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private withAbort(parent?: AbortSignal, ownerId?: string, serial?: string, leaseToken?: string, media = false): { controller: AbortController; cleanup: () => void } {
    const controller = new AbortController();
    const abort = () => controller.abort(parent?.reason);
    if (parent?.aborted) controller.abort(parent.reason);
    else parent?.addEventListener("abort", abort, { once: true });
    this.activeControllers.add(controller);
    const indexes: Array<[Map<string, Set<AbortController>>, string | undefined]> = [
      [this.controllersByDevice, serial], [this.controllersByLease, leaseToken],
      [this.controllersByMedia, media ? serial : undefined],
    ];
    for (const [index, key] of indexes) {
      if (!key) continue;
      const controllers = index.get(key) ?? new Set<AbortController>();
      controllers.add(controller);
      index.set(key, controllers);
    }
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
        for (const [index, key] of indexes) {
          if (!key) continue;
          const controllers = index.get(key);
          controllers?.delete(controller);
          if (!controllers?.size) index.delete(key);
        }
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
    serial?: string,
    leaseToken?: string,
    laneName = "device",
  ): Promise<T> {
    if (this.disposed) return Promise.reject(new HarmonyError("INTERNAL_ERROR", "Harmony device manager is disposed"));
    const epoch = this.queueEpoch;
    const operationId = ++this.operationId;
    const abort = this.withAbort(parentSignal, ownerId, serial, leaseToken, laneName === "media");
    const laneKey = serial ? `${laneName}:${serial}` : "global";
    const lane = this.operationLanes.get(laneKey) ?? { tail: Promise.resolve(), pending: 0, active: false };
    if (lane.pending >= 64) {
      abort.cleanup();
      return Promise.reject(new HarmonyError("DEVICE_BUSY", "Device queue is full; wait for pending work to complete", { retryable: true }));
    }
    this.operationLanes.set(laneKey, lane);
    this.pending += 1;
    lane.pending += 1;
    let resolveResult!: (value: T | PromiseLike<T>) => void;
    let rejectResult!: (reason?: unknown) => void;
    const result = new Promise<T>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });

    lane.tail = lane.tail
      .catch(() => undefined)
      .then(async () => {
        this.pending -= 1;
        lane.pending -= 1;
        if (epoch !== this.queueEpoch || abort.controller.signal.aborted) {
          abort.cleanup();
          if (lane.pending === 0 && !lane.active) this.operationLanes.delete(laneKey);
          rejectResult(new HarmonyError("COMMAND_ABORTED", "Device operation was cancelled by emergency stop", { retryable: true }));
          return;
        }
        lane.active = true;
        this.activeCount += 1;
        try {
          const value = await task(abort.controller.signal, operationId);
          resolveResult(value);
        } catch (error) {
          rejectResult(asHarmonyError(error));
        } finally {
          abort.cleanup();
          lane.active = false;
          this.activeCount -= 1;
          if (lane.pending === 0 && !lane.active) this.operationLanes.delete(laneKey);
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

  private scheduleLeaseExpiry(lease: HarmonyLease): void {
    clearTimeout(this.leaseTimers.get(lease.token));
    const timer = setTimeout(() => {
      const current = this.leasesByToken.get(lease.token);
      if (!current) return;
      if (Date.parse(current.expiresAt) <= this.now()) this.removeLease(current, "expired");
      else this.scheduleLeaseExpiry(current);
    }, Math.max(1, Date.parse(lease.expiresAt) - this.now()));
    timer.unref?.();
    this.leaseTimers.set(lease.token, timer);
  }

  private requireAdmission(serial: string, passive = false): void {
    if (this.stoppingAll || (this.stoppingDevices.has(serial) && !(passive && this.inputOnlyStops.has(serial)))) {
      throw new HarmonyError("DEVICE_BUSY", "Device dispatch is blocked while stopping or awaiting cleanup confirmation", {
        details: { serial, state: this.stoppingDevices.get(serial) ?? "stopping", dispatchState: "not-sent" },
      });
    }
  }

  private removeLease(lease: HarmonyLease, reason: string): void {
    clearTimeout(this.leaseTimers.get(lease.token));
    this.leaseTimers.delete(lease.token);
    this.leasesByToken.delete(lease.token);
    if (this.leasesBySerial.get(lease.serial)?.token === lease.token) this.leasesBySerial.delete(lease.serial);
    this.forgetDeviceSnapshots(lease.serial);
    for (const controller of this.controllersByLease.get(lease.token) ?? []) controller.abort(reason);
    this.emit({
      type: "lease_released",
      timestamp: iso(this.now()),
      serial: lease.serial,
      ownerId: lease.owner.id,
      reason,
    });
    if (!this.stoppingDevices.has(lease.serial) && (this.physicalLocks.has(lease.serial) || this.recordingController.hasActiveRecording(lease.serial) || this.controllersByLease.get(lease.token)?.size)) {
      // An ordinary lease release ends input ownership, not device observation.
      const deviceLost = reason === "device_offline" || reason === "device_disconnected" || reason === "device_epoch_changed";
      void this.stopDeviceResources(lease.serial, reason, deviceLost ? undefined : lease.owner.id);
    }
  }

  private requireLease(serial: string, token: string | undefined): HarmonyLease {
    this.requireAdmission(serial);
    this.sweepExpiredLeases();
    if (!token) throw new HarmonyError("LEASE_REQUIRED", "An active device lease is required");
    const lease = this.leasesByToken.get(token);
    if (!lease || lease.serial !== serial) {
      throw new HarmonyError("LEASE_REQUIRED", "The device lease is missing or belongs to another device");
    }
    if (lease.deviceEpoch !== this.generations.get(serial)) {
      this.removeLease(lease, "device_epoch_changed");
      throw new HarmonyError("LEASE_EXPIRED", "The device connection changed; acquire fresh control");
    }
    if (Date.parse(lease.expiresAt) <= this.now()) {
      this.removeLease(lease, "expired");
      throw new HarmonyError("LEASE_EXPIRED", "The device lease has expired", { retryable: true });
    }
    return lease;
  }

  private controlBackend(serial: string, token: string, signal: AbortSignal, trackInstallation = true): HarmonyAutomationBackend {
    const controlled = fencedBackend(this.requireBackend(), signal, () => { this.requireLease(serial, token); }, async (method, args) => {
      this.requireLease(serial, token);
      if (method === "installPackage") {
        args[1] = await importHapArtifact(String(args[1]), join(dirname(this.configPath), "harmony-artifacts"));
      }
      if (method === "pushFile") {
        const directory = join(dirname(this.configPath), "harmony-file-artifacts", randomBytes(16).toString("hex"));
        try { args[2] = await importDeviceFileArtifact(String(args[2]), directory, signal); }
        catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
        return { args, cleanup: async () => { await rm(directory, { recursive: true, force: true }); } };
      }
      return args;
    }, (method, args, error) => {
      this.doctorRunner.recordCapabilityFailure(serial, method, args, error);
    });
    if (!trackInstallation || !controlled.installPackage) return controlled;
    // Scenario steps invoke the backend directly; they must use the same journal as direct installs.
    return new Proxy(controlled, {
      get: (target, key, receiver) => key === "installPackage"
        ? async (device: string, hapPath: string, replace = true, installSignal?: AbortSignal) =>
          this.operationTasks.track({ serial: device, kind: "installation", title: basename(hapPath), target: hapPath }, async started => {
            started(); await controlled.installPackage!(device, hapPath, replace, installSignal);
          }, () => ({ verification: "device-confirmed" }))
        : Reflect.get(target, key, receiver),
    });
  }

  private normalizeDevices(devices: BackendDevice[]): HarmonyDevice[] {
    const timestamp = iso(this.now());
    const presentNow = new Set<string>();
    const normalized: HarmonyDevice[] = [];
    for (const device of devices) {
      validateSerial(device.serial);
      if (presentNow.has(device.serial)) continue;
      presentNow.add(device.serial);
      this.missingRefreshCounts.delete(device.serial);
      const previous = this.devices.get(device.serial);
      const wasPresent = this.presentLastRefresh.has(device.serial);
      let generation = this.generations.get(device.serial) ?? 0;
      if (generation === 0) generation = 1;
      else if (!wasPresent || previous?.state !== device.state) generation += 1;
      this.generations.set(device.serial, generation);
      const current: HarmonyDevice = { ...device, generation, lastSeenAt: timestamp };
      this.devices.set(device.serial, current);
      normalized.push(current);
      if (!previous || previous.generation !== generation || deviceFingerprint(previous) !== deviceFingerprint(current)) {
        this.forgetDeviceSnapshots(device.serial);
        this.doctorRunner.invalidateDevice(device.serial);
      }
      if (current.state !== "online") {
        const lease = this.leasesBySerial.get(device.serial);
        if (lease) this.removeLease(lease, "device_offline");
        if (this.recordingController.hasActiveRecording(device.serial) || this.mediaController.hasActiveStreamsForDevice(device.serial)) {
          void this.stopDevice(device.serial, "device_offline");
        }
      }
    }
    for (const serial of [...this.presentLastRefresh]) {
      if (!presentNow.has(serial)) {
        const missingRefreshes = (this.missingRefreshCounts.get(serial) ?? 0) + 1;
        if (missingRefreshes <= DEVICE_MISSING_GRACE_REFRESHES) {
          this.missingRefreshCounts.set(serial, missingRefreshes);
          const previous = this.devices.get(serial);
          if (previous) normalized.push(previous);
          continue;
        }
        this.missingRefreshCounts.delete(serial);
        this.presentLastRefresh.delete(serial);
        this.devices.delete(serial);
        this.forgetDeviceSnapshots(serial);
        const lease = this.leasesBySerial.get(serial);
        if (lease) this.removeLease(lease, "device_disconnected");
        if (this.recordingController.hasActiveRecording(serial) || this.mediaController.hasActiveStreamsForDevice(serial)) {
          void this.stopDevice(serial, "device_disconnected");
        }
      }
    }
    for (const serial of presentNow) this.presentLastRefresh.add(serial);
    return normalized;
  }

  private async refreshDevices(signal?: AbortSignal): Promise<HarmonyDevice[]> {
    if (this.deviceRefreshPromise) return await awaitSharedOperation(this.deviceRefreshPromise, signal);
    const backend = this.requireBackend();
    const controller = new AbortController();
    this.deviceRefreshController = controller;
    const refresh = (async () => {
      try {
        const devices = this.normalizeDevices(await backend.listDevices(controller.signal));
        this.lastDeviceRefreshAt = this.now();
        this.runtimeError = undefined;
        this.emit({ type: "devices", timestamp: iso(this.now()), devices });
        return devices;
      } catch (error) {
        this.runtimeError = asHarmonyError(error);
        throw this.runtimeError;
      }
    })();
    this.deviceRefreshPromise = refresh;
    void refresh.finally(() => {
      if (this.deviceRefreshPromise === refresh) {
        this.deviceRefreshPromise = undefined;
        this.deviceRefreshController = undefined;
      }
    }).catch(() => undefined);
    return await awaitSharedOperation(refresh, signal);
  }

  async listDevices(signal?: AbortSignal): Promise<HarmonyDevice[]> {
    if (signal?.aborted) throw new HarmonyError("COMMAND_ABORTED", "Device discovery was cancelled");
    // Coalesce before queue admission: otherwise every window's simultaneous
    // poll becomes a separate refresh and consumes the disconnect grace at once.
    if (!this.deviceListPromise) {
      const pending = this.enqueue("list_devices", async queuedSignal => await this.refreshDevices(queuedSignal));
      this.deviceListPromise = pending;
      void pending.finally(() => {
        if (this.deviceListPromise === pending) this.deviceListPromise = undefined;
      }).catch(() => undefined);
    }
    return await awaitSharedOperation(this.deviceListPromise, signal);
  }

  async connectTcpDevice(address: string, remove: boolean, signal?: AbortSignal): Promise<HarmonyDevice[]> {
    const endpoint = validateTcpDeviceAddress(address);
    if (typeof remove !== "boolean") throw new HarmonyError("INVALID_ARGUMENT", "Choose whether to connect or disconnect");
    return await this.enqueue(remove ? "tcp_disconnect" : "tcp_connect", async queuedSignal => {
      if (this.leasesBySerial.has(endpoint)) throw new HarmonyError("DEVICE_BUSY", "Release device control before changing its TCP connection");
      const backend = this.requireBackend();
      if (!backend.connectTcpDevice) throw new HarmonyError("CAPABILITY_UNAVAILABLE", "This HDC backend cannot manage TCP devices");
      await backend.connectTcpDevice(endpoint, remove, queuedSignal);
      let devices = await this.refreshDevices(queuedSignal);
      // Ordinary polling retains a missing device for two refreshes. An explicit,
      // verified disconnect should clear that grace period before responding.
      if (remove) for (let attempt = 0; attempt < DEVICE_MISSING_GRACE_REFRESHES; attempt += 1) devices = await this.refreshDevices(queuedSignal);
      return devices;
    }, signal, undefined, endpoint);
  }

  async listProcesses(serial: string, signal?: AbortSignal): Promise<HarmonyProcess[]> {
    validateSerial(serial);
    return await this.enqueue("list_processes", async (queuedSignal) => {
      await this.onlineDevice(serial, queuedSignal);
      const backend = this.requireBackend();
      if (!backend.listProcesses) throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Harmony process discovery is unavailable");
      return await backend.listProcesses(serial, queuedSignal);
    }, signal, undefined, serial);
  }

  async applications(serial: string, query?: string, bundleName?: string, signal?: AbortSignal) {
    validateSerial(serial);
    return this.enqueue("applications", async queuedSignal => {
      await this.onlineDevice(serial, queuedSignal);
      const backend = this.requireBackend();
      if (!backend.applications) throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Application discovery is unavailable");
      return backend.applications(serial, query, bundleName, queuedSignal);
    }, signal, undefined, serial);
  }

  async listFiles(serial: string, scope: HarmonyFileScope, path: string, signal?: AbortSignal, offset = 0) {
    validateSerial(serial);
    return await this.enqueue("list_device_files", async queuedSignal => {
      await this.onlineDevice(serial, queuedSignal);
      const backend = this.requireBackend();
      if (!backend.listFiles) throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Device file browsing is unavailable");
      return await backend.listFiles(serial, scope, path, queuedSignal, offset);
    }, signal, undefined, serial);
  }

  async statFile(serial: string, scope: HarmonyFileScope, path: string, signal?: AbortSignal) {
    validateSerial(serial);
    return await this.enqueue("stat_device_file", async queuedSignal => {
      await this.onlineDevice(serial, queuedSignal);
      const backend = this.requireBackend();
      if (!backend.statFile) throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Device path lookup is unavailable");
      return await backend.statFile(serial, scope, path, queuedSignal);
    }, signal, undefined, serial);
  }

  async isSqliteFile(serial: string, scope: HarmonyFileScope, path: string, signal?: AbortSignal): Promise<boolean> {
    validateSerial(serial);
    return await this.enqueue("inspect_device_file_signature", async queuedSignal => {
      await this.onlineDevice(serial, queuedSignal);
      const backend = this.requireBackend();
      if (!backend.isSqliteFile) throw new HarmonyError("CAPABILITY_UNAVAILABLE", "SQLite file signature inspection is unavailable");
      return await backend.isSqliteFile(serial, scope, path, queuedSignal);
    }, signal, undefined, serial);
  }

  async searchFiles(serial: string, scope: HarmonyFileScope, path: string, query: string, signal?: AbortSignal) {
    validateSerial(serial);
    return await this.enqueue("search_device_files", async queuedSignal => {
      await this.onlineDevice(serial, queuedSignal);
      const backend = this.requireBackend();
      if (!backend.listFiles) throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Device file browsing is unavailable");
      const { searchHarmonyFiles } = await import("./file-search");
      const deadline = AbortSignal.any([queuedSignal, AbortSignal.timeout(30_000)]);
      return await searchHarmonyFiles(scope, path, query, nextPath => backend.listFiles!(serial, scope, nextPath, deadline), deadline);
    }, signal, undefined, serial);
  }

  async pullFile(serial: string, scope: HarmonyFileScope, path: string, destinationPath: string, signal?: AbortSignal) {
    validateSerial(serial);
    return await this.enqueue("pull_device_file", async queuedSignal => {
      await this.onlineDevice(serial, queuedSignal);
      const backend = this.requireBackend();
      if (!backend.pullFile) throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Device file download is unavailable");
      return await backend.pullFile(serial, scope, path, destinationPath, queuedSignal);
    }, signal, undefined, serial);
  }

  async uploadFile(options: { serial: string; leaseToken: string; scope: HarmonyFileScope; sourcePath: string; path: string; overwrite?: boolean; signal?: AbortSignal }): Promise<HarmonyOperationResult> {
    return await this.action("upload_file", options.serial, options.leaseToken, undefined, options.signal,
      async (backend, signal) => {
        if (!backend.pushFile) throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Device file upload is unavailable");
        await backend.pushFile(options.serial, options.scope, options.sourcePath, options.path, options.overwrite ?? false, signal);
      });
  }

  async createDirectory(options: { serial: string; leaseToken: string; scope: HarmonyFileScope; path: string; signal?: AbortSignal }): Promise<HarmonyOperationResult> {
    return await this.action("create_directory", options.serial, options.leaseToken, undefined, options.signal,
      async (backend, signal) => {
        if (!backend.createDirectory) throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Device directory creation is unavailable");
        await backend.createDirectory(options.serial, options.scope, options.path, signal);
      });
  }

  async deletePath(options: { serial: string; leaseToken: string; scope: HarmonyFileScope; path: string; signal?: AbortSignal }): Promise<HarmonyOperationResult> {
    return await this.action("delete_path", options.serial, options.leaseToken, undefined, options.signal,
      async (backend, signal) => {
        if (!backend.deletePath) throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Device file deletion is unavailable");
        await backend.deletePath(options.serial, options.scope, options.path, signal);
      });
  }

  async renamePath(options: { serial: string; leaseToken: string; scope: HarmonyFileScope; path: string; newPath: string; signal?: AbortSignal }): Promise<HarmonyOperationResult> {
    return await this.action("rename_path", options.serial, options.leaseToken, undefined, options.signal,
      async (backend, signal) => {
        if (!backend.renamePath) throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Device file rename is unavailable");
        await backend.renamePath(options.serial, options.scope, options.path, options.newPath, signal);
      });
  }

  async copyPath(options: { serial: string; leaseToken: string; scope: HarmonyFileScope; path: string; newPath: string; move: boolean; signal?: AbortSignal }): Promise<HarmonyOperationResult> {
    const result = await this.action(options.move ? "move_path" : "copy_path", options.serial, options.leaseToken, undefined, options.signal,
      async (backend, signal) => {
        if (!backend.copyPath) throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Device file copy and move are unavailable");
        await backend.copyPath(options.serial, options.scope, options.path, options.newPath, options.move, signal);
      });
    if (result.receipt) { result.receipt.effect = "applied"; result.receipt.verification = "passed"; }
    return result;
  }

  async chmodPath(options: { serial: string; leaseToken: string; scope: HarmonyFileScope; path: string; mode: string; signal?: AbortSignal }): Promise<HarmonyOperationResult> {
    const result = await this.action("chmod_path", options.serial, options.leaseToken, undefined, options.signal,
      async (backend, signal) => {
        if (!backend.chmodPath) throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Device file permissions cannot be changed");
        await backend.chmodPath(options.serial, options.scope, options.path, options.mode, signal);
      });
    if (result.receipt) { result.receipt.effect = "applied"; result.receipt.verification = "passed"; }
    return result;
  }

  async readTextFile(serial: string, scope: HarmonyFileScope, path: string, signal?: AbortSignal, encoding?: DeviceTextReadEncoding) {
    validateSerial(serial);
    return await this.enqueue("read_device_text", async queuedSignal => {
      await this.onlineDevice(serial, queuedSignal);
      const backend = this.requireBackend();
      if (!backend.readTextFile) throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Device text preview is unavailable");
      return await backend.readTextFile(serial, scope, path, queuedSignal, encoding);
    }, signal, undefined, serial);
  }

  async saveTextFile(options: { serial: string; leaseToken: string; scope: HarmonyFileScope; path: string; text: string; expectedHash: string; newlineMode?: WritableDeviceNewline; encoding?: DeviceTextEncoding; signal?: AbortSignal }): Promise<HarmonyOperationResult> {
    const result = await this.action("save_text_file", options.serial, options.leaseToken, undefined, options.signal,
      async (backend, signal) => {
        if (!backend.saveTextFile) throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Device text editing is unavailable");
        await backend.saveTextFile(options.serial, options.scope, options.path, options.text, options.expectedHash, signal, options.newlineMode, options.encoding);
      });
    if (result.receipt) { result.receipt.effect = "applied"; result.receipt.verification = "passed"; }
    return result;
  }

  async runShellCommand(options: { serial: string; leaseToken: string; scope: HarmonyFileScope; command: string; signal?: AbortSignal }) {
    let output: { stdout: string; stderr: string; exitCode: number; durationMs: number } | undefined;
    const receipt = await this.action("manual_device_command", options.serial, options.leaseToken, undefined, options.signal,
      async (backend, signal) => {
        if (!backend.runShellCommand) throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Manual device commands are unavailable");
        output = await backend.runShellCommand(options.serial, options.scope, options.command, signal);
      });
    if (!output) throw new HarmonyError("INVALID_RESPONSE", "Device command produced no result");
    return { ...output, receipt };
  }

  async readLogs(options: HarmonyLogOptions): Promise<HarmonyLogEntry[]> {
    validateSerial(options.serial);
    return await this.enqueue("read_logs", async (queuedSignal) => {
      await this.onlineDevice(options.serial, queuedSignal);
      const backend = this.requireBackend();
      if (!backend.readLogs) throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Harmony device logs are unavailable");
      return await backend.readLogs(options.serial, {
        ...(options.pid !== undefined ? { pid: options.pid } : {}),
        ...(options.level ? { level: options.level } : {}),
        ...(options.query ? { query: options.query } : {}),
        ...(options.limit ? { limit: options.limit } : {}),
        signal: queuedSignal,
      });
    }, options.signal, undefined, options.serial);
  }

  async streamLogs(serial: string, onEntries: (entries: HarmonyLogEntry[]) => void, signal?: AbortSignal): Promise<void> {
    return this.mediaController.streamLogs(serial, onEntries, signal);
  }

  private async onlineDevice(serial: string, signal?: AbortSignal): Promise<HarmonyDevice> {
    const cached = this.devices.get(serial);
    // A complete frame from the current live connection is newer evidence of
    // connectivity than a device-list TTL. Do not put metadata subprocesses on
    // the input path while that connection is actively delivering frames.
    const liveOnline = this.mediaController.hasFreshVideoFrame(serial, cached?.generation);
    const device = cached?.state === "online" && (liveOnline || this.now() - this.lastDeviceRefreshAt < DEVICE_REFRESH_TTL_MS)
      ? cached
      : (await this.refreshDevices(signal)).find((candidate) => candidate.serial === serial);
    if (!device) throw new HarmonyError("DEVICE_NOT_FOUND", "Harmony device is not connected", { retryable: true });
    if (device.state !== "online") throw new HarmonyError("DEVICE_OFFLINE", "Harmony device is not online or authorized", { retryable: true });
    return device;
  }

  async doctor(serial: string, signal?: AbortSignal, reprobe = false): Promise<HarmonyDoctorReport> {
    return this.doctorRunner.run(serial, signal, reprobe);
  }

  async acquireLease(options: AcquireLeaseOptions): Promise<HarmonyLease> {
    this.requireAdmission(options.serial);
    validateSerial(options.serial);
    validateOwner(options.owner);
    const ttl = normalizeLeaseDuration(options.ttlMs);
    return await this.enqueue("acquire_lease", async (signal) => {
      const device = await this.onlineDevice(options.serial, signal);
      this.requireAdmission(options.serial);
      if (signal.aborted) throw new HarmonyError("COMMAND_ABORTED", "Device lease acquisition was cancelled", { retryable: true });
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
        this.scheduleLeaseExpiry(renewed);
        return renewed;
      }
      const acquiredAt = iso(this.now());
      if ((!this.injectedBackend || this.arbitrationDirectory) && !this.physicalLocks.has(options.serial)) {
        this.physicalLocks.set(options.serial, acquireDeviceLock(options.serial, this.arbitrationDirectory));
      }
      const lease: HarmonyLease = {
        deviceEpoch: device.generation,
        leaseEpoch: ++this.leaseEpoch,
        token: this.token(),
        serial: options.serial,
        owner: { ...options.owner },
        acquiredAt,
        expiresAt: iso(this.now() + ttl),
      };
      this.leasesBySerial.set(options.serial, lease);
      this.leasesByToken.set(lease.token, lease);
      this.scheduleLeaseExpiry(lease);
      this.emit({ type: "lease_acquired", timestamp: acquiredAt, lease });
      return lease;
    }, options.signal, options.owner.id, options.serial);
  }

  renewLease(token: string, ttlMs?: number): HarmonyLease {
    this.sweepExpiredLeases();
    const lease = this.leasesByToken.get(token);
    if (!lease) throw new HarmonyError("LEASE_EXPIRED", "The device lease is missing or expired", { retryable: true });
    this.requireLease(lease.serial, token);
    const renewed = { ...lease, expiresAt: iso(this.now() + normalizeLeaseDuration(ttlMs)) };
    this.leasesByToken.set(token, renewed);
    this.leasesBySerial.set(lease.serial, renewed);
    this.scheduleLeaseExpiry(renewed);
    return renewed;
  }

  /** Move explicit manual control to one background transfer without dropping the physical lock. */
  handoffTransferLease(serial: string, manualToken: string, jobId: string): HarmonyLease {
    if (!/^[a-f0-9-]{36}$/.test(jobId)) throw new HarmonyError("INVALID_ARGUMENT", "Invalid transfer job identity");
    const previous = this.requireLease(serial, manualToken);
    if (previous.owner.kind !== "manual" || (this.controllersByLease.get(manualToken)?.size ?? 0) > 0) {
      throw new HarmonyError("DEVICE_BUSY", "Manual control is busy; finish active input before queuing a transfer");
    }
    clearTimeout(this.leaseTimers.get(manualToken));
    this.leaseTimers.delete(manualToken);
    this.leasesByToken.delete(manualToken);
    this.forgetDeviceSnapshots(serial);
    const acquiredAt = iso(this.now());
    const lease: HarmonyLease = {
      ...previous,
      token: this.token(),
      leaseEpoch: ++this.leaseEpoch,
      owner: { kind: "agent", id: `transfer:${jobId}` },
      acquiredAt,
      expiresAt: iso(this.now() + MAX_LEASE_TTL_MS),
    };
    this.leasesByToken.set(lease.token, lease);
    this.leasesBySerial.set(serial, lease);
    this.scheduleLeaseExpiry(lease);
    this.emit({ type: "lease_released", timestamp: acquiredAt, serial, ownerId: previous.owner.id, reason: "transfer_handoff" });
    this.emit({ type: "lease_acquired", timestamp: acquiredAt, lease });
    return lease;
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
        this.releaseLease(lease.token);
        count += 1;
      }
    }
    for (const controller of this.controllersByOwner.get(ownerId) ?? []) controller.abort("owner_released");
    return count;
  }

  private async captureSnapshotNow(
    serial: string,
    includeTree: boolean,
    includeScreenshot: boolean,
    signal?: AbortSignal,
  ): Promise<HarmonySnapshot> {
    const device = await this.onlineDevice(serial, signal);
    const raw = await this.requireBackend().snapshot(serial, { includeTree, includeScreenshot, signal });
    if (includeScreenshot && raw.screenshot) this.mediaController.recordScreenshotObservation(serial, device.generation, raw.screenshot, signal);
    const revision = (this.snapshotRevisions.get(serial) ?? 0) + 1;
    this.snapshotRevisions.set(serial, revision);
    const nodes: HarmonyUiNode[] | undefined = includeTree ? raw.nodes?.map((node, index, all) => ({
      ...node,
      ref: `g${device.generation}-r${revision}-n${index}`,
      ...(node.parentIndex === undefined
        ? {}
        : { parentRef: `g${device.generation}-r${revision}-n${Math.min(node.parentIndex, all.length - 1)}` }),
      parentIndex: undefined,
    })) : undefined;
    const snapshot: StoredSnapshot = {
      serial,
      generation: device.generation,
      revision,
      capturedAt: iso(this.now()),
      quality: includeTree ? observationQuality(raw) : { treeStatus: "unavailable", scopeComplete: false, scope: "unknown" },
      tree: includeTree ? raw.tree : undefined,
      nodes,
      screenshot: includeScreenshot ? raw.screenshot : undefined,
      nodeByRef: new Map((nodes ?? []).map((node) => [node.ref, node])),
    };
    // Live-view screenshot polling must not replace the latest UI-tree refs.
    // A later tree capture becomes the public current snapshot; a bounded
    // semantic history keeps older refs recoverable through live revalidation.
    if (includeTree) {
      this.snapshots.set(serial, snapshot);
      this.retainSnapshotReferences(serial, snapshot);
    }
    this.emit({ type: "snapshot", timestamp: snapshot.capturedAt, serial, generation: device.generation, revision });
    const { nodeByRef, ...publicSnapshot } = snapshot;
    void nodeByRef;
    return publicSnapshot;
  }

  async snapshot(options: HarmonySnapshotOptions): Promise<HarmonySnapshot> {
    validateSerial(options.serial);
    const includeTree = options.includeTree ?? true;
    const includeScreenshot = options.includeScreenshot ?? true;
    if (includeTree) await this.mediaController.interruptLiveFrame(options.serial, "semantic_snapshot");
    return await this.enqueue("snapshot", async (signal) => {
      if (options.leaseToken) this.requireLease(options.serial, options.leaseToken);
      return await this.captureSnapshotNow(options.serial, includeTree, includeScreenshot, signal);
    }, options.signal, undefined, options.serial);
  }

  async runScenario(options: HarmonyScenarioOptions): Promise<HarmonyScenarioResult> {
    return this.runScenarioInternal(options);
  }

  private async runScenarioInternal(options: HarmonyScenarioOptions, resumeId?: string): Promise<HarmonyScenarioResult> {
    validateSerial(options.serial);
    const lease = this.requireLease(options.serial, options.leaseToken);
    await this.mediaController.interruptLiveFrame(options.serial, "run_scenario");
    return await this.enqueue("run_scenario", async (signal, operationId) => {
      this.requireLease(options.serial, options.leaseToken);
      const device = await this.onlineDevice(options.serial, signal);
      if (resumeId) {
        if (!this.scenarioStore) throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Scenario journal is unavailable");
        const snapshot = await this.captureSnapshotNow(options.serial, true, false, signal);
        options = { ...options, ...this.scenarioStore.resumeInputs(resumeId, snapshot, lease.owner.sessionId, deviceFingerprint(device)) };
      }
      validateHarmonyScenario(options);
      const execution = this.scenarioStore?.create(options, lease.owner, device.generation, resumeId, deviceFingerprint(device));
      const deviceDetails = { model: device.model, product: device.product, osVersion: device.osVersion, apiVersion: device.apiVersion, uitestVersion: device.uitestVersion, transport: device.transport };
      if (execution && this.scenarioStore) { execution.device = deviceDetails; this.scenarioStore.write(execution); }
      try {
        const result = await runHarmonyScenario({ ...options, signal }, {
          serial: options.serial,
          generation: device.generation,
          leaseEpoch: lease.leaseEpoch,
          backend: this.controlBackend(options.serial, options.leaseToken, signal),
          signal,
          now: this.now,
          captureScreenshot: captureSignal => this.trackScreenshot(options.serial,
            () => this.captureSnapshotNow(options.serial, false, true, captureSignal)),
          saveScreenshot: snapshot => this.trackScreenshot(options.serial, async () => snapshot),
          capture: async (captureOptions, captureSignal) => await this.captureSnapshotNow(
            options.serial,
            captureOptions.includeTree,
            captureOptions.includeScreenshot,
            captureSignal ?? signal,
          ),
          compound: async (step, stepSignal) => {
            if (step.action === "voice_input") {
              await this.withInputRecovery(options.serial, lease, () =>
                this.executeVoice(
                  { ...step, serial: options.serial, leaseToken: options.leaseToken },
                  this.controlBackend(options.serial, options.leaseToken, stepSignal),
                  stepSignal,
                ),
              );
              return "device_transcript_verified";
            }
            if (step.action === "geometry_assert") {
              await this.captureSnapshotNow(options.serial, false, true, stepSignal);
              const geometry = await this.getFrameGeometry(options.serial, "screenshot", stepSignal);
              if (geometry.displayRotation !== step.rotation) {
                throw new HarmonyError("SCENARIO_FAILED", "Observed display rotation differs from the expected orientation", {
                  details: { dispatchState: "not-sent", expected: step.rotation, actual: geometry.displayRotation },
                });
              }
              return "native_geometry_verified";
            }
            throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Compound action is unavailable");
          },
          invalidateSnapshot: () => this.snapshots.delete(options.serial),
          beforeStep: () => { this.requireLease(options.serial, options.leaseToken); },
          onStep: (step, checkpoint) => {
            this.emit({ type: "operation", timestamp: iso(this.now()), serial: options.serial, operation: `scenario_step_${step.index}_${step.status}`, operationId });
            if (!execution || !this.scenarioStore) return;
            execution.steps[step.index] = step;
            if (checkpoint) execution.checkpoint = { name: checkpoint.name, stepIndex: checkpoint.stepIndex, observationHash: observationFingerprint(checkpoint.snapshot) };
            this.scenarioStore.write(execution);
          },
        });
        result.device = deviceDetails;
        if (options.policy?.collectLogs) {
          result.logs = await collectScenarioLogs(this.requireBackend(), options.serial, signal);
          const completed = this.now();
          result.completedAt = iso(completed);
          result.durationMs = Math.max(0, completed - Date.parse(result.startedAt));
        }
        if (execution && this.scenarioStore) { this.scenarioStore.finish(execution, result); result.executionId = execution.id; }
        this.emit({
          type: "operation",
          timestamp: iso(this.now()),
          serial: options.serial,
          operation: "run_scenario",
          operationId,
        });
        return result;
      } catch (error) {
        if (execution && this.scenarioStore) { execution.status = "interrupted"; this.scenarioStore.write(execution); }
        throw error;
      }
    }, options.signal, lease.owner.id, options.serial, options.leaseToken);
  }

  listExecutions(serial?: string) { return this.scenarioStore?.list(serial) ?? []; }
  getExecutionProgress(clientRunId: string, serial: string) { return this.scenarioStore?.getByClientRunId(clientRunId, serial); }
  removeExecution(id: string, serial: string) { this.scenarioStore?.remove(id, serial); }

  async resumeScenario(id: string, serial: string, leaseToken: string, signal?: AbortSignal) {
    this.requireLease(serial, leaseToken);
    if (!this.scenarioStore) throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Persistent scenario journal is unavailable");
    return await this.runScenarioInternal({ serial, leaseToken, steps: [], signal }, id);
  }

  async captureLiveFrame(options: { serial: string; signal?: AbortSignal }): Promise<HarmonySnapshot> {
    return this.mediaController.captureLiveFrame(options);
  }

  requestVideoKeyframe(serial: string, generation: number): void {
    this.mediaController.requestVideoKeyframe(serial, generation);
  }

  async openVideoStream(options: { serial: string; signal?: AbortSignal }): Promise<HarmonyVideoConnection> {
    return this.mediaController.openVideoStream(options);
  }

  async getFrameGeometry(serial: string, space: "video" | "screenshot", signal?: AbortSignal): Promise<HarmonyGeometry> {
    return this.mediaController.getFrameGeometry(serial, space, signal);
  }

  async captureScreenshotArtifact(options: {
    serial: string;
    leaseToken?: string;
    signal?: AbortSignal;
  }): Promise<HarmonyMediaArtifact> {
    // A screenshot is read-only. HDC serializes captures internally, so taking one
    // must not abort the live view or require releasing manual control.
    return await this.trackScreenshot(options.serial, () => {
      if (options.leaseToken) this.requireLease(options.serial, options.leaseToken);
      return this.captureLiveFrame({ serial: options.serial, signal: options.signal });
    });
  }

  private trackScreenshot(serial: string, capture: () => Promise<HarmonySnapshot>): Promise<HarmonyMediaArtifact> {
    return this.operationTasks.track({ serial, kind: "screenshot", title: "Screenshot", target: serial }, async started => {
      started();
      const snapshot = await capture();
      if (!snapshot.screenshot) throw new HarmonyError("INVALID_RESPONSE", "Harmony screenshot is unavailable");
      return await saveHarmonyScreenshot(this.config, serial, snapshot.screenshot, new Date(snapshot.capturedAt));
    }, artifact => ({ capturedAt: artifact.createdAt, bytes: artifact.size, verification: "media-saved", mediaFilename: artifact.filename }));
  }

  getRecordingState(serial: string): HarmonyRecordingState | undefined {
    return this.recordingController.getRecordingState(serial);
  }

  getRecordingRecoveries(serial: string): HarmonyRecordingState[] {
    return this.recordingController.getRecordingRecoveries(serial);
  }

  getRecordingCompletion(serial: string, recordingId: string, ownerId: string) {
    return this.recordingController.getRecordingCompletion(serial, recordingId, ownerId);
  }

  async discardRecordingDraft(options: { serial: string; recordingId: string; ownerId: string; signal?: AbortSignal }): Promise<void> {
    return this.recordingController.discardRecordingDraft(options);
  }

  async retryRecordingSave(options: { serial: string; recordingId: string; ownerId: string; signal?: AbortSignal }): Promise<HarmonyMediaArtifact> {
    return this.recordingController.retryRecordingSave(options);
  }

  async startRecording(options: { serial: string; leaseToken?: string; ownerId: string; signal?: AbortSignal }): Promise<HarmonyRecordingState> {
    return this.recordingController.startRecording(options);
  }

  async stopRecording(options: { serial: string; leaseToken?: string; ownerId: string; recordingId?: string; signal?: AbortSignal }): Promise<HarmonyMediaArtifact> {
    return this.recordingController.stopRecording(options);
  }

  async retrieveRecording(options: { serial: string; leaseToken?: string; ownerId: string; recordingId?: string; signal?: AbortSignal }): Promise<HarmonyMediaArtifact> {
    return this.recordingController.retrieveRecording(options);
  }

  async abandonRecording(options: { serial: string; leaseToken?: string; ownerId: string; recordingId?: string; signal?: AbortSignal }): Promise<void> {
    return this.recordingController.abandonRecording(options);
  }

  getLatestSnapshot(serial: string): HarmonySnapshot | undefined {
    validateSerial(serial);
    const snapshot = this.snapshots.get(serial);
    if (!snapshot) return undefined;
    return {
      serial: snapshot.serial,
      generation: snapshot.generation,
      revision: snapshot.revision,
      capturedAt: snapshot.capturedAt,
      quality: snapshot.quality,
      nodes: snapshot.nodes?.map((node) => ({ ...node, ...(node.bounds ? { bounds: { ...node.bounds } } : {}) })),
    };
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
    await this.mediaController.interruptLiveFrame(serial, operation);
    return await this.enqueue(operation, async (queuedSignal, operationId) => {
      this.requireLease(serial, leaseToken);
      const device = await this.onlineDevice(serial, queuedSignal);
      if (generation !== undefined && generation !== device.generation) {
        throw new HarmonyError("STALE_SNAPSHOT", "The device screen changed or a person interrupted this action; observe a fresh screen before trying again", {
          details: { expectedGeneration: device.generation, receivedGeneration: generation },
          retryable: true,
        });
      }
      // Any write may change the page, even when the device command later fails.
      // The public "latest snapshot" is therefore invalidated. Lightweight
      // semantic refs are retained separately and must pass a fresh, unique
      // live-tree match before they can be reused.
      this.snapshots.delete(serial);
      const startedAt = iso(this.now());
      const ownsHold = ["key_hold", "touch_hold", "voice_input", "open_assistant", "manual_pointer"].includes(operation);
      const dispatch = () => invoke(this.controlBackend(serial, leaseToken, queuedSignal, operation !== "install_package"), queuedSignal);
      if (ownsHold) await this.withInputRecovery(serial, lease, dispatch);
      else await dispatch();
      if (queuedSignal.aborted) throw new HarmonyError("COMMAND_ABORTED", "Device operation was cancelled; its effect may be unknown", { details: { dispatchState: "sent" } });
      this.emit({ type: "operation", timestamp: iso(this.now()), serial, operation, operationId });
      return {
        serial,
        operationId,
        generation: device.generation,
        completedAt: iso(this.now()),
        receipt: {
          action: operation,
          dispatchState: "sent",
          effect: "unknown",
          verification: "not-run",
          provider: this.requireBackend().kind,
          deviceEpoch: device.generation,
          leaseEpoch: lease.leaseEpoch,
          startedAt,
          completedAt: iso(this.now()),
        },
      };
    }, signal, lease.owner.id, serial, leaseToken);
  }

  private async withInputRecovery<T>(serial: string, lease: HarmonyLease, operation: () => Promise<T>): Promise<T> {
    this.recoveryStore?.record(serial, "input", "active");
    try {
      const result = await operation();
      this.recoveryStore?.clear(serial, "input");
      return result;
    } catch (error) {
      if (error instanceof HarmonyError && error.details?.cleanup === "uncertain") {
        this.uncertainInput.add(serial);
        this.recoveryStore?.record(serial, "input", "uncertain");
        this.stoppingDevices.set(serial, "recovering");
        this.removeLease(lease, "uncertain_input_release");
      } else {
        this.recoveryStore?.clear(serial, "input");
      }
      throw error;
    }
  }

  async tap(options: HarmonyTapOptions): Promise<HarmonyOperationResult> {
    return await this.action("tap", options.serial, options.leaseToken, options.generation, options.signal,
      async (backend, signal) => {
        const point = await this.mediaController.resolveInputPoint(options, options.x, options.y, signal);
        await backend.tap(options.serial, point.x, point.y, signal);
      });
  }

  async beginManualPointer(options: HarmonyTapOptions): Promise<{ gestureId: string }> {
    return this.manualPointer.begin(options);
  }

  async updateManualPointer(options: { serial: string; leaseToken: string; gestureId: string; phase: "move" | "up"; x?: number; y?: number }): Promise<void> {
    return this.manualPointer.update(options);
  }

  async confirmInputCalibration(serial: string, id: string, assistant?: { appId: string; selector: HarmonyUiSelector }) {
    return this.audioVoice.confirmInputCalibration(serial, id, assistant);
  }

  async openAssistant(options: { serial: string; leaseToken: string; profileId: string; signal?: AbortSignal }) {
    return this.audioVoice.openAssistant(options);
  }

  async audioOutputs(signal?: AbortSignal) {
    return this.audioVoice.audioOutputs(signal);
  }

  async importAudio(path: string) {
    return this.audioVoice.importAudio(path);
  }

  async previewAudio(audioAssetId: string, output: AudioOutput, signal?: AbortSignal) {
    return this.audioVoice.previewAudio(audioAssetId, output, signal);
  }

  async appTestAudio(options: { serial: string; leaseToken: string; audioAssetId: string; pairing: AppTestPairing; signal?: AbortSignal }) {
    return this.audioVoice.appTestAudio(options);
  }

  async voiceInput(options: VoiceInputOptions) {
    let voice: Awaited<ReturnType<HarmonyDeviceManager["executeVoice"]>> | undefined;
    const result = await this.action("voice_input", options.serial, options.leaseToken, undefined, options.signal, async (backend, signal) => {
      voice = await this.executeVoice(options, backend, signal);
    });
    return { ...result, ...voice };
  }

  private executeVoice(options: VoiceInputOptions, backend: HarmonyAutomationBackend, signal: AbortSignal) {
    return this.audioVoice.executeVoice(options, backend, signal);
  }

  async keyHold(options: { serial: string; leaseToken: string; key: PhysicalKey; durationMs: number; calibrate?: boolean; signal?: AbortSignal }) {
    return this.audioVoice.keyHold(options);
  }

  async touchHold(options: HarmonyTapOptions & { durationMs: number; calibrate?: boolean }) {
    return this.audioVoice.touchHold(options);
  }

  async doubleTap(options: HarmonyPointGestureOptions): Promise<HarmonyOperationResult> {
    return await this.action("double_tap", options.serial, options.leaseToken, options.generation, options.signal,
      async (backend, signal) => {
        if (!backend.doubleTap) throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Harmony double-tap injection is unavailable");
        const point = await this.mediaController.resolveInputPoint(options, options.x, options.y, signal);
        await backend.doubleTap(options.serial, point.x, point.y, signal);
      });
  }

  async longPress(options: HarmonyPointGestureOptions): Promise<HarmonyOperationResult> {
    return await this.action("long_press", options.serial, options.leaseToken, options.generation, options.signal,
      async (backend, signal) => {
        if (!backend.longPress) throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Harmony long-press injection is unavailable");
        const point = await this.mediaController.resolveInputPoint(options, options.x, options.y, signal);
        await backend.longPress(options.serial, point.x, point.y, signal);
      });
  }

  async tapRef(options: HarmonyTapRefOptions): Promise<HarmonyOperationResult> {
    validateSerial(options.serial);
    if (!Number.isSafeInteger(options.generation) || options.generation < 0) {
      throw new HarmonyError("INVALID_ARGUMENT", "A valid UI reference generation is required");
    }
    const identity = /^g(\d+)-r(\d+)-n(\d+)$/.exec(options.ref);
    if (!identity) throw new HarmonyError("INVALID_ARGUMENT", "Invalid Harmony UI reference");
    const refGeneration = Number(identity[1]);
    const refRevision = Number(identity[2]);
    if (!Number.isSafeInteger(refGeneration) || !Number.isSafeInteger(refRevision) || refGeneration !== options.generation) {
      throw new HarmonyError("STALE_SNAPSHOT", "The UI reference does not belong to the requested device generation", { retryable: true });
    }
    const referenceSnapshot = this.referenceSnapshots.get(options.serial)?.find((entry) => (
      entry.generation === options.generation && entry.revision === refRevision
    ));
    if (!referenceSnapshot) {
      throw new HarmonyError("STALE_SNAPSHOT", "The referenced snapshot is no longer retained; observe the screen and use a fresh ref", { retryable: true });
    }
    if (this.now() - Date.parse(referenceSnapshot.capturedAt) > 30_000) {
      throw new HarmonyError("STALE_SNAPSHOT", "The UI reference is older than 30 seconds; observe again", { retryable: true });
    }
    const node = referenceSnapshot.nodeByRef.get(options.ref);
    if (!node?.bounds) throw new HarmonyError("INVALID_ARGUMENT", "UI reference does not have tappable bounds");
    if (node.enabled === false || node.visible === false) throw new HarmonyError("INVALID_ARGUMENT", "UI reference is not enabled or visible");
    if (node.clickable === false) throw new HarmonyError("INVALID_ARGUMENT", "UI reference is not clickable");
    const current = this.snapshots.get(options.serial);
    const strategy = current?.generation === options.generation && current.revision === refRevision
      ? "semantic_ref"
      : "retained_semantic_ref";
    let tappedX = Math.round((node.bounds.left + node.bounds.right) / 2);
    let tappedY = Math.round((node.bounds.top + node.bounds.bottom) / 2);
    const result = await this.action("tap_ref", options.serial, options.leaseToken, options.generation, options.signal,
      async (backend, signal) => {
        // Snapshot revisions are local bookkeeping, not an atomic device-side
        // transaction. Re-read the tree immediately before tapping and require
        // the same uniquely identifiable target at nearly the same location.
        const fresh = await backend.snapshot(options.serial, { includeTree: true, includeScreenshot: false, signal });
        requireValidObservation(fresh);
        if (
          this.now() - Date.parse(referenceSnapshot.capturedAt) > 30_000
          || referenceSnapshot.quality?.windowId !== fresh.quality?.windowId
          || referenceSnapshot.quality?.appId !== fresh.quality?.appId
        ) {
          throw new HarmonyError("STALE_SNAPSHOT", "The reference expired or its active app/window changed", { details: { dispatchState: "not-sent" } });
        }
        const match = resolveRetainedTarget(node, fresh);
        this.requireLease(options.serial, options.leaseToken);
        if (signal.aborted) throw new HarmonyError("COMMAND_ABORTED", "Device operation was cancelled");
        const bounds = match.bounds;
        tappedX = Math.round((bounds.left + bounds.right) / 2);
        tappedY = Math.round((bounds.top + bounds.bottom) / 2);
        await backend.tap(options.serial, tappedX, tappedY, signal);
      });
    return { ...result, strategy, x: tappedX, y: tappedY };
  }

  async swipe(options: HarmonySwipeOptions): Promise<HarmonyOperationResult> {
    return await this.action("swipe", options.serial, options.leaseToken, options.generation, options.signal,
      async (backend, signal) => {
        const from = await this.mediaController.resolveInputPoint(options, options.fromX, options.fromY, signal);
        const to = await this.mediaController.resolveInputPoint(options, options.toX, options.toY, signal);
        await backend.swipe(options.serial, from.x, from.y, to.x, to.y, options.durationMs, signal);
      });
  }

  async drag(options: HarmonyDragOptions): Promise<HarmonyOperationResult> {
    return await this.action("drag", options.serial, options.leaseToken, options.generation, options.signal,
      async (backend, signal) => {
        if (!backend.drag) throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Harmony drag injection is unavailable");
        const from = await this.mediaController.resolveInputPoint(options, options.fromX, options.fromY, signal);
        const to = await this.mediaController.resolveInputPoint(options, options.toX, options.toY, signal);
        await backend.drag(options.serial, from.x, from.y, to.x, to.y, options.durationMs, signal);
      });
  }

  async fling(options: HarmonyFlingOptions): Promise<HarmonyOperationResult> {
    return await this.action("fling", options.serial, options.leaseToken, options.generation, options.signal,
      async (backend, signal) => {
        if (!backend.fling) throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Harmony fling injection is unavailable");
        const from = await this.mediaController.resolveInputPoint(options, options.fromX, options.fromY, signal);
        const to = await this.mediaController.resolveInputPoint(options, options.toX, options.toY, signal);
        await backend.fling(options.serial, from.x, from.y, to.x, to.y, options.durationMs, signal);
      });
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

  async installPackage(options: HarmonyInstallAppOptions): Promise<HarmonyOperationResult> {
    return await this.operationTasks.track({ serial: options.serial, kind: "installation", title: basename(options.hapPath), target: options.hapPath },
      async started => await this.action("install_package", options.serial, options.leaseToken, undefined, options.signal,
        async (backend, signal) => {
          if (!backend.installPackage) throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Harmony package installation is unavailable");
          const hapPath = options.expectedHash === undefined ? options.hapPath
            : await importHapArtifact(options.hapPath, join(dirname(this.configPath), "harmony-artifacts"), options.expectedHash);
          started();
          await backend.installPackage(options.serial, hapPath, options.replace ?? true, signal);
        }), () => ({ verification: "device-confirmed" }));
  }

  async stopApp(options: { serial: string; leaseToken: string; bundleName: string; signal?: AbortSignal }): Promise<HarmonyOperationResult> {
    return await this.action("stop_app", options.serial, options.leaseToken, undefined, options.signal,
      async (backend, signal) => {
        if (!backend.stopApp) throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Stopping applications is unavailable");
        await backend.stopApp(options.serial, options.bundleName, signal);
      });
  }

  async clearAppData(options: { serial: string; leaseToken: string; bundleName: string; signal?: AbortSignal }): Promise<HarmonyOperationResult> {
    return await this.action("clear_app_data", options.serial, options.leaseToken, undefined, options.signal,
      async (backend, signal) => {
        if (!backend.clearAppData) throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Clearing application data is unavailable");
        await backend.clearAppData(options.serial, options.bundleName, signal);
      });
  }

  async clearAppCache(options: { serial: string; leaseToken: string; bundleName: string; signal?: AbortSignal }): Promise<HarmonyOperationResult> {
    return await this.action("clear_app_cache", options.serial, options.leaseToken, undefined, options.signal,
      async (backend, signal) => {
        if (!backend.clearAppCache) throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Clearing application cache is unavailable");
        await backend.clearAppCache(options.serial, options.bundleName, signal);
      });
  }

  async uninstallApp(options: { serial: string; leaseToken: string; bundleName: string; signal?: AbortSignal }): Promise<HarmonyOperationResult> {
    return await this.action("uninstall_app", options.serial, options.leaseToken, undefined, options.signal,
      async (backend, signal) => {
        if (!backend.uninstallPackage) throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Uninstalling applications is unavailable");
        await backend.uninstallPackage(options.serial, options.bundleName, signal);
      });
  }

  async setAppEnabled(options: { serial: string; leaseToken: string; bundleName: string; enabled: boolean; signal?: AbortSignal }): Promise<HarmonyOperationResult> {
    return await this.action(options.enabled ? "enable_app" : "disable_app", options.serial, options.leaseToken, undefined, options.signal,
      async (backend, signal) => {
        if (!backend.setAppEnabled) throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Application enable/disable is unavailable");
        await backend.setAppEnabled(options.serial, options.bundleName, options.enabled, signal);
      });
  }

  getConfig(): HarmonyConfig {
    return {
      ...this.config,
      ...(this.config.storage ? { storage: { ...this.config.storage } } : {}),
      ...(this.config.vision ? { vision: { ...this.config.vision } } : {}),
    };
  }

  async updateConfig(
    patch: { hdcPath?: string | null; video?: HarmonyConfig["video"] | null; storage?: HarmonyConfig["storage"] | null; vision?: HarmonyConfig["vision"] | null },
    signal?: AbortSignal,
  ): Promise<HarmonyConfig> {
    if (this.injectedBackend) throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Injected Harmony backends cannot be reconfigured");
    const next: HarmonyConfig = { ...this.config };
    if (patch.hdcPath === null || patch.hdcPath === "") delete next.hdcPath;
    else if (patch.hdcPath !== undefined) next.hdcPath = patch.hdcPath;
    if (patch.video === null) delete next.video;
    else if (patch.video !== undefined) next.video = { ...patch.video };
    if (patch.storage === null) delete next.storage;
    else if (patch.storage !== undefined) next.storage = { ...patch.storage };
    if (patch.vision === null) delete next.vision;
    else if (patch.vision !== undefined) next.vision = patch.vision;
    const previousConfig = this.config;
    const runtimeChanged = next.hdcPath !== previousConfig.hdcPath || JSON.stringify(next.video) !== JSON.stringify(previousConfig.video);
    let candidateBackend: HarmonyAutomationBackend | undefined;
    if (runtimeChanged) {
      // Validate the candidate before persisting it or disturbing the working
      // backend. A bad picker choice must not strand the user on restart.
      candidateBackend = this.backendFactory(next);
      try {
        await candidateBackend.listDevices(signal);
      } catch (error) {
        await Promise.resolve(candidateBackend.dispose?.()).catch(() => undefined);
        throw error;
      }
    }
    let normalized: HarmonyConfig;
    try {
      normalized = writeHarmonyConfig(next, this.configPath);
    } catch (error) {
      await candidateBackend?.dispose?.();
      throw error;
    }
    this.config = normalized;
    if (runtimeChanged && candidateBackend) {
      const previousBackend = this.backend;
      await this.emergencyStop("configuration_changed");
      this.backend = candidateBackend;
      this.runtimeError = undefined;
      await Promise.resolve(previousBackend?.dispose?.()).catch(() => undefined);
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
      queue: { pending: this.pending, active: this.activeCount > 0, epoch: this.queueEpoch },
      ...(this.backend?.automationDiagnostics ? { automation: this.backend.automationDiagnostics() } : {}),
    };
  }

  async supportBundle(options: { serial?: string; includeTree?: boolean; includeScreenshot?: boolean; signal?: AbortSignal }) {
    const snapshot = options.serial && (options.includeTree || options.includeScreenshot)
      ? await this.snapshot({ serial: options.serial, includeTree: Boolean(options.includeTree), includeScreenshot: Boolean(options.includeScreenshot), signal: options.signal })
      : undefined;
    return await saveSupportBundle(join(dirname(this.configPath), "harmony-support"), createSupportBundle(this.getState(options.serial), await this.getDiagnostics(), { ...options, snapshot }));
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
      controls: [...this.stoppingDevices].filter(([deviceSerial]) => !serial || deviceSerial === serial)
        .map(([deviceSerial, status]) => ({ serial: deviceSerial, status, cleanup: status === "stopping" ? "pending" : "uncertain" })),
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

  async confirmCleanup(serial: string, signal?: AbortSignal) {
    validateSerial(serial);
    const requireSettled = () => {
      if (
        this.cleanupUnsettled.has(serial)
        || this.stopPromises.has(serial)
        || this.operationLanes.get(`device:${serial}`)?.active
        || this.operationLanes.get(`device:${serial}`)?.pending
        || this.operationLanes.get(`media:${serial}`)?.active
        || this.operationLanes.get(`media:${serial}`)?.pending
        || this.recordingController.hasActiveRecording(serial)
      ) {
        throw new HarmonyError("DEVICE_BUSY", "Wait for owned operations and recording cleanup to settle before confirming", {
          details: { serial, state: "stopping", dispatchState: "not-sent" },
        });
      }
    };
    requireSettled();
    if (!this.stoppingDevices.has(serial)) return { cleanup: "complete" as const };
    const cleanupWork = this.cleanupWork.get(serial);
    const generation = this.generations.get(serial);
    const device = await this.onlineDevice(serial, signal);
    const observation = await this.requireBackend().snapshot(serial, { includeTree: true, includeScreenshot: false, signal });
    requireValidObservation(observation);
    // Another window can retry cleanup while the observation is pending. An old
    // confirmation must never release that newer cleanup or a newly acquired owner.
    if (!this.stoppingDevices.has(serial)) return { cleanup: "complete" as const };
    requireSettled();
    if (
      this.cleanupWork.get(serial) !== cleanupWork
      || this.generations.get(serial) !== device.generation
      || (generation !== undefined && generation !== device.generation)
    ) {
      throw new HarmonyError("DEVICE_BUSY", "Device cleanup changed while confirming; retry recovery", {
        details: { serial, state: this.stoppingDevices.get(serial), dispatchState: "not-sent" },
      });
    }
    // Human confirmation is distinct from a driver-verified release.
    this.uncertainInput.delete(serial);
    this.cleanupWork.delete(serial);
    this.recoveryStore?.clear(serial);
    this.physicalLocks.get(serial)?.release();
    this.physicalLocks.delete(serial);
    this.stoppingDevices.delete(serial);
    this.inputOnlyStops.delete(serial);
    this.emit({ type: "state", timestamp: iso(this.now()), state: this.getState() });
    return { cleanup: "manual-confirmed" as const };
  }

  /** Fence an Agent's input for a direct human gesture while keeping passive video alive. */
  async preemptAgentForManual(serial: string): Promise<void> {
    validateSerial(serial);
    const ongoing = this.stopPromises.get(serial);
    if (ongoing) {
      const outcome = await ongoing;
      if (outcome.cleanup !== "complete") throw new HarmonyError("DEVICE_BUSY", "Device input release is uncertain");
    }
    const lease = this.leasesBySerial.get(serial);
    if (!lease) return;
    if (lease.owner.kind !== "agent") throw new HarmonyError("LEASE_CONFLICT", "Another manual window is operating the device");
    if (this.recordingController.getActiveRecording(serial)?.ownerId === lease.owner.id) {
      const outcome = await this.stopDevice(serial, "manual_preemption");
      if (outcome.cleanup !== "complete") throw new HarmonyError("DEVICE_BUSY", "Device recording cleanup is uncertain");
      return;
    }
    this.stoppingDevices.set(serial, "stopping");
    this.removeLease(lease, "manual_preemption");
    for (const controller of this.controllersByDevice.get(serial) ?? []) {
      if (!this.controllersByMedia.get(serial)?.has(controller)) controller.abort("manual_preemption");
    }
    const generation = (this.generations.get(serial) ?? 0) + 1;
    this.generations.set(serial, generation);
    const device = this.devices.get(serial);
    if (device) this.devices.set(serial, { ...device, generation });
    this.emit({ type: "state", timestamp: iso(this.now()), state: this.getState() });
    const cleanup = (async () => {
      // Wait for the aborted action to settle before resetting input. Resetting
      // in parallel could let a late driver action press after the release.
      await this.operationLanes.get(`device:${serial}`)?.tail;
      await this.backend?.resetAutomation?.(serial);
      if (this.uncertainInput.has(serial)) throw new Error("Input release was not verified");
    })();
    this.cleanupUnsettled.add(serial);
    void cleanup.finally(() => this.cleanupUnsettled.delete(serial)).catch(() => undefined);
    const outcome = await boundedCleanup(cleanup, this.cleanupTimeoutMs);
    if (outcome !== "complete") {
      this.stoppingDevices.set(serial, "recovering");
      this.recoveryStore?.record(serial, "input", "uncertain");
      void cleanup.then(() => {
        if (this.stoppingDevices.get(serial) !== "recovering" || this.uncertainInput.has(serial)) return;
        this.recoveryStore?.clear(serial, "input");
        this.physicalLocks.get(serial)?.release();
        this.physicalLocks.delete(serial);
        this.stoppingDevices.delete(serial);
        this.emit({ type: "state", timestamp: iso(this.now()), state: this.getState() });
      }).catch(() => undefined);
      this.emit({ type: "state", timestamp: iso(this.now()), state: this.getState() });
      throw new HarmonyError("DEVICE_BUSY", "Input release is uncertain; confirm release on the phone before clicking");
    }
    this.recoveryStore?.clear(serial, "input");
    this.physicalLocks.get(serial)?.release();
    this.physicalLocks.delete(serial);
    this.stoppingDevices.delete(serial);
    this.emit({ type: "state", timestamp: iso(this.now()), state: this.getState() });
  }

  stopDevice(serial: string, reason = "device_stop"): Promise<{ dispatchBlocked: true; cleanup: "complete" | "uncertain" }> {
    const ongoing = this.stopPromises.get(serial);
    // Upgrade the fence now; the full cleanup still awaits the same input work.
    if (ongoing && this.inputOnlyStops.has(serial)) this.stopPromises.delete(serial);
    return this.stopDeviceResources(serial, reason);
  }

  async retryCleanup(serial: string): Promise<{ cleanup: "complete" | "uncertain" }> {
    validateSerial(serial);
    if (!this.stoppingDevices.has(serial)) return { cleanup: "complete" };
    // Retry owned cleanup, never treat a reconnect click as physical-release confirmation.
    return this.stopDevice(serial, "cleanup_retry");
  }

  private stopDeviceResources(serial: string, reason: string, releasedOwnerId?: string): Promise<{ dispatchBlocked: true; cleanup: "complete" | "uncertain" }> {
    validateSerial(serial);
    const existing = this.stopPromises.get(serial);
    if (existing) return existing;
    const inputOnly = releasedOwnerId !== undefined;
    if (inputOnly) this.inputOnlyStops.add(serial); else this.inputOnlyStops.delete(serial);
    const hadPhysicalControl = this.leasesBySerial.has(serial) || this.physicalLocks.has(serial) || this.uncertainInput.has(serial)
      || this.inputCleanupWork.has(serial);
    // The fence is synchronous and precedes all asynchronous resource cleanup.
    this.stoppingDevices.set(serial, "stopping");
    const lease = this.leasesBySerial.get(serial);
    if (lease && (!inputOnly || lease.owner.id === releasedOwnerId)) this.removeLease(lease, reason);
    for (const controller of this.controllersByDevice.get(serial) ?? []) {
      if (!inputOnly || this.controllersByOwner.get(releasedOwnerId!)?.has(controller)) controller.abort(reason);
    }
    if (!inputOnly) {
      this.mediaController.cancelLiveFrame(serial, reason);
      const generation = (this.generations.get(serial) ?? 0) + 1;
      this.generations.set(serial, generation);
      const device = this.devices.get(serial);
      if (device) this.devices.set(serial, { ...device, generation });
    }
    this.forgetDeviceSnapshots(serial);
    if (!inputOnly || this.recordingController.getActiveRecording(serial)?.ownerId === releasedOwnerId) {
      this.recordingController.clearDurationTimer(serial);
    }
    const cleanupController = new AbortController();
    let inputCleanupComplete = false;
    // Reuse only an in-flight input release. A rejected aggregate can contain an
    // unrelated video failure and must not poison every subsequent cleanup retry.
    const inputCleanup = (this.inputCleanupWork.get(serial)
      ?? Promise.allSettled([this.operationLanes.get(`device:${serial}`)?.tail]).then(async () => {
        await this.backend?.resetAutomation?.(serial);
      })).then(() => { inputCleanupComplete = true; });
    this.inputCleanupWork.set(serial, inputCleanup);
    void inputCleanup.finally(() => {
      if (this.inputCleanupWork.get(serial) === inputCleanup) this.inputCleanupWork.delete(serial);
    }).catch(() => undefined);
    const recordingCleanup = (async () => {
      if (
        inputOnly
        && this.recordingController.getActiveRecording(serial)?.ownerId !== releasedOwnerId
        && ![...(this.controllersByMedia.get(serial) ?? [])].some(controller => this.controllersByOwner.get(releasedOwnerId!)?.has(controller))
      ) {
        return;
      }
      await this.operationLanes.get(`media:${serial}`)?.tail;
      const recording = this.recordingController.getActiveRecording(serial);
      if (!recording || (inputOnly && recording.ownerId !== releasedOwnerId)) return;
      await this.recordingController.finishRecording(recording, cleanupController.signal, reason);
    })();
    const releaseWork = Promise.allSettled([inputCleanup, recordingCleanup]);
    const cleanupWork = Promise.allSettled([
      inputCleanup,
      ...(!inputOnly ? this.mediaController.getCleanupPromises(serial) : []),
      recordingCleanup,
    ]).then(results => { if (results.some(result => result.status === "rejected")) throw new Error("A device resource could not be cleaned up"); });
    this.cleanupUnsettled.add(serial);
    void releaseWork.then(() => {
      if (this.cleanupWork.get(serial) === cleanupWork) this.cleanupUnsettled.delete(serial);
    });
    this.cleanupWork.set(serial, cleanupWork);
    const finishCleanup = () => {
      if (this.cleanupWork.get(serial) !== cleanupWork) return;
      this.cleanupWork.delete(serial);
      this.cleanupUnsettled.delete(serial);
      if (inputOnly) this.recoveryStore?.clear(serial, "input");
      else { this.recordingController.deleteRecoveryDevice(serial); this.recoveryStore?.clear(serial); }
      this.physicalLocks.get(serial)?.release();
      this.physicalLocks.delete(serial);
      if (!this.stopPromises.has(serial)) this.inputOnlyStops.delete(serial);
      if (inputOnly && this.recordingController.hasRecoveryDevice(serial)) this.stoppingDevices.set(serial, "recovering");
      else this.stoppingDevices.delete(serial);
    };
    const released = () => (!hadPhysicalControl || inputCleanupComplete) && !this.uncertainInput.has(serial)
      && (inputOnly ? this.recordingController.getActiveRecording(serial)?.ownerId !== releasedOwnerId : !this.recordingController.hasActiveRecording(serial))
      && !this.operationLanes.get(`device:${serial}`)?.active && !this.operationLanes.get(`device:${serial}`)?.pending;
    const stopping = boundedCleanup(cleanupWork, this.cleanupTimeoutMs).then(result => {
      const cleanup = this.uncertainInput.has(serial) ? "uncertain" : result;
      if (this.cleanupWork.get(serial) !== cleanupWork) return { dispatchBlocked: true as const, cleanup };
      if (cleanup === "complete") finishCleanup();
      else if (released()) {
        // Video forwarding or file finalization can fail after input is released.
        // Preserve the backend warning/receipt without persisting a false input latch.
        finishCleanup();
      } else {
        cleanupController.abort("cleanup_timeout");
        this.stoppingDevices.set(serial, "recovering");
        this.recoveryStore?.record(serial, "input", "uncertain");
        // Input and recording may settle after the deadline even if a read-only
        // viewer failed or never acknowledged close. Keep actual input uncertainty fenced.
        void releaseWork.then(() => {
          if (this.cleanupWork.get(serial) !== cleanupWork || !released()) return;
          finishCleanup();
          this.emit({ type: "state", timestamp: iso(this.now()), state: this.getState() });
        }).catch(() => undefined);
      }
      this.emit({ type: "state", timestamp: iso(this.now()), state: this.getState() });
      return { dispatchBlocked: true as const, cleanup };
    }).finally(() => {
      if (this.stopPromises.get(serial) !== stopping) return;
      this.stopPromises.delete(serial);
      if (!this.cleanupWork.has(serial)) this.inputOnlyStops.delete(serial);
    });
    this.stopPromises.set(serial, stopping);
    return stopping;
  }

  async emergencyStop(reason = "emergency_stop"): Promise<void> {
    this.stoppingAll = true;
    this.queueEpoch += 1;
    this.lastDeviceRefreshAt = Number.NEGATIVE_INFINITY;
    for (const controller of this.activeControllers) controller.abort(reason);
    this.deviceRefreshController?.abort(reason);
    const serials = new Set([
      ...this.generations.keys(),
      ...this.leasesBySerial.keys(),
      ...this.recordingController.activeSerials(),
    ]);
    try {
      await Promise.all([...serials].map(serial => this.stopDevice(serial, reason)));
      if (this.deviceRefreshPromise) await boundedCleanup(this.deviceRefreshPromise, this.cleanupTimeoutMs);
    } finally { this.stoppingAll = false; }
  }

  async dispose(): Promise<{ cleanup: "complete" | "uncertain" }> {
    if (this.disposed) return { cleanup: this.stoppingDevices.size ? "uncertain" : "complete" };
    this.mediaController.abortAllLogStreams();
    this.disposed = true;
    await this.emergencyStop("disposed");
    const cleanup = await boundedCleanup(Promise.resolve(this.backend?.dispose?.()), this.cleanupTimeoutMs);
    this.listeners.clear();
    return { cleanup: this.stoppingDevices.size ? "uncertain" : cleanup };
  }
}

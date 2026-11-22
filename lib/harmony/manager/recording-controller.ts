import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { nextHarmonyArtifactPath, prepareHarmonyRecordingPath, recordingArtifact, resolveHarmonyStorage } from "../artifacts";
import { asHarmonyError, HarmonyError, isHarmonyError } from "../errors";
import { RecordingDrafts } from "../media/recording-drafts";
import { RECORDING_POLICY } from "../media/recording-policy";
import type { HarmonyOperationTasks } from "../operation-tasks";
import type { HarmonyRecoveryStore } from "../runtime/recovery-store";
import type {
  HarmonyAutomationBackend,
  HarmonyConfig,
  HarmonyDevice,
  HarmonyLease,
  HarmonyManagerEvent,
  HarmonyManagerState,
  HarmonyMediaArtifact,
  HarmonyRecordingState,
} from "../types";
import { iso, validateSerial } from "./shared";

export interface RecordingControllerHost {
  configPath: string;
  persistentDrafts: boolean;
  operationTasks: HarmonyOperationTasks;
  recoveryStore?: HarmonyRecoveryStore;
  now: () => number;
  freeDiskBytes: (directory: string) => Promise<number>;
  getConfig: () => HarmonyConfig;
  requireBackend: () => HarmonyAutomationBackend;
  requireAdmission: (serial: string, passive?: boolean) => void;
  requireLease: (serial: string, token: string | undefined) => HarmonyLease;
  onlineDevice: (serial: string, signal?: AbortSignal) => Promise<HarmonyDevice>;
  enqueue: <T>(
    operation: string,
    task: (signal: AbortSignal, operationId: number) => Promise<T>,
    parentSignal?: AbortSignal,
    ownerId?: string,
    serial?: string,
    leaseToken?: string,
    laneName?: string,
  ) => Promise<T>;
  emit: (event: HarmonyManagerEvent) => void;
  getState: () => HarmonyManagerState;
  setRuntimeError: (error: HarmonyError) => void;
  markDeviceRecovering: (serial: string) => void;
  clearStoppingIfIdle: (serial: string) => void;
}

export class HarmonyRecordingController {
  private readonly recordings = new Map<string, HarmonyRecordingState>();
  private readonly recordingStarts = new Set<string>();
  private readonly recordingTasks = new Map<string, string>();
  private readonly recordingFinishes = new Map<string, Promise<HarmonyMediaArtifact>>();
  private readonly completedRecordings = new Map<string, { ownerId: string; artifact: HarmonyMediaArtifact; stopReason?: string }>();
  private readonly recordingDrafts?: RecordingDrafts;
  private readonly recoveredRecordings = new Map<string, { state: HarmonyRecordingState; finalized: boolean }>();
  private readonly recordingFailures = new Map<string, HarmonyError>();
  private readonly recordingRecoveryDevices = new Set<string>();
  private readonly recordingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly recordingDiskTimers = new Map<string, ReturnType<typeof setInterval>>();

  constructor(private readonly host: RecordingControllerHost) {
    if (host.persistentDrafts) {
      this.recordingDrafts = new RecordingDrafts(join(dirname(host.configPath), "harmony-recording-drafts"));
      for (const draft of this.recordingDrafts.list()) this.recoveredRecordings.set(draft.state.recordingId, draft);
    }
  }

  hasActiveRecording(serial: string): boolean {
    return this.recordings.has(serial);
  }

  getActiveRecording(serial: string): HarmonyRecordingState | undefined {
    return this.recordings.get(serial);
  }

  activeSerials(): IterableIterator<string> {
    return this.recordings.keys();
  }

  hasRecoveryDevice(serial: string): boolean {
    return this.recordingRecoveryDevices.has(serial);
  }

  deleteRecoveryDevice(serial: string): void {
    this.recordingRecoveryDevices.delete(serial);
  }

  clearDurationTimer(serial: string): void {
    clearTimeout(this.recordingTimers.get(serial));
    this.recordingTimers.delete(serial);
  }

  getRecordingState(serial: string): HarmonyRecordingState | undefined {
    validateSerial(serial);
    const state = this.recordings.get(serial);
    return state ? { ...state } : undefined;
  }

  getRecordingRecoveries(serial: string): HarmonyRecordingState[] {
    validateSerial(serial);
    return [...this.recoveredRecordings.values()]
      .filter(item => item.state.serial === serial)
      .map(item => ({ ...item.state, recoveryAvailable: item.finalized }));
  }

  getRecordingCompletion(serial: string, recordingId: string, ownerId: string) {
    validateSerial(serial);
    const completed = this.completedRecordings.get(recordingId);
    return completed?.artifact.serial === serial && completed.ownerId === ownerId
      ? { artifact: completed.artifact, stopReason: completed.stopReason }
      : null;
  }

  async discardRecordingDraft(options: { serial: string; recordingId: string; ownerId: string; signal?: AbortSignal }): Promise<void> {
    validateSerial(options.serial);
    await this.host.enqueue("discard_recording_draft", async () => {
      const draft = this.recoveredRecordings.get(options.recordingId);
      if (!draft || draft.state.serial !== options.serial || !this.recordingDrafts) {
        throw new HarmonyError("INVALID_ARGUMENT", "No retained recording matches this request");
      }
      // Only registered, inactive local recovery files can be discarded. Phone originals stay.
      this.recordingDrafts.clear(options.recordingId);
      this.recoveredRecordings.delete(options.recordingId);
    }, options.signal, options.ownerId, options.serial, undefined, "media");
  }

  async retryRecordingSave(options: { serial: string; recordingId: string; ownerId: string; signal?: AbortSignal }): Promise<HarmonyMediaArtifact> {
    const current = this.recordings.get(options.serial);
    if (current?.recordingId === options.recordingId) return this.stopRecording(options);
    return this.host.enqueue("retry_recording_save", async () => {
      const completed = this.completedRecordings.get(options.recordingId);
      if (completed && completed.ownerId === options.ownerId && completed.artifact.serial === options.serial) return completed.artifact;
      const draft = this.recoveredRecordings.get(options.recordingId);
      if (!draft || draft.state.serial !== options.serial || !this.recordingDrafts) {
        throw new HarmonyError("INVALID_ARGUMENT", "No retained recording matches this request");
      }
      if (!draft.finalized) {
        throw new HarmonyError("INVALID_RESPONSE", "This interrupted recording was not finalized and cannot be automatically recovered. The draft is retained.");
      }
      const destination = await prepareHarmonyRecordingPath(this.host.getConfig(), options.serial, new Date(draft.state.startedAt));
      if (draft.state.method === "system-recorder" && draft.state.systemFileName) {
        const backend = this.host.requireBackend();
        if (!backend.retrieveRetainedRecording) {
          throw new HarmonyError("CAPABILITY_UNAVAILABLE", "This runtime cannot retrieve retained system recordings");
        }
        await backend.retrieveRetainedRecording(options.serial, draft.state.systemFileName, destination);
      } else {
        await copyFile(this.recordingDrafts.path(options.recordingId), destination, constants.COPYFILE_EXCL);
      }
      const artifact = await recordingArtifact(options.serial, destination, new Date());
      this.recordingDrafts.clear(options.recordingId);
      this.recoveredRecordings.delete(options.recordingId);
      this.completedRecordings.set(options.recordingId, { ownerId: options.ownerId, artifact });
      return artifact;
    }, options.signal, options.ownerId, options.serial, undefined, "media");
  }

  async startRecording(options: {
    serial: string;
    leaseToken?: string;
    ownerId: string;
    signal?: AbortSignal;
  }): Promise<HarmonyRecordingState> {
    validateSerial(options.serial);
    if (typeof options.ownerId !== "string" || !options.ownerId.trim() || options.ownerId.length > 160) {
      throw new HarmonyError("INVALID_ARGUMENT", "Choose a valid recording owner");
    }
    const taskId = this.host.operationTasks.begin({ serial: options.serial, kind: "recording", title: "Screen recording", target: options.serial });
    let dispatched = false;
    try {
      return await this.host.enqueue("start_recording", async (signal, operationId) => {
        this.host.requireAdmission(options.serial, true);
        if (options.leaseToken) {
          const lease = this.host.requireLease(options.serial, options.leaseToken);
          if (lease.owner.id !== options.ownerId) {
            throw new HarmonyError("LEASE_REQUIRED", "The recording owner does not hold this device lease");
          }
        }
        if (this.recordings.has(options.serial)) {
          throw new HarmonyError("DEVICE_BUSY", "This Harmony device is already recording");
        }
        // Native recording owns one read-only H.264 subscriber. Its media owner
        // never acquires or preempts the input lease, including a long AI action.
        const backend = this.host.requireBackend();
        if (!backend.startRecording) {
          throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Harmony screen recording is unavailable on this device runtime");
        }
        const directory = resolveHarmonyStorage(this.host.getConfig()).recordingDirectory;
        await mkdir(directory, { recursive: true });
        if (await this.host.freeDiskBytes(directory) < RECORDING_POLICY.minimumFreeBytes) {
          throw new HarmonyError("COMMAND_OUTPUT_LIMIT", "Recording needs at least 256 MiB of free disk space");
        }
        await this.host.onlineDevice(options.serial, signal);
        this.host.requireAdmission(options.serial, true);
        if (signal.aborted) {
          throw new HarmonyError("COMMAND_ABORTED", "Recording start cancelled", { details: { dispatchState: "not-sent" } });
        }
        const recordingId = randomBytes(12).toString("hex");
        const state: HarmonyRecordingState = {
          phase: "preparing",
          maxDurationMs: RECORDING_POLICY.durationMs,
          bytesWritten: 0,
          serial: options.serial,
          recordingId,
          remoteName: `piora-recording-${recordingId}.mp4`,
          startedAt: iso(this.host.now()),
          ownerId: options.ownerId,
        };
        this.host.recoveryStore?.record(options.serial, "recording", "active");
        this.recordingStarts.add(options.serial);
        this.recordings.set(options.serial, state);
        this.recordingTasks.set(recordingId, taskId);
        // Register ownership before dispatch so a concurrent stop can reclaim it.
        dispatched = true;
        let stateUnknown = false;
        try {
          const destinationDirectory = resolveHarmonyStorage(this.host.getConfig()).recordingDirectory;
          await mkdir(destinationDirectory, { recursive: true });
          this.recordingDrafts?.save(state);
          const started = await backend.startRecording(options.serial, state.remoteName, signal, error => this.recordingFailed(state, error), {
            ...(this.recordingDrafts ? { draftPath: this.recordingDrafts.path(recordingId) } : {}),
            destinationDirectory,
            onProgress: update => {
              if (update.bytesWritten !== undefined) state.bytesWritten = update.bytesWritten;
              if (update.stopReason) state.stopReason = update.stopReason;
              if (update.finalized) { state.recoveryAvailable = true; state.phase = "saving"; }
              this.recordingDrafts?.save(state, update.finalized);
            },
          });
          state.method = started?.method ?? "stream";
          if (started?.systemFileName) state.systemFileName = started.systemFileName;
          state.phase = "recording";
          this.recordingDrafts?.save(state);
        } catch (error) {
          // A sent but unconfirmed system-recorder start may be recording on the phone. Keep the
          // session so the user can stop it there and retrieve the file; no toggle is sent again.
          if (isHarmonyError(error) && error.details?.systemRecorderStateUnknown === true && error.details?.recordingStopped === false) {
            state.method = "system-recorder";
            state.systemRecorderStateUnknown = true;
            state.phase = "unconfirmed";
            stateUnknown = true;
            if (typeof error.details.systemFileName === "string") state.systemFileName = error.details.systemFileName;
            this.recordingDrafts?.save(state);
          } else {
            if (isHarmonyError(error) && (error.details?.recordingStopped || error.details?.dispatchState === "not-sent")) {
              this.recordings.delete(options.serial);
              this.recordingTasks.delete(recordingId);
            }
            if (isHarmonyError(error) && (error.details?.recordingStopped || (error.details?.cleanup !== "uncertain" && error.details?.dispatchState === "not-sent"))) {
              this.host.recoveryStore?.clear(options.serial, "recording");
            } else {
              this.host.recoveryStore?.record(options.serial, "recording", "uncertain");
              this.recordingRecoveryDevices.add(options.serial);
              this.host.markDeviceRecovering(options.serial);
            }
            throw error;
          }
        } finally {
          this.recordingStarts.delete(options.serial);
        }
        if (signal.aborted) throw new HarmonyError("COMMAND_ABORTED", "Recording start cancelled; cleanup is required");
        const failure = this.recordingFailures.get(recordingId);
        if (failure) throw failure;
        this.host.operationTasks.started(taskId, "recording");
        if (stateUnknown) {
          // No automatic stop: retrieval waits for the user to stop the phone recording.
          this.host.emit({ type: "operation", timestamp: iso(this.host.now()), serial: options.serial, operation: "start_recording", operationId });
          return { ...state };
        }
        // The media duration limit must not cancel an unrelated AI/input owner.
        const timer = setTimeout(() => {
          state.stopReason = "duration-limit";
          void this.stopRecording({ serial: options.serial, ownerId: state.ownerId, recordingId }).catch(() => undefined);
        }, RECORDING_POLICY.durationMs);
        timer.unref?.();
        this.recordingTimers.set(options.serial, timer);
        let checkingDisk = false;
        const diskTimer = setInterval(() => {
          if (checkingDisk) return;
          checkingDisk = true;
          void this.host.freeDiskBytes(directory).then(bytes => {
            if (this.recordings.get(options.serial) === state && bytes < RECORDING_POLICY.minimumFreeBytes) {
              state.stopReason = "disk-space";
              return this.stopRecording({ serial: options.serial, ownerId: state.ownerId, recordingId });
            }
          }).catch(() => undefined).finally(() => { checkingDisk = false; });
        }, RECORDING_POLICY.diskCheckIntervalMs);
        diskTimer.unref?.();
        this.recordingDiskTimers.set(options.serial, diskTimer);
        this.host.emit({ type: "operation", timestamp: iso(this.host.now()), serial: options.serial, operation: "start_recording", operationId });
        return { ...state };
      }, options.signal, options.ownerId, options.serial, undefined, "media");
    } catch (error) {
      this.host.operationTasks.failed(taskId, error, dispatched);
      throw error;
    }
  }

  async stopRecording(options: {
    serial: string;
    leaseToken?: string;
    ownerId: string;
    recordingId?: string;
    signal?: AbortSignal;
  }): Promise<HarmonyMediaArtifact> {
    validateSerial(options.serial);
    return await this.host.enqueue("stop_recording", async (signal, operationId) => {
      const completed = options.recordingId ? this.completedRecordings.get(options.recordingId) : undefined;
      if (completed && completed.ownerId === options.ownerId && completed.artifact.serial === options.serial) return completed.artifact;
      if (options.leaseToken) {
        const lease = this.host.requireLease(options.serial, options.leaseToken);
        if (lease.owner.id !== options.ownerId) {
          throw new HarmonyError("LEASE_REQUIRED", "The recording owner does not hold this device lease");
        }
      }
      const state = this.recordings.get(options.serial);
      if (!state) throw new HarmonyError("INVALID_ARGUMENT", "This Harmony device is not recording");
      if (state.ownerId !== options.ownerId) throw new HarmonyError("DEVICE_BUSY", "The recording belongs to another controller");
      if (options.recordingId !== undefined && options.recordingId !== state.recordingId) {
        throw new HarmonyError("STALE_SNAPSHOT", "The recording changed; refresh its state before stopping");
      }
      const artifact = await this.finishRecording(state, signal);
      this.host.emit({ type: "operation", timestamp: iso(this.host.now()), serial: options.serial, operation: "stop_recording", operationId });
      return artifact;
    }, options.signal, options.ownerId, options.serial, undefined, "media");
  }

  /**
   * "我已停止，取回录屏": only for a system recording whose start could not be confirmed. The user
   * has stopped it on the phone; Piora looks up and copies its generated file without any toggle.
   */
  async retrieveRecording(options: {
    serial: string;
    leaseToken?: string;
    ownerId: string;
    recordingId?: string;
    signal?: AbortSignal;
  }): Promise<HarmonyMediaArtifact> {
    validateSerial(options.serial);
    return await this.host.enqueue("retrieve_recording", async (signal, operationId) => {
      if (options.leaseToken) {
        const lease = this.host.requireLease(options.serial, options.leaseToken);
        if (lease.owner.id !== options.ownerId) {
          throw new HarmonyError("LEASE_REQUIRED", "The recording owner does not hold this device lease");
        }
      }
      const state = this.recordings.get(options.serial);
      if (!state) throw new HarmonyError("INVALID_ARGUMENT", "This Harmony device is not recording");
      if (state.ownerId !== options.ownerId) throw new HarmonyError("DEVICE_BUSY", "The recording belongs to another controller");
      if (options.recordingId !== undefined && options.recordingId !== state.recordingId) {
        throw new HarmonyError("STALE_SNAPSHOT", "The recording changed; refresh its state before retrieving");
      }
      if (!state.systemRecorderStateUnknown) {
        throw new HarmonyError("INVALID_ARGUMENT", "Only an unconfirmed system recording can be retrieved without stopping");
      }
      const artifact = await this.finishRecording(state, signal, undefined, "retrieve");
      this.host.emit({ type: "operation", timestamp: iso(this.host.now()), serial: options.serial, operation: "retrieve_recording", operationId });
      return artifact;
    }, options.signal, options.ownerId, options.serial, undefined, "media");
  }

  /**
   * "放弃取回": forgets an unconfirmed system recording on this computer. The backend removes only
   * its /data/local/tmp relay copy; no recorder toggle is sent and the gallery original stays.
   */
  async abandonRecording(options: {
    serial: string;
    leaseToken?: string;
    ownerId: string;
    recordingId?: string;
    signal?: AbortSignal;
  }): Promise<void> {
    validateSerial(options.serial);
    await this.host.enqueue("abandon_recording", async (_signal, operationId) => {
      if (options.leaseToken) {
        const lease = this.host.requireLease(options.serial, options.leaseToken);
        if (lease.owner.id !== options.ownerId) {
          throw new HarmonyError("LEASE_REQUIRED", "The recording owner does not hold this device lease");
        }
      }
      const state = this.recordings.get(options.serial);
      if (!state) throw new HarmonyError("INVALID_ARGUMENT", "This Harmony device is not recording");
      if (state.ownerId !== options.ownerId) throw new HarmonyError("DEVICE_BUSY", "The recording belongs to another controller");
      if (options.recordingId !== undefined && options.recordingId !== state.recordingId) {
        throw new HarmonyError("STALE_SNAPSHOT", "The recording changed; refresh its state before giving up");
      }
      if (!state.systemRecorderStateUnknown) {
        throw new HarmonyError("INVALID_ARGUMENT", "Only an unconfirmed system recording can be abandoned");
      }
      const backend = this.host.requireBackend();
      if (!backend.abandonRecording) {
        throw new HarmonyError("CAPABILITY_UNAVAILABLE", "System recording abandonment is unavailable on this device runtime");
      }
      if (this.recordingFinishes.has(state.recordingId)) {
        throw new HarmonyError("DEVICE_BUSY", "The recording is being retrieved; wait for it to finish");
      }
      await backend.abandonRecording(options.serial, state.remoteName);
      if (this.recordings.get(options.serial) === state) this.recordings.delete(options.serial);
      clearTimeout(this.recordingTimers.get(options.serial));
      this.recordingTimers.delete(options.serial);
      clearInterval(this.recordingDiskTimers.get(options.serial));
      this.recordingDiskTimers.delete(options.serial);
      this.recordingDrafts?.clear(state.recordingId);
      this.clearRecordingRecovery(options.serial);
      const taskId = this.recordingTasks.get(state.recordingId);
      if (taskId) {
        this.host.operationTasks.failed(
          taskId,
          new HarmonyError("COMMAND_ABORTED", "Retrieval abandoned; the recording remains in the phone gallery", {
            details: { reason: "system-recording-abandoned", recordingStopped: true },
          }),
        );
      }
      this.recordingTasks.delete(state.recordingId);
      this.recordingFailures.delete(state.recordingId);
      this.host.emit({ type: "operation", timestamp: iso(this.host.now()), serial: options.serial, operation: "abandon_recording", operationId });
    }, options.signal, options.ownerId, options.serial, undefined, "media");
  }

  private recordingFailed(state: HarmonyRecordingState, error: HarmonyError): void {
    if (this.recordings.get(state.serial) !== state) return;
    if (error.details?.recoverable === true) state.stopReason = String(error.details.stopReason ?? "interrupted");
    else this.recordingFailures.set(state.recordingId, error);
    const taskId = this.recordingTasks.get(state.recordingId);
    try {
      if (taskId && error.details?.recoverable !== true) this.host.operationTasks.failed(taskId, error);
    } catch (failure) {
      this.host.setRuntimeError(asHarmonyError(failure));
    }
    void this.host.enqueue("recording_failed", async signal => {
      if (this.recordings.get(state.serial) === state) await this.finishRecording(state, signal);
    }, undefined, state.ownerId, state.serial, undefined, "media").catch(() => undefined);
    this.host.emit({ type: "state", timestamp: iso(this.host.now()), state: this.host.getState() });
  }

  finishRecording(
    state: HarmonyRecordingState,
    signal: AbortSignal,
    reason?: string,
    mode: "stop" | "retrieve" = "stop",
  ): Promise<HarmonyMediaArtifact> {
    const existing = this.recordingFinishes.get(state.recordingId);
    if (existing) return existing;
    const finishing = this.finishRecordingNow(state, signal, reason, mode);
    this.recordingFinishes.set(state.recordingId, finishing);
    void finishing.finally(() => {
      if (this.recordingFinishes.get(state.recordingId) === finishing) this.recordingFinishes.delete(state.recordingId);
    }).catch(() => undefined);
    return finishing;
  }

  private async finishRecordingNow(
    state: HarmonyRecordingState,
    signal: AbortSignal,
    reason?: string,
    mode: "stop" | "retrieve" = "stop",
  ): Promise<HarmonyMediaArtifact> {
    const serial = state.serial;
    const taskId = this.recordingTasks.get(state.recordingId);
    clearInterval(this.recordingDiskTimers.get(serial));
    this.recordingDiskTimers.delete(serial);
    let stopped = false;
    try {
      state.phase = "stopping";
      const backend = this.host.requireBackend();
      if (!backend.stopRecording) {
        throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Harmony screen recording is unavailable on this device runtime");
      }
      if (mode === "retrieve" && !backend.retrieveRecording) {
        throw new HarmonyError("CAPABILITY_UNAVAILABLE", "System recording retrieval is unavailable on this device runtime");
      }
      // A journal write failure must never prevent closing the owned reader.
      let journalFailure: unknown;
      try { if (taskId) this.host.operationTasks.started(taskId, "saving"); }
      catch (error) { journalFailure = error; }
      const config = this.host.getConfig();
      const destinationPath = await prepareHarmonyRecordingPath(config, serial, new Date(state.startedAt))
        .catch(() => nextHarmonyArtifactPath(config, "recording", serial, new Date(state.startedAt)));
      if (mode === "retrieve") await backend.retrieveRecording!(serial, state.remoteName, destinationPath, signal);
      else await backend.stopRecording(serial, state.remoteName, destinationPath, signal);
      state.phase = "saving";
      stopped = true;
      if (this.recordings.get(serial) === state) this.recordings.delete(serial);
      this.clearRecordingRecovery(serial);
      clearTimeout(this.recordingTimers.get(serial));
      this.recordingTimers.delete(serial);
      const artifact = await recordingArtifact(serial, destinationPath, new Date());
      const mediaFailure = this.recordingFailures.get(state.recordingId);
      if (mediaFailure) throw mediaFailure;
      if (journalFailure) throw journalFailure;
      if (taskId) {
        this.host.operationTasks.complete(taskId, {
          capturedAt: artifact.createdAt,
          bytes: artifact.size,
          verification: "media-saved",
          mediaFilename: artifact.filename,
        });
      }
      this.recordingTasks.delete(state.recordingId);
      this.recordingFailures.delete(state.recordingId);
      this.recordingDrafts?.clear(state.recordingId);
      this.completedRecordings.set(state.recordingId, {
        ownerId: state.ownerId,
        artifact,
        ...(state.stopReason ? { stopReason: state.stopReason } : {}),
      });
      if (this.completedRecordings.size > 100) this.completedRecordings.delete(this.completedRecordings.keys().next().value!);
      return artifact;
    } catch (error) {
      if (isHarmonyError(error) && error.details?.recoverable === true) {
        state.phase = "save-failed";
        state.recoveryAvailable = true;
        if (error.details?.systemRecorderStateUnknown) state.systemRecorderStateUnknown = true;
        clearTimeout(this.recordingTimers.get(serial));
        this.recordingTimers.delete(serial);
        this.recordingDrafts?.save(state);
        this.clearRecordingRecovery(serial);
        if (taskId) this.host.operationTasks.failed(taskId, error);
        throw error;
      }
      // A retrieval-only attempt that found or copied nothing keeps the session: the user can
      // retry "我已停止，取回录屏" or explicitly give up. Nothing on the phone was toggled.
      if (!stopped && mode === "retrieve" && isHarmonyError(error) && error.details?.pendingRetrieval === true && error.details?.recordingStopped === false) {
        if (taskId) this.host.operationTasks.started(taskId, "recording");
        throw error;
      }
      if (stopped || (isHarmonyError(error) && error.details?.recordingStopped)) {
        if (this.recordings.get(serial) === state) this.recordings.delete(serial);
        clearTimeout(this.recordingTimers.get(serial));
        this.recordingTimers.delete(serial);
        // Saving/finalizing may fail after the owned reader is already closed.
        // Report that failure, but do not invent an unreleased device operation.
        this.clearRecordingRecovery(serial);
        this.recordingTasks.delete(state.recordingId);
        this.recordingFailures.delete(state.recordingId);
      } else {
        this.host.recoveryStore?.record(serial, "recording", "uncertain");
        this.recordingRecoveryDevices.add(serial);
        this.host.markDeviceRecovering(serial);
      }
      const failure = asHarmonyError(error);
      const disconnected = reason === "device_offline" || reason === "device_disconnected";
      if (taskId) {
        this.host.operationTasks.failed(
          taskId,
          new HarmonyError(disconnected ? "DEVICE_OFFLINE" : failure.code, failure.message, {
            details: { ...failure.details, ...(stopped ? { recordingStopped: true } : {}) },
          }),
        );
      }
      throw error;
    }
  }

  private clearRecordingRecovery(serial: string): void {
    this.host.recoveryStore?.clear(serial, "recording");
    if (this.recordingRecoveryDevices.delete(serial)) {
      this.host.clearStoppingIfIdle(serial);
    }
  }
}

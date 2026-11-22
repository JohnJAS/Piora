import { randomBytes } from "node:crypto";
import { HarmonyError } from "../errors";
import { videoMetadataTransform } from "../media/video-metadata";
import { transformFramePoint, type HarmonyGeometry } from "../observation/geometry";
import { boundedCleanup } from "../runtime/resource-scope";
import type {
  HarmonyAutomationBackend,
  HarmonyDevice,
  HarmonyLogEntry,
  HarmonySnapshot,
  HarmonyTapOptions,
  HarmonyVideoConnection,
} from "../types";
import { iso, PASSIVE_FRAME_CLEANUP_TIMEOUT_MS, validateSerial } from "./shared";

export interface MediaStreamControllerHost {
  cleanupTimeoutMs: number;
  now: () => number;
  isDisposed: () => boolean;
  getDevice: (serial: string) => HarmonyDevice | undefined;
  getGeneration: (serial: string) => number | undefined;
  requireBackend: () => HarmonyAutomationBackend;
  requireAdmission: (serial: string, passive?: boolean) => void;
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
}

export class HarmonyMediaStreamController {
  private readonly liveFrameControllers = new Map<string, AbortController>();
  private readonly logStreamControllers = new Map<AbortController, string>();
  private readonly liveFramePromises = new Map<string, Promise<HarmonySnapshot>>();
  private readonly videoConnections = new Map<string, Set<HarmonyVideoConnection>>();
  private readonly videoConnectionCurrent = new WeakMap<HarmonyVideoConnection, () => boolean>();
  private readonly videoConnectionFrames = new WeakMap<HarmonyVideoConnection, { capturedAt: number; generation: number; width?: number; height?: number }>();
  private readonly liveFrameRevisions = new Map<string, number>();
  private readonly frameDimensions = new Map<string, { width: number; height: number }>();
  private readonly frameCapturedAt = new Map<string, { capturedAt: number; generation: number }>();
  private readonly geometries = new Map<string, HarmonyGeometry>();

  constructor(private readonly host: MediaStreamControllerHost) {}

  forgetDeviceFrameState(serial: string): void {
    this.geometries.delete(`${serial}:video`);
    this.geometries.delete(`${serial}:screenshot`);
    this.frameCapturedAt.delete(`${serial}:video`);
    this.frameCapturedAt.delete(`${serial}:screenshot`);
    this.frameDimensions.delete(`${serial}:video`);
    this.frameDimensions.delete(`${serial}:screenshot`);
  }

  hasFreshVideoFrame(serial: string, generation: number | undefined): boolean {
    const live = this.frameCapturedAt.get(`${serial}:video`);
    const frameAge = live ? this.host.now() - live.capturedAt : Infinity;
    return live?.generation === generation && frameAge >= 0 && frameAge <= 250 && Boolean(this.videoConnections.get(serial)?.size);
  }

  hasActiveStreamsForDevice(serial: string): boolean {
    return (
      this.videoConnections.has(serial)
      || this.liveFrameControllers.has(serial)
      || [...this.logStreamControllers.values()].includes(serial)
    );
  }

  getFrameCapturedAt(key: string): { capturedAt: number; generation: number } | undefined {
    return this.frameCapturedAt.get(key);
  }

  getGeometry(key: string): HarmonyGeometry | undefined {
    return this.geometries.get(key);
  }

  findGeometryById(geometryId: string | undefined): HarmonyGeometry | undefined {
    return [...this.geometries.values()].find(geometry => geometry.geometryId === geometryId);
  }

  cancelLiveFrame(serial: string, reason: string): void {
    this.liveFrameControllers.get(serial)?.abort(reason);
    for (const [controller, deviceSerial] of this.logStreamControllers) {
      if (deviceSerial === serial) controller.abort(reason);
    }
  }

  abortAllLogStreams(): void {
    for (const controller of this.logStreamControllers.keys()) controller.abort();
  }

  getCleanupPromises(serial: string): Array<Promise<unknown> | undefined> {
    return [
      this.liveFramePromises.get(serial),
      ...[...(this.videoConnections.get(serial) ?? [])].map(connection => connection.close()),
    ];
  }

  async interruptLiveFrame(serial: string, reason: string): Promise<void> {
    const inFlight = this.liveFramePromises.get(serial);
    this.cancelLiveFrame(serial, reason);
    // An aborted read-only frame rejects when its process has settled. A
    // rejection here is still completed cleanup, not an uncertain device hold.
    if (
      inFlight
      && await boundedCleanup(
        inFlight.then(() => undefined, () => undefined),
        Math.max(this.host.cleanupTimeoutMs, PASSIVE_FRAME_CLEANUP_TIMEOUT_MS),
      ) !== "complete"
    ) {
      throw new HarmonyError("DEVICE_BUSY", "A previous frame capture has not settled", {
        details: { dispatchState: "not-sent", cleanup: "uncertain" },
      });
    }
  }

  async streamLogs(serial: string, onEntries: (entries: HarmonyLogEntry[]) => void, signal?: AbortSignal): Promise<void> {
    validateSerial(serial);
    const backend = await this.host.enqueue("start_log_stream", async (queuedSignal) => {
      await this.host.onlineDevice(serial, queuedSignal);
      return this.host.requireBackend();
    }, signal, undefined, serial);
    if (!backend.streamLogs) throw new HarmonyError("CAPABILITY_UNAVAILABLE", "设备不支持实时日志");
    // The live read must not occupy the physical-device command queue.
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted || this.host.isDisposed()) controller.abort();
    this.logStreamControllers.set(controller, serial);
    try { await backend.streamLogs(serial, onEntries, controller.signal); }
    finally {
      signal?.removeEventListener("abort", abort);
      this.logStreamControllers.delete(controller);
    }
  }

  async captureLiveFrame(options: { serial: string; signal?: AbortSignal }): Promise<HarmonySnapshot> {
    validateSerial(options.serial);
    const existing = this.liveFramePromises.get(options.serial);
    if (existing) return await existing;

    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason ?? "live_frame_cancelled");
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
    this.liveFrameControllers.set(options.serial, controller);
    const promise = (async () => {
      const device = await this.host.onlineDevice(options.serial, controller.signal);
      const raw = await this.host.requireBackend().snapshot(options.serial, {
        includeTree: false,
        includeScreenshot: true,
        signal: controller.signal,
      });
      if (!raw.screenshot) throw new HarmonyError("INVALID_RESPONSE", "Harmony screenshot is unavailable");
      this.recordScreenshotObservation(options.serial, device.generation, raw.screenshot, controller.signal);
      const revision = (this.liveFrameRevisions.get(options.serial) ?? 0) + 1;
      this.liveFrameRevisions.set(options.serial, revision);
      return {
        serial: options.serial,
        generation: device.generation,
        revision,
        capturedAt: iso(this.host.now()),
        screenshot: raw.screenshot,
      };
    })().finally(() => {
      options.signal?.removeEventListener("abort", abort);
      if (this.liveFrameControllers.get(options.serial) === controller) this.liveFrameControllers.delete(options.serial);
      if (this.liveFramePromises.get(options.serial) === promise) this.liveFramePromises.delete(options.serial);
    });
    this.liveFramePromises.set(options.serial, promise);
    return await promise;
  }

  requestVideoKeyframe(serial: string, generation: number): void {
    validateSerial(serial);
    this.host.requireAdmission(serial, true);
    if (this.host.getGeneration(serial) !== generation || this.host.getDevice(serial)?.state !== "online") {
      throw new HarmonyError("STALE_SNAPSHOT", "The device connection has changed");
    }
    const connections = this.videoConnections.get(serial);
    const connection = connections && [...connections].find(value => value.requestKeyframe && this.videoConnectionCurrent.get(value)?.());
    if (!connection) throw new HarmonyError("CAPABILITY_UNAVAILABLE", "No active video connection supports keyframe recovery");
    connection.requestKeyframe!();
  }

  async openVideoStream(options: { serial: string; signal?: AbortSignal }): Promise<HarmonyVideoConnection> {
    validateSerial(options.serial);
    this.host.requireAdmission(options.serial, true);
    const device = await this.host.onlineDevice(options.serial, options.signal);
    const backend = this.host.requireBackend();
    if (!backend.openVideoStream) {
      throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Harmony video streaming is unavailable in this runtime");
    }
    const connection = await backend.openVideoStream(options.serial, options.signal);
    try {
      this.host.requireAdmission(options.serial, true);
      if (this.host.getGeneration(options.serial) !== device.generation) {
        throw new HarmonyError("STALE_SNAPSHOT", "The device epoch changed while opening video");
      }
    } catch (error) {
      await connection.close();
      throw error;
    }
    let closing: Promise<void> | undefined;
    let closed = false;
    let dimensions: { width: number; height: number } | undefined;
    const current = () => !closed
      && !options.signal?.aborted
      && this.host.getDevice(options.serial)?.state === "online"
      && this.host.getGeneration(options.serial) === device.generation;
    const observed = connection.stream.pipeThrough(videoMetadataTransform((width, height) => {
      if (!current()) return;
      // A new SPS/PPS can change the codec without changing pixel dimensions.
      this.videoConnectionFrames.delete(tracked);
      dimensions = { width, height };
      this.recordFrameDimensions(options.serial, "video", width, height);
      const remaining = [...(this.videoConnections.get(options.serial) ?? [])]
        .filter(viewer => viewer !== tracked && this.videoConnectionCurrent.get(viewer)?.())
        .map(viewer => this.videoConnectionFrames.get(viewer))
        .filter(observation => observation?.width === width && observation?.height === height)
        .sort((left, right) => right!.capturedAt - left!.capturedAt)[0];
      if (remaining) this.frameCapturedAt.set(`${options.serial}:video`, remaining);
      else {
        this.frameCapturedAt.delete(`${options.serial}:video`);
        this.geometries.delete(`${options.serial}:video`);
      }
    }, () => {
      if (!current()) return;
      const observation = { capturedAt: this.host.now(), generation: device.generation, ...dimensions };
      this.recordFrameDimensions(options.serial, "video", dimensions?.width ?? 0, dimensions?.height ?? 0);
      this.videoConnectionFrames.set(tracked, observation);
      this.frameCapturedAt.set(`${options.serial}:video`, observation);
    }));
    const reader = observed.getReader();
    let downstream: ReadableStreamDefaultController<Uint8Array> | undefined;
    const tracked: HarmonyVideoConnection = {
      requestKeyframe: connection.requestKeyframe ? () => { if (current()) connection.requestKeyframe!(); } : undefined,
      stream: new ReadableStream<Uint8Array>({
        start(controller) { downstream = controller; },
        async pull(controller) {
          if (closed) { await closing?.catch(() => undefined); return; }
          try {
            const next = await reader.read();
            if (closed) return;
            if (next.done) await tracked.close();
            else controller.enqueue(next.value);
          } catch (error) {
            if (closed) return;
            try { controller.error(error); } catch { /* Already cancelled. */ }
            await tracked.close().catch(() => undefined);
          }
        },
        async cancel() { await tracked.close(); },
      }, { highWaterMark: 0 }),
      // A failed read-only video forward cleanup is not an unreleased key/touch.
      // The backend retains its exact port journal and close error for diagnosis.
      close: () => {
        if (closing) return closing;
        closed = true;
        options.signal?.removeEventListener("abort", abort);
        const viewers = this.videoConnections.get(options.serial);
        viewers?.delete(tracked);
        this.videoConnectionFrames.delete(tracked);
        if (!viewers?.size) this.videoConnections.delete(options.serial);
        if (this.host.getGeneration(options.serial) === device.generation) {
          const remaining = [...(viewers ?? [])]
            .filter(viewer => this.videoConnectionCurrent.get(viewer)?.())
            .map(viewer => this.videoConnectionFrames.get(viewer))
            .filter(observation => observation !== undefined)
            .sort((left, right) => right.capturedAt - left.capturedAt)[0];
          if (remaining) {
            this.recordFrameDimensions(options.serial, "video", remaining.width ?? 0, remaining.height ?? 0);
            this.frameCapturedAt.set(`${options.serial}:video`, remaining);
          } else {
            this.frameCapturedAt.delete(`${options.serial}:video`);
            this.geometries.delete(`${options.serial}:video`);
            this.frameDimensions.delete(`${options.serial}:video`);
          }
        }
        // A backend close may itself wait for reader cancellation. Start both
        // before awaiting either; invoke backend close first for EOF-only sources.
        return closing = Promise.allSettled([
          Promise.resolve().then(() => connection.close()),
          Promise.resolve().then(() => reader.cancel().catch(() => undefined)),
        ]).then(results => {
          reader.releaseLock();
          if (results[0].status === "rejected") {
            try { downstream?.error(results[0].reason); } catch { /* Consumer cancelled. */ }
            throw results[0].reason;
          }
          try { downstream?.close(); } catch { /* Already cancelled or errored. */ }
        });
      },
    };
    this.videoConnectionCurrent.set(tracked, current);
    const set = this.videoConnections.get(options.serial) ?? new Set<HarmonyVideoConnection>();
    set.add(tracked);
    this.videoConnections.set(options.serial, set);
    const abort = () => { void tracked.close().catch(() => undefined); };
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    return tracked;
  }

  private recordFrameDimensions(serial: string, space: "video" | "screenshot", width: number, height: number): void {
    const key = `${serial}:${space}`;
    if (![width, height].every(value => Number.isInteger(value) && value > 0 && value <= 16_384)) {
      this.frameDimensions.delete(key);
      this.geometries.delete(key);
      if (space === "video") this.frameCapturedAt.delete(key);
      return;
    }
    const previous = this.frameDimensions.get(key);
    if (previous?.width !== width || previous?.height !== height) {
      this.geometries.delete(key);
      if (space === "video") this.frameCapturedAt.delete(key);
      this.frameDimensions.set(key, { width, height });
    }
  }

  recordScreenshotObservation(
    serial: string,
    generation: number,
    screenshot: NonNullable<HarmonySnapshot["screenshot"]>,
    signal?: AbortSignal,
  ): void {
    if (signal?.aborted || this.host.getDevice(serial)?.state !== "online" || this.host.getGeneration(serial) !== generation) return;
    const key = `${serial}:screenshot`;
    this.frameCapturedAt.set(key, { capturedAt: this.host.now(), generation });
    this.recordFrameDimensions(serial, "screenshot", screenshot.width ?? 0, screenshot.height ?? 0);
  }

  async getFrameGeometry(serial: string, space: "video" | "screenshot", signal?: AbortSignal): Promise<HarmonyGeometry> {
    const device = await this.host.onlineDevice(serial, signal);
    const backend = this.host.requireBackend();
    if (!backend.displayGeometry) throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Native display geometry is unavailable");
    const key = `${serial}:${space}`;
    const frame = this.frameDimensions.get(key);
    if (!frame) throw new HarmonyError("STALE_SNAPSHOT", "No server-observed frame geometry is available");
    const observation = this.frameCapturedAt.get(key);
    const age = observation ? this.host.now() - observation.capturedAt : Number.NaN;
    if (!observation || observation.generation !== device.generation || !Number.isFinite(age) || age < 0 || age > 5000) {
      throw new HarmonyError("STALE_SNAPSHOT", "The frame is stale; wait for live video or a new screenshot");
    }
    const native = await backend.displayGeometry(serial, signal);
    const currentObservation = this.frameCapturedAt.get(key);
    const currentAge = currentObservation ? this.host.now() - currentObservation.capturedAt : Number.NaN;
    if (
      this.host.getGeneration(serial) !== device.generation
      || currentObservation?.generation !== device.generation
      || this.frameDimensions.get(key) !== frame
      || !Number.isFinite(currentAge)
      || currentAge < 0
      || currentAge > 5000
    ) {
      throw new HarmonyError("STALE_SNAPSHOT", "Frame geometry changed or expired during verification");
    }
    // Current video and screenCap providers send the full current-orientation
    // display. A changed aspect ratio is not evidence of a known crop.
    if (Math.abs(frame.width / frame.height - native.nativeWidth / native.nativeHeight) > 0.002) {
      this.geometries.delete(key);
      throw new HarmonyError("STALE_SNAPSHOT", "Frame and native display geometry disagree; wait for a new frame");
    }
    const candidate = {
      ...native,
      deviceEpoch: device.generation,
      frameWidth: frame.width,
      frameHeight: frame.height,
      rotation: 0 as const,
      crop: { left: 0, top: 0, width: native.nativeWidth, height: native.nativeHeight },
    };
    const previous = this.geometries.get(key);
    const { geometryId: previousId, ...previousShape } = previous ?? {};
    const geometry = previousId && JSON.stringify(previousShape) === JSON.stringify(candidate)
      ? previous!
      : { ...candidate, geometryId: randomBytes(16).toString("hex") };
    this.geometries.set(key, geometry);
    return structuredClone(geometry);
  }

  async resolveInputPoint(
    options: Pick<HarmonyTapOptions, "serial" | "coordinateSpace" | "geometryId">,
    x: number,
    y: number,
    signal: AbortSignal,
  ): Promise<{ x: number; y: number }> {
    if (options.coordinateSpace !== "frame" && !options.geometryId) {
      const backend = this.host.requireBackend();
      if (!backend.displayGeometry) {
        throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Native coordinates require a verified display geometry provider");
      }
      const geometry = await backend.displayGeometry(options.serial, signal);
      if (![x, y].every(Number.isFinite) || x < 0 || y < 0 || x >= geometry.nativeWidth || y >= geometry.nativeHeight) {
        throw new HarmonyError("INVALID_ARGUMENT", "Native point is outside the observed display", { details: { dispatchState: "not-sent" } });
      }
      return { x, y };
    }
    const entry = [...this.geometries.entries()].find(([key, value]) => key.startsWith(`${options.serial}:`) && value.geometryId === options.geometryId);
    if (!entry) throw new HarmonyError("STALE_SNAPSHOT", "The frame geometry expired; reconnect or refresh the frame");
    const space = entry[0].endsWith(":video") ? "video" : "screenshot";
    const current = await this.getFrameGeometry(options.serial, space, signal);
    if (current.geometryId !== options.geometryId) {
      throw new HarmonyError("STALE_SNAPSHOT", "The display rotated or changed since this frame");
    }
    if (options.coordinateSpace === "frame") return transformFramePoint(current, x, y);
    if (![x, y].every(Number.isFinite) || x < 0 || y < 0 || x >= current.nativeWidth || y >= current.nativeHeight) {
      throw new HarmonyError("INVALID_ARGUMENT", "Native point is outside the observed display");
    }
    return { x, y };
  }
}

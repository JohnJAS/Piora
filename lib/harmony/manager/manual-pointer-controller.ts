import { randomBytes } from "node:crypto";
import { HarmonyError } from "../errors";
import { ManualPointer } from "../input/manual-pointer";
import { transformFramePoint, type HarmonyGeometry } from "../observation/geometry";
import type {
  HarmonyAutomationBackend,
  HarmonyLease,
  HarmonyOperationResult,
  HarmonyTapOptions,
} from "../types";

export interface ManualPointerControllerHost {
  now: () => number;
  getGeneration: (serial: string) => number | undefined;
  requireLease: (serial: string, token: string | undefined) => HarmonyLease;
  requireBackend: () => HarmonyAutomationBackend;
  getGeometry: (key: string) => HarmonyGeometry | undefined;
  getFrameCapturedAt: (key: string) => { capturedAt: number; generation: number } | undefined;
  getFrameGeometry: (serial: string, space: "video" | "screenshot", signal?: AbortSignal) => Promise<HarmonyGeometry>;
  resolveInputPoint: (
    options: Pick<HarmonyTapOptions, "serial" | "coordinateSpace" | "geometryId">,
    x: number,
    y: number,
    signal: AbortSignal,
  ) => Promise<{ x: number; y: number }>;
  action: (
    operation: string,
    serial: string,
    leaseToken: string,
    generation: number | undefined,
    signal: AbortSignal | undefined,
    invoke: (backend: HarmonyAutomationBackend, queuedSignal: AbortSignal) => Promise<void>,
  ) => Promise<HarmonyOperationResult>;
}

interface ManualPointerEntry {
  id: string;
  token: string;
  pointer?: ManualPointer;
  result?: Promise<HarmonyOperationResult>;
}

export class HarmonyManualPointerController {
  private readonly manualPointers = new Map<string, ManualPointerEntry>();

  constructor(private readonly host: ManualPointerControllerHost) {}

  async begin(options: HarmonyTapOptions): Promise<{ gestureId: string }> {
    const lease = this.host.requireLease(options.serial, options.leaseToken);
    if (lease.owner.kind !== "manual") throw new HarmonyError("INVALID_ARGUMENT", "Live pointers require a manual lease");
    if (this.manualPointers.has(options.serial)) throw new HarmonyError("DEVICE_BUSY", "A manual pointer is already active");
    const rawBackend = this.host.requireBackend();
    if (!rawBackend.pointerPhase) throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Live pointer control is unavailable");
    const entry: ManualPointerEntry = { id: randomBytes(16).toString("hex"), token: options.leaseToken };
    this.manualPointers.set(options.serial, entry);
    let ready!: (result: { gestureId: string }) => void;
    let failed!: (error: unknown) => void;
    const prepared = new Promise<{ gestureId: string }>((resolve, reject) => { ready = resolve; failed = reject; });
    entry.result = this.host.action("manual_pointer", options.serial, options.leaseToken, options.generation, options.signal, async (backend, signal) => {
      const point = await this.host.resolveInputPoint(options, options.x, options.y, signal);
      const key = `${options.serial}:video`;
      const geometry = this.host.getGeometry(key);
      if (!geometry || geometry.geometryId !== options.geometryId) {
        throw new HarmonyError("STALE_SNAPSHOT", "Live pointer requires current video geometry");
      }
      const validate = () => {
        this.host.requireLease(options.serial, options.leaseToken);
        const observed = this.host.getFrameCapturedAt(key);
        const age = observed ? this.host.now() - observed.capturedAt : NaN;
        if (
          signal.aborted
          || this.host.getGeneration(options.serial) !== geometry.deviceEpoch
          || this.host.getGeometry(key)?.geometryId !== geometry.geometryId
          || observed?.generation !== geometry.deviceEpoch
          || !Number.isFinite(age)
          || age < 0
          || age > 1000
        ) {
          throw new HarmonyError("STALE_SNAPSHOT", "The live pointer frame expired or changed");
        }
      };
      const pointer = entry.pointer = new ManualPointer({
        validate,
        dispatch: async (phase, position) => {
          if (phase === "up") {
            // Release remains allowed after the lease/epoch/signal is revoked.
            try { await rawBackend.pointerPhase!(options.serial, phase, entry.id, position.x, position.y); }
            catch (cause) {
              throw new HarmonyError("AUTOMATION_DRIVER_FAILED", "Pointer release could not be confirmed", {
                cause,
                details: { cleanup: "uncertain", dispatchState: "unknown" },
              });
            }
          } else {
            validate();
            await backend.pointerPhase!(options.serial, phase, entry.id, position.x, position.y);
          }
        },
      });
      // Rotation is also checked while held, including 180-degree changes that
      // retain the same video dimensions. Never overlap geometry polls.
      let checking = false;
      const watchdog = setInterval(() => {
        if (checking) return;
        checking = true;
        void this.host.getFrameGeometry(options.serial, "video", signal).then(validate)
          .catch(() => pointer.up()).catch(() => undefined).finally(() => { checking = false; });
      }, 150);
      const running = pointer.run(point, signal);
      void running.catch(() => undefined);
      try {
        await pointer.ready;
        ready({ gestureId: entry.id });
        await running;
      } finally {
        clearInterval(watchdog);
      }
    });
    void entry.result.catch(failed).finally(() => {
      if (this.manualPointers.get(options.serial) === entry) this.manualPointers.delete(options.serial);
    });
    return prepared;
  }

  async update(options: { serial: string; leaseToken: string; gestureId: string; phase: "move" | "up"; x?: number; y?: number }): Promise<void> {
    const entry = this.manualPointers.get(options.serial);
    if (!entry || entry.id !== options.gestureId || entry.token !== options.leaseToken || !entry.pointer) {
      throw new HarmonyError("STALE_SNAPSHOT", "The manual pointer expired");
    }
    if (options.phase === "up") {
      await entry.pointer.up();
      await entry.result;
      return;
    }
    this.host.requireLease(options.serial, options.leaseToken);
    const geometry = this.host.getGeometry(`${options.serial}:video`);
    if (!geometry) {
      await entry.pointer.up();
      throw new HarmonyError("STALE_SNAPSHOT", "Video geometry expired");
    }
    try { await entry.pointer.move(transformFramePoint(geometry, options.x!, options.y!)); }
    catch (error) { await entry.pointer.up(); throw error; }
  }
}

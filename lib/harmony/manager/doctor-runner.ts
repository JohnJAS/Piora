import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { capabilitiesFromHelp } from "../capabilities/probes";
import type { HarmonyDoctorReport } from "../contracts/capabilities";
import { asHarmonyError, HarmonyError, isHarmonyError } from "../errors";
import { deviceFingerprint } from "../input/calibration-store";
import { requireValidObservation } from "../observation/quality";
import type { HarmonyOperationTasks } from "../operation-tasks";
import { discoverHdcCandidates } from "../runtime";
import { peekHarmonySqliteSnapshotMetadata } from "../sqlite-inspector";
import type {
  HarmonyAutomationBackend,
  HarmonyConfig,
  HarmonyDevice,
} from "../types";
import { iso, validateSerial } from "./shared";

export interface DoctorRunnerHost {
  injectedBackend: boolean;
  operationTasks: HarmonyOperationTasks;
  now: () => number;
  getConfig: () => HarmonyConfig;
  hasBackend: () => boolean;
  tryCreateBackend: () => void;
  requireBackend: () => HarmonyAutomationBackend;
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
  listAcousticOutputs: (signal?: AbortSignal) => Promise<unknown[]>;
  listVoiceProfileIds: (device: HarmonyDevice) => string[];
  getFrameCapturedAt: (key: string) => { capturedAt: number; generation: number } | undefined;
}

export class HarmonyDoctorRunner {
  private readonly capabilityCache = new Map<string, { fingerprint: string; at: number; values: HarmonyDoctorReport["capabilities"] }>();
  private readonly capabilityFailures = new Map<string, Map<string, string>>();

  constructor(private readonly host: DoctorRunnerHost) {}

  invalidateDevice(serial: string): void {
    this.capabilityCache.delete(serial);
    this.capabilityFailures.delete(serial);
  }

  recordCapabilityFailure(serial: string, method: string, args: unknown[], error: unknown): void {
    const failure = asHarmonyError(error);
    if (!["CAPABILITY_UNAVAILABLE", "COMMAND_FAILED", "AUTOMATION_DRIVER_FAILED", "AUTOMATION_DRIVER_UNAVAILABLE"].includes(failure.code)) return;
    const names: Record<string, string> = {
      doubleTap: "double_tap",
      longPress: "long_press",
      pressKey: "press_key",
      keyHold: "key_hold",
      touchHold: "touch_hold",
      inputText: "input_text",
      launchApp: "launch_app",
    };
    const action = method === "semanticAction" ? String((args[1] as { action?: string })?.action) : names[method] ?? method;
    const failures = this.capabilityFailures.get(serial) ?? new Map<string, string>();
    failures.set(action, failure.code);
    this.capabilityFailures.set(serial, failures);
  }

  async run(serial: string, signal?: AbortSignal, reprobe = false): Promise<HarmonyDoctorReport> {
    validateSerial(serial);
    return await this.host.enqueue("doctor", async queuedSignal => {
      if (!this.host.hasBackend() && !this.host.injectedBackend && reprobe) this.host.tryCreateBackend();
      const device = await this.host.onlineDevice(serial, queuedSignal);
      const backend = this.host.requireBackend();
      const versions: HarmonyDoctorReport["versions"] = { os: device.osVersion, api: device.apiVersion, uitest: device.uitestVersion };
      let hdcStamp = "unknown";
      try { const info = statSync(backend.hdcPath!); hdcStamp = `${info.size}:${info.mtimeMs}`; } catch { /* Missing or injected executable. */ }
      try {
        versions.hypium = JSON.parse(
          readFileSync(join(process.env.PIORA_WEB_RUNTIME_ROOT?.trim() || process.cwd(), "node_modules", "hypium-driver", "package.json"), "utf8"),
        ).version;
      } catch { /* Unknown installed driver. */ }
      const fingerprint = `${deviceFingerprint(device)}:${device.generation}:${device.uitestVersion}:${backend.hdcPath}:${hdcStamp}:${versions.hypium}`;
      const cached = this.capabilityCache.get(serial);
      if (reprobe) this.capabilityFailures.delete(serial);
      let capabilities: HarmonyDoctorReport["capabilities"];
      if (!reprobe && cached?.fingerprint === fingerprint && this.host.now() - cached.at < 300_000) {
        capabilities = cached.values;
      } else {
        capabilities = backend.probeCapabilities ? await backend.probeCapabilities(serial, queuedSignal) : capabilitiesFromHelp({});
        this.capabilityCache.set(serial, { fingerprint, at: this.host.now(), values: capabilities });
      }
      capabilities = capabilities.map(capability => this.capabilityFailures.get(serial)?.has(capability.action)
        ? {
          ...capability,
          status: "unavailable",
          reason: `A real dispatch failed (${this.capabilityFailures.get(serial)!.get(capability.action)}); use Check device to explicitly reprobe`,
          evidence: "probed",
        }
        : capability);
      const checks: HarmonyDoctorReport["checks"] = [{ name: "connection", status: "passed" }];
      try {
        if (!backend.displayGeometry) throw new Error("Provider has no native geometry probe");
        await backend.displayGeometry(serial, queuedSignal);
        checks.push({ name: "native-geometry", status: "passed" });
      } catch {
        checks.push({ name: "native-geometry", status: "unknown", reason: "Coordinate control requires a known display and a fresh frame" });
      }
      const probe = await backend.doctorProbes?.(serial, queuedSignal);
      if (probe) { versions.hdc = probe.hdcVersion; checks.push(...probe.checks); }
      try {
        const observation = await backend.snapshot(serial, { includeTree: true, includeScreenshot: false, signal: queuedSignal });
        requireValidObservation(observation);
        checks.push({ name: "ui-tree", status: "passed", reason: "Current scoped tree parsed successfully; contents are not included in doctor" });
      } catch {
        checks.push({ name: "ui-tree", status: "unknown", reason: "Cannot verify the current window tree; inspect device authorization and foreground test app" });
      }
      if (!backend.listFiles) {
        checks.push({ name: "file-access", status: "unknown", reason: "Provider has no shared-directory metadata reader; no application sandbox was checked" });
      } else {
        try {
          const listing = await backend.listFiles(serial, { kind: "shared" }, "/data/local/tmp", queuedSignal, 0);
          if (queuedSignal.aborted) throw new HarmonyError("COMMAND_ABORTED", "Doctor cancelled");
          if (!Array.isArray(listing.files) || listing.files.length > 500 || typeof listing.truncated !== "boolean") {
            throw new HarmonyError("INVALID_RESPONSE", "Invalid directory metadata");
          }
          checks.push({
            name: "file-access",
            status: "passed",
            reason: `Fixed shared temporary-directory metadata read confirmed${listing.truncated ? "; first page was truncated" : ""}. No file contents or application sandbox were read.`,
          });
        } catch (error) {
          if (queuedSignal.aborted || (isHarmonyError(error) && error.code === "COMMAND_ABORTED")) {
            throw new HarmonyError("COMMAND_ABORTED", "Doctor cancelled");
          }
          const failure = asHarmonyError(error);
          const category = `${error instanceof Error ? error.message : ""} ${failure.message} ${typeof failure.details?.reason === "string" ? failure.details.reason : ""}`;
          const reason = /permission denied|access denied|not permitted|权限|无权/i.test(category)
            ? "Shared temporary-directory metadata access was denied"
            : /no such file|not found|不存在/i.test(category)
              ? "The fixed shared temporary directory was not found"
              : "Shared temporary-directory metadata could not be verified";
          checks.push({
            name: "file-access",
            status: failure.code === "CAPABILITY_UNAVAILABLE" ? "unknown" : "failed",
            reason: `${reason} (${failure.code}). This does not determine application sandbox or file-content access.`,
          });
        }
      }
      if (!this.host.injectedBackend) {
        const candidates = discoverHdcCandidates({ config: this.host.getConfig() });
        checks.push({
          name: "hdc-selection",
          status: "passed",
          reason: `Selected: ${backend.hdcPath}; ${candidates.length} local candidate(s). A runtime switch requires an explicit selection.`,
        });
        try {
          const outputs = await this.host.listAcousticOutputs(queuedSignal);
          checks.push({
            name: "acoustic-routes",
            status: outputs.length ? "passed" : "unknown",
            reason: `${outputs.length} output(s); ${this.host.listVoiceProfileIds(device).length} device-bound calibrated profile(s). No sound was played.`,
          });
        } catch {
          checks.push({ name: "acoustic-routes", status: "unknown", reason: "Output enumeration unavailable; choose and calibrate an explicit supported route" });
        }
      }
      const automation = backend.automationDiagnostics?.();
      const worker = automation?.sessions?.find(session => session.serial === serial);
      checks.push({
        name: "hypium-worker",
        status: worker?.state === "ready" ? "passed" : "unknown",
        reason: worker ? `Worker state: ${worker.state}` : "No live worker has verified this device; doctor does not initialize a control session",
      });
      const forwards = backend.interruptedForwards?.(serial) ?? [];
      if (forwards.length) {
        checks.push({
          name: "orphaned-video-forwards",
          status: "unknown",
          reason: `Prior process exited; manually inspect only these recorded local ports: ${forwards.map(forward => forward.localPort).join(", ")}. No automatic removal.`,
        });
      }
      if (queuedSignal.aborted) throw new HarmonyError("COMMAND_ABORTED", "Doctor cancelled");
      const checkedAt = this.host.now();
      const frames = (["video", "screenshot"] as const)
        .map(space => ({ space, observation: this.host.getFrameCapturedAt(`${serial}:${space}`) }))
        .filter(entry => entry.observation?.generation === device.generation && Number.isFinite(entry.observation.capturedAt));
      const fresh = frames
        .filter(entry => checkedAt - entry.observation!.capturedAt >= 0 && checkedAt - entry.observation!.capturedAt <= 5000)
        .sort((left, right) => right.observation!.capturedAt - left.observation!.capturedAt)[0];
      checks.push({
        name: "frame-freshness",
        status: fresh ? "passed" : "unknown",
        reason: fresh
          ? `Latest ${fresh.space === "video" ? "encoded video packet" : "screenshot"} received at ${iso(fresh.observation!.capturedAt)}; age ${checkedAt - fresh.observation!.capturedAt} ms. Reception time alone does not verify client decoding or drawing.`
          : frames.some(entry => checkedAt < entry.observation!.capturedAt)
            ? "Observed frame time is ahead of the current clock; freshness is unconfirmed. No new frame was requested."
            : frames.length
              ? "Last received frame is older than five seconds; no new frame was requested."
              : "No frame received in the current device epoch; video configuration alone is not a frame. No new capture or viewer was started.",
      });
      const database = peekHarmonySqliteSnapshotMetadata(serial);
      const recentSnapshot = this.host.operationTasks.list(serial).find(
        task => task.kind === "snapshot" && (task.status === "completed" || task.status === "failed"),
      );
      const history = recentSnapshot
        ? recentSnapshot.status === "completed"
          ? ` Last historical capture completed at ${recentSnapshot.completedAt ?? recentSnapshot.updatedAt}; history alone does not establish a currently open snapshot.`
          : ` Last capture failed at ${recentSnapshot.updatedAt}${recentSnapshot.errorCode && /^[A-Z_]{1,64}$/.test(recentSnapshot.errorCode) ? ` (${recentSnapshot.errorCode})` : ""}; this does not determine access for every application.`
        : "";
      checks.push({
        name: "database-snapshot",
        status: database.active > 0 ? "passed" : "unknown",
        reason: database.latestActive
          ? `${database.active} current-device local read-only snapshot(s); latest private copy created at ${iso(database.latestActive.createdAt)}, first verified at ${iso(database.latestActive.readyAt)}, expires at ${iso(database.latestActive.expiresAt)}. Data reflects capture time; refresh in Database for a new capture.${history}`
          : `${database.opening ? "A local snapshot is still awaiting its first successful verification." : database.expired ? "Existing local snapshots have expired." : "No verified local snapshot is currently open; choose an automatically discovered application database in Database."} Doctor did not scan, open, query or clean up a database.${history}`,
      });
      return {
        serial,
        deviceEpoch: device.generation,
        checkedAt: iso(checkedAt),
        versions,
        capabilities: capabilities.map(capability => ({ ...capability, deviceEpoch: device.generation })),
        checks,
        nextActions: checks.some(check => check.status !== "passed")
          ? ["Inspect the phone's display configuration; unlock it manually if needed. No automatic unlock is performed."]
          : [],
      };
    }, signal, undefined, serial);
  }
}

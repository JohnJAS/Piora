import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { WindowsAcousticProvider, type AudioOutput } from "../audio/acoustic-provider";
import { appTestPacket, type AppTestPairing } from "../audio/app-test-provider";
import { AudioAssetStore } from "../audio/audio-assets";
import { runVoiceInput, validateVoiceProfile, VoiceProfileStore, type VoiceProfile } from "../audio/audio-session";
import { HarmonyError } from "../errors";
import { InputCalibrationStore } from "../input/calibration-store";
import type { PhysicalKey } from "../input/key-catalog";
import type { HarmonyGeometry } from "../observation/geometry";
import { requireValidObservation } from "../observation/quality";
import { findHarmonyNodes, validateHarmonySelector } from "../selector";
import type {
  HarmonyAutomationBackend,
  HarmonyDevice,
  HarmonyLease,
  HarmonyOperationResult,
  HarmonySnapshot,
  HarmonySnapshotOptions,
  HarmonyTapOptions,
  HarmonyUiSelector,
} from "../types";

export interface VoiceInputOptions {
  serial: string;
  leaseToken: string;
  audioAssetId: string;
  profileId?: string;
  timeoutMs?: number;
  geometryId?: string;
  requiredMode?: "tap" | "push-to-talk";
  signal?: AbortSignal;
  calibrateProfile?: Pick<VoiceProfile, "targetAppId" | "output" | "entry" | "ready" | "result" | "mode" | "holdDurationMs">;
}

export interface AudioVoiceControllerHost {
  configPath: string;
  onlineDevice: (serial: string, signal?: AbortSignal) => Promise<HarmonyDevice>;
  requireLease: (serial: string, token: string | undefined) => HarmonyLease;
  snapshot: (options: HarmonySnapshotOptions) => Promise<HarmonySnapshot>;
  captureSnapshotNow: (serial: string, includeTree: boolean, includeScreenshot: boolean, signal?: AbortSignal) => Promise<HarmonySnapshot>;
  resolveInputPoint: (
    options: Pick<HarmonyTapOptions, "serial" | "coordinateSpace" | "geometryId">,
    x: number,
    y: number,
    signal: AbortSignal,
  ) => Promise<{ x: number; y: number }>;
  findGeometryById: (geometryId: string | undefined) => HarmonyGeometry | undefined;
  action: (
    operation: string,
    serial: string,
    leaseToken: string,
    generation: number | undefined,
    signal: AbortSignal | undefined,
    invoke: (backend: HarmonyAutomationBackend, queuedSignal: AbortSignal) => Promise<void>,
  ) => Promise<HarmonyOperationResult>;
}

export class HarmonyAudioVoiceController {
  private inputCalibration?: InputCalibrationStore;
  private audioAssets?: AudioAssetStore;
  private voiceProfiles?: VoiceProfileStore;
  private readonly acoustic = new WindowsAcousticProvider();

  constructor(private readonly host: AudioVoiceControllerHost) {}

  private calibrations(): InputCalibrationStore {
    return this.inputCalibration ??= new InputCalibrationStore(join(dirname(this.host.configPath), "harmony-input-calibration"));
  }

  private audioStore(): AudioAssetStore {
    return this.audioAssets ??= new AudioAssetStore(join(dirname(this.host.configPath), "harmony-audio-assets"));
  }

  private voiceStore(): VoiceProfileStore {
    return this.voiceProfiles ??= new VoiceProfileStore(join(dirname(this.host.configPath), "harmony-voice-profiles"));
  }

  listVoiceProfileIds(device: HarmonyDevice): string[] {
    return this.voiceStore().listIds(device);
  }

  async audioOutputs(signal?: AbortSignal) {
    return await this.acoustic.outputs(signal);
  }

  async importAudio(path: string) {
    return await this.audioStore().import(path);
  }

  async previewAudio(audioAssetId: string, output: AudioOutput, signal?: AbortSignal) {
    const immutable = await this.audioStore().resolve(audioAssetId);
    return this.acoustic.play(output, immutable.path, signal);
  }

  async confirmInputCalibration(serial: string, id: string, assistant?: { appId: string; selector: HarmonyUiSelector }) {
    if (assistant) {
      validateHarmonySelector(assistant.selector);
      const snapshot = await this.host.snapshot({ serial, includeTree: true, includeScreenshot: false });
      requireValidObservation(snapshot);
      if (snapshot.quality?.appId !== assistant.appId || findHarmonyNodes(snapshot.nodes ?? [], assistant.selector).length !== 1) {
        throw new HarmonyError("SCENARIO_FAILED", "The assistant postcondition is not uniquely visible on this device");
      }
    }
    return this.calibrations().confirm(await this.host.onlineDevice(serial), id, assistant);
  }

  async openAssistant(options: { serial: string; leaseToken: string; profileId: string; signal?: AbortSignal }) {
    const result = await this.host.action("open_assistant", options.serial, options.leaseToken, undefined, options.signal, async (backend, signal) => {
      const profile = this.calibrations().assistant(await this.host.onlineDevice(options.serial, signal), options.profileId);
      if (!backend.keyHold) throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Physical key hold is unavailable");
      await backend.keyHold(options.serial, "power", profile.durationMs, signal);
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline && !signal.aborted) {
        const snapshot = await this.host.captureSnapshotNow(options.serial, true, false, signal);
        requireValidObservation(snapshot);
        if (snapshot.quality?.appId === profile.assistant!.appId && findHarmonyNodes(snapshot.nodes ?? [], profile.assistant!.selector).length === 1) return;
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      throw new HarmonyError(signal.aborted ? "COMMAND_ABORTED" : "SCENARIO_FAILED", "Assistant did not reach its calibrated postcondition");
    });
    return { ...result, receipt: { ...result.receipt!, effect: "applied" as const, verification: "passed" as const } };
  }

  async appTestAudio(options: { serial: string; leaseToken: string; audioAssetId: string; pairing: AppTestPairing; signal?: AbortSignal }) {
    let hashResult: string | undefined;
    const receipt = await this.host.action("app_test_audio", options.serial, options.leaseToken, undefined, options.signal, async (backend, signal) => {
      const lease = this.host.requireLease(options.serial, options.leaseToken);
      if (lease.owner.kind !== "manual" || !backend.appTestAudio) {
        throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Debug PCM pairing is available only through explicit desktop manual control");
      }
      const source = await this.audioStore().resolve(options.audioAssetId);
      const packet = appTestPacket(await readFile(source.path), options.pairing, lease.owner.id);
      const initial = await this.host.captureSnapshotNow(options.serial, true, false, signal);
      if (
        initial.quality?.treeStatus !== "valid"
        || initial.quality.appId !== "dev.piora.audio.fixture"
        || !initial.nodes?.some(node => node.id === "app-test-result" && node.text === "ready")
      ) {
        throw new HarmonyError("OBSERVATION_UNAVAILABLE", "Open and pair the debug fixture on this device first");
      }
      await backend.appTestAudio(options.serial, packet.packet, signal);
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline && !signal.aborted) {
        const snapshot = await this.host.captureSnapshotNow(options.serial, true, false, signal);
        if (snapshot.quality?.treeStatus !== "valid" || snapshot.quality.appId !== initial.quality.appId || snapshot.quality.windowId !== initial.quality.windowId) {
          throw new HarmonyError("STALE_SNAPSHOT", "Debug app lost focus");
        }
        if (snapshot.nodes?.some(node => node.id === "app-test-result" && node.text === packet.expected)) {
          hashResult = packet.expected;
          return;
        }
        if (snapshot.nodes?.some(node => node.id === "app-test-result" && node.text === "rejected")) {
          throw new HarmonyError("SCENARIO_FAILED", "Debug app rejected the PCM packet");
        }
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      throw new HarmonyError(signal.aborted ? "COMMAND_ABORTED" : "COMMAND_TIMEOUT", "Debug PCM result was not verified");
    });
    return { ...receipt, provider: "app-test", verification: hashResult, coversMicrophone: false, coversSpeechRecognition: false };
  }

  async voiceInput(options: VoiceInputOptions) {
    let voice: Awaited<ReturnType<HarmonyAudioVoiceController["executeVoice"]>> | undefined;
    const result = await this.host.action("voice_input", options.serial, options.leaseToken, undefined, options.signal, async (backend, signal) => {
      voice = await this.executeVoice(options, backend, signal);
    });
    return { ...result, ...voice };
  }

  async executeVoice(options: VoiceInputOptions, backend: HarmonyAutomationBackend, signal: AbortSignal) {
    let calibratedProfile: VoiceProfile | undefined;
    const device = await this.host.onlineDevice(options.serial, signal);
    const profile = options.calibrateProfile ?? this.voiceStore().get(device, options.profileId ?? "");
    validateVoiceProfile(profile);
    if (options.requiredMode && options.requiredMode !== profile.mode) {
      throw new HarmonyError("INVALID_ARGUMENT", "Voice profile mode does not match this scenario", { details: { dispatchState: "not-sent" } });
    }
    const outputs = await this.acoustic.outputs(signal);
    if (!outputs.some(output => output.id === profile.output?.id && output.name === profile.output?.name && output.provider === profile.output?.provider)) {
      throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Selected acoustic output changed; choose and calibrate it again", { details: { dispatchState: "not-sent" } });
    }
    const { asset } = await this.audioStore().resolve(options.audioAssetId);
    if (profile.mode === "push-to-talk") {
      if (!options.geometryId || !backend.touchHold || !profile.holdDurationMs) {
        throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Voice touch mode requires fresh geometry and calibrated touch hold");
      }
      this.calibrations().require(device, "touch", profile.holdDurationMs);
    }
    let heldGeometry: HarmonyGeometry | undefined;
    const voiceResult = await runVoiceInput(profile, asset, {
      serial: options.serial,
      backend,
      signal,
      beforeDispatch: () => { this.host.requireLease(options.serial, options.leaseToken); },
      capture: async captureSignal => await this.host.captureSnapshotNow(options.serial, true, false, captureSignal),
      validateHold: async holdSignal => {
        if (!heldGeometry) return;
        const native = await backend.displayGeometry!(options.serial, holdSignal);
        if (
          native.displayId !== heldGeometry.displayId
          || native.displayRotation !== heldGeometry.displayRotation
          || native.nativeWidth !== heldGeometry.nativeWidth
          || native.nativeHeight !== heldGeometry.nativeHeight
        ) {
          throw new HarmonyError("STALE_SNAPSHOT", "Voice hold geometry changed");
        }
      },
      play: async playSignal => {
        const immutable = await this.audioStore().resolve(asset.id);
        return await this.acoustic.play(profile.output, immutable.path, playSignal);
      },
      hold: async (point, durationMs, holdSignal) => {
        await this.host.resolveInputPoint({ serial: options.serial, coordinateSpace: "native", geometryId: options.geometryId }, point.x, point.y, holdSignal);
        heldGeometry = this.host.findGeometryById(options.geometryId);
        if (!heldGeometry) throw new HarmonyError("STALE_SNAPSHOT", "Voice hold geometry expired before dispatch");
        return await backend.touchHold!(options.serial, point.x, point.y, durationMs, holdSignal);
      },
    }, options.timeoutMs);
    if (options.calibrateProfile) calibratedProfile = this.voiceStore().save(device, { ...profile, calibrationAssetHash: asset.hash });
    return { voice: voiceResult, ...(calibratedProfile ? { profile: calibratedProfile } : {}) };
  }

  async keyHold(options: { serial: string; leaseToken: string; key: PhysicalKey; durationMs: number; calibrate?: boolean; signal?: AbortSignal }) {
    let calibration: ReturnType<InputCalibrationStore["record"]> | undefined;
    const result = await this.host.action("key_hold", options.serial, options.leaseToken, undefined, options.signal, async (backend, signal) => {
      const device = await this.host.onlineDevice(options.serial, signal);
      if (!backend.keyHold) throw new HarmonyError("CAPABILITY_UNAVAILABLE", "No safe key hold provider");
      if (!options.calibrate) this.calibrations().require(device, "key", options.durationMs, options.key);
      await backend.keyHold(options.serial, options.key, options.durationMs, signal);
      if (options.calibrate) calibration = this.calibrations().record(device, "key", options.durationMs, options.key);
    });
    return { ...result, ...(calibration ? { calibration } : {}) };
  }

  async touchHold(options: HarmonyTapOptions & { durationMs: number; calibrate?: boolean }) {
    let calibration: ReturnType<InputCalibrationStore["record"]> | undefined;
    const result = await this.host.action("touch_hold", options.serial, options.leaseToken, options.generation, options.signal, async (backend, signal) => {
      const device = await this.host.onlineDevice(options.serial, signal);
      if (!options.geometryId || !backend.touchHold) {
        throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Touch hold requires current geometry and a safe release provider");
      }
      const point = await this.host.resolveInputPoint(options, options.x, options.y, signal);
      const initial = await backend.snapshot(options.serial, { includeTree: true, includeScreenshot: false, signal });
      if (!initial.quality?.windowId) {
        throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Touch hold requires an observed window identity so focus changes can stop it");
      }
      if (!options.calibrate) this.calibrations().require(device, "touch", options.durationMs);
      const controller = new AbortController();
      const inner = AbortSignal.any([signal, controller.signal]);
      let checking = false;
      const timer = setInterval(() => {
        if (checking || inner.aborted) return;
        checking = true;
        void (async () => {
          await this.host.resolveInputPoint(options, options.x, options.y, inner);
          const observation = await backend.snapshot(options.serial, { includeTree: true, includeScreenshot: false, signal: inner });
          if (observation.quality?.windowId !== initial.quality?.windowId) controller.abort("focus_changed");
        })().catch(() => controller.abort("geometry_or_focus_unknown")).finally(() => { checking = false; });
      }, 250);
      try { await backend.touchHold(options.serial, point.x, point.y, options.durationMs, inner); }
      finally { clearInterval(timer); controller.abort("touch_hold_complete"); }
      if (options.calibrate) calibration = this.calibrations().record(device, "touch", options.durationMs);
    });
    return { ...result, ...(calibration ? { calibration } : {}) };
  }
}

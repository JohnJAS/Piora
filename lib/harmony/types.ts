export type HarmonyDeviceConnectionState =
  | "online"
  | "unauthorized"
  | "offline"
  | "unknown";

export interface HarmonyCapabilities {
  uiTree: boolean;
  screenshot: boolean;
  tap: boolean;
  swipe: boolean;
  inputText: boolean;
  keys: boolean;
  launchApp: boolean;
}

export interface HarmonyDevice {
  serial: string;
  state: HarmonyDeviceConnectionState;
  name?: string;
  model?: string;
  product?: string;
  osVersion?: string;
  apiVersion?: string;
  uitestVersion?: string;
  generation: number;
  lastSeenAt: string;
  capabilities: HarmonyCapabilities;
}

export interface HarmonyLeaseOwner {
  kind: "agent" | "manual";
  /** Unique runtime identity. Agent callers should use their run/session identity. */
  id: string;
  sessionId?: string;
}

export interface HarmonyLease {
  token: string;
  serial: string;
  owner: HarmonyLeaseOwner;
  acquiredAt: string;
  expiresAt: string;
}

export interface HarmonyBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface HarmonyUiNode {
  ref: string;
  parentRef?: string;
  text?: string;
  id?: string;
  type?: string;
  hint?: string;
  description?: string;
  bounds?: HarmonyBounds;
  enabled?: boolean;
  clickable?: boolean;
  scrollable?: boolean;
  focused?: boolean;
  selected?: boolean;
  checked?: boolean;
  visible?: boolean;
}

export interface HarmonyScreenshot {
  mimeType: "image/png";
  data: Buffer;
  width?: number;
  height?: number;
}

export interface HarmonyProcess {
  pid: number;
  name: string;
}

export type HarmonyLogLevel = "debug" | "info" | "warn" | "error" | "fatal" | "unknown";

export interface HarmonyLogEntry {
  timestamp?: string;
  level: HarmonyLogLevel;
  pid?: number;
  tid?: number;
  domain?: string;
  tag?: string;
  message: string;
  raw: string;
}

export interface HarmonyLogOptions {
  serial: string;
  pid?: number;
  level?: Exclude<HarmonyLogLevel, "unknown">;
  query?: string;
  limit?: number;
  signal?: AbortSignal;
}

export interface HarmonySnapshot {
  serial: string;
  generation: number;
  revision: number;
  capturedAt: string;
  tree?: unknown;
  nodes?: HarmonyUiNode[];
  screenshot?: HarmonyScreenshot;
}

export interface HarmonyManagerState {
  runtime: {
    status: "unresolved" | "ready" | "unavailable" | "error";
    hdcPath?: string;
    error?: ReturnType<import("./errors").HarmonyError["toJSON"]>;
  };
  devices: HarmonyDevice[];
  leases: HarmonyLease[];
  snapshots: Array<{
    serial: string;
    generation: number;
    revision: number;
    capturedAt: string;
    hasTree: boolean;
    hasScreenshot: boolean;
  }>;
}

export interface HarmonyConfig {
  hdcPath?: string;
  storage?: {
    screenshotDirectory?: string;
    recordingDirectory?: string;
  };
  vision?: {
    enabled: boolean;
    provider: string;
    modelId: string;
    /** Keep the raw phone screenshot out of the action model by default. */
    shareScreenshotWithActionModel?: boolean;
  };
}

export interface HarmonyMediaArtifact {
  kind: "screenshot" | "recording";
  serial: string;
  path: string;
  filename: string;
  createdAt: string;
  size: number;
  mimeType: "image/png" | "video/mp4";
}

export interface HarmonyRecordingState {
  serial: string;
  recordingId: string;
  remoteName: string;
  startedAt: string;
  ownerId: string;
}

export interface HarmonyRuntimeCandidate {
  hdcPath: string;
  sdkPath: string;
  source: "selection" | "environment" | "config" | "deveco" | "path" | "bundled";
}

export interface HarmonyVideoConnection {
  stream: ReadableStream<Uint8Array>;
  close(): Promise<void>;
}

export interface HarmonyDiagnostics {
  timestamp: string;
  config: HarmonyConfig;
  runtime: HarmonyManagerState["runtime"] & { backendKind?: string };
  deviceCount: number;
  onlineDeviceCount: number;
  activeLeaseCount: number;
  queue: { pending: number; active: boolean; epoch: number };
}

export interface HarmonyOperationResult {
  serial: string;
  operationId: number;
  generation: number;
  completedAt: string;
  strategy?: string;
  x?: number;
  y?: number;
}

export interface HarmonySnapshotOptions {
  serial: string;
  leaseToken?: string;
  includeTree?: boolean;
  includeScreenshot?: boolean;
  signal?: AbortSignal;
}

export interface HarmonyTapOptions {
  serial: string;
  leaseToken: string;
  x: number;
  y: number;
  generation?: number;
  signal?: AbortSignal;
}

export type HarmonyPointGestureOptions = HarmonyTapOptions;

export interface HarmonyTapRefOptions {
  serial: string;
  leaseToken: string;
  ref: string;
  generation: number;
  signal?: AbortSignal;
}

export interface HarmonySwipeOptions {
  serial: string;
  leaseToken: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  durationMs?: number;
  generation?: number;
  signal?: AbortSignal;
}

export type HarmonyDragOptions = HarmonySwipeOptions;

export type HarmonyFlingOptions = HarmonySwipeOptions;

export interface HarmonyInputTextOptions {
  serial: string;
  leaseToken: string;
  text: string;
  signal?: AbortSignal;
}

export interface HarmonyPressKeyOptions {
  serial: string;
  leaseToken: string;
  key: "back" | "home" | "recents" | "enter";
  signal?: AbortSignal;
}

export interface HarmonyLaunchAppOptions {
  serial: string;
  leaseToken: string;
  bundleName: string;
  abilityName?: string;
  signal?: AbortSignal;
}

export type HarmonyManagerEvent =
  | { type: "state"; timestamp: string; state: HarmonyManagerState }
  | { type: "devices"; timestamp: string; devices: HarmonyDevice[] }
  | { type: "lease_acquired"; timestamp: string; lease: HarmonyLease }
  | { type: "lease_released"; timestamp: string; serial: string; ownerId: string; reason: string }
  | { type: "snapshot"; timestamp: string; serial: string; generation: number; revision: number }
  | { type: "operation"; timestamp: string; serial: string; operation: string; operationId: number };

export interface BackendDevice {
  serial: string;
  state: HarmonyDeviceConnectionState;
  name?: string;
  model?: string;
  product?: string;
  osVersion?: string;
  apiVersion?: string;
  uitestVersion?: string;
  capabilities: HarmonyCapabilities;
}

export interface BackendSnapshot {
  tree?: unknown;
  nodes?: Array<Omit<HarmonyUiNode, "ref" | "parentRef"> & { parentIndex?: number }>;
  screenshot?: HarmonyScreenshot;
}

export interface HarmonyAutomationBackend {
  readonly kind: string;
  readonly hdcPath?: string;
  listDevices(signal?: AbortSignal): Promise<BackendDevice[]>;
  listProcesses?(serial: string, signal?: AbortSignal): Promise<HarmonyProcess[]>;
  readLogs?(
    serial: string,
    options: Omit<HarmonyLogOptions, "serial" | "signal"> & { signal?: AbortSignal },
  ): Promise<HarmonyLogEntry[]>;
  snapshot(
    serial: string,
    options: { includeTree: boolean; includeScreenshot: boolean; signal?: AbortSignal },
  ): Promise<BackendSnapshot>;
  startRecording?(serial: string, remoteName: string, signal?: AbortSignal): Promise<void>;
  stopRecording?(serial: string, remoteName: string, destinationPath: string, signal?: AbortSignal): Promise<number>;
  openVideoStream?(serial: string, signal?: AbortSignal): Promise<HarmonyVideoConnection>;
  tap(serial: string, x: number, y: number, signal?: AbortSignal): Promise<void>;
  doubleTap?(serial: string, x: number, y: number, signal?: AbortSignal): Promise<void>;
  longPress?(serial: string, x: number, y: number, signal?: AbortSignal): Promise<void>;
  swipe(
    serial: string,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    durationMs?: number,
    signal?: AbortSignal,
  ): Promise<void>;
  drag?(
    serial: string,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    durationMs?: number,
    signal?: AbortSignal,
  ): Promise<void>;
  fling?(
    serial: string,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    durationMs?: number,
    signal?: AbortSignal,
  ): Promise<void>;
  inputText(serial: string, text: string, signal?: AbortSignal): Promise<void>;
  pressKey(
    serial: string,
    key: "back" | "home" | "recents" | "enter",
    signal?: AbortSignal,
  ): Promise<void>;
  launchApp(
    serial: string,
    bundleName: string,
    abilityName?: string,
    signal?: AbortSignal,
  ): Promise<void>;
  dispose?(): Promise<void> | void;
}

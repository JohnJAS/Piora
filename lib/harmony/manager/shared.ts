import { HarmonyError } from "../errors";
import type {
  HarmonyAutomationBackend,
  HarmonyConfig,
  HarmonyLeaseOwner,
  HarmonyManagerEvent,
  HarmonySnapshot,
  HarmonyUiNode,
} from "../types";

export const DEFAULT_LEASE_TTL_MS = 5 * 60_000;
export const MIN_LEASE_TTL_MS = 5_000;
export const MAX_LEASE_TTL_MS = 30 * 60_000;
export const DEVICE_REFRESH_TTL_MS = 10_000;
export const DEVICE_MISSING_GRACE_REFRESHES = 2;
// HDC's cancelled screenshot still performs an independent, bounded temporary
// file cleanup (up to three seconds). Input-release deadlines are shorter and
// must not make that ordinary read-only cleanup look like an unreleased hold.
export const PASSIVE_FRAME_CLEANUP_TIMEOUT_MS = 5_000;
// Keep a few lightweight semantic snapshots so an Agent can safely use a
// second ref from the same observation after another action or observer has
// advanced the current snapshot. Every retained target is re-read and
// uniquely matched against the live UiTest tree immediately before tapping.
export const MAX_RETAINED_REFERENCE_SNAPSHOTS = 4;

export interface AcquireLeaseOptions {
  serial: string;
  owner: HarmonyLeaseOwner;
  ttlMs?: number;
  signal?: AbortSignal;
}

export interface HarmonyDeviceManagerOptions {
  arbitrationDirectory?: string;
  cleanupTimeoutMs?: number;
  backend?: HarmonyAutomationBackend;
  backendFactory?: (config: HarmonyConfig) => HarmonyAutomationBackend;
  configPath?: string;
  now?: () => number;
  freeDiskBytes?: (directory: string) => Promise<number>;
  token?: () => string;
}

export type HarmonyManagerListener = (event: HarmonyManagerEvent) => void;

export interface StoredSnapshot extends HarmonySnapshot {
  nodeByRef: Map<string, HarmonyUiNode>;
}

export interface StoredReferenceSnapshot {
  quality?: HarmonySnapshot["quality"];
  capturedAt: string;
  generation: number;
  revision: number;
  nodeByRef: Map<string, HarmonyUiNode>;
}

export interface OperationLane {
  tail: Promise<void>;
  pending: number;
  active: boolean;
}

export function iso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

export function awaitSharedOperation<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(new HarmonyError("COMMAND_ABORTED", "Harmony device discovery was cancelled", { retryable: true }));
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new HarmonyError("COMMAND_ABORTED", "Harmony device discovery was cancelled", { retryable: true }));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener("abort", abort); resolve(value); },
      (error) => { signal.removeEventListener("abort", abort); reject(error); },
    );
  });
}

export function validateSerial(serial: string): void {
  if (typeof serial !== "string" || serial.length < 1 || serial.length > 256) {
    throw new HarmonyError("INVALID_ARGUMENT", "A valid device serial is required");
  }
}

export function validateOwner(owner: HarmonyLeaseOwner): void {
  if (!owner || !["agent", "manual"].includes(owner.kind) || typeof owner.id !== "string" || !owner.id.trim()) {
    throw new HarmonyError("INVALID_ARGUMENT", "A valid lease owner is required");
  }
  if (owner.id.length > 512 || (owner.sessionId?.length ?? 0) > 512) {
    throw new HarmonyError("INVALID_ARGUMENT", "Lease owner identity is too long");
  }
}

export function normalizeLeaseDuration(ttlMs?: number): number {
  const value = ttlMs ?? DEFAULT_LEASE_TTL_MS;
  if (!Number.isFinite(value) || value < MIN_LEASE_TTL_MS || value > MAX_LEASE_TTL_MS) {
    throw new HarmonyError("INVALID_ARGUMENT", `Lease TTL must be between ${MIN_LEASE_TTL_MS} and ${MAX_LEASE_TTL_MS} ms`);
  }
  return Math.round(value);
}

import type { PermissionTier } from "./approval-policy";

declare global {
  var __pioraPermissionTiers: Map<string, PermissionTier> | undefined;
}

function tiers(): Map<string, PermissionTier> {
  return globalThis.__pioraPermissionTiers ??= new Map();
}

export function setPermissionTier(sessionId: string, tier: PermissionTier): void {
  tiers().set(sessionId, tier);
}

export function getPermissionTier(sessionId: string): PermissionTier {
  return tiers().get(sessionId) ?? "auto-edit";
}

export function clearPermissionTier(sessionId: string): void {
  tiers().delete(sessionId);
}

export function inferPermissionTierFromTools(toolNames: readonly string[] | undefined): PermissionTier {
  if (!toolNames) return "auto-edit";
  const names = new Set(toolNames);
  if (![...names].some((name) => name === "bash" || name === "edit" || name === "write")) return "read-only";
  if (["bash", "read", "edit", "write", "grep", "find", "ls"].every((name) => names.has(name))) return "full-access";
  return "auto-edit";
}

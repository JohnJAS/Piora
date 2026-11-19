import { AsyncLocalStorage } from "node:async_hooks";
import type { SettingsManager } from "@earendil-works/pi-coding-agent";

/** A null reserve lets each model derive its own input budget. */
export interface CompactionThresholdSettings {
  reserveTokens: number | null;
}

interface CompactionThresholdState {
  reserveTokens: number;
  configuredReserveTokens: number | null;
}

interface CompactionSettingsManager {
  getCompactionReserveTokens(): number;
  getGlobalSettings(): ReturnType<SettingsManager["getGlobalSettings"]>;
  globalSettings: { compaction?: { reserveTokens?: number } };
  markModified(field: string, nestedKey?: string): void;
  save(): void;
  flush(): Promise<void>;
  drainErrors(): Array<{ error: Error }>;
}

export function parseCompactionThresholdSettings(value: unknown): CompactionThresholdSettings {
  const reserveTokens = (value as Partial<CompactionThresholdSettings> | null)?.reserveTokens;
  if (reserveTokens === null) return { reserveTokens: null };
  if (!Number.isInteger(reserveTokens) || (reserveTokens as number) < 0 || (reserveTokens as number) > 131_072) {
    throw new TypeError("reserveTokens must be null or an integer between 0 and 131072");
  }
  return { reserveTokens: reserveTokens as number };
}

export function readCompactionThresholdSettings(manager: Pick<CompactionSettingsManager, "getCompactionReserveTokens" | "getGlobalSettings">): CompactionThresholdState {
  return {
    reserveTokens: manager.getCompactionReserveTokens(),
    configuredReserveTokens: manager.getGlobalSettings().compaction?.reserveTokens ?? null,
  };
}

export async function applyCompactionThresholdSettings(manager: unknown, settings: CompactionThresholdSettings): Promise<CompactionThresholdState> {
  const writer = manager as CompactionSettingsManager;
  const next = settings.reserveTokens ?? undefined;
  if (writer.globalSettings.compaction?.reserveTokens !== next) {
    const compaction = writer.globalSettings.compaction ??= {};
    if (next === undefined) delete compaction.reserveTokens;
    else compaction.reserveTokens = next;
    writer.markModified("compaction", "reserveTokens");
    writer.save();
    await writer.flush();
    const errors = writer.drainErrors();
    if (errors.length) throw errors[0].error;
  }
  return readCompactionThresholdSettings(writer);
}

type CompactionPolicyManager = Pick<SettingsManager, "getCompactionSettings" | "getSettings">;
type CompactionModel = NonNullable<Parameters<SettingsManager["getCompactionSettings"]>[0]> & {
  contextWindow?: number;
  maxTokens?: number;
};
type CompactionSettings = ReturnType<SettingsManager["getCompactionSettings"]>;
interface CompactionRetentionLimit {
  manager?: CompactionPolicyManager;
  maxRecentTokens: number;
}

const globals = globalThis as typeof globalThis & {
  __pioraCompactionPolicy?: {
    installed: WeakSet<CompactionPolicyManager>;
    retention: AsyncLocalStorage<CompactionRetentionLimit>;
  };
};
const policy = globals.__pioraCompactionPolicy ??= {
  installed: new WeakSet(),
  retention: new AsyncLocalStorage(),
};

function fitCompactionBudget(manager: CompactionPolicyManager, settings: CompactionSettings, model?: CompactionModel): CompactionSettings {
  const window = model?.contextWindow ?? 0;
  if (!model || !Number.isSafeInteger(window) || window <= 0) return settings;

  const configured = manager.getSettings().compaction;
  const explicitReserve = configured?.modelOverrides?.[`${model.provider}/${model.id}`]?.reserveTokens ?? configured?.reserveTokens;
  const maxOutput = model.maxTokens ?? 0;
  const outputReserve = Math.min(21_000, Number.isSafeInteger(maxOutput) && maxOutput > 0 ? maxOutput : settings.reserveTokens);
  // Shared-budget provider requests already leave a 4K margin for input estimates.
  const safetyBuffer = Math.min(13_000, Math.max(4_096, Math.floor(window / 10)));
  // Leave room for a usable prompt on small models with large output limits.
  const automaticReserve = Math.min(Math.floor(window * 2 / 3), outputReserve + safetyBuffer);
  const reserveTokens = explicitReserve !== undefined && settings.reserveTokens < window ? settings.reserveTokens : automaticReserve;
  const inputBudget = window - reserveTokens;
  return {
    ...settings,
    reserveTokens,
    keepRecentTokens: Math.min(settings.keepRecentTokens, Math.floor(inputBudget / 2)),
  };
}

/** Use the SDK's trigger and summarizer with limits resolved against the selected model. */
export function installModelAwareCompactionSettings(manager: CompactionPolicyManager): void {
  if (policy.installed.has(manager)) return;
  const read = manager.getCompactionSettings.bind(manager);
  manager.getCompactionSettings = (model?: CompactionModel) => {
    const settings = fitCompactionBudget(manager, read(model), model);
    const limit = policy.retention.getStore();
    return limit?.manager === manager
      ? { ...settings, keepRecentTokens: Math.min(settings.keepRecentTokens, limit.maxRecentTokens) }
      : settings;
  };
  policy.installed.add(manager);
}

export async function withCompactionRetentionLimit<T>(
  manager: CompactionPolicyManager,
  maxRecentTokens: number,
  compact: () => Promise<T>,
): Promise<T> {
  installModelAwareCompactionSettings(manager);
  const scope: CompactionRetentionLimit = { manager, maxRecentTokens };
  try {
    return await policy.retention.run(scope, compact);
  } finally {
    // A callback spawned during compaction can outlive the operation.
    scope.manager = undefined;
  }
}

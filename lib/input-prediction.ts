export interface PredictionSettings {
  enabled: boolean;
  model: { provider: string; modelId: string } | null;
  timeoutMs: number;
}

export const defaultPredictionSettings = (): PredictionSettings => ({ enabled: false, model: null, timeoutMs: 30_000 });
const SETTINGS_KEY = "piora-input-prediction-v2";
const SETTINGS_EVENT = "piora:input-prediction";

export function validatePredictionSettings(value: unknown): PredictionSettings {
  const input = value as Partial<PredictionSettings> | null;
  if (!input || typeof input.enabled !== "boolean" || !Number.isInteger(input.timeoutMs)
    || input.timeoutMs! < 5_000 || input.timeoutMs! > 120_000) {
    throw new Error("Invalid prediction settings");
  }
  const model = input.model;
  if (model !== null && (!model || typeof model.provider !== "string" || !model.provider.trim() || model.provider.length > 256
    || typeof model.modelId !== "string" || !model.modelId.trim() || model.modelId.length > 256)) {
    throw new Error("Invalid prediction model");
  }
  return { enabled: input.enabled, model: model ?? null, timeoutMs: input.timeoutMs! };
}

// Require a fresh opt-in when restoring a feature that previously stopped making model calls.
const predictionSettingsKey = (cwd?: string | null) => cwd ? `${SETTINGS_KEY}:${cwd}` : SETTINGS_KEY;

export function readPredictionSettings(cwd?: string | null): PredictionSettings {
  try {
    const raw = (cwd && localStorage.getItem(predictionSettingsKey(cwd))) || localStorage.getItem(SETTINGS_KEY);
    return raw ? validatePredictionSettings(JSON.parse(raw)) : defaultPredictionSettings();
  } catch {
    return defaultPredictionSettings();
  }
}

export function savePredictionSettings(value: PredictionSettings | null, cwd?: string | null) {
  if (value) localStorage.setItem(predictionSettingsKey(cwd), JSON.stringify(validatePredictionSettings(value)));
  else localStorage.removeItem(predictionSettingsKey(cwd));
  window.dispatchEvent(new Event(SETTINGS_EVENT));
}

export function subscribePredictionSettings(refresh: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (!event.key || event.key === SETTINGS_KEY || event.key.startsWith(`${SETTINGS_KEY}:`)) refresh();
  };
  window.addEventListener(SETTINGS_EVENT, refresh);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(SETTINGS_EVENT, refresh);
    window.removeEventListener("storage", onStorage);
  };
}

/** Keep the effective text and tool context, excluding media bytes and reasoning. */
export function predictionContext(messages: unknown[]): string {
  return JSON.stringify(messages, (key, value) => key === "data" || key === "usage" || key === "thinking" ? undefined : value);
}

export function normalizePredictionText(value: string): string {
  const text = value.trim();
  // The composer interprets leading slash and bang as command entry points.
  if (/^[\/!]/.test(text) || Array.from(text).length > 1_000) return "";
  return text;
}

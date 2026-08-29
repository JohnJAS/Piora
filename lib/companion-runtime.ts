import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writePrivateFileAtomicSync } from "./atomic-file";
import {
  createDefaultCompanionPreferences,
  normalizeCompanionPreferences,
  type CompanionInteractionModel,
  type CompanionLibraryItem,
  type CompanionPreferences,
  type CompanionTodo,
} from "./companion-store";
import { getRuntimeAgentDataDirectory } from "./runtime-home";

export const COMPANION_RUNTIME_VERSION = 1;
const MAX_MEMORIES = 200;
const MAX_DECISIONS = 80;

export type CompanionMood = "calm" | "focused" | "cheerful" | "concerned" | "sleepy";
export type CompanionAutonomyLevel = "quiet" | "balanced" | "active";
export type CompanionActionKind = "speak" | "animate" | "walk" | "open-panel" | "rest";

export interface CompanionMemory {
  id: string;
  text: string;
  source: "user" | "model" | "system";
  createdAt: number;
  updatedAt: number;
}

export interface CompanionDecision {
  id: string;
  event: string;
  thoughtSummary: string;
  mood: CompanionMood;
  speech: string;
  actions: Array<{
    kind: CompanionActionKind;
    animation?: string;
    direction?: "left" | "right";
    distance?: number;
  }>;
  observedFacts: string[];
  nextThinkAfterSeconds: number;
  createdAt: number;
}

export interface CompanionRuntimeSettings {
  interactionModel: CompanionInteractionModel | null;
  shareWorkContext: boolean;
  autonomyLevel: CompanionAutonomyLevel;
  autonomyPaused: boolean;
  personality: string;
  quietHours: { enabled: boolean; start: string; end: string };
  allowMovement: boolean;
  allowProactiveSpeech: boolean;
}

export interface CompanionRuntimeState {
  version: typeof COMPANION_RUNTIME_VERSION;
  updatedAt: number;
  migratedFromLocalStorage: boolean;
  settings: CompanionRuntimeSettings;
  todos: CompanionTodo[];
  library: CompanionLibraryItem[];
  memories: CompanionMemory[];
  mind: {
    mood: CompanionMood;
    lastDecision: CompanionDecision | null;
    decisionHistory: CompanionDecision[];
    nextWakeAt: number | null;
  };
}

type RuntimeListener = (state: CompanionRuntimeState, reason: string) => void;

declare global {
  var __pioraCompanionRuntimeListeners: Set<RuntimeListener> | undefined;
}

function runtimePath(): string {
  return join(getRuntimeAgentDataDirectory(), "piora", "companion-runtime.json");
}

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function safeId(value: unknown, prefix: string): string {
  const id = cleanText(value, 120);
  return /^[a-zA-Z0-9._:-]+$/.test(id) ? id : `${prefix}:${crypto.randomUUID()}`;
}

function defaultSettings(preferences = createDefaultCompanionPreferences()): CompanionRuntimeSettings {
  return {
    interactionModel: preferences.interactionModel,
    shareWorkContext: preferences.shareWorkContext,
    autonomyLevel: "balanced",
    autonomyPaused: false,
    personality: "温暖、聪明、克制；关注事实，不打断专注。",
    quietHours: { enabled: false, start: "22:30", end: "08:00" },
    allowMovement: true,
    allowProactiveSpeech: true,
  };
}

export function createDefaultCompanionRuntimeState(now = Date.now()): CompanionRuntimeState {
  return {
    version: COMPANION_RUNTIME_VERSION,
    updatedAt: now,
    migratedFromLocalStorage: false,
    settings: defaultSettings(),
    todos: [],
    library: [],
    memories: [],
    mind: { mood: "calm", lastDecision: null, decisionHistory: [], nextWakeAt: null },
  };
}

function normalizeDecision(value: unknown): CompanionDecision | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const moods: CompanionMood[] = ["calm", "focused", "cheerful", "concerned", "sleepy"];
  const mood = moods.includes(source.mood as CompanionMood) ? source.mood as CompanionMood : "calm";
  const actionKinds: CompanionActionKind[] = ["speak", "animate", "walk", "open-panel", "rest"];
  const actions = Array.isArray(source.actions) ? source.actions.slice(0, 4).flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const action = candidate as Record<string, unknown>;
    if (!actionKinds.includes(action.kind as CompanionActionKind)) return [];
    return [{
      kind: action.kind as CompanionActionKind,
      ...(cleanText(action.animation, 40) ? { animation: cleanText(action.animation, 40) } : {}),
      ...(action.direction === "left" || action.direction === "right"
        ? { direction: action.direction as "left" | "right" }
        : {}),
      ...(typeof action.distance === "number" && Number.isFinite(action.distance)
        ? { distance: Math.max(12, Math.min(320, Math.round(action.distance))) }
        : {}),
    }];
  }) : [];
  return {
    id: safeId(source.id, "decision"),
    event: cleanText(source.event, 80) || "unknown",
    thoughtSummary: cleanText(source.thoughtSummary, 280),
    mood,
    speech: cleanText(source.speech, 240),
    actions,
    observedFacts: Array.isArray(source.observedFacts)
      ? source.observedFacts.slice(0, 8).map((item) => cleanText(item, 160)).filter(Boolean)
      : [],
    nextThinkAfterSeconds: typeof source.nextThinkAfterSeconds === "number"
      ? Math.max(30, Math.min(3600, Math.round(source.nextThinkAfterSeconds)))
      : 300,
    createdAt: typeof source.createdAt === "number" && Number.isFinite(source.createdAt)
      ? source.createdAt
      : Date.now(),
  };
}

export function normalizeCompanionRuntimeState(value: unknown): CompanionRuntimeState {
  const fallback = createDefaultCompanionRuntimeState();
  if (!value || typeof value !== "object") return fallback;
  const source = value as Record<string, unknown>;
  if (source.version !== COMPANION_RUNTIME_VERSION) return fallback;
  const legacy = normalizeCompanionPreferences({
    ...createDefaultCompanionPreferences(),
    version: 4,
    todos: source.todos,
    library: source.library,
  });
  const settings = source.settings && typeof source.settings === "object"
    ? source.settings as Record<string, unknown>
    : {};
  const model = settings.interactionModel && typeof settings.interactionModel === "object"
    ? settings.interactionModel as Record<string, unknown>
    : null;
  const validModel = model && cleanText(model.provider, 120) && cleanText(model.modelId, 240)
    ? { provider: cleanText(model.provider, 120), modelId: cleanText(model.modelId, 240) }
    : null;
  const levels: CompanionAutonomyLevel[] = ["quiet", "balanced", "active"];
  const quiet = settings.quietHours && typeof settings.quietHours === "object"
    ? settings.quietHours as Record<string, unknown>
    : {};
  const rawMemories = Array.isArray(source.memories) ? source.memories : [];
  const memories = rawMemories.slice(0, MAX_MEMORIES).flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Record<string, unknown>;
    const text = cleanText(item.text, 1000);
    if (!text) return [];
    const createdAt = typeof item.createdAt === "number" ? item.createdAt : Date.now();
    return [{
      id: safeId(item.id, "memory"),
      text,
      source: (item.source === "model" || item.source === "system" ? item.source : "user") as CompanionMemory["source"],
      createdAt,
      updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : createdAt,
    }];
  });
  const mind = source.mind && typeof source.mind === "object" ? source.mind as Record<string, unknown> : {};
  const history = Array.isArray(mind.decisionHistory)
    ? mind.decisionHistory.map(normalizeDecision).filter((item): item is CompanionDecision => Boolean(item)).slice(0, MAX_DECISIONS)
    : [];
  const lastDecision = normalizeDecision(mind.lastDecision) ?? history[0] ?? null;
  return {
    version: COMPANION_RUNTIME_VERSION,
    updatedAt: typeof source.updatedAt === "number" ? source.updatedAt : Date.now(),
    migratedFromLocalStorage: source.migratedFromLocalStorage === true,
    settings: {
      interactionModel: validModel,
      shareWorkContext: settings.shareWorkContext !== false,
      autonomyLevel: levels.includes(settings.autonomyLevel as CompanionAutonomyLevel)
        ? settings.autonomyLevel as CompanionAutonomyLevel
        : "balanced",
      autonomyPaused: settings.autonomyPaused === true,
      personality: cleanText(settings.personality, 600) || fallback.settings.personality,
      quietHours: {
        enabled: quiet.enabled === true,
        start: /^\d{2}:\d{2}$/.test(String(quiet.start)) ? String(quiet.start) : "22:30",
        end: /^\d{2}:\d{2}$/.test(String(quiet.end)) ? String(quiet.end) : "08:00",
      },
      allowMovement: settings.allowMovement !== false,
      allowProactiveSpeech: settings.allowProactiveSpeech !== false,
    },
    todos: legacy.todos,
    library: legacy.library,
    memories,
    mind: {
      mood: lastDecision?.mood ?? "calm",
      lastDecision,
      decisionHistory: history,
      nextWakeAt: typeof mind.nextWakeAt === "number" && Number.isFinite(mind.nextWakeAt) ? mind.nextWakeAt : null,
    },
  };
}

export function readCompanionRuntimeState(): CompanionRuntimeState {
  try {
    return normalizeCompanionRuntimeState(JSON.parse(readFileSync(runtimePath(), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn("Unable to read companion runtime", error);
    return createDefaultCompanionRuntimeState();
  }
}

function publish(state: CompanionRuntimeState, reason: string): void {
  for (const listener of globalThis.__pioraCompanionRuntimeListeners ?? []) {
    try { listener(state, reason); }
    catch { globalThis.__pioraCompanionRuntimeListeners?.delete(listener); }
  }
}

export function writeCompanionRuntimeState(state: CompanionRuntimeState, reason = "state.updated"): CompanionRuntimeState {
  const normalized = normalizeCompanionRuntimeState({ ...state, updatedAt: Date.now() });
  mkdirSync(dirname(runtimePath()), { recursive: true });
  writePrivateFileAtomicSync(runtimePath(), `${JSON.stringify(normalized, null, 2)}\n`);
  publish(normalized, reason);
  return normalized;
}

export function updateCompanionRuntimeState(
  mutate: (current: CompanionRuntimeState) => CompanionRuntimeState,
  reason?: string,
): CompanionRuntimeState {
  return writeCompanionRuntimeState(mutate(readCompanionRuntimeState()), reason);
}

export function migrateCompanionPreferences(preferences: CompanionPreferences): CompanionRuntimeState {
  const normalized = normalizeCompanionPreferences(preferences);
  return updateCompanionRuntimeState((current) => ({
    ...current,
    migratedFromLocalStorage: true,
    settings: {
      ...current.settings,
      interactionModel: normalized.interactionModel,
      shareWorkContext: normalized.shareWorkContext,
    },
    todos: current.todos.length ? current.todos : normalized.todos,
    library: current.library.length ? current.library : normalized.library,
  }), "state.migrated");
}

export function recordCompanionDecision(decision: CompanionDecision): CompanionRuntimeState {
  const safe = normalizeDecision(decision);
  if (!safe) return readCompanionRuntimeState();
  return updateCompanionRuntimeState((current) => ({
    ...current,
    mind: {
      mood: safe.mood,
      lastDecision: safe,
      decisionHistory: [safe, ...current.mind.decisionHistory.filter((item) => item.id !== safe.id)].slice(0, MAX_DECISIONS),
      nextWakeAt: Date.now() + safe.nextThinkAfterSeconds * 1000,
    },
  }), "mind.decision");
}

export function subscribeCompanionRuntime(listener: RuntimeListener): () => void {
  const listeners = globalThis.__pioraCompanionRuntimeListeners ??= new Set();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

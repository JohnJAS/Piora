export const COMPANION_STORAGE_KEY = "pi-companion-preferences-v1";
export const COMPANION_SCHEMA_VERSION = 3;
export const DEFAULT_COMPANION_PET_ID = "pekka-pal.codex-pet";
export const BUNDLED_COMPANION_PETS_PUBLIC_PATH = "/companion-pets/bundled";
export const MAX_COMPANION_TODOS = 100;
export const MAX_COMPANION_PHRASES = 24;

const MAX_TODO_LENGTH = 240;
const MAX_PHRASE_LABEL_LENGTH = 40;
const MAX_PHRASE_TEXT_LENGTH = 2_000;

export interface CompanionTodo {
  id: string;
  text: string;
  completed: boolean;
  createdAt: number;
}

export interface CompanionQuickPhrase {
  id: string;
  label: string;
  text: string;
}

export interface CompanionPreferences {
  version: typeof COMPANION_SCHEMA_VERSION;
  open: boolean;
  alwaysOnTop: boolean;
  selectedPetId: string;
  todos: CompanionTodo[];
  phrases: CompanionQuickPhrase[];
  idleTricks: boolean;
}

export interface CompanionPhraseSeed {
  label: string;
  text: string;
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function safeId(value: unknown, fallback: string): string {
  const id = cleanText(value, 120);
  return /^[a-zA-Z0-9._:-]+$/.test(id) ? id : fallback;
}

export function createCompanionId(prefix: "todo" | "phrase"): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}:${uuid ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`;
}

export function createDefaultCompanionPreferences(seeds: CompanionPhraseSeed[] = []): CompanionPreferences {
  return {
    version: COMPANION_SCHEMA_VERSION,
    open: false,
    alwaysOnTop: true,
    selectedPetId: DEFAULT_COMPANION_PET_ID,
    todos: [],
    phrases: seeds.slice(0, MAX_COMPANION_PHRASES).flatMap((seed, index) => {
      const label = cleanText(seed.label, MAX_PHRASE_LABEL_LENGTH);
      const text = cleanText(seed.text, MAX_PHRASE_TEXT_LENGTH);
      return label && text ? [{ id: `phrase:default-${index + 1}`, label, text }] : [];
    }),
    idleTricks: true,
  };
}

// v1/v2 data migrates forward so existing todos/phrases survive while the
// removed care-loop timestamps are discarded. Anything newer is rejected.
const SUPPORTED_SCHEMA_VERSIONS = new Set([1, 2, COMPANION_SCHEMA_VERSION]);

export function normalizeCompanionPreferences(
  value: unknown,
  fallback: CompanionPreferences = createDefaultCompanionPreferences(),
): CompanionPreferences {
  if (!value || typeof value !== "object") return fallback;
  const record = value as Record<string, unknown>;
  if (!SUPPORTED_SCHEMA_VERSIONS.has(record.version as number)) return fallback;
  const rawTodos = Array.isArray(record.todos) ? record.todos : [];
  const todos = rawTodos.slice(0, MAX_COMPANION_TODOS).flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== "object") return [];
    const todo = candidate as Record<string, unknown>;
    const text = cleanText(todo.text, MAX_TODO_LENGTH);
    if (!text) return [];
    return [{
      id: safeId(todo.id, `todo:restored-${index + 1}`),
      text,
      completed: todo.completed === true,
      createdAt: typeof todo.createdAt === "number" && Number.isFinite(todo.createdAt)
        ? todo.createdAt
        : 0,
    }];
  });

  const rawPhrases = Array.isArray(record.phrases) ? record.phrases : [];
  const phrases = rawPhrases.slice(0, MAX_COMPANION_PHRASES).flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== "object") return [];
    const phrase = candidate as Record<string, unknown>;
    const label = cleanText(phrase.label, MAX_PHRASE_LABEL_LENGTH);
    const text = cleanText(phrase.text, MAX_PHRASE_TEXT_LENGTH);
    if (!label || !text) return [];
    return [{ id: safeId(phrase.id, `phrase:restored-${index + 1}`), label, text }];
  });

  return {
    version: COMPANION_SCHEMA_VERSION,
    open: record.open === true,
    alwaysOnTop: record.alwaysOnTop !== false,
    selectedPetId: safeId(record.selectedPetId, "builtin"),
    todos,
    phrases,
    idleTricks: record.idleTricks !== false,
  };
}

export function parseCompanionPreferences(
  raw: string | null,
  fallback: CompanionPreferences = createDefaultCompanionPreferences(),
): CompanionPreferences {
  if (!raw) return fallback;
  try {
    return normalizeCompanionPreferences(JSON.parse(raw), fallback);
  } catch {
    return fallback;
  }
}

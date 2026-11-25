export const RUNTIME_PROMPT_EXTENSION_KEYS = [
  "browser",
  "automations",
  "userInput",
  "fileTools",
  "fileReferences",
  "subagents",
  "ssh",
  "harmony",
  "computer",
  "room",
  "meme",
] as const;

export type RuntimePromptExtensionKey = (typeof RUNTIME_PROMPT_EXTENSION_KEYS)[number];

export interface RuntimePromptSettings {
  version: 1;
  mergeCompact: boolean;
  alignCliCompaction: boolean;
  extensions: Record<RuntimePromptExtensionKey, boolean>;
}

export interface RuntimePromptSettingsPatch {
  mergeCompact?: boolean;
  alignCliCompaction?: boolean;
  extensions?: Partial<Record<RuntimePromptExtensionKey, boolean>>;
}

export const DEFAULT_RUNTIME_PROMPT_SETTINGS: RuntimePromptSettings = {
  version: 1,
  mergeCompact: true,
  alignCliCompaction: true,
  extensions: {
    browser: true,
    automations: false,
    userInput: false,
    fileTools: false,
    fileReferences: false,
    subagents: true,
    ssh: true,
    harmony: false,
    computer: true,
    room: false,
    meme: false,
  },
};

export function createDefaultRuntimePromptSettings(): RuntimePromptSettings {
  return {
    version: 1,
    mergeCompact: DEFAULT_RUNTIME_PROMPT_SETTINGS.mergeCompact,
    alignCliCompaction: DEFAULT_RUNTIME_PROMPT_SETTINGS.alignCliCompaction,
    extensions: { ...DEFAULT_RUNTIME_PROMPT_SETTINGS.extensions },
  };
}

export function createCliAlignedPresetSettings(): RuntimePromptSettings {
  return {
    version: 1,
    mergeCompact: true,
    alignCliCompaction: true,
    extensions: {
      browser: false,
      automations: false,
      userInput: false,
      fileTools: false,
      fileReferences: false,
      subagents: false,
      ssh: false,
      harmony: false,
      computer: false,
      room: false,
      meme: false,
    },
  };
}

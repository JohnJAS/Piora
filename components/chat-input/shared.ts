import type { AttachedFile } from "@/hooks/useAgentSession";
import type { ChatDraftFile, ChatDraftImage } from "@/lib/draft-store";
import { MAX_ATTACHED_IMAGES, isBase64ImageWithinLimits } from "@/lib/image-attachments";
import { MAX_PROMPT_MATERIAL_COUNT } from "@/lib/prompt-input-policy";
import type { SlashCommandSource } from "@/lib/commands";

export const MAX_ATTACHED_FILES = MAX_PROMPT_MATERIAL_COUNT;
export const COMPOSER_MAX_HEIGHT = 360;
export const COMPOSITION_END_ENTER_GRACE_MS = 100;
export const MODEL_FILTER_THRESHOLD = 8;

const IGNORED_NESTED_ATTACHMENT_DIRECTORIES = new Set([".git", ".next", "node_modules"]);

export type BrowserAttachmentFile = Pick<File, "name"> & { webkitRelativePath?: string };

export interface AttachedImage {
  data: string; // base64, no prefix
  mimeType: string;
  previewUrl: string; // object URL for display
}

export interface ModelOption {
  provider: string;
  modelId: string;
  name: string;
  isDefault?: boolean;
}

export interface PromptOptimizationState {
  source: string;
  loading: boolean;
  result?: string;
  error?: string;
}

export const THINKING_LEVELS = ["auto", "off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevel = typeof THINKING_LEVELS[number];
export type ModelMenuSection = "models" | "reasoning" | null;

export const THINKING_LEVEL_DESC_KEYS: Record<ThinkingLevel, string> = {
  auto: "chat.thinkingUseDefault",
  off: "chat.thinkingOff",
  minimal: "chat.thinkingMinimal",
  low: "chat.thinkingLow",
  medium: "chat.thinkingMedium",
  high: "chat.thinkingHigh",
  xhigh: "chat.thinkingXhigh",
  max: "chat.thinkingMax",
};

export const THINKING_LEVEL_LABEL_KEYS: Record<ThinkingLevel, string> = {
  auto: "chat.thinkingLevelAuto",
  off: "chat.thinkingLevelOff",
  minimal: "chat.thinkingLevelMinimal",
  low: "chat.thinkingLevelLow",
  medium: "chat.thinkingLevelMedium",
  high: "chat.thinkingLevelHigh",
  xhigh: "chat.thinkingLevelXhigh",
  max: "chat.thinkingLevelMax",
};

export const SLASH_SOURCES: SlashCommandSource[] = ["builtin", "extension", "prompt", "skill"];

export const SLASH_SOURCE_GROUP_LABEL_KEYS: Record<SlashCommandSource, string> = {
  builtin: "chat.builtIn",
  extension: "chat.extensions",
  prompt: "chat.prompts",
  skill: "chat.skills",
};

function normalizedAttachmentPath(file: BrowserAttachmentFile): string[] {
  return (file.webkitRelativePath ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment && segment !== "." && segment !== "..");
}

export function getAttachmentFileName(file: BrowserAttachmentFile): string {
  const relativePath = normalizedAttachmentPath(file).join("/");
  return relativePath || file.name;
}

export function isFolderAttachmentFileAllowed(file: BrowserAttachmentFile): boolean {
  const pathSegments = normalizedAttachmentPath(file);
  // The first segment is the folder the user explicitly selected. Only skip
  // hidden/generated directories nested inside that explicit selection.
  return !pathSegments.slice(1, -1).some((segment) => (
    segment.startsWith(".") || IGNORED_NESTED_ATTACHMENT_DIRECTORIES.has(segment.toLocaleLowerCase())
  ));
}

export function resizeComposerTextarea(textarea: HTMLTextAreaElement): void {
  textarea.style.height = "auto";
  const viewportLimit = typeof window === "undefined" ? COMPOSER_MAX_HEIGHT : Math.round(window.innerHeight * 0.38);
  textarea.style.height = `${Math.min(textarea.scrollHeight, Math.max(200, Math.min(COMPOSER_MAX_HEIGHT, viewportLimit)))}px`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function joinSpeechText(before: string, transcript: string, after: string, language: string): {
  value: string;
  selection: number;
} {
  const text = transcript.trim();
  if (!text) return { value: before + after, selection: before.length };

  // Mandarin dictation does not normally use spaces between phrases. For
  // space-delimited languages, keep dictated text readable when inserted at
  // the caret in the middle of an existing prompt.
  const usesWordSpaces = !language.toLocaleLowerCase().startsWith("zh");
  const leadingSpace = usesWordSpaces && before.length > 0 && !/\s$/.test(before) ? " " : "";
  const trailingSpace = usesWordSpaces && after.length > 0 && !/^\s/.test(after) ? " " : "";
  const inserted = leadingSpace + text + trailingSpace;
  return {
    value: before + inserted + after,
    selection: before.length + inserted.length - trailingSpace.length,
  };
}

export function filterModelOptions(options: ModelOption[], query: string): ModelOption[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return options;

  return options.filter((option) => (
    `${option.name} ${option.modelId}`
      .toLocaleLowerCase()
      .includes(normalizedQuery)
  ));
}

export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return tokens.toLocaleString();
}

export function getContextRemainingPercent(
  usage: { percent: number | null; contextWindow: number; tokens: number | null } | null | undefined,
): number | null {
  if (!usage || usage.contextWindow <= 0) return null;
  const usedPercent = usage.tokens !== null
    ? (usage.tokens / usage.contextWindow) * 100
    : usage.percent;
  if (usedPercent === null || !Number.isFinite(usedPercent)) return null;
  return Math.max(0, Math.min(100, 100 - usedPercent));
}

export function imageToDraftImage(image: AttachedImage): ChatDraftImage {
  return { data: image.data, mimeType: image.mimeType };
}

export function draftImageToAttachedImage(image: ChatDraftImage): AttachedImage {
  return {
    ...image,
    previewUrl: `data:${image.mimeType};base64,${image.data}`,
  };
}

export function draftImagesToAttachedImages(images: ChatDraftImage[] | undefined): AttachedImage[] {
  return (images ?? [])
    .filter(isBase64ImageWithinLimits)
    .slice(0, MAX_ATTACHED_IMAGES)
    .map(draftImageToAttachedImage);
}

export function attachedFileToDraftFile(file: AttachedFile): ChatDraftFile {
  return { ...file };
}

export function draftFilesToAttachedFiles(files: ChatDraftFile[] | undefined): AttachedFile[] {
  return (files ?? []).slice(0, MAX_ATTACHED_FILES).map((file) => ({ ...file }));
}

export function revokeImagePreview(image: AttachedImage): void {
  if (image.previewUrl.startsWith("blob:")) {
    URL.revokeObjectURL(image.previewUrl);
  }
}

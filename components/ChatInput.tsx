"use client";
import { ToolPermissionControl } from "./ToolPermissionControl";
import type { PermissionMode, ToolPermissionState } from "@/lib/tool-permission-policy";
import type { ComposerActivity } from "@/lib/character-director-state";

import React, { useRef, useState, useCallback, useEffect, useImperativeHandle, forwardRef, KeyboardEvent } from "react";
import { useReplyDraft } from "@/hooks/useReplyDraft";
import { useReplySuggestions } from "@/hooks/useReplySuggestions";
import { useInputPrediction } from "@/hooks/useInputPrediction";
import { ReplySuggestionBar } from "./ReplySuggestionBar";
import type { ReplySource } from "@/lib/reply-suggestions";
import type { AttachedFile, BuiltinSlashCommandResult, CompactResultInfo, SlashCommandInfo } from "@/hooks/useAgentSession";
import type { ChatCommandCatalog, ChatInputOptions } from "@/lib/chat-command-types";
import { createChatCommandCatalog, parseChatInput } from "@/lib/chat-command-input";
import commandStyles from "./ChatCommandComposer.module.css";
import { storeBrowserFiles } from "@/lib/file-attachments";
import { clearDraft, getDraft, setDraft, hydrateDraft, deferDraftPersistence, DRAFT_STORAGE_ERROR_EVENT } from "@/lib/draft-store";
import {
  MAX_ATTACHED_IMAGE_BYTES,
  MAX_ATTACHED_IMAGE_TOTAL_BYTES,
  MAX_ATTACHED_IMAGES,
  getBase64DecodedByteLength,
} from "@/lib/image-attachments";
import {
  LARGE_PASTE_CHARACTER_THRESHOLD,
  MAX_ATTACHED_FILE_BYTES,
  MAX_PROMPT_MATERIAL_BYTES,
  shouldMaterializeDirectPrompt,
} from "@/lib/prompt-input-policy";
import { ModelChangeCoordinator } from "@/lib/model-change-coordinator";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import { useApplicationShortcuts } from "@/hooks/useApplicationShortcuts";
import { useLocalDictation } from "@/hooks/useLocalDictation";
import { isPlainEnter, matchesSendShortcut } from "@/lib/send-shortcut";
import { useRunningSendMode } from "@/hooks/useRunningSendMode";
import { useSendShortcut } from "@/hooks/useSendShortcut";
import { formatShortcutBinding, isMacPlatform, shortcutMatchesEvent, shouldPreserveApplicationShortcut } from "@/lib/keyboard-shortcuts";
import { AliIcon } from "./AliIcon";
import type { ContextUsage, SessionStatsInfo } from "@/lib/pi-types";
import type { ExtensionStatusItem } from "@/lib/types";
import { ExtensionStatusBar } from "./ExtensionStatusBar";
import { WorkflowModePills } from "./workflow/WorkflowModePills";
import { useComposerWorkflow, type PausedGoalPendingSubmission } from "./workflow/useComposerWorkflow";
import { parseSideSlashTrigger } from "@/lib/side-chat/composer-trigger";
import { DEFAULT_WORKFLOW_TURN_BUDGET, type WorkflowMode, type WorkflowPromptOptions } from "@/lib/workflow-types";
import {
  buildSlashCommandRegistry,
  filterSlashCommandRegistry,
  getSlashCommandDescription,
  type SlashCommandPaletteItem,
  type SlashCommandSource,
} from "@/lib/commands";
import {
  COMPOSITION_END_ENTER_GRACE_MS,
  MAX_ATTACHED_FILES,
  MODEL_FILTER_THRESHOLD,
  SLASH_SOURCES,
  THINKING_LEVEL_LABEL_KEYS,
  attachedFileToDraftFile,
  draftFilesToAttachedFiles,
  draftImagesToAttachedImages,
  filterModelOptions,
  getAttachmentFileName,
  getContextRemainingPercent,
  imageToDraftImage,
  isFolderAttachmentFileAllowed,
  joinSpeechText,
  resizeComposerTextarea,
  revokeImagePreview,
  type AttachedImage,
  type ModelMenuSection,
  type ModelOption,
  type ThinkingLevel,
} from "./chat-input/shared";
import {
  ComposerAttachmentsBar,
  ComposerStatusBanners,
  ModelErrorBanner,
  PromptOptimizationReview,
} from "./chat-input/ComposerBanners";
import { FileMentionMenu, InputHistoryMenu, SlashCommandMenu } from "./chat-input/ComposerMenus";
import { ContextUsageRing, SessionStatsBadge } from "./chat-input/ComposerMetrics";
import { ModelSettingsMenu } from "./chat-input/ModelSettingsMenu";
import {
  AttachmentAddMenu,
  StreamingSubmitControl,
  VoiceInputControl,
} from "./chat-input/ComposerFooterControls";
import { useFileMentionAutocomplete } from "./chat-input/useFileMentionAutocomplete";
import { usePromptOptimization } from "./chat-input/usePromptOptimization";
import { useSendModePopover } from "./chat-input/useSendModePopover";

export {
  ModelErrorBanner,
  filterModelOptions,
  getAttachmentFileName,
  getContextRemainingPercent,
  isFolderAttachmentFileAllowed,
  joinSpeechText,
  type AttachedImage,
};

interface Props {
  replySource?: ReplySource | null;
  predictionActive?: boolean;
  onSend: (message: string, images?: AttachedImage[], files?: AttachedFile[], onDurable?: (clientPromptId?: string) => void, retryOfPromptIds?: string[], inputOptions?: ChatInputOptions) => boolean | void | Promise<boolean | void>;
  onQueueInput?: (message: string, images?: AttachedImage[], files?: AttachedFile[], onDurable?: (clientPromptId?: string) => void, inputOptions?: ChatInputOptions, retryOfPromptIds?: string[]) => Promise<boolean>;
  commandCatalog?: ChatCommandCatalog;
  slashCommandsError?: string | null;
  onAbort: () => void;
  onSteer?: (message: string, images?: AttachedImage[]) => boolean | void | Promise<boolean | void>;
  onFollowUp?: (message: string, images?: AttachedImage[]) => boolean | void | Promise<boolean | void>;
  onPromptWithStreamingBehavior?: (message: string, behavior: "steer" | "followUp", images?: AttachedImage[]) => boolean | void | Promise<boolean | void>;
  isStreaming: boolean;
  /** Block submissions while the launch workspace is unavailable, without hiding model selection. */
  sendDisabled?: boolean;
  model?: { provider: string; modelId: string } | null;
  isAutoModelSelection?: boolean;
  modelNames?: Record<string, string>;
  modelList?: { id: string; name: string; provider: string; contextWindow?: number; isDefault?: boolean }[];
  modelError?: string | null;
  onModelChange?: (provider: string, modelId: string) => Promise<boolean>;
  onCompact?: () => void;
  onAbortCompaction?: () => void;
  isCompacting?: boolean;
  compactionStartedAt?: number | null;
  compactError?: string | null;
  onDismissCompactError?: () => void;
  compactResult?: CompactResultInfo | null;
  onDismissCompactResult?: () => void;
  thinkingLevel?: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  onThinkingLevelChange?: (level: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max") => void;
  availableThinkingLevels?: string[] | null;
  thinkingLevelMap?: Record<string, string | null> | null;
  retryInfo?: { attempt: number; maxAttempts: number; errorMessage?: string } | null;
  inputHistory?: string[];
  slashCommands?: SlashCommandInfo[];
  slashCommandsLoading?: boolean;
  onLoadSlashCommands?: () => Promise<SlashCommandInfo[]> | SlashCommandInfo[];
  onBuiltinCommand?: (message: string) => Promise<BuiltinSlashCommandResult>;
  draftKey?: string;
  /** Session working directory — enables the @ file autocomplete menu */
  cwd?: string | null;
  contextUsage?: ContextUsage | null;
  sessionStats?: SessionStatsInfo | null;
  extensionStatuses?: ExtensionStatusItem[];
  /** Reuses the production composer in a spacious new-task launch surface. */
  variant?: "conversation" | "launcher";
  placeholder?: string;
  /** Optional project and prompt controls rendered above the input surface. */
  contextControl?: React.ReactNode;
  /** Compact session options inside the input toolbar. */
  toolbarControl?: React.ReactNode;
  /** Pending submissions aligned with the input surface below its context controls. */
  queueContent?: React.ReactNode;
  workflow?: WorkflowPromptOptions;
  workflowEnabled?: boolean;
  workflowBusy?: boolean;
  hasActiveGoal?: boolean;
  hasPausedGoal?: boolean;
  workflowAutoContinuing?: boolean;
  onWorkflowModeChange?: (mode: WorkflowMode) => void;
  onRequestGoalReplace?: (inlineObjective?: string) => void;
  onRequestPausedGoalResume?: (pending: PausedGoalPendingSubmission) => void;
  toolPermission?: ToolPermissionState | null;
  permissionSaving?: boolean;
  onToolPermissionChange?: (mode: PermissionMode) => void;
  onCharacterActivity?: (activity: ComposerActivity) => void;
  surfacePlacement?: "main" | "side";
  sideChatEnabled?: boolean;
  canOpenSideChat?: boolean;
  onOpenSideChat?: (initialPrompt?: string) => Promise<import("./side-chat/useSideChatController").OpenSideChatResult | void> | import("./side-chat/useSideChatController").OpenSideChatResult | void;
}

export interface ChatInputHandle {
  focus: () => void;
  submit: () => void;
  insertText: (text: string) => void;
  insertQuotedText: (quoted: string) => void;
  insertIfEmpty: (text: string) => void;
  prependText: (text: string, retryOfPromptIds?: string[]) => void;
  addImages: (files: File[]) => void;
  addFiles: (files: File[]) => void;
  restoreFailedPrompt: (text: string, files?: AttachedFile[], images?: AttachedImage[]) => void;
  /** Send a separate local UI shortcut without replacing the user's draft. */
  sendText: (text: string) => boolean;
  restoreCommandDraft: (draft: import("@/lib/draft-store").ChatDraft) => boolean;
  toggleVoiceInput: () => void;
  togglePlanMode: () => void;
  enterGoalDraftMode: (inlineObjective?: string) => void;
  clearGoalDraftMode: () => void;
}

export const ChatInput = React.memo(forwardRef<ChatInputHandle, Props>(function ChatInput({
  onSend, onAbort, onSteer, onFollowUp, isStreaming, sendDisabled = false, model, isAutoModelSelection, modelNames, modelList, modelError, onModelChange,
  onCompact, onAbortCompaction, isCompacting, compactionStartedAt = null, compactError, onDismissCompactError, compactResult, onDismissCompactResult,
  thinkingLevel, onThinkingLevelChange, availableThinkingLevels, thinkingLevelMap,
  retryInfo, inputHistory = [],
  slashCommands, slashCommandsLoading, onLoadSlashCommands,
  onBuiltinCommand,
  onPromptWithStreamingBehavior,
  onQueueInput, commandCatalog, slashCommandsError,
  draftKey,
  cwd,
  contextUsage,
  sessionStats,
  extensionStatuses = [],
  variant = "conversation",
  placeholder,
  contextControl, toolbarControl, queueContent,
  workflow, workflowBusy = false, workflowEnabled = true,
  hasActiveGoal = false, hasPausedGoal = false, workflowAutoContinuing = false,
  onWorkflowModeChange, onRequestGoalReplace, onRequestPausedGoalResume,
  toolPermission, permissionSaving, onToolPermissionChange, onCharacterActivity,
  surfacePlacement = "main", sideChatEnabled = false, canOpenSideChat = false, onOpenSideChat,
  replySource = null,
  predictionActive = true,
}: Props, ref) {
  const { t, locale } = useI18n();
  const { mode: defaultSendMode } = useRunningSendMode();
  const runningSendMode = defaultSendMode;
  const {
    sendModeMenuId,
    sendModeMenuRef,
    sendModeButtonRef,
    sendModeHoverDismissedRef,
    keepSendModeOpen,
    closeSendModeMenu,
    scheduleSendModeClose,
    openSendModeMenu,
  } = useSendModePopover();
  const { shortcut: sendShortcut, newlineShortcut } = useSendShortcut();
  const isMobile = useIsMobile();
  const { bindings: applicationShortcutBindings } = useApplicationShortcuts();
  const voiceInputBinding = applicationShortcutBindings["composer.voiceInput"];
  const voiceInputShortcut = formatShortcutBinding(
    voiceInputBinding,
    isMacPlatform(typeof window === "undefined" ? undefined : window.piDesktop?.platform),
  );
  const { draft: replyDraft, current: replyDraftRef, setValue, commit: commitReplyDraft, reset: resetReplyDraft, undo: undoReplyDraft } = useReplyDraft(() => {
    const saved = draftKey ? getDraft(draftKey) : null;
    return { value: saved?.value ?? "", spans: saved?.replySpans ?? [] };
  });
  const value = replyDraft.value;
  const [commandInputOptions, setCommandInputOptions] = useState<ChatInputOptions>(() => draftKey ? getDraft(draftKey)?.commandInput ?? {} : {});
  const commandInputOptionsRef = useRef(commandInputOptions);
  commandInputOptionsRef.current = commandInputOptions;
  const authoritativeWorkflowMode = workflow?.mode;
  const authoritativeWorkflowBudget = workflow?.turnBudget;
  useEffect(() => {
    if (workflowEnabled) return;
    setCommandInputOptions(current => {
      if (!current.workflow) return current;
      const next = { ...current }; delete next.workflow; return next;
    });
  }, [workflowEnabled, commandInputOptions.workflow]);
  useEffect(() => {
    // Keep a just-sent selection visible until the authoritative snapshot catches
    // up. Then release the draft override so Plan exit/approval can change mode.
    if (!authoritativeWorkflowMode) return;
    setCommandInputOptions(current => {
      if (current.workflow?.mode !== authoritativeWorkflowMode
        || (current.workflow.turnBudget ?? DEFAULT_WORKFLOW_TURN_BUDGET) !== (authoritativeWorkflowBudget ?? DEFAULT_WORKFLOW_TURN_BUDGET)) return current;
      const next = { ...current };
      delete next.workflow;
      return next;
    });
  }, [authoritativeWorkflowMode, authoritativeWorkflowBudget]);
  const parsedCommandInput = parseChatInput(value, commandCatalog ?? createChatCommandCatalog(slashCommands ?? []), commandInputOptions);
  const isCommandInput = parsedCommandInput.kind !== "message";
  const suggestions = useReplySuggestions(isStreaming || isCompacting ? null : replySource, locale);
  const [hydratedDraftKey, setHydratedDraftKey] = useState<string | undefined>(undefined);
  const [draftStorageError, setDraftStorageError] = useState(false);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [modelDropdownRect, setModelDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const [modelMenuSection, setModelMenuSection] = useState<ModelMenuSection>(null);
  const [modelFilter, setModelFilter] = useState("");
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>(() => (
    draftKey ? draftImagesToAttachedImages(getDraft(draftKey)?.images) : []
  ));
  const [previewImage, setPreviewImage] = useState<{ src: string; index: number } | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>(() => (
    draftKey ? draftFilesToAttachedFiles(getDraft(draftKey)?.files) : []
  ));
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isProcessingImages, setIsProcessingImages] = useState(false);
  const [isProcessingFiles, setIsProcessingFiles] = useState(false);
  const canAttachFiles = !isStreaming || Boolean(onQueueInput);
  const trimmedValue = value.trimStart();
  const bashMode = attachedImages.length === 0 && attachedFiles.length === 0 && trimmedValue.startsWith("!");
  const bashExcluded = bashMode && trimmedValue.startsWith("!!");
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [historyMenuOpen, setHistoryMenuOpen] = useState(false);
  const [historyActiveIndex, setHistoryActiveIndex] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const followUpTextareaRef = useRef<HTMLTextAreaElement>(null);
  const inputAnchorRef = useRef<HTMLDivElement>(null);
  const slashListId = React.useId();
  const submitRef = useRef<() => void>(() => {});
  const sendingRef = useRef(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const modelDropdownPanelRef = useRef<HTMLDivElement>(null);
  const attachmentMenuRef = useRef<HTMLDivElement>(null);
  const historyMenuRef = useRef<HTMLDivElement>(null);
  const modelChangeCoordinatorRef = useRef<ModelChangeCoordinator | null>(null);
  if (!modelChangeCoordinatorRef.current) {
    modelChangeCoordinatorRef.current = new ModelChangeCoordinator();
  }
  const speechInsertionRef = useRef<{ before: string; after: string; language: string } | null>(null);
  const localVoiceStopRef = useRef<() => Promise<boolean>>(async () => false);
  const localVoiceCancelRef = useRef<() => void>(() => {});
  const localVoiceActiveRef = useRef(false);
  const voiceToggleRef = useRef<() => void>(() => {});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);
  const lastCompositionEndAtRef = useRef(0);
  const slashCommandsRequestedRef = useRef(false);
  const slashItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const historyItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const draftKeyRef = useRef(draftKey);
  const retryOfPromptIdsRef = useRef<string[]>(draftKey ? getDraft(draftKey)?.retryOfPromptIds ?? [] : []);
  const valueRef = useRef(value);
  const attachedImagesRef = useRef(attachedImages);
  const pendingImageCountRef = useRef(0);
  const pendingImageBytesRef = useRef(0);
  const pendingFileCountRef = useRef(0);
  valueRef.current = value;
  attachedImagesRef.current = attachedImages;
  const attachedFilesRef = useRef(attachedFiles);
  attachedFilesRef.current = attachedFiles;

  const {
    promptOptimization,
    setPromptOptimization,
    promptOptimizerAbortRef,
    handleOptimizePrompt,
  } = usePromptOptimization({
    value,
    valueRef,
    cwd,
    model,
    isAutoModelSelection,
    isStreaming,
  });

  const composerWorkflow = useComposerWorkflow({
    workflow,
    workflowEnabled: Boolean(workflowEnabled && workflow),
    workflowBusy,
    hasActiveGoal,
    hasPausedGoal,
    workflowAutoContinuing,
    isStreaming,
    draftKey,
    value,
    valueRef,
    setValue,
    textareaRef,
    commandInputOptions,
    setCommandInputOptions,
    onWorkflowModeChange,
    onRequestGoalReplace,
    onRequestPausedGoalResume,
    onAfterModeChange: () => {
      setSlashMenuOpen(false);
      setHistoryMenuOpen(false);
    },
    surfacePlacement,
    sideChatEnabled,
    canOpenSideChat,
    hasAttachments: attachedImages.length > 0 || attachedFiles.length > 0,
    onOpenSideChat,
    onSideChatNotice: setAttachmentError,
  });

  const {
    atQuery,
    setAtQuery,
    atMenuOpen,
    setAtMenuOpen,
    atActiveIndex,
    setAtActiveIndex,
    fileIndex,
    fileIndexLoading,
    needsServerSearch,
    serverResultInUse,
    atMatches,
    atMenuRef,
    atListRef,
    atItemRefs,
    atListId,
    atMenuPosition,
    updateAtQuery,
    applyAtCompletion,
  } = useFileMentionAutocomplete({
    cwd,
    value,
    setValue,
    textareaRef,
    inputAnchorRef,
    workflowEnabled: Boolean(workflowEnabled && workflow),
    onSelectWorkflowMention: composerWorkflow.handleWorkflowMention,
  });

  useEffect(() => {
    if (folderInputRef.current) folderInputRef.current.webkitdirectory = true;
  }, []);

  const stopVoiceInput = useCallback((abort = false) => {
    if (abort) localVoiceCancelRef.current();
    else void localVoiceStopRef.current();
    if (abort) speechInsertionRef.current = null;
  }, []);

  const processImageFiles = useCallback(async (files: File[]) => {
    if (!canAttachFiles) return;
    setAttachmentError(null);
    const remaining = Math.max(
      0,
      MAX_ATTACHED_IMAGES - attachedImagesRef.current.length - pendingImageCountRef.current,
    );
    let remainingBytes = MAX_ATTACHED_IMAGE_TOTAL_BYTES
      - attachedImagesRef.current.reduce((total, image) => total + (getBase64DecodedByteLength(image.data) ?? 0), 0)
      - pendingImageBytesRef.current;
    let rejected = false;
    const imageFiles: File[] = [];
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      if (imageFiles.length >= remaining || file.size > MAX_ATTACHED_IMAGE_BYTES || file.size > remainingBytes) {
        rejected = true;
        continue;
      }
      imageFiles.push(file);
      remainingBytes -= file.size;
    }
    if (rejected) setAttachmentError(t("chat.imageTooLarge", { size: "100 MB" }));
    if (!imageFiles.length) return;
    pendingImageCountRef.current += imageFiles.length;
    pendingImageBytesRef.current += imageFiles.reduce((total, file) => total + file.size, 0);
    setIsProcessingImages(true);
    try {
      const newImages = await Promise.all(
        imageFiles.map(
          (file) =>
            new Promise<AttachedImage>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                const result = reader.result as string;
                // result is "data:<mime>;base64,<data>"
                const base64 = result.split(",")[1];
                resolve({ data: base64, mimeType: file.type, previewUrl: URL.createObjectURL(file) });
              };
              reader.onerror = reject;
              reader.readAsDataURL(file);
            })
        )
      );
      setAttachedImages((prev) => {
        const accepted = newImages.slice(0, Math.max(0, MAX_ATTACHED_IMAGES - prev.length));
        newImages.slice(accepted.length).forEach(revokeImagePreview);
        return [...prev, ...accepted];
      });
    } finally {
      pendingImageCountRef.current -= imageFiles.length;
      pendingImageBytesRef.current -= imageFiles.reduce((total, file) => total + file.size, 0);
      if (pendingImageCountRef.current <= 0) setIsProcessingImages(false);
    }
  }, [canAttachFiles, t]);

  const removeImage = useCallback((index: number) => {
    setPreviewImage(null);
    setAttachedImages((prev) => {
      const next = [...prev];
      const [removed] = next.splice(index, 1);
      if (removed) revokeImagePreview(removed);
      return next;
    });
  }, []);

  const processFileSelection = useCallback(async (files: File[]) => {
    if (!canAttachFiles) return;
    setAttachmentError(null);
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length) processImageFiles(imageFiles);

    const nonImageFiles = files.filter((file) => !file.type.startsWith("image/"));
    const remainingCount = Math.max(0, MAX_ATTACHED_FILES - attachedFilesRef.current.length - pendingFileCountRef.current);
    const originDraftKey = draftKeyRef.current;
    const selected = nonImageFiles.slice(0, remainingCount);
    const prepared = new Map<File, AttachedFile>();
    const browserFiles: File[] = [];
    let remainingBytes = MAX_PROMPT_MATERIAL_BYTES;
    let rejectedForSize = false;
    for (const file of selected) {
      let path = "";
      try { path = window.piDesktop?.files?.getPathForFile(file) ?? ""; } catch { /* Browser upload fallback. */ }
      if (path) {
        prepared.set(file, { name: getAttachmentFileName(file), size: file.size, text: null, path });
        continue;
      }
      if (file.size > MAX_ATTACHED_FILE_BYTES || file.size > remainingBytes) {
        rejectedForSize = true;
        continue;
      }
      browserFiles.push(file);
      remainingBytes -= file.size;
    }
    if (rejectedForSize) {
      setAttachmentError(t("chat.attachmentTooLarge", { size: "100 MB" }));
    } else if (nonImageFiles.length > remainingCount) {
      setAttachmentError(t("chat.attachmentCountLimit", { count: MAX_ATTACHED_FILES }));
    }
    if (!selected.length) return;
    pendingFileCountRef.current += selected.length;
    setIsProcessingFiles(true);
    try {
      if (browserFiles.length) {
        const stored = await storeBrowserFiles(browserFiles, browserFiles.map(getAttachmentFileName));
        browserFiles.forEach((file, index) => prepared.set(file, stored[index]));
      }
    } catch (error) {
      if (draftKeyRef.current === originDraftKey) {
        setAttachmentError(t("chat.attachmentReadFailed", { error: error instanceof Error ? error.message : String(error) }));
      }
    } finally {
      const attachments = selected.flatMap((file) => prepared.has(file) ? [prepared.get(file)!] : []);
      if (draftKeyRef.current === originDraftKey) {
        setAttachedFiles((prev) => [...prev, ...attachments].slice(0, MAX_ATTACHED_FILES));
      } else if (originDraftKey && attachments.length) {
        const origin = getDraft(originDraftKey) ?? { value: "", images: [], files: [] };
        setDraft(originDraftKey, { ...origin, files: [...origin.files, ...attachments].slice(0, MAX_ATTACHED_FILES) });
      }
      pendingFileCountRef.current -= selected.length;
      if (!pendingFileCountRef.current) setIsProcessingFiles(false);
    }
  }, [canAttachFiles, processImageFiles, t]);

  useImperativeHandle(ref, () => ({
    focus() {
      textareaRef.current?.focus({ preventScroll: true });
    },
    submit() {
      submitRef.current();
    },
    sendText(text: string) {
      const message = text.trim();
      if (!message || isStreaming || sendDisabled || isAutoModelSelection) return false;
      onSend(message);
      return true;
    },
    toggleVoiceInput() {
      voiceToggleRef.current();
    },
    togglePlanMode() {
      composerWorkflow.togglePlanMode();
    },
    enterGoalDraftMode(inlineObjective?: string) {
      composerWorkflow.enterGoalDraftMode(inlineObjective);
    },
    clearGoalDraftMode() {
      composerWorkflow.clearGoalDraftMode();
    },
    insertIfEmpty(text: string) {
      const ta = textareaRef.current;
      const current = ta ? ta.value : value;
      if (current.trim()) return;
      setValue(text);
      setAtQuery(null);
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        resizeComposerTextarea(ta);
      });
    },
    prependText(text: string, retryOfPromptIds?: string[]) {
      if (!text.trim()) return;
      if (retryOfPromptIds?.length) retryOfPromptIdsRef.current = [...new Set([...retryOfPromptIdsRef.current, ...retryOfPromptIds])];
      const ta = textareaRef.current;
      const current = ta ? ta.value : value;
      // Mirrors the TUI's queue restore: queued text first, then whatever
      // the user already typed, separated by a blank line.
      const combined = [text, current].filter((item) => item.trim()).join("\n\n");
      setValue(combined);
      setAtQuery(null);
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(combined.length, combined.length);
        resizeComposerTextarea(ta);
      });
    },
    insertText(text: string) {
      const ta = textareaRef.current;
      if (!ta) {
        setValue((current) => current + (current ? " " : "") + text);
        return;
      }
      const start = ta.selectionStart ?? ta.value.length;
      const end = ta.selectionEnd ?? ta.value.length;
      const before = ta.value.slice(0, start);
      const after = ta.value.slice(end);
      const separator = before.length > 0 && !before.endsWith(" ") ? " " : "";
      const newValue = before + separator + text + after;
      setValue(newValue);
      setAtQuery(null);
      requestAnimationFrame(() => {
        if (!ta) return;
        const position = start + separator.length + text.length;
        ta.setSelectionRange(position, position);
        ta.focus();
        resizeComposerTextarea(ta);
      });
    },
    insertQuotedText(quoted: string) {
      const trimmed = quoted.trim();
      if (!trimmed) return;
      const ta = textareaRef.current;
      const current = ta ? ta.value : valueRef.current;
      const combined = `${[current.trimEnd(), trimmed].filter(Boolean).join("\n\n")}\n\n`;
      setValue(combined);
      setAtQuery(null);
      requestAnimationFrame(() => {
        const element = textareaRef.current;
        if (!element) return;
        element.focus({ preventScroll: true });
        element.setSelectionRange(combined.length, combined.length);
        resizeComposerTextarea(element);
      });
    },
    addImages(files: File[]) {
      void processImageFiles(files);
    },
    addFiles(files: File[]) {
      void processFileSelection(files);
    },
    restoreCommandDraft(draft) {
      if (valueRef.current.trim() || attachedImagesRef.current.length || attachedFilesRef.current.length) return false;
      setCommandInputOptions(draft.commandInput ?? {});
      resetReplyDraft({ value: draft.value, spans: draft.replySpans ?? [] });
      setAttachedFiles(draftFilesToAttachedFiles(draft.files));
      setAttachedImages(draftImagesToAttachedImages(draft.images));
      retryOfPromptIdsRef.current = draft.retryOfPromptIds ?? [];
      return true;
    },
    restoreFailedPrompt(text: string, files?: AttachedFile[], images?: AttachedImage[]) {
      setValue((current) => current === text ? current : current ? [text, current].filter(Boolean).join("\n\n") : text);
      if (files?.length) setAttachedFiles((current) => [...files, ...current]);
      if (images?.length) {
        setAttachedImages((current) => [
          ...images.map((image) => ({
            ...image,
            previewUrl: `data:${image.mimeType};base64,${image.data}`,
          })),
          ...current,
        ]);
      }
      requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.focus();
        resizeComposerTextarea(textarea);
      });
    },
  }));

  const removeFile = useCallback((index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const restorePastedFile = useCallback((index: number) => {
    const file = attachedFilesRef.current[index];
    if (file?.kind !== "paste" || file.text == null) return;
    setAttachedFiles((current) => current.filter((_, currentIndex) => currentIndex !== index));
    setValue((current) => current ? `${current}\n\n${file.text}` : file.text!);
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      resizeComposerTextarea(textarea);
    });
  }, [setValue]);

  const clearImages = useCallback(() => {
    setPreviewImage(null);
    setAttachedImages((prev) => {
      prev.forEach(revokeImagePreview);
      return [];
    });
  }, []);

  const clearInput = useCallback(() => {
    setCommandInputOptions({});
    retryOfPromptIdsRef.current = [];
    stopVoiceInput(true);
    resetReplyDraft({ value: "", spans: [] });
    setAtQuery(null);
    setHistoryMenuOpen(false);
    setAttachmentMenuOpen(false);
    if (draftKey) clearDraft(draftKey);
    if (draftKeyRef.current && draftKeyRef.current !== draftKey) clearDraft(draftKeyRef.current);
    clearImages();
    setAttachedFiles([]);
    setAttachmentError(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [clearImages, draftKey, stopVoiceInput, resetReplyDraft, setAtQuery]);

  useEffect(() => {
    if (!draftKey || draftKeyRef.current !== draftKey || hydratedDraftKey !== draftKey) return;
    if (!value && !attachedImages.length && !attachedFiles.length) retryOfPromptIdsRef.current = [];
    setDraft(draftKey, {
      commandInput: commandInputOptions,
      value: valueRef.current,
      replySpans: replyDraftRef.current.spans,
      images: attachedImagesRef.current.map(imageToDraftImage),
      files: attachedFilesRef.current.map(attachedFileToDraftFile),
      ...(retryOfPromptIdsRef.current.length ? { retryOfPromptIds: [...retryOfPromptIdsRef.current] } : {}),
    });
  }, [attachedFiles, attachedImages, draftKey, value, replyDraft.spans, hydratedDraftKey, replyDraftRef, commandInputOptions]);

  useEffect(() => {
    const previousDraftKey = draftKeyRef.current;
    if (previousDraftKey === draftKey) return;

    stopVoiceInput(true);

    if (previousDraftKey) {
      setDraft(previousDraftKey, {
        value: valueRef.current,
        replySpans: replyDraftRef.current.spans,
        images: attachedImagesRef.current.map(imageToDraftImage),
        files: attachedFilesRef.current.map(attachedFileToDraftFile),
        commandInput: commandInputOptionsRef.current,
        ...(retryOfPromptIdsRef.current.length ? { retryOfPromptIds: [...retryOfPromptIdsRef.current] } : {}),
      });
    }

    const draft = draftKey ? getDraft(draftKey) : null;
    setCommandInputOptions(draft?.commandInput ?? {});
    draftKeyRef.current = draftKey;
    retryOfPromptIdsRef.current = draft?.retryOfPromptIds ?? [];
    promptOptimizerAbortRef.current?.abort();
    promptOptimizerAbortRef.current = null;
    setPromptOptimization(null);
    setAttachmentMenuOpen(false);
    setPreviewImage(null);
    resetReplyDraft({ value: draft?.value ?? "", spans: draft?.replySpans ?? [] });
    valueRef.current = draft?.value ?? "";
    setAtQuery(null);
    setHistoryMenuOpen(false);
    const nextImages = draftImagesToAttachedImages(draft?.images);
    const nextFiles = draftFilesToAttachedFiles(draft?.files);
    attachedImagesRef.current.forEach(revokeImagePreview);
    attachedImagesRef.current = nextImages;
    attachedFilesRef.current = nextFiles;
    setAttachedImages(nextImages);
    setAttachedFiles(nextFiles);
  }, [draftKey, stopVoiceInput, resetReplyDraft, replyDraftRef, promptOptimizerAbortRef, setAtQuery, setPromptOptimization]);

  useEffect(() => {
    if (!draftKey) return;
    let alive = true;
    const before = replyDraftRef.current;
    const beforeImages = attachedImagesRef.current;
    const beforeFiles = attachedFilesRef.current;
    setDraftStorageError(false);
    void hydrateDraft(draftKey).then((saved) => {
      if (!alive || draftKeyRef.current !== draftKey) return;
      if (saved && replyDraftRef.current === before && attachedImagesRef.current === beforeImages && attachedFilesRef.current === beforeFiles) {
        setCommandInputOptions(saved.commandInput ?? {});
        resetReplyDraft({ value: saved.value, spans: saved.replySpans ?? [] });
        retryOfPromptIdsRef.current = saved.retryOfPromptIds ?? [];
        setAttachedImages((images) => { images.forEach(revokeImagePreview); return draftImagesToAttachedImages(saved.images); });
        setAttachedFiles(draftFilesToAttachedFiles(saved.files));
      }
    }).catch(() => { if (alive) setDraftStorageError(true); }).finally(() => { if (alive) setHydratedDraftKey(draftKey); });
    return () => { alive = false; };
  }, [draftKey, replyDraftRef, resetReplyDraft]);

  useEffect(() => {
    const failed = (event: Event) => { if ((event as CustomEvent<string>).detail === draftKeyRef.current) setDraftStorageError(true); };
    window.addEventListener(DRAFT_STORAGE_ERROR_EVENT, failed);
    return () => window.removeEventListener(DRAFT_STORAGE_ERROR_EVENT, failed);
  }, []);

  useEffect(() => {
    return () => {
      stopVoiceInput(true);
      promptOptimizerAbortRef.current?.abort();
      attachedImagesRef.current.forEach(revokeImagePreview);
    };
  }, [stopVoiceInput, promptOptimizerAbortRef]);

  const handleSend = useCallback(async (overrideOptions?: ChatInputOptions) => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    try {
    const originDraftKey = draftKeyRef.current;
    if (localVoiceActiveRef.current) {
      const insertion = speechInsertionRef.current;
      const finished = await localVoiceStopRef.current();
      if (!finished || draftKeyRef.current !== originDraftKey || speechInsertionRef.current !== insertion) return;
    }
    const value = valueRef.current;
    const msg = value.trim();
    const sentWorkflow = workflowEnabled ? overrideOptions?.workflow ?? commandInputOptions.workflow ?? workflow : { mode: "agent" as const };
    const sentCommandOptions = { ...commandInputOptions, ...overrideOptions, ...(sentWorkflow ? { workflow: { ...sentWorkflow } } : {}) };
    const parsed = parseChatInput(value, commandCatalog ?? createChatCommandCatalog(slashCommands ?? []), sentCommandOptions);
    const commandSubmission = parsed.kind !== "message";
    if (!commandSubmission && msg.startsWith("/")) sentCommandOptions.inputMode = "text";
    // Delivery from a recovered draft must never turn an ordinary send into steering.
    if (!commandSubmission) sentCommandOptions.delivery = overrideOptions?.delivery ?? (isStreaming ? runningSendMode : "next_turn");
    if (!msg && !attachedImages.length && !attachedFiles.length) return;
    if (sendDisabled || permissionSaving || (isStreaming && !onQueueInput) || isProcessingImages || pendingFileCountRef.current > 0 || (isAutoModelSelection && !commandSubmission)) return;
    if (attachedFiles.some((file) => !file.path && file.text == null)) {
      setAttachmentError(t("chat.attachmentMissingPath"));
      return;
    }
    let messageToSend = value;
    let filesToSend = attachedFiles;
    if (msg && !commandSubmission && shouldMaterializeDirectPrompt(msg, contextUsage)) {
      const existingPastes = attachedFiles.filter((file) => file.kind === "paste" && file.text != null);
      const combined = [value, ...existingPastes.map((file) => file.text!)].join("\n\n");
      filesToSend = [
        ...attachedFiles.filter((file) => file.kind !== "paste"),
        {
          name: t("chat.pastedContentName", { count: 1 }),
          size: new TextEncoder().encode(combined).byteLength,
          text: combined,
          kind: "paste" as const,
        },
      ];
      messageToSend = "";
    }
    const sentReplyDraft = replyDraftRef.current;
    const sentValue = value;
    const sentImages = attachedImages;
    const sentFiles = attachedFiles;
    const sentDraftKey = draftKeyRef.current;
    const sentRetryOfPromptIds = [...retryOfPromptIdsRef.current];
    const sentDraft = {
      commandInput: sentCommandOptions,
      value: sentValue,
      replySpans: sentReplyDraft.spans,
      images: sentImages.map(imageToDraftImage),
      files: sentFiles.map(attachedFileToDraftFile),
      retryOfPromptIds: sentRetryOfPromptIds,
    };
    // Clear the visible composer immediately, while retaining its disk copy
    // until onSend confirms that recovery storage owns the submission.
    if (sentDraftKey) setDraft(sentDraftKey, sentDraft);
    const resumeDraftPersistence = sentDraftKey ? deferDraftPersistence(sentDraftKey) : () => {};
    let submittedPromptId: string | undefined;
    let cleared = false;
    const clearSubmittedDraft = () => {
      if (cleared || draftKeyRef.current !== sentDraftKey || valueRef.current !== sentValue || attachedImagesRef.current !== sentImages || attachedFilesRef.current !== sentFiles) return;
      cleared = true;
      clearInput();
      if (sentCommandOptions.workflow && (sentCommandOptions.workflow.mode !== workflow?.mode
        || (sentCommandOptions.workflow.turnBudget ?? DEFAULT_WORKFLOW_TURN_BUDGET) !== (workflow?.turnBudget ?? DEFAULT_WORKFLOW_TURN_BUDGET))) {
        setCommandInputOptions({ workflow: { ...sentCommandOptions.workflow } });
      }
      valueRef.current = "";
      attachedImagesRef.current = [];
      attachedFilesRef.current = [];
    };
    const restoreSubmittedDraft = () => {
      if (!cleared || submittedPromptId) return;
      const retryOfPromptIds = [...new Set([...(submittedPromptId ? [submittedPromptId] : []), ...sentRetryOfPromptIds])];
      if (draftKeyRef.current !== sentDraftKey) {
        if (sentDraftKey && !getDraft(sentDraftKey)) setDraft(sentDraftKey, { ...sentDraft, retryOfPromptIds });
        return;
      }
      if (valueRef.current || attachedImagesRef.current.length || attachedFilesRef.current.length) return;
      retryOfPromptIdsRef.current = retryOfPromptIds;
      resetReplyDraft(sentReplyDraft);
      setCommandInputOptions(sentCommandOptions);
      setAttachedFiles(sentFiles);
      setAttachedImages(draftImagesToAttachedImages(sentImages.map(imageToDraftImage)));
      if (sentDraftKey) setDraft(sentDraftKey, { ...sentDraft, retryOfPromptIds });
    };
    try {
    clearSubmittedDraft();
    if (!await modelChangeCoordinatorRef.current!.waitForIdle() || draftKeyRef.current !== sentDraftKey) {
      restoreSubmittedDraft();
      return;
    }
    if (!onQueueInput && !sentImages.length && !sentFiles.length && commandSubmission && onBuiltinCommand) {
      const result = await onBuiltinCommand(msg);
      if (result.handled) {
        if (result.error) restoreSubmittedDraft();
        return;
      }
    }
    const durable = (clientPromptId?: string) => {
      submittedPromptId ??= clientPromptId;
      resumeDraftPersistence();
    };
    const accepted = isStreaming && onQueueInput ? await onQueueInput(messageToSend, sentImages, filesToSend, durable, sentCommandOptions, sentRetryOfPromptIds) : await onSend(
      messageToSend,
      sentImages.length ? sentImages : undefined,
      filesToSend.length ? filesToSend : undefined,
      durable,
      sentRetryOfPromptIds.length ? sentRetryOfPromptIds : undefined,
      sentCommandOptions,
    );
    if (accepted === false) { restoreSubmittedDraft(); return; }
    } catch (error) { restoreSubmittedDraft(); throw error; }
    finally { resumeDraftPersistence(); }
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : String(error));
    } finally { sendingRef.current = false; }
  }, [attachedImages, attachedFiles, sendDisabled, permissionSaving, isStreaming, isProcessingImages, isAutoModelSelection, onBuiltinCommand, onSend, onQueueInput, clearInput, contextUsage, t, replyDraftRef, resetReplyDraft, commandInputOptions, runningSendMode, commandCatalog, slashCommands, workflow, workflowEnabled]);

  useEffect(() => {
    submitRef.current = () => { void handleSend(); };
  }, [handleSend]);

  const submitComposer = useCallback(
    (overrideOptions?: ChatInputOptions) => composerWorkflow.submitWithWorkflowTriggers(handleSend, overrideOptions),
    [composerWorkflow, handleSend],
  );

  useEffect(() => {
    submitRef.current = () => { void submitComposer(); };
  }, [submitComposer]);

  const slashQuery = value.trimStart().startsWith("/") && !/\s/.test(value.trimStart().slice(1))
    ? value.trimStart().slice(1).toLowerCase()
    : null;

  const filteredSlashCommands = (() => {
    if (slashQuery === null) return [];
    const workflowItems = composerWorkflow.buildWorkflowSlashItems(slashQuery);
    const registryItems = filterSlashCommandRegistry(buildSlashCommandRegistry(slashCommands ?? [], isStreaming, commandCatalog)
      .filter(command => command.supported !== false || slashQuery.trim().length > 0), slashQuery, t);
    return [...workflowItems, ...registryItems];
  })();

  const groupedSlashCommands = (() => {
    const groups = new Map<SlashCommandSource, { source: SlashCommandSource; items: { command: SlashCommandPaletteItem; index: number }[] }>();
    for (const source of SLASH_SOURCES) {
      groups.set(source, { source, items: [] });
    }
    filteredSlashCommands.forEach((command, index) => {
      groups.get(command.source)?.items.push({ command, index });
    });
    return SLASH_SOURCES
      .map((source) => groups.get(source)!)
      .filter((group) => group.items.length > 0);
  })();

  const slashCommandCountLabel = filteredSlashCommands.length === 1
    ? t(slashQuery ? "chat.match" : "chat.command")
    : t(slashQuery ? "chat.matches" : "chat.commands", { count: filteredSlashCommands.length });
  const hasInputText = Boolean(value.trim());
  const canSend = !sendDisabled && !permissionSaving && !isProcessingImages && !isProcessingFiles
    && !workflowAutoContinuing
    && (!isAutoModelSelection || isCommandInput)
    && (hasInputText || attachedImages.length > 0 || attachedFiles.length > 0);
  const canQueueStreamingMessage = canSend && (Boolean(onQueueInput) || hasInputText && attachedImages.length === 0 && attachedFiles.length === 0);
  useEffect(() => {
    if (!canQueueStreamingMessage) sendModeHoverDismissedRef.current = false;
  }, [canQueueStreamingMessage, sendModeHoverDismissedRef]);
  const canOptimizePrompt = hasInputText
    && !isStreaming
    && !isAutoModelSelection
    && Boolean(model)
    && !trimmedValue.startsWith("/")
    && !trimmedValue.startsWith("!")
    && !promptOptimization?.loading;

  const applyVoiceTranscript = useCallback((transcript: string) => {
    const insertion = speechInsertionRef.current;
    if (!insertion) return;
    const next = joinSpeechText(insertion.before, transcript, insertion.after, insertion.language);
    // Each update replaces the current dictation, preserving the original
    // selection. Typing, sending or switching drafts cancels this insertion.
    setValue(next.value);
    valueRef.current = next.value;
    updateAtQuery(next.value, next.selection);
    requestAnimationFrame(() => {
      if (speechInsertionRef.current !== insertion) return;
      const element = textareaRef.current;
      if (!element) return;
      element.focus({ preventScroll: true });
      element.setSelectionRange(next.selection, next.selection);
      resizeComposerTextarea(element);
    });
  }, [setValue, updateAtQuery]);

  const prepareVoiceInsertion = useCallback(() => {
    const textarea = textareaRef.current;
    const currentValue = textarea?.value ?? valueRef.current;
    const selectionStart = textarea?.selectionStart ?? currentValue.length;
    const selectionEnd = textarea?.selectionEnd ?? selectionStart;
    speechInsertionRef.current = {
      before: currentValue.slice(0, selectionStart),
      after: currentValue.slice(selectionEnd),
      language: locale === "zh-CN" ? "zh-CN" : "en-US",
    };
    setHistoryMenuOpen(false);
    setSlashMenuOpen(false);
    setAtMenuOpen(false);
    if (promptOptimization) {
      promptOptimizerAbortRef.current?.abort();
      promptOptimizerAbortRef.current = null;
      setPromptOptimization(null);
    }
  }, [locale, promptOptimization, promptOptimizerAbortRef, setAtMenuOpen, setPromptOptimization]);

  const localDictation = useLocalDictation({
    language: locale === "zh-CN" ? "zh" : "en",
    onTranscript: applyVoiceTranscript,
  });
  localVoiceStopRef.current = localDictation.stop;
  localVoiceCancelRef.current = localDictation.cancel;
  localVoiceActiveRef.current = localDictation.phase !== "idle";
  const localVoiceEnabled = localDictation.available && localDictation.supported;
  const localVoiceRecording = localVoiceEnabled
    && (localDictation.phase === "starting" || localDictation.phase === "recording");
  const voiceTranscribing = localVoiceEnabled && localDictation.phase === "transcribing";
  const voiceInputSupported = localVoiceEnabled;
  const voiceListening = localVoiceRecording;
  const effectiveVoiceError = localDictation.error;

  const toggleVoiceInput = useCallback(() => {
    if (!localVoiceEnabled) return;
    if (localDictation.phase === "idle") prepareVoiceInsertion();
    void localDictation.toggle();
  }, [localDictation, localVoiceEnabled, prepareVoiceInsertion]);
  voiceToggleRef.current = toggleVoiceInput;

  useEffect(() => {
    const handleVoiceShortcut = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || !voiceInputSupported || !shortcutMatchesEvent(
        event,
        voiceInputBinding,
        isMacPlatform(window.piDesktop?.platform),
      )) return;
      const target = event.target instanceof Element ? event.target : null;
      if (shouldPreserveApplicationShortcut(event.target) && !target?.closest(".chat-composer-surface")) return;
      event.preventDefault();
      toggleVoiceInput();
    };
    window.addEventListener("keydown", handleVoiceShortcut);
    return () => window.removeEventListener("keydown", handleVoiceShortcut);
  }, [toggleVoiceInput, voiceInputBinding, voiceInputSupported]);

  useEffect(() => {
    if (historyActiveIndex >= inputHistory.length) {
      setHistoryActiveIndex(Math.max(0, inputHistory.length - 1));
    }
  }, [inputHistory.length, historyActiveIndex]);

  useEffect(() => {
    historyItemRefs.current.length = inputHistory.length;
  }, [inputHistory.length]);

  useEffect(() => {
    if (!historyMenuOpen) return;
    historyItemRefs.current[historyActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [historyActiveIndex, historyMenuOpen]);

  const applyHistoryInput = useCallback((text: string) => {
    commitReplyDraft({ value: text, spans: [] });
    setHistoryMenuOpen(false);
    setHistoryActiveIndex(0);
    setAtQuery(null);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(text.length, text.length);
      ta.style.height = "auto";
      resizeComposerTextarea(ta);
    });
  }, [commitReplyDraft, setAtQuery]);

  const applySlashCommand = useCallback((command: SlashCommandPaletteItem) => {
    if (command.supported === false) { setAttachmentError(t("chatCommands.unsupported")); return; }
    setCommandInputOptions(current => ({ workflow: current.workflow, commandKey: command.key, catalogRevision: commandCatalog?.revision }));
    const nextValue = `/${command.name} `;
    const originDraftKey = draftKeyRef.current;
    textareaRef.current?.focus();
    setValue(nextValue);
    setSlashMenuOpen(false);
    setSlashActiveIndex(0);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      // A fast typist may already have entered arguments before this frame.
      // Moving the caret back to the completed prefix would reorder that text.
      if (!ta || ta.value !== nextValue || draftKeyRef.current !== originDraftKey) return;
      ta.focus();
      ta.setSelectionRange(nextValue.length, nextValue.length);
      ta.style.height = "auto";
      resizeComposerTextarea(ta);
    });
  }, [setValue, commandCatalog?.revision, t]);

  const sendQueued = useCallback(async (mode: "steer" | "followup") => {
    if (onQueueInput) {
      try { await handleSend({ delivery: mode === "steer" ? "steer" : "next_turn" }); }
      catch (error) { setAttachmentError(error instanceof Error ? error.message : String(error)); }
      return;
    }
    if (sendingRef.current) return;
    const streamingBehavior = mode === "steer" ? "steer" : "followUp";
    const sentDraftKey = draftKeyRef.current;
    let restoreSubmittedDraft = () => {};
    let resumeDraftPersistence = () => {};
    sendingRef.current = true;
    try {
      if (localVoiceActiveRef.current) {
        const insertion = speechInsertionRef.current;
        const finished = await localVoiceStopRef.current();
        if (!finished || draftKeyRef.current !== sentDraftKey || speechInsertionRef.current !== insertion) return;
      }
      const value = valueRef.current;
      const msg = value.trim();
      if (!msg || attachedImages.length || attachedFiles.length) return;
      const submit = msg.startsWith("/") && onPromptWithStreamingBehavior
        ? () => onPromptWithStreamingBehavior(msg, streamingBehavior)
        : mode === "steer" && onSteer ? () => onSteer(msg)
        : mode === "followup" && onFollowUp ? () => onFollowUp(msg) : null;
      if (!submit) return;
      const sentReplyDraft = replyDraftRef.current;
      const retryOfPromptIds = [...retryOfPromptIdsRef.current];
      const sentDraft = { value, replySpans: sentReplyDraft.spans, images: [], files: [], retryOfPromptIds };
      if (sentDraftKey) {
        setDraft(sentDraftKey, sentDraft);
        resumeDraftPersistence = deferDraftPersistence(sentDraftKey);
      }
      restoreSubmittedDraft = () => {
        if (draftKeyRef.current !== sentDraftKey) {
          if (sentDraftKey && !getDraft(sentDraftKey)) setDraft(sentDraftKey, sentDraft);
          return;
        }
        if (valueRef.current || attachedImagesRef.current.length || attachedFilesRef.current.length) return;
        retryOfPromptIdsRef.current = retryOfPromptIds;
        resetReplyDraft(sentReplyDraft);
        if (sentDraftKey) setDraft(sentDraftKey, sentDraft);
      };
      clearInput();
      valueRef.current = "";
      attachedImagesRef.current = [];
      attachedFilesRef.current = [];
      if (await submit() === false) restoreSubmittedDraft();
    } catch (error) {
      restoreSubmittedDraft();
      if (draftKeyRef.current === sentDraftKey) setAttachmentError(error instanceof Error ? error.message : String(error));
    } finally {
      resumeDraftPersistence();
      sendingRef.current = false;
    }
  }, [attachedImages, attachedFiles, onPromptWithStreamingBehavior, onSteer, onFollowUp, clearInput, replyDraftRef, resetReplyDraft, onQueueInput, handleSend]);

  const selectSlashCommand = useCallback((command: SlashCommandPaletteItem) => {
    if (composerWorkflow.handleSlashWorkflowSelect(command)) {
      setSlashMenuOpen(false);
      setSlashActiveIndex(0);
      return;
    }
    applySlashCommand(command);
  }, [composerWorkflow, applySlashCommand]);

  const submitStreamingMessage = useCallback(() => {
    if (!canQueueStreamingMessage) return;
    sendQueued(runningSendMode === "steer" ? "steer" : "followup");
  }, [canQueueStreamingMessage, sendQueued, runningSendMode]);

  const getNextSlashIndex = useCallback((direction: "up" | "down" | "left" | "right") => {
    const lastIndex = filteredSlashCommands.length - 1;
    if (lastIndex < 0) return 0;

    if (direction === "left") return Math.max(0, slashActiveIndex - 1);
    if (direction === "right") return Math.min(lastIndex, slashActiveIndex + 1);

    const currentNode = slashItemRefs.current[slashActiveIndex];
    if (!currentNode) {
      return direction === "down"
        ? Math.min(lastIndex, slashActiveIndex + 1)
        : Math.max(0, slashActiveIndex - 1);
    }

    const currentRect = currentNode.getBoundingClientRect();
    const currentX = currentRect.left + currentRect.width / 2;
    const currentY = currentRect.top + currentRect.height / 2;
    let bestIndex = -1;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let index = 0; index <= lastIndex; index += 1) {
      if (index === slashActiveIndex) continue;
      const node = slashItemRefs.current[index];
      if (!node) continue;
      const rect = node.getBoundingClientRect();
      const candidateY = rect.top + rect.height / 2;
      const verticalDelta = candidateY - currentY;
      if (direction === "down" ? verticalDelta <= 4 : verticalDelta >= -4) continue;

      const candidateX = rect.left + rect.width / 2;
      const score = Math.abs(verticalDelta) * 1000 + Math.abs(candidateX - currentX);
      if (score < bestScore) {
        bestIndex = index;
        bestScore = score;
      }
    }

    if (bestIndex >= 0) return bestIndex;
    return direction === "down"
      ? Math.min(lastIndex, slashActiveIndex + 1)
      : Math.max(0, slashActiveIndex - 1);
  }, [filteredSlashCommands.length, slashActiveIndex]);

  const prediction = useInputPrediction(
    predictionActive && !sendingRef.current && (!draftKey || hydratedDraftKey === draftKey)
      && !value && !attachedImages.length && !attachedFiles.length && !isProcessingImages && !isProcessingFiles
      && !isStreaming && !isCompacting && !sendDisabled && !permissionSaving && !isAutoModelSelection
      && !composerWorkflow.isGoalDrafting && !workflowAutoContinuing && !localVoiceRecording && !voiceTranscribing
      ? replySource : null,
    cwd, locale,
  );

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    if (value || prediction) resizeComposerTextarea(ta);
  }, [value, prediction]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      const nativeEvent = e.nativeEvent;
      const recentlyComposed = Date.now() - lastCompositionEndAtRef.current < COMPOSITION_END_ENTER_GRACE_MS;
      const isComposing =
        isComposingRef.current ||
        nativeEvent.isComposing ||
        nativeEvent.keyCode === 229;

      if (isComposing || recentlyComposed) {
        if (e.key === "Enter" && recentlyComposed) e.preventDefault();
        return;
      }

      // Hover opens the popover without moving focus out of the composer.
      // Escape must dismiss that popover before it can stop the current run.
      if (e.key === "Escape" && sendModeMenuRef.current?.matches(":popover-open")) {
        e.preventDefault();
        e.stopPropagation();
        closeSendModeMenu();
        return;
      }

      if (!isComposing && (e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "z" || e.key.toLowerCase() === "y")) {
        e.preventDefault();
        undoReplyDraft(e.shiftKey || e.key.toLowerCase() === "y");
        return;
      }

      if (historyMenuOpen && !isComposing) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setHistoryActiveIndex((i) => Math.min(Math.max(0, inputHistory.length - 1), i + 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setHistoryActiveIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setHistoryMenuOpen(false);
          return;
        }
        if ((e.key === "Tab" || isPlainEnter(e)) && inputHistory[historyActiveIndex]) {
          e.preventDefault();
          applyHistoryInput(inputHistory[historyActiveIndex]);
          return;
        }
      }

      if (slashMenuOpen && slashQuery !== null) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("down"));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("up"));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setSlashMenuOpen(false);
          return;
        }
        if ((e.key === "Tab" || isPlainEnter(e)) && filteredSlashCommands[slashActiveIndex]) {
          e.preventDefault();
          const selected = filteredSlashCommands[slashActiveIndex];
          if (selected.key === "workflow:plan" || selected.key === "workflow:goal") {
            selectSlashCommand(selected);
            return;
          }
          if (matchesSendShortcut(e, sendShortcut) && selected.name === slashQuery && selected.argumentMode !== "required") {
            setSlashMenuOpen(false);
            void submitComposer();
            return;
          }
          selectSlashCommand(selected);
          return;
        }
      }

      // @ file menu — skip while composing so IME candidate navigation
      // (arrows/Enter/Tab) is never intercepted.
      if (atMenuOpen && atQuery !== null && !isComposing) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setAtActiveIndex((i) => Math.min(Math.max(0, atMatches.length - 1), i + 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setAtActiveIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setAtMenuOpen(false);
          return;
        }
        if ((e.key === "Tab" || isPlainEnter(e)) && atMatches[atActiveIndex]) {
          e.preventDefault();
          applyAtCompletion(atMatches[atActiveIndex]);
          return;
        }
      }

      if (composerWorkflow.handleWorkflowKeyDown(e, {
        menusOpen: historyMenuOpen || slashMenuOpen || atMenuOpen,
        isComposing,
      })) {
        return;
      }

      if (e.key === "ArrowUp" && !isComposing && !isStreaming && inputHistory.length > 0 && value.trim().length === 0) {
        e.preventDefault();
        setSlashMenuOpen(false);
        setAtMenuOpen(false);
        setHistoryActiveIndex(inputHistory.length - 1);
        setHistoryMenuOpen(true);
        return;
      }

      if (e.key === "Escape" && !isComposing && localVoiceRecording) {
        e.preventDefault();
        stopVoiceInput();
        return;
      }

      if (e.key === "Escape" && !isComposing && attachmentMenuOpen) {
        e.preventDefault();
        setAttachmentMenuOpen(false);
        return;
      }

      // Esc stops the agent when no slash/@/history menu or IME composition is active.
      if (e.key === "Escape" && !isComposing && isStreaming && onAbort) {
        e.preventDefault();
        onAbort();
        return;
      }

      if (prediction && e.key === "Tab" && !e.currentTarget.value && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey
        && !historyMenuOpen && !slashMenuOpen && !atMenuOpen && !attachmentMenuOpen) {
        e.preventDefault();
        setValue(prediction);
        return;
      }

      if (matchesSendShortcut(e, newlineShortcut)) {
        e.preventDefault();
        const textarea = e.currentTarget;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const nextValue = textarea.value.slice(0, start) + "\n" + textarea.value.slice(end);
        setValue(nextValue);
        setHistoryMenuOpen(false);
        updateAtQuery(nextValue, start + 1);
        requestAnimationFrame(() => textarea.setSelectionRange(start + 1, start + 1));
        return;
      }

      if (matchesSendShortcut(e, sendShortcut)) {
        e.preventDefault();
        if (e.repeat) return;
        const isSideSlash = surfacePlacement !== "side" && sideChatEnabled && parseSideSlashTrigger(valueRef.current).matched;
        if (isStreaming && !isCommandInput && !isSideSlash && (onQueueInput || onSteer || onFollowUp)) {
          submitStreamingMessage();
        } else {
          void submitComposer();
        }
        return;
      }
      // Only the configured newline binding inserts a line break.
      if (e.key === "Enter") e.preventDefault();
    },
    [prediction, isStreaming, isCommandInput, surfacePlacement, sideChatEnabled, onQueueInput, onSteer, onFollowUp, onAbort, slashMenuOpen, slashQuery, filteredSlashCommands, slashActiveIndex, selectSlashCommand, submitComposer, composerWorkflow, getNextSlashIndex, atMenuOpen, atQuery, atMatches, atActiveIndex, applyAtCompletion, historyMenuOpen, inputHistory, historyActiveIndex, applyHistoryInput, value, stopVoiceInput, localVoiceRecording, attachmentMenuOpen, submitStreamingMessage, undoReplyDraft, sendShortcut, newlineShortcut, setValue, updateAtQuery, closeSendModeMenu, sendModeMenuRef, setAtActiveIndex, setAtMenuOpen]
  );

  const handleInput = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    resizeComposerTextarea(ta);
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (!files.length) {
      files.push(...Array.from(e.clipboardData?.items ?? [])
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile()).filter((file): file is File => file !== null));
    }
    if (files.length) {
      e.preventDefault();
      void processFileSelection(files);
      return;
    }
    const pastedText = e.clipboardData?.getData("text/plain") ?? "";
    if (pastedText.length <= LARGE_PASTE_CHARACTER_THRESHOLD || attachedFilesRef.current.length >= MAX_ATTACHED_FILES) return;
    e.preventDefault();
    const index = attachedFilesRef.current.filter((file) => file.kind === "paste").length + 1;
    setAttachedFiles((current) => [...current, {
      name: t("chat.pastedContentName", { count: index }),
      size: new TextEncoder().encode(pastedText).byteLength,
      text: pastedText,
      kind: "paste" as const,
    }].slice(0, MAX_ATTACHED_FILES));
  }, [processFileSelection, t]);

  useEffect(() => {
    if (slashQuery === null) {
      setSlashMenuOpen(false);
      setSlashActiveIndex(0);
      slashCommandsRequestedRef.current = false;
      return;
    }
    setSlashMenuOpen(true);
    setSlashActiveIndex(0);
    if (!slashCommandsRequestedRef.current && onLoadSlashCommands) {
      slashCommandsRequestedRef.current = true;
      Promise.resolve(onLoadSlashCommands()).catch(() => {
        slashCommandsRequestedRef.current = false;
      });
    }
  }, [slashQuery, onLoadSlashCommands]);

  useEffect(() => {
    if (slashActiveIndex >= filteredSlashCommands.length) {
      setSlashActiveIndex(Math.max(0, filteredSlashCommands.length - 1));
    }
  }, [filteredSlashCommands.length, slashActiveIndex]);

  useEffect(() => {
    slashItemRefs.current.length = filteredSlashCommands.length;
  }, [filteredSlashCommands.length]);

  useEffect(() => {
    if (!slashMenuOpen) return;
    slashItemRefs.current[slashActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [slashActiveIndex, slashMenuOpen]);

  // Build model options: prefer modelList (has provider info), fallback to modelNames
  const modelOptions: ModelOption[] = (() => {
    if (modelList && modelList.length > 0) {
      return modelList.map((m) => ({ provider: m.provider, modelId: m.id, name: m.name, isDefault: m.isDefault }));
    }
    return Object.entries(modelNames ?? {}).map(([modelId, name]) => ({
        provider: model?.provider ?? "unknown",
        modelId,
        name,
      }));
  })();
  const filteredModelOptions = filterModelOptions(modelOptions, modelFilter);
  const showModelFilter = modelOptions.length > MODEL_FILTER_THRESHOLD;

  // Group options by provider, preserving insertion order
  const modelsByProvider: { provider: string; options: ModelOption[] }[] = [];
  for (const opt of filteredModelOptions) {
    const group = modelsByProvider.find((g) => g.provider === opt.provider);
    if (group) group.options.push(opt);
    else modelsByProvider.push({ provider: opt.provider, options: [opt] });
  }

  const displayModelName = model && !isAutoModelSelection
    ? (modelOptions.find((o) => o.modelId === model.modelId && o.provider === model.provider)?.name ?? model.modelId)
    : null;
  const currentName = displayModelName;
  const activeThinkingLevel = (thinkingLevel ?? "auto") as ThinkingLevel;
  const thinkingLevelLabel = t(THINKING_LEVEL_LABEL_KEYS[activeThinkingLevel] ?? THINKING_LEVEL_LABEL_KEYS.auto);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        modelDropdownPanelRef.current && !modelDropdownPanelRef.current.contains(e.target as Node)
      ) {
        setModelDropdownOpen(false);
        setModelMenuSection(null);
        setModelFilter("");
      }
      if (historyMenuRef.current && !historyMenuRef.current.contains(e.target as Node) && !textareaRef.current?.contains(e.target as Node)) {
        setHistoryMenuOpen(false);
      }
      if (atMenuRef.current && !atMenuRef.current.contains(e.target as Node) && !textareaRef.current?.contains(e.target as Node)) {
        setAtMenuOpen(false);
      }
      if (attachmentMenuRef.current && !attachmentMenuRef.current.contains(e.target as Node)) {
        setAttachmentMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [atMenuRef, setAtMenuOpen]);

  return (
    <div
      data-composer-variant={variant}
      style={{
        flexShrink: 0,
        background: "transparent",
        padding: variant === "launcher" ? 0 : "0 16px 8px",
        paddingLeft: variant === "launcher" ? 0 : isMobile ? 16 : 36, // reserve a safe gutter between selectable text and the left resize handle
        paddingRight: variant === "launcher" ? 0 : isMobile ? 16 : 52, // desktop: 16px base + 36px for ChatMinimap alignment
      }}
    >
      {/* Native pickers stay outside the visible composer so files and folders
          remain separate, explicit choices in Chromium/Electron. */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        disabled={!canAttachFiles}
        style={{ display: "none" }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          void processFileSelection(files);
          e.target.value = "";
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        disabled={!canAttachFiles}
        style={{ display: "none" }}
        onChange={(e) => {
          const selectedFiles = Array.from(e.target.files ?? []);
          const files = selectedFiles.filter(isFolderAttachmentFileAllowed);
          if (selectedFiles.length > 0 && files.length === 0) {
            setAttachmentError(t("chat.folderHasNoAttachableFiles"));
          } else {
            void processFileSelection(files);
          }
          e.target.value = "";
        }}
      />
      <div className="composer-column">
        <ComposerStatusBanners
          modelError={modelError}
          retryInfo={retryInfo}
          draftKey={draftKey}
          isCompacting={isCompacting}
          compactionStartedAt={compactionStartedAt}
          onAbortCompaction={onAbortCompaction}
          compactResult={compactResult}
          onDismissCompactResult={onDismissCompactResult}
          compactError={compactError}
          onDismissCompactError={onDismissCompactError}
        />
        {/* Image previews */}
        <ReplySuggestionBar {...suggestions} draft={replyDraft} onChange={(next, caret) => {
          stopVoiceInput(true);
          promptOptimizerAbortRef.current?.abort();
          setPromptOptimization(null);
          commitReplyDraft(next);
          if (caret !== undefined && !isMobile) requestAnimationFrame(() => {
            const textarea = textareaRef.current;
            if (!textarea) return;
            textarea.focus({ preventScroll: true });
            textarea.setSelectionRange(caret, caret);
            resizeComposerTextarea(textarea);
          });
        }} />
        {draftStorageError && <div role="status" style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)", padding: "8px 0" }}>{t("reply.storageFailed")}</div>}
        {attachmentError && (
          <div role="alert" style={{ marginBottom: 6, color: "#ef4444", fontSize: "var(--text-xs)" }}>
            {attachmentError}
          </div>
        )}
        {isProcessingFiles && <div role="status" style={{ marginBottom: 6, color: "var(--text-muted)", fontSize: "var(--text-xs)" }}>{t("chat.processingFiles")}</div>}
        <ComposerAttachmentsBar
          attachedImages={attachedImages}
          previewImage={previewImage}
          onSetPreviewImage={setPreviewImage}
          onRemoveImage={removeImage}
          attachedFiles={attachedFiles}
          onRestorePastedFile={restorePastedFile}
          onRemoveFile={removeFile}
        />

        {/* Main input */}
        <div ref={inputAnchorRef} style={{ position: "relative" }}>
          {historyMenuOpen && inputHistory.length > 0 && (
            <InputHistoryMenu
              menuRef={historyMenuRef}
              itemRefs={historyItemRefs}
              inputHistory={inputHistory}
              activeIndex={historyActiveIndex}
              onHoverIndex={setHistoryActiveIndex}
              onSelect={applyHistoryInput}
            />
          )}
          {slashMenuOpen && slashQuery !== null && (
            <SlashCommandMenu
              listId={slashListId}
              countLabel={slashCommandCountLabel}
              loading={slashCommandsLoading}
              error={slashCommandsError}
              onRetryLoad={() => void onLoadSlashCommands?.()}
              isStreaming={isStreaming}
              filteredCount={filteredSlashCommands.length}
              groups={groupedSlashCommands}
              activeIndex={slashActiveIndex}
              itemRefs={slashItemRefs}
              onHoverIndex={setSlashActiveIndex}
              onSelect={selectSlashCommand}
            />
          )}
          {atMenuOpen && atQuery !== null && atMenuPosition && (
            <FileMentionMenu
              menuRef={atMenuRef}
              listRef={atListRef}
              itemRefs={atItemRefs}
              listId={atListId}
              position={atMenuPosition}
              cwd={cwd}
              atQuery={atQuery}
              fileIndex={fileIndex}
              fileIndexLoading={fileIndexLoading}
              needsServerSearch={needsServerSearch}
              serverResultInUse={serverResultInUse}
              matches={atMatches}
              activeIndex={atActiveIndex}
              onHoverIndex={setAtActiveIndex}
              onSelect={applyAtCompletion}
            />
          )}
          {promptOptimization && !promptOptimization.loading && (
            <PromptOptimizationReview
              state={promptOptimization}
              onKeepOriginal={() => setPromptOptimization(null)}
              onUseOptimized={(result) => {
                commitReplyDraft({ value: result, spans: [] });
                setPromptOptimization(null);
                requestAnimationFrame(() => textareaRef.current?.focus());
              }}
            />
          )}
          {contextControl && <div className="chat-composer-topbar">
            <div className="chat-composer-context">{contextControl}</div>
          </div>}
          {queueContent}
          <div
            className="chat-composer-surface"
            style={{
              position: "relative",
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              alignItems: "center",
              background: "var(--bg)",
              border: `1px solid ${bashMode ? "var(--tool-bg)" : "color-mix(in srgb, var(--border) 70%, transparent)"}`,
              borderRadius: "var(--radius-panel)",
              padding: "10px 10px 10px 14px",
              boxShadow: "0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -12px rgba(15,23,42,0.10)",
              transition: "border-color 0.15s, background 0.15s, box-shadow 0.15s",
            } as React.CSSProperties}
          >
          {parsedCommandInput.kind === "command" && <div className={commandStyles.context}>
            <AliIcon name="code" size={13} />
            <span className={commandStyles.description}>{parsedCommandInput.command.source === "builtin" ? getSlashCommandDescription({ name: parsedCommandInput.command.name, source: "builtin", description: buildSlashCommandRegistry([], false).find(item => item.name === parsedCommandInput.command.name)?.description ?? "chatCommands.title" }, t) : parsedCommandInput.command.description}</span>
            <details className={commandStyles.options}>
              <summary>{t("chatCommands.options")}<AliIcon name="arrowdown" size={10} /></summary>
              <div className={commandStyles.optionsPanel}>
                <p className={commandStyles.hint}>{t(parsedCommandInput.command.source === "extension" && isStreaming ? "chatCommands.extensionHint" : parsedCommandInput.command.argumentMode === "none" ? "chatCommands.noArguments" : "chatCommands.arguments")}{parsedCommandInput.command.argumentHint ? ` · ${parsedCommandInput.command.argumentHint}` : ""}</p>
            {isStreaming && parsedCommandInput.command.source !== "builtin" && <label className={commandStyles.delivery}>
              {t("chatCommands.delivery")}
              <select aria-label={t("chatCommands.delivery")} value={commandInputOptions.delivery ?? (parsedCommandInput.command.source === "extension" ? "immediate" : "next_turn")} onChange={event => setCommandInputOptions(current => ({ ...current, delivery: event.target.value === "immediate" ? undefined : event.target.value as ChatInputOptions["delivery"] }))}>
                {parsedCommandInput.command.source === "extension" ? <option value="immediate">{t("chatCommands.executeNow")}</option> : <><option value="steer">{t("chat.steer")}</option><option value="followUp">{t("chat.followUp")}</option></>}
                <option value="next_turn">{t("chatCommands.afterTask")}</option>
              </select>
            </label>}
            {parsedCommandInput.command.argumentMode !== "none" && commandInputOptions.afterPrompt === undefined && <button type="button" onClick={event => {
              event.currentTarget.closest("details")?.removeAttribute("open");
              setCommandInputOptions(current => ({ ...current, afterPrompt: "" }));
              requestAnimationFrame(() => followUpTextareaRef.current?.focus());
            }}>{t("chatCommands.addQuery")}</button>}
                <button type="button" onClick={() => { setValue([value, parsedCommandInput.afterPrompt].filter(Boolean).join("\n\n")); setCommandInputOptions(current => ({ workflow: current.workflow, inputMode: "text" })); textareaRef.current?.focus(); }}>{t("chatCommands.asText")}</button>
              </div>
            </details>
          </div>}
          <textarea
            ref={textareaRef}
            className="chat-composer-textarea"
            aria-autocomplete="list"
            aria-controls={slashMenuOpen ? slashListId : atMenuPosition ? atListId : undefined}
            aria-activedescendant={slashMenuOpen && filteredSlashCommands[slashActiveIndex] ? `${slashListId}-${slashActiveIndex}` : atMenuPosition && atMatches[atActiveIndex] ? `${atListId}-${atActiveIndex}` : undefined}
            value={value}
            onFocus={onCharacterActivity ? () => onCharacterActivity("focus") : undefined}
            onBlur={onCharacterActivity ? () => onCharacterActivity("blur") : undefined}
            onChange={(e) => {
              onCharacterActivity?.("input");
              if (localVoiceRecording || voiceTranscribing) stopVoiceInput(true);
              if (localDictation.error) localDictation.clearError();
              if (promptOptimization && e.target.value.trim() !== promptOptimization.source) {
                promptOptimizerAbortRef.current?.abort();
                promptOptimizerAbortRef.current = null;
                setPromptOptimization(null);
              }
              let nextValue = e.target.value;
              const previousName = value.trimStart().match(/^\/([^\s]*)/)?.[1];
              const nextName = nextValue.trimStart().match(/^\/([^\s]*)/)?.[1];
              if (previousName !== nextName) setCommandInputOptions(current => ({ ...current, commandKey: undefined, catalogRevision: undefined }));
              if (!nextValue.trimStart().startsWith("/") && commandInputOptions.afterPrompt?.trim()) {
                nextValue = [nextValue, commandInputOptions.afterPrompt].filter(Boolean).join("\n\n");
                setCommandInputOptions(current => ({ workflow: current.workflow }));
              }
              setValue(nextValue);
              setHistoryMenuOpen(false);
              updateAtQuery(nextValue, e.target.selectionStart);
            }}
            onSelect={(e) => {
              const el = e.currentTarget;
              updateAtQuery(el.value, el.selectionStart);
            }}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={(e) => {
              isComposingRef.current = false;
              lastCompositionEndAtRef.current = Date.now();
              const el = e.currentTarget;
              updateAtQuery(el.value, el.selectionStart);
            }}
            onInput={handleInput}
            onPaste={handlePaste}
            aria-keyshortcuts={prediction ? "Tab" : undefined}
            title={prediction ? t("prediction.acceptHint") : undefined}
            placeholder={
              prediction || (workflowAutoContinuing
                ? t("workflow.goal.continuing")
                : composerWorkflow.isGoalDrafting
                  ? t("workflow.goal.draftPlaceholder")
                  : (placeholder ?? (isStreaming && (onSteer || onFollowUp)
                    ? t("chat.steerPlaceholder")
                    : isStreaming ? t("chat.agentPlaceholder")
                    : t("chat.messagePlaceholder"))))
            }
            data-goal-drafting={composerWorkflow.isGoalDrafting ? "true" : undefined}
            rows={composerWorkflow.isGoalDrafting ? 3 : 1}
            style={{
              flex: "1 0 100%",
              minWidth: 0,
              background: "none",
              border: "none",
              outline: "none",
              resize: "none",
              color: "var(--text)",
              fontSize: "var(--chat-font-size)",
              lineHeight: "var(--chat-line-height)",
              fontFamily: "inherit",
              minHeight: composerWorkflow.isGoalDrafting ? 80 : 24,
              maxHeight: "min(38vh, 360px)",
              overflow: "auto",
              transition: "min-height 180ms ease",
            }}
          />

          {/* Composer footer: attach + model selector (bottom-right of the input) */}
          {parsedCommandInput.kind === "command" && parsedCommandInput.afterPrompt && commandInputOptions.afterPrompt === undefined && <div className={commandStyles.sequence}>
            <AliIcon name="arrowright" size={12} /><span>{t("chatCommands.promptStep")}</span><span>{parsedCommandInput.afterPrompt}</span>
          </div>}
          {isCommandInput && commandInputOptions.afterPrompt !== undefined && <label className={commandStyles.afterPrompt}>
            <span className={commandStyles.queryHeading}>{t("chatCommands.addQuery")}<button type="button" aria-label={t("chatCommands.cancelQuery")} onClick={() => setCommandInputOptions(current => ({ ...current, afterPrompt: undefined }))}><AliIcon name="close" size={12} /></button></span>
            <textarea ref={followUpTextareaRef} aria-label={t("chatCommands.query")} value={commandInputOptions.afterPrompt} placeholder={t("chatCommands.queryPlaceholder")} onChange={event => setCommandInputOptions(current => ({ ...current, afterPrompt: event.target.value }))} />
          </label>}
          {isCommandInput && parsedCommandInput.kind === "invalid" && !slashMenuOpen && value.trim() !== "/" && <div className={commandStyles.validation} role="status">
            <p>{t(`chatCommands.error.${parsedCommandInput.code}`, { name: parsedCommandInput.name })}</p><button type="button" onClick={() => { setValue([value, commandInputOptions.afterPrompt].filter(Boolean).join("\n\n")); setCommandInputOptions(current => ({ workflow: current.workflow, inputMode: "text" })); }}>{t("chatCommands.asText")}</button>
          </div>}
          <div className="chat-composer-footer" data-has-workflow={workflowEnabled && workflow ? true : undefined}
            data-workflow-mode={workflowEnabled && workflow ? (composerWorkflow.isGoalDrafting ? "goal" : composerWorkflow.isPlanMode ? "plan" : "agent") : undefined}>
            <AttachmentAddMenu
              menuRef={attachmentMenuRef}
              open={attachmentMenuOpen}
              canAttachFiles={canAttachFiles}
              hasAttachments={Boolean(attachedImages.length || attachedFiles.length)}
              workflowEnabled={Boolean(workflowEnabled && workflow)}
              planWorkflowActive={composerWorkflow.isPlanMode}
              goalWorkflowActive={composerWorkflow.isGoalDrafting || hasActiveGoal}
              workflowDisabled={isStreaming || workflowBusy}
              onToggle={() => setAttachmentMenuOpen((open) => !open)}
              onAttachFiles={() => {
                setAttachmentMenuOpen(false);
                fileInputRef.current?.click();
              }}
              onAttachFolder={() => {
                setAttachmentMenuOpen(false);
                folderInputRef.current?.click();
              }}
              onTogglePlanWorkflow={() => {
                setAttachmentMenuOpen(false);
                composerWorkflow.togglePlanMode();
              }}
              onStartGoalWorkflow={() => {
                setAttachmentMenuOpen(false);
                composerWorkflow.enterGoalDraftMode();
              }}
            />
            {onToolPermissionChange && <ToolPermissionControl state={toolPermission ?? null} saving={permissionSaving} onChange={onToolPermissionChange} />}
            {workflowEnabled && workflow && (
              <WorkflowModePills
                mode={composerWorkflow.isPlanMode ? "plan" : "agent"}
                goalDrafting={composerWorkflow.isGoalDrafting}
                disabled={isStreaming || workflowBusy}
                onExitPlan={composerWorkflow.exitPlanMode}
                onClearGoalDraft={composerWorkflow.clearGoalDraftMode}
              />
            )}
            {toolbarControl}
            {voiceInputSupported && (
              <VoiceInputControl
                voiceListening={voiceListening}
                transcribing={voiceTranscribing}
                error={effectiveVoiceError}
                shortcut={voiceInputShortcut}
                onToggle={toggleVoiceInput}
              />
            )}
            <button
              type="button"
              className="prompt-optimize-button"
              onClick={() => void handleOptimizePrompt()}
              disabled={!canOptimizePrompt}
              data-loading={promptOptimization?.loading || undefined}
              title={!model ? t("chat.selectModelToOptimize") : t("chat.optimizePromptDescription")}
              aria-label={t("chat.optimizePrompt")}
            >
              <AliIcon name="solution" size={15} />
              {(!isMobile || variant === "launcher") && <span>{promptOptimization?.loading ? t("chat.optimizingPrompt") : t("chat.optimizePrompt")}</span>}
            </button>
            <div style={{ flex: 1 }} />
            {variant === "conversation" ? <ExtensionStatusBar statuses={extensionStatuses} /> : null}
            {variant === "conversation" ? <SessionStatsBadge sessionStats={sessionStats} /> : null}
            {variant === "conversation" ? <ContextUsageRing contextUsage={contextUsage} /> : null}
            <div className="composer-submit-controls">
            {/* Codex-style model settings: one compact summary chip with focused submenus. */}
            {(modelOptions.length > 0 || currentName || modelError) && onModelChange && (
              <ModelSettingsMenu
                dropdownRef={dropdownRef}
                panelRef={modelDropdownPanelRef}
                isMobile={isMobile}
                isStreaming={isStreaming}
                isCompacting={isCompacting}
                isAutoModelSelection={isAutoModelSelection}
                model={model}
                currentName={currentName}
                modelOptions={modelOptions}
                modelsByProvider={modelsByProvider}
                showModelFilter={showModelFilter}
                modelFilter={modelFilter}
                onModelFilterChange={setModelFilter}
                dropdownOpen={modelDropdownOpen}
                dropdownRect={modelDropdownRect}
                menuSection={modelMenuSection}
                onToggleDropdown={(rect) => {
                  setModelDropdownRect(rect);
                  setModelDropdownOpen((open) => {
                    if (!open) setModelMenuSection(null);
                    else {
                      setModelMenuSection(null);
                      setModelFilter("");
                    }
                    return !open;
                  });
                }}
                onCloseDropdown={() => {
                  setModelDropdownOpen(false);
                  setModelMenuSection(null);
                  setModelFilter("");
                }}
                onSelectSection={setModelMenuSection}
                onSelectModel={(provider, modelId, isActive) => {
                  setModelDropdownOpen(false);
                  setModelMenuSection(null);
                  setModelFilter("");
                  if (!isActive || isAutoModelSelection) {
                    modelChangeCoordinatorRef.current!.track(onModelChange(provider, modelId));
                  }
                }}
                activeThinkingLevel={activeThinkingLevel}
                thinkingLevelLabel={thinkingLevelLabel}
                availableThinkingLevels={availableThinkingLevels}
                thinkingLevelMap={thinkingLevelMap}
                onThinkingLevelChange={onThinkingLevelChange}
                onCompact={onCompact}
                onAbortCompaction={onAbortCompaction}
              />
            )}
            {isStreaming && !isCommandInput && !(surfacePlacement !== "side" && sideChatEnabled && parseSideSlashTrigger(value).matched) ? (
              <StreamingSubmitControl
                canQueueStreamingMessage={canQueueStreamingMessage}
                runningSendMode={runningSendMode}
                sendModeMenuId={sendModeMenuId}
                sendModeButtonRef={sendModeButtonRef}
                sendModeMenuRef={sendModeMenuRef}
                sendModeHoverDismissedRef={sendModeHoverDismissedRef}
                keepSendModeOpen={keepSendModeOpen}
                closeSendModeMenu={closeSendModeMenu}
                scheduleSendModeClose={scheduleSendModeClose}
                openSendModeMenu={openSendModeMenu}
                onSubmitStreamingMessage={submitStreamingMessage}
                onSendQueued={sendQueued}
                onAbort={onAbort}
              />
            ) : (
              <button
                type="button"
                onClick={() => void submitComposer()}
                disabled={!canSend}
                title={t(isCommandInput ? parsedCommandInput.kind === "command" && parsedCommandInput.afterPrompt ? "chatCommands.executeAndAsk" : "chatCommands.execute" : isProcessingImages ? "chat.processingImages" : isProcessingFiles ? "chat.processingFiles" : isAutoModelSelection ? "chat.selectModel" : "chat.send")}
                aria-label={t(isCommandInput ? "chatCommands.execute" : isProcessingImages ? "chat.processingImages" : isProcessingFiles ? "chat.processingFiles" : isAutoModelSelection ? "chat.selectModel" : "chat.send")}
                className={isCommandInput ? commandStyles.sendButton : undefined}
                style={{
                  width: isCommandInput ? "auto" : 32, height: 32, padding: isCommandInput ? "0 10px" : 0, flexShrink: 0, gap: 6,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  border: "none", borderRadius: isCommandInput ? "var(--radius-control)" : "50%",
                  background: canSend ? "var(--text)" : "var(--bg-hover)",
                  color: canSend ? "var(--bg)" : "var(--text-dim)",
                  cursor: canSend ? "pointer" : "not-allowed",
                  transition: "background 120ms ease, color 120ms ease, transform 120ms ease",
                }}
              >
                {isCommandInput && <span>{t(parsedCommandInput.kind === "command" && parsedCommandInput.afterPrompt ? "chatCommands.executeAndAsk" : parsedCommandInput.kind === "command" && parsedCommandInput.command.source === "extension" && isStreaming && commandInputOptions.delivery !== "next_turn" ? "chatCommands.executeNow" : "chatCommands.execute")}</span>}
                <AliIcon name="send" size={16} />
              </button>
            )}
            </div>
          </div>
          </div>
        </div>

        {/* Bash mode status label */}
        {bashMode && (
          <div className="text-xs px-2 py-1" style={{ color: bashExcluded ? "var(--text-muted)" : "var(--accent)", marginTop: 4 }}>
             {t("chat.shell")}{bashExcluded ? null : <> · {t("chat.outputModel")}</>}
          </div>
        )}
      </div>
    </div>
  );
}));

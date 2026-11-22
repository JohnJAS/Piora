"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type KeyboardEvent, type MutableRefObject, type RefObject, type SetStateAction } from "react";
import { useApplicationShortcuts } from "@/hooks/useApplicationShortcuts";
import { useI18n } from "@/hooks/useI18n";
import type { ChatInputOptions } from "@/lib/chat-command-types";
import { clearDraft, getDraft } from "@/lib/draft-store";
import type { OpenSideChatResult } from "../side-chat/useSideChatController";
import type { SlashCommandPaletteItem } from "@/lib/commands";
import { isMacPlatform, shortcutMatchesEvent, shouldPreserveApplicationShortcut } from "@/lib/keyboard-shortcuts";
import { matchesSideSlashQuery, parseSideSlashTrigger } from "@/lib/side-chat/composer-trigger";
import {
  matchesWorkflowSlashQuery,
  parseWorkflowSlashTrigger,
  shouldBackspaceExitWorkflowMode,
} from "@/lib/workflow/composer-triggers";
import {
  DEFAULT_WORKFLOW_TURN_BUDGET,
  type WorkflowMode,
  type WorkflowPromptOptions,
} from "@/lib/workflow-types";

export interface PausedGoalPendingSubmission {
  submitKeepPaused: () => Promise<void>;
  submitResumeGoal: () => Promise<void>;
}

export interface UseComposerWorkflowOptions {
  workflow?: WorkflowPromptOptions;
  workflowEnabled: boolean;
  workflowBusy: boolean;
  hasActiveGoal: boolean;
  hasPausedGoal: boolean;
  workflowAutoContinuing: boolean;
  isStreaming: boolean;
  draftKey?: string;
  value: string;
  valueRef: MutableRefObject<string>;
  setValue: (next: string | ((current: string) => string)) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  commandInputOptions: ChatInputOptions;
  setCommandInputOptions: Dispatch<SetStateAction<ChatInputOptions>>;
  onWorkflowModeChange?: (mode: WorkflowMode) => void;
  onRequestGoalReplace?: (inlineObjective?: string) => void;
  onRequestPausedGoalResume?: (pending: PausedGoalPendingSubmission) => void;
  onAfterModeChange?: () => void;
  surfacePlacement?: "main" | "side";
  sideChatEnabled?: boolean;
  canOpenSideChat?: boolean;
  hasAttachments?: boolean;
  onOpenSideChat?: (initialPrompt?: string) => Promise<OpenSideChatResult | void> | OpenSideChatResult | void;
  onSideChatNotice?: (message: string) => void;
}

export function useComposerWorkflow({
  workflow,
  workflowEnabled,
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
  onAfterModeChange,
  surfacePlacement = "main",
  sideChatEnabled = false,
  canOpenSideChat = false,
  hasAttachments = false,
  onOpenSideChat,
  onSideChatNotice,
}: UseComposerWorkflowOptions) {
  const { t } = useI18n();
  const { bindings } = useApplicationShortcuts();
  const togglePlanBinding = bindings["composer.togglePlanMode"];
  const allowWorkflows = Boolean(workflowEnabled && surfacePlacement !== "side");

  const [goalDrafting, setGoalDrafting] = useState(false);
  const draftKeyRef = useRef(draftKey);
  draftKeyRef.current = draftKey;
  const submittingSideChatRef = useRef(false);

  // Clear Goal drafting whenever Laboratory is disabled, a Goal becomes active, or switching chats.
  useEffect(() => {
    if (!allowWorkflows || hasActiveGoal) setGoalDrafting(false);
  }, [allowWorkflows, hasActiveGoal]);

  useEffect(() => {
    setGoalDrafting(false);
  }, [draftKey]);

  const effectiveWorkflow: WorkflowPromptOptions | undefined = allowWorkflows && workflow
    ? (commandInputOptions.workflow ?? workflow)
    : undefined;
  const turnBudget = effectiveWorkflow?.turnBudget ?? workflow?.turnBudget ?? DEFAULT_WORKFLOW_TURN_BUDGET;
  const isPlanMode = Boolean(allowWorkflows && effectiveWorkflow?.mode === "plan");
  const isGoalDrafting = Boolean(allowWorkflows && goalDrafting && !hasActiveGoal);

  const focusComposer = useCallback(() => {
    requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
  }, [textareaRef]);

  const setMode = useCallback((mode: WorkflowMode) => {
    if (!allowWorkflows || isStreaming || workflowBusy) return;
    setCommandInputOptions((current) => ({
      ...current,
      workflow: { mode, turnBudget },
    }));
    onWorkflowModeChange?.(mode);
    onAfterModeChange?.();
  }, [allowWorkflows, isStreaming, workflowBusy, setCommandInputOptions, turnBudget, onWorkflowModeChange, onAfterModeChange]);

  const exitPlanMode = useCallback(() => {
    setMode("agent");
    focusComposer();
  }, [setMode, focusComposer]);

  const togglePlanMode = useCallback(() => {
    if (!allowWorkflows || isStreaming || workflowBusy) return;
    if (isPlanMode) {
      setMode("agent");
    } else {
      setGoalDrafting(false);
      setMode("plan");
    }
    focusComposer();
  }, [allowWorkflows, isStreaming, workflowBusy, isPlanMode, setMode, focusComposer]);

  const clearGoalDraftMode = useCallback(() => {
    setGoalDrafting(false);
    setCommandInputOptions((current) => {
      if (current.workflow?.mode !== "goal") return current;
      const next = { ...current };
      delete next.workflow;
      return next;
    });
    focusComposer();
  }, [setCommandInputOptions, focusComposer]);

  const enterGoalDraftMode = useCallback((inlineObjective?: string) => {
    if (!allowWorkflows || isStreaming || workflowBusy) return;
    if (hasActiveGoal) {
      onRequestGoalReplace?.(inlineObjective);
      return;
    }
    setGoalDrafting(true);
    setCommandInputOptions((current) => ({
      ...current,
      workflow: { mode: "goal", turnBudget },
    }));
    if (inlineObjective !== undefined) {
      setValue(inlineObjective);
      valueRef.current = inlineObjective;
    }
    onAfterModeChange?.();
    focusComposer();
  }, [
    allowWorkflows,
    isStreaming,
    workflowBusy,
    hasActiveGoal,
    onRequestGoalReplace,
    setCommandInputOptions,
    turnBudget,
    setValue,
    valueRef,
    onAfterModeChange,
    focusComposer,
  ]);

  const handleWorkflowMention = useCallback((kind: "plan" | "goal") => {
    if (kind === "plan") {
      if (!isPlanMode) togglePlanMode();
    } else {
      enterGoalDraftMode();
    }
  }, [isPlanMode, togglePlanMode, enterGoalDraftMode]);

  const workflowTogglePlanRef = useRef(togglePlanMode);
  workflowTogglePlanRef.current = togglePlanMode;

  useEffect(() => {
    if (!allowWorkflows) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || !togglePlanBinding) return;
      if (!shortcutMatchesEvent(event, togglePlanBinding, isMacPlatform(window.piDesktop?.platform))) return;
      const target = event.target instanceof Element ? event.target : null;
      if (shouldPreserveApplicationShortcut(event.target) && !target?.closest(".chat-composer-surface")) return;
      event.preventDefault();
      workflowTogglePlanRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [allowWorkflows, togglePlanBinding]);

  const buildWorkflowSlashItems = useCallback((slashQuery: string | null): SlashCommandPaletteItem[] => {
    if (slashQuery === null) return [];
    const items: SlashCommandPaletteItem[] = [];
    if (surfacePlacement !== "side" && sideChatEnabled && matchesSideSlashQuery(slashQuery)) {
      items.push({
        key: "sidechat:open",
        name: "side",
        description: "sideChat.slashDescription",
        source: "builtin",
        supported: Boolean(canOpenSideChat),
      });
    }
    if (!allowWorkflows) return items;
    if (matchesWorkflowSlashQuery(slashQuery, "plan")) {
      items.push({
        key: "workflow:plan",
        name: "plan",
        description: "workflow.slash.planDescription",
        source: "builtin",
        supported: !isStreaming,
      });
    }
    if (matchesWorkflowSlashQuery(slashQuery, "goal")) {
      items.push({
        key: "workflow:goal",
        name: "goal",
        description: "workflow.slash.goalDescription",
        source: "builtin",
        supported: !isStreaming,
      });
    }
    return items;
  }, [allowWorkflows, canOpenSideChat, isStreaming, sideChatEnabled, surfacePlacement]);

  const handleSlashWorkflowSelect = useCallback((command: SlashCommandPaletteItem): boolean => {
    if (command.key === "sidechat:open") {
      if (!sideChatEnabled) {
        setValue("");
        valueRef.current = "";
        onSideChatNotice?.(t("sideChat.disabledNotice"));
      } else if (!canOpenSideChat) {
        setValue("");
        valueRef.current = "";
        onSideChatNotice?.(t("sideChat.parentNotStartedNotice"));
      } else if (hasAttachments) {
        onSideChatNotice?.(t("sideChat.attachmentsNotSupported"));
      } else {
        const submittedText = valueRef.current;
        const originDraftKey = draftKeyRef.current;
        void Promise.resolve(onOpenSideChat?.()).then((result) => {
          const ok = result ? result.ok : true;
          if (ok) {
            if (draftKeyRef.current === originDraftKey) {
              if (valueRef.current === submittedText) {
                setValue("");
                valueRef.current = "";
              }
            } else if (originDraftKey && getDraft(originDraftKey)?.value === submittedText) {
              clearDraft(originDraftKey);
            }
          } else if (result?.error) {
            onSideChatNotice?.(result.error);
          }
        });
      }
      onAfterModeChange?.();
      return true;
    }
    if (!allowWorkflows) return false;
    if (command.key !== "workflow:plan" && command.key !== "workflow:goal") return false;
    setValue("");
    valueRef.current = "";
    if (command.key === "workflow:plan") togglePlanMode();
    else enterGoalDraftMode();
    return true;
  }, [allowWorkflows, canOpenSideChat, enterGoalDraftMode, hasAttachments, onAfterModeChange, onOpenSideChat, onSideChatNotice, setValue, sideChatEnabled, t, togglePlanMode, valueRef]);

  const handleWorkflowKeyDown = useCallback((
    event: KeyboardEvent<HTMLTextAreaElement>,
    options: { menusOpen: boolean; isComposing: boolean },
  ): boolean => {
    if (!allowWorkflows || options.isComposing) return false;
    if (
      event.key === "Tab"
      && event.shiftKey
      && !event.ctrlKey
      && !event.metaKey
      && !event.altKey
      && !options.menusOpen
      && !isStreaming
      && !workflowBusy
    ) {
      event.preventDefault();
      togglePlanMode();
      return true;
    }
    const exitTarget = shouldBackspaceExitWorkflowMode({
      mode: isPlanMode ? "plan" : "agent",
      goalDrafting: isGoalDrafting,
      value,
      selectionStart: event.currentTarget.selectionStart,
      selectionEnd: event.currentTarget.selectionEnd,
      key: event.key,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      isComposing: options.isComposing,
    });
    if (exitTarget === "plan") {
      event.preventDefault();
      exitPlanMode();
      return true;
    }
    if (exitTarget === "goal") {
      event.preventDefault();
      clearGoalDraftMode();
      return true;
    }
    return false;
  }, [allowWorkflows, isStreaming, workflowBusy, togglePlanMode, isPlanMode, isGoalDrafting, value, exitPlanMode, clearGoalDraftMode]);

  const submitWithWorkflowTriggers = useCallback(async (
    handleSend: (overrideOptions?: ChatInputOptions) => Promise<void>,
    overrideOptions?: ChatInputOptions,
  ) => {
    if (workflowAutoContinuing) return;
    const raw = valueRef.current;
    if (!commandInputOptions.commandKey) {
      const sideTrigger = parseSideSlashTrigger(raw);
      if (sideTrigger.matched) {
        if (surfacePlacement === "side") {
          onSideChatNotice?.(t("sideChat.nestedForbidden"));
          return;
        }
        if (!sideChatEnabled) {
          onSideChatNotice?.(t("sideChat.disabledNotice"));
          return;
        }
        if (!canOpenSideChat) {
          onSideChatNotice?.(t("sideChat.parentNotStartedNotice"));
          return;
        }
        if (hasAttachments) {
          onSideChatNotice?.(t("sideChat.attachmentsNotSupported"));
          return;
        }
        if (submittingSideChatRef.current) return;
        const submittedText = raw;
        const originDraftKey = draftKeyRef.current;
        submittingSideChatRef.current = true;
        try {
          const result = await onOpenSideChat?.(sideTrigger.initialPrompt || undefined);
          const ok = result ? result.ok : true;
          if (ok) {
            if (draftKeyRef.current === originDraftKey) {
              if (valueRef.current === submittedText) {
                setValue("");
                valueRef.current = "";
              }
            } else if (originDraftKey && getDraft(originDraftKey)?.value === submittedText) {
              clearDraft(originDraftKey);
            }
          } else if (result?.error) {
            onSideChatNotice?.(result.error);
          }
        } finally {
          submittingSideChatRef.current = false;
        }
        return;
      }
    }

    if (allowWorkflows && !isStreaming && !commandInputOptions.commandKey) {
      const trigger = parseWorkflowSlashTrigger(raw);
      if (trigger) {
        if (trigger.kind === "plan") {
          if (!trigger.rest) {
            setValue("");
            valueRef.current = "";
            togglePlanMode();
            return;
          }
          setValue(trigger.rest);
          valueRef.current = trigger.rest;
          setGoalDrafting(false);
          await handleSend({
            ...overrideOptions,
            workflow: { mode: "plan", turnBudget },
          });
          return;
        }
        if (trigger.kind === "goal") {
          if (hasActiveGoal) {
            setValue("");
            valueRef.current = "";
            onRequestGoalReplace?.(trigger.rest || undefined);
            return;
          }
          if (!trigger.rest) {
            setValue("");
            valueRef.current = "";
            enterGoalDraftMode();
            return;
          }
          setValue(trigger.rest);
          valueRef.current = trigger.rest;
          setGoalDrafting(false);
          await handleSend({
            ...overrideOptions,
            workflow: { mode: "goal", turnBudget },
          });
          return;
        }
      }
    }

    if (
      allowWorkflows
      && hasPausedGoal
      && !isStreaming
      && !isPlanMode
      && !isGoalDrafting
      && !overrideOptions?.workflow
      && raw.trim().length > 0
      && onRequestPausedGoalResume
    ) {
      onRequestPausedGoalResume({
        submitKeepPaused: async () => {
          await handleSend({ ...overrideOptions, workflow: { mode: "agent", preservePausedGoal: true } });
        },
        submitResumeGoal: async () => {
          await handleSend({ ...overrideOptions, workflow: { mode: "goal", turnBudget, resumePausedGoal: true } });
        },
      });
      return;
    }

    const wasGoalDrafting = isGoalDrafting;
    if (wasGoalDrafting) setGoalDrafting(false);
    await handleSend(
      wasGoalDrafting
        ? { ...overrideOptions, workflow: { mode: "goal", turnBudget } }
        : overrideOptions,
    );
  }, [
    workflowAutoContinuing,
    valueRef,
    commandInputOptions.commandKey,
    surfacePlacement,
    sideChatEnabled,
    canOpenSideChat,
    hasAttachments,
    onOpenSideChat,
    onSideChatNotice,
    t,
    allowWorkflows,
    isStreaming,
    hasPausedGoal,
    isPlanMode,
    isGoalDrafting,
    turnBudget,
    setValue,
    togglePlanMode,
    enterGoalDraftMode,
    hasActiveGoal,
    onRequestGoalReplace,
    onRequestPausedGoalResume,
  ]);

  return {
    effectiveWorkflow,
    isPlanMode,
    isGoalDrafting,
    togglePlanMode,
    exitPlanMode,
    enterGoalDraftMode,
    clearGoalDraftMode,
    handleWorkflowMention,
    buildWorkflowSlashItems,
    handleSlashWorkflowSelect,
    handleWorkflowKeyDown,
    submitWithWorkflowTriggers,
    t,
  };
}

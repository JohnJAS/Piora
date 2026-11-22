"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { SideChatStorage, SideChatSummary } from "@/lib/side-chat/types";
import type { TaskRuntimeSnapshot } from "@/lib/task-status";
import type { SessionInfo } from "@/lib/types";
import type { RightPanelTab } from "../workspace/RightPanel";
import {
  isSideChatTab,
  parseSideChatTabId,
  SIDE_CHAT_SKIP_TEMP_CLOSE_CONFIRM_KEY,
  toSideChatLoadingTabId,
  toSideChatTabId,
  type SideChatTabId,
} from "./side-chat-events";

export interface PendingSideChatCreate {
  clientId: string;
  parentSessionId: string;
  storage: SideChatStorage;
  initialPrompt?: string;
  quotedSelection?: string;
}

export interface SideChatLaunchPayload {
  initialPrompt?: string;
  quotedSelection?: string;
  submittedCommandId?: string;
}

export interface OpenSideChatRequest {
  storage?: SideChatStorage;
  initialPrompt?: string;
  quotedSelection?: string;
  forceNew?: boolean;
  idempotencyKey?: string;
  durableSubmit?: boolean;
}

export interface OpenSideChatResult {
  ok: boolean;
  sideId?: string;
  error?: string;
}

export interface SideChatLiveActivity {
  hasMessages: boolean;
  isRunning: boolean;
}

export interface UseSideChatControllerOptions {
  enabled: boolean;
  parentSession: SessionInfo | null;
  parentSnapshot?: TaskRuntimeSnapshot | null;
  parentRunning?: boolean;
  rightPanelOpen: boolean;
  rightPanelTab: RightPanelTab;
  setRightPanelOpen: (open: boolean) => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  restoredSideChatTab?: SideChatTabId | null;
  onRestoredSideChatTabHandled?: () => void;
  onPromotedSession: (session: SessionInfo) => void;
  onJumpToParent: () => void;
  onOpenFile?: (filePath: string) => void;
}

function readStoredOpenTabIds(parentSessionId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(`piora-side-chat-open-tabs:${parentSessionId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
  } catch {
    return [];
  }
}

function writeStoredOpenTabIds(parentSessionId: string, openIds: readonly string[]): void {
  if (typeof window === "undefined") return;
  try {
    if (openIds.length === 0) {
      window.localStorage.removeItem(`piora-side-chat-open-tabs:${parentSessionId}`);
    } else {
      window.localStorage.setItem(`piora-side-chat-open-tabs:${parentSessionId}`, JSON.stringify(openIds));
    }
  } catch {
    // Ignore storage quota errors cleanly.
  }
}

function shouldSkipTempCloseConfirm(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDE_CHAT_SKIP_TEMP_CLOSE_CONFIRM_KEY) === "true";
  } catch {
    return false;
  }
}

export function useSideChatController({
  enabled,
  parentSession,
  parentSnapshot,
  parentRunning = false,
  rightPanelOpen,
  rightPanelTab,
  setRightPanelOpen,
  setRightPanelTab,
  restoredSideChatTab = null,
  onRestoredSideChatTabHandled,
  onPromotedSession,
  onJumpToParent,
  onOpenFile,
}: UseSideChatControllerOptions) {
  const { t } = useI18n();
  const parentId = parentSession?.id ?? null;
  const [itemsState, setItemsState] = useState<{ parentSessionId: string | null; items: SideChatSummary[] }>({
    parentSessionId: null,
    items: [],
  });
  const [parentArchivedState, setParentArchivedState] = useState<{ parentSessionId: string | null; archived: boolean }>({
    parentSessionId: null,
    archived: false,
  });
  const [openIdsState, setOpenIdsState] = useState<{ parentSessionId: string | null; openIds: string[] }>({
    parentSessionId: null,
    openIds: [],
  });
  const [pendingCreates, setPendingCreates] = useState<PendingSideChatCreate[]>([]);
  const [unreadIdsState, setUnreadIdsState] = useState<{ parentSessionId: string | null; ids: Set<string> }>({
    parentSessionId: null,
    ids: new Set(),
  });
  const [pendingCloseConfirm, setPendingCloseConfirm] = useState<SideChatSummary | null>(null);
  const [pendingLaunchBySideId, setPendingLaunchBySideId] = useState<Map<string, SideChatLaunchPayload>>(() => new Map());
  const [liveActivityBySideId, setLiveActivityBySideId] = useState<Map<string, SideChatLiveActivity>>(() => new Map());
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Scope per-parent state synchronously during render so switching A -> B
  // never exposes A's side chats, open tabs, or unread counts for a single frame.
  const items = useMemo(
    () => (itemsState.parentSessionId === parentId ? itemsState.items : []),
    [itemsState, parentId],
  );
  const parentArchived = parentArchivedState.parentSessionId === parentId ? parentArchivedState.archived : false;
  const openIds = useMemo(
    () => (openIdsState.parentSessionId === parentId ? openIdsState.openIds : []),
    [openIdsState, parentId],
  );
  const unreadIds = useMemo(
    () => (unreadIdsState.parentSessionId === parentId ? unreadIdsState.ids : new Set<string>()),
    [parentId, unreadIdsState],
  );
  const scopedPendingCreates = useMemo(
    () => (parentId ? pendingCreates.filter((entry) => entry.parentSessionId === parentId) : []),
    [parentId, pendingCreates],
  );

  const parentIdRef = useRef<string | null>(parentId);
  parentIdRef.current = parentId;
  const openIdsRef = useRef(openIds);
  openIdsRef.current = openIds;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const rightPanelOpenRef = useRef(rightPanelOpen);
  rightPanelOpenRef.current = rightPanelOpen;
  const rightPanelTabRef = useRef(rightPanelTab);
  rightPanelTabRef.current = rightPanelTab;
  const restoredSideChatTabRef = useRef(restoredSideChatTab);
  restoredSideChatTabRef.current = restoredSideChatTab;
  const onRestoredSideChatTabHandledRef = useRef(onRestoredSideChatTabHandled);
  onRestoredSideChatTabHandledRef.current = onRestoredSideChatTabHandled;
  const fetchAbortRef = useRef<AbortController | null>(null);
  const deletingIdsRef = useRef<Set<string>>(new Set());
  const prevLiveRunningRef = useRef<string>("");

  const liveRunningSet = useMemo(
    () => new Set(parentSnapshot?.runningSideChatIds ?? []),
    [parentSnapshot?.runningSideChatIds],
  );

  const effectiveItems = useMemo(() => items.map((item) => {
    const liveActivity = liveActivityBySideId.get(item.id);
    const isRunning = item.running || liveRunningSet.has(item.id) || Boolean(liveActivity?.isRunning);
    return isRunning === item.running ? item : { ...item, running: isRunning };
  }), [items, liveActivityBySideId, liveRunningSet]);

  const activeSideChatId = useMemo(() => {
    const parsed = parseSideChatTabId(rightPanelTab);
    if (parsed?.kind !== "live") return null;
    return effectiveItems.some((item) => item.id === parsed.id && !item.archived) ? parsed.id : null;
  }, [effectiveItems, rightPanelTab]);

  // Clear unread state when viewing a side chat tab visibly.
  useEffect(() => {
    if (!rightPanelOpen || !activeSideChatId || !parentId) return;
    setUnreadIdsState((current) => {
      if (current.parentSessionId !== parentId || !current.ids.has(activeSideChatId)) return current;
      const next = new Set(current.ids);
      next.delete(activeSideChatId);
      return { parentSessionId: parentId, ids: next };
    });
  }, [activeSideChatId, parentId, rightPanelOpen]);

  const refreshSideChats = useCallback(async (targetParentId: string | null) => {
    fetchAbortRef.current?.abort();
    if (!enabled || !targetParentId) {
      setItemsState({ parentSessionId: targetParentId, items: [] });
      setOpenIdsState({ parentSessionId: targetParentId, openIds: [] });
      setPendingCloseConfirm(null);
      if (!enabled && restoredSideChatTabRef.current) {
        onRestoredSideChatTabHandledRef.current?.();
      }
      return;
    }
    const controller = new AbortController();
    fetchAbortRef.current = controller;
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(targetParentId)}/side-chats?includeArchived=true`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok || controller.signal.aborted || parentIdRef.current !== targetParentId) return;
      const payload = await response.json() as { enabled?: boolean; parentArchived?: boolean; sideChats?: SideChatSummary[] };
      if (controller.signal.aborted || parentIdRef.current !== targetParentId) return;
      setParentArchivedState({ parentSessionId: targetParentId, archived: Boolean(payload.parentArchived) });
      const list = Array.isArray(payload.sideChats) ? payload.sideChats : [];
      setItemsState({ parentSessionId: targetParentId, items: list });
      const validActiveIds = new Set(list.filter((item) => !item.archived).map((item) => item.id));
      const storedOpen = readStoredOpenTabIds(targetParentId).filter((id) => validActiveIds.has(id));
      const currentOpen = parentIdRef.current === targetParentId ? openIdsRef.current : [];
      const merged = currentOpen.filter((id) => validActiveIds.has(id));
      for (const id of storedOpen) {
        if (!merged.includes(id)) merged.push(id);
      }

      // S05: Restore persisted sidechat:<id> tab across reload if it belongs to this parent and is active.
      let restoredTargetTab: SideChatTabId | null = null;
      const pendingRestoreTab = restoredSideChatTabRef.current;
      if (pendingRestoreTab) {
        const parsedRestore = parseSideChatTabId(pendingRestoreTab);
        onRestoredSideChatTabHandledRef.current?.();
        if (parsedRestore?.kind === "live") {
          const targetSummary = list.find((item) => item.id === parsedRestore.id);
          if (targetSummary && !targetSummary.archived && !targetSummary.expired) {
            if (!merged.includes(targetSummary.id)) {
              merged.push(targetSummary.id);
            }
            if (rightPanelTabRef.current === "home") {
              restoredTargetTab = toSideChatTabId(targetSummary.id);
              setRightPanelTab(restoredTargetTab);
            }
          }
        }
      }

      openIdsRef.current = merged;
      setOpenIdsState({ parentSessionId: targetParentId, openIds: merged });
      writeStoredOpenTabIds(targetParentId, merged);

      // R3: If active tab points to a side chat no longer valid for this parent, reconcile immediately.
      if (!restoredTargetTab && isSideChatTab(rightPanelTabRef.current)) {
        const parsedActive = parseSideChatTabId(rightPanelTabRef.current);
        if (parsedActive?.kind === "live" && !validActiveIds.has(parsedActive.id)) {
          setRightPanelTab(merged[0] ? toSideChatTabId(merged[0]) : "home");
        }
      }
    } catch {
      // Transient fetch abort / offline errors are safely ignored until next action.
    }
  }, [enabled, setRightPanelTab]);

  // Reset per-parent tabs & load list whenever parentSession or enabled state changes.
  useEffect(() => {
    setErrorBanner(null);
    setParentArchivedState({ parentSessionId: parentId, archived: false });
    setPendingCloseConfirm(null);
    setUnreadIdsState({ parentSessionId: parentId, ids: new Set() });
    if (!enabled || !parentId) {
      setItemsState({ parentSessionId: parentId, items: [] });
      setOpenIdsState({ parentSessionId: parentId, openIds: [] });
      if (!enabled && restoredSideChatTabRef.current) {
        onRestoredSideChatTabHandledRef.current?.();
      }
      if (isSideChatTab(rightPanelTabRef.current)) setRightPanelTab("home");
      return;
    }
    const restored = readStoredOpenTabIds(parentId);
    setItemsState({ parentSessionId: parentId, items: [] });
    setOpenIdsState({ parentSessionId: parentId, openIds: restored });
    if (isSideChatTab(rightPanelTabRef.current)) {
      const parsed = parseSideChatTabId(rightPanelTabRef.current);
      if (parsed?.kind !== "live" || !restored.includes(parsed.id)) {
        setRightPanelTab(restored.length > 0 ? toSideChatTabId(restored[0]) : "home");
      }
    }
    void refreshSideChats(parentId);
    return () => {
      fetchAbortRef.current?.abort();
    };
  }, [enabled, parentId, refreshSideChats, setRightPanelTab]);

  // Refresh metadata once live running side chats settle back to idle.
  useEffect(() => {
    const signature = [...liveRunningSet].sort().join(",");
    const prev = prevLiveRunningRef.current;
    prevLiveRunningRef.current = signature;
    if (prev && signature !== prev && parentId && enabled) {
      void refreshSideChats(parentId);
    }
  }, [enabled, liveRunningSet, parentId, refreshSideChats]);

  const updateOpenIdsForParent = useCallback((targetParentId: string, updater: (current: string[]) => string[]) => {
    const base = parentIdRef.current === targetParentId ? openIdsRef.current : readStoredOpenTabIds(targetParentId);
    const next = updater(base);
    writeStoredOpenTabIds(targetParentId, next);
    if (parentIdRef.current === targetParentId) {
      openIdsRef.current = next;
      setOpenIdsState({ parentSessionId: targetParentId, openIds: next });
    }
  }, []);

  const reportSideChatActivity = useCallback((sideId: string, activity: SideChatLiveActivity) => {
    setLiveActivityBySideId((current) => {
      const prev = current.get(sideId);
      if (prev && prev.hasMessages === activity.hasMessages && prev.isRunning === activity.isRunning) {
        return current;
      }
      const next = new Map(current);
      next.set(sideId, activity);
      return next;
    });
  }, []);

  const selectSideChat = useCallback((sideId: string) => {
    if (!parentId || !enabled) return;
    const owned = itemsRef.current.find((item) => item.id === sideId && item.parentSessionId === parentId && !item.archived);
    if (!owned) return;
    updateOpenIdsForParent(parentId, (current) => current.includes(sideId) ? current : [...current, sideId]);
    setUnreadIdsState((current) => {
      if (current.parentSessionId !== parentId || !current.ids.has(sideId)) return current;
      const next = new Set(current.ids);
      next.delete(sideId);
      return { parentSessionId: parentId, ids: next };
    });
    setRightPanelTab(toSideChatTabId(sideId));
    setRightPanelOpen(true);
  }, [enabled, parentId, setRightPanelOpen, setRightPanelTab, updateOpenIdsForParent]);

  const openOrCreateSideChat = useCallback(async (request: OpenSideChatRequest = {}): Promise<OpenSideChatResult> => {
    if (!enabled || !parentId) {
      return { ok: false, error: t("sideChat.parentNotStartedNotice") };
    }
    const storage: SideChatStorage = request.storage === "temporary" ? "temporary" : "attached";
    const trimmedPrompt = request.initialPrompt?.trim() ?? "";
    const trimmedQuote = request.quotedSelection?.trim() ?? "";
    const wantsNew = Boolean(request.forceNew || trimmedPrompt || trimmedQuote);

    if (!wantsNew) {
      const existingOpen = openIdsRef.current.find((id) => effectiveItems.some((item) => item.id === id && !item.archived));
      const candidateId = existingOpen ?? effectiveItems.find((item) => !item.archived)?.id;
      if (candidateId) {
        selectSideChat(candidateId);
        return { ok: true, sideId: candidateId };
      }
    }

    const originParentId = parentId;
    const clientId = crypto.randomUUID();
    const loadingTabId = toSideChatLoadingTabId(clientId);
    const loadingEntry: PendingSideChatCreate = {
      clientId,
      parentSessionId: originParentId,
      storage,
      initialPrompt: request.initialPrompt,
      quotedSelection: request.quotedSelection,
    };
    const previousTab = rightPanelTabRef.current;

    setErrorBanner(null);
    setPendingCreates((current) => [...current, loadingEntry]);
    setRightPanelTab(loadingTabId);
    setRightPanelOpen(true);

    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(originParentId)}/side-chats`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storage }),
      });
      const payload = await response.json().catch(() => null) as { sideChat?: SideChatSummary; error?: string } | null;
      if (!response.ok || !payload?.sideChat) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }
      let created = payload.sideChat;

      if (trimmedPrompt && request.durableSubmit !== false) {
        const submitResponse = await fetch(`/api/agent/${encodeURIComponent(created.id)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "submit_input",
            message: trimmedPrompt,
            inputMode: "text",
            idempotencyKey: request.idempotencyKey ?? `side-launch:${created.id}`,
          }),
        });
        const submitPayload = await submitResponse.json().catch(() => null) as { data?: { commandId?: string }; error?: string } | null;
        if (!submitResponse.ok) {
          void fetch(`/api/sessions/${encodeURIComponent(originParentId)}/side-chats/${encodeURIComponent(created.id)}`, {
            method: "DELETE",
          }).catch(() => {});
          throw new Error(submitPayload?.error || `HTTP ${submitResponse.status}`);
        }
        created = {
          ...created,
          running: true,
          preview: created.preview || trimmedPrompt.slice(0, 120),
        };
        reportSideChatActivity(created.id, { hasMessages: true, isRunning: true });
        if (submitPayload?.data?.commandId) {
          setPendingLaunchBySideId((current) => {
            const next = new Map(current);
            next.set(created.id, { submittedCommandId: submitPayload.data!.commandId });
            return next;
          });
        }
      } else if (trimmedPrompt || trimmedQuote) {
        setPendingLaunchBySideId((current) => {
          const next = new Map(current);
          next.set(created.id, {
            ...(trimmedPrompt ? { initialPrompt: trimmedPrompt } : {}),
            ...(trimmedQuote ? { quotedSelection: trimmedQuote } : {}),
          });
          return next;
        });
      }

      setPendingCreates((current) => current.filter((item) => item.clientId !== clientId));

      if (parentIdRef.current !== originParentId) {
        const stored = readStoredOpenTabIds(originParentId);
        if (!stored.includes(created.id)) writeStoredOpenTabIds(originParentId, [...stored, created.id]);
        return { ok: true, sideId: created.id };
      }

      setItemsState((current) => {
        const base = current.parentSessionId === originParentId ? current.items : [];
        return {
          parentSessionId: originParentId,
          items: [created, ...base.filter((item) => item.id !== created.id)],
        };
      });
      updateOpenIdsForParent(originParentId, (current) => current.includes(created.id) ? current : [...current, created.id]);
      // R8: Only activate the newly created side-chat tab if the user did not switch away while waiting.
      if (rightPanelTabRef.current === loadingTabId) {
        setRightPanelTab(toSideChatTabId(created.id));
      }
      return { ok: true, sideId: created.id };
    } catch (error) {
      setPendingCreates((current) => current.filter((item) => item.clientId !== clientId));
      if (parentIdRef.current === originParentId && rightPanelTabRef.current === loadingTabId) {
        const parsedPrev = parseSideChatTabId(previousTab);
        setRightPanelTab(parsedPrev?.kind === "loading" ? "home" : previousTab);
      }
      const message = t("sideChat.createFailed", { error: error instanceof Error ? error.message : String(error) });
      setErrorBanner(message);
      return { ok: false, error: message };
    }
  }, [effectiveItems, enabled, parentId, reportSideChatActivity, selectSideChat, setRightPanelOpen, setRightPanelTab, t, updateOpenIdsForParent]);

  const closeTabImmediately = useCallback(async (sideId: string, deleteBackingFile: boolean): Promise<boolean> => {
    const originParentId = parentIdRef.current;
    if (!originParentId) return false;

    if (deleteBackingFile) {
      if (deletingIdsRef.current.has(sideId)) return false;
      deletingIdsRef.current.add(sideId);
      try {
        const response = await fetch(`/api/sessions/${encodeURIComponent(originParentId)}/side-chats/${encodeURIComponent(sideId)}`, {
          method: "DELETE",
        });
        if (!response.ok && response.status !== 404) {
          const payload = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(payload?.error || `HTTP ${response.status}`);
        }
      } catch (error) {
        if (parentIdRef.current === originParentId) {
          setErrorBanner(t("sideChat.actionFailed", { error: error instanceof Error ? error.message : String(error) }));
        }
        return false;
      } finally {
        deletingIdsRef.current.delete(sideId);
      }
    }

    const closingIndex = openIdsRef.current.indexOf(sideId);
    const nextOpenIds = openIdsRef.current.filter((id) => id !== sideId);
    updateOpenIdsForParent(originParentId, (current) => current.filter((id) => id !== sideId));

    if (parentIdRef.current !== originParentId) {
      return true;
    }

    setUnreadIdsState((current) => {
      if (current.parentSessionId !== originParentId || !current.ids.has(sideId)) return current;
      const next = new Set(current.ids);
      next.delete(sideId);
      return { parentSessionId: originParentId, ids: next };
    });
    if (rightPanelTabRef.current === toSideChatTabId(sideId)) {
      const nextTabId = nextOpenIds[Math.min(closingIndex, nextOpenIds.length - 1)];
      setRightPanelTab(nextTabId ? toSideChatTabId(nextTabId) : "home");
    }
    if (deleteBackingFile) {
      setItemsState((current) => {
        if (current.parentSessionId !== originParentId) return current;
        return {
          parentSessionId: originParentId,
          items: current.items.filter((item) => item.id !== sideId),
        };
      });
      setPendingLaunchBySideId((current) => {
        if (!current.has(sideId)) return current;
        const next = new Map(current);
        next.delete(sideId);
        return next;
      });
      setLiveActivityBySideId((current) => {
        if (!current.has(sideId)) return current;
        const next = new Map(current);
        next.delete(sideId);
        return next;
      });
    }
    return true;
  }, [setRightPanelTab, t, updateOpenIdsForParent]);

  const requestCloseTab = useCallback((sideId: string) => {
    const summary = effectiveItems.find((item) => item.id === sideId);
    if (!summary) {
      void closeTabImmediately(sideId, false);
      return;
    }
    const liveActivity = liveActivityBySideId.get(sideId);
    const hasActivity = summary.messageCount > 0
      || summary.running
      || pendingLaunchBySideId.has(sideId)
      || Boolean(liveActivity?.hasMessages || liveActivity?.isRunning);
    if (summary.storage === "temporary" && hasActivity && !shouldSkipTempCloseConfirm()) {
      setPendingCloseConfirm(summary);
      return;
    }
    void closeTabImmediately(sideId, summary.storage === "temporary");
  }, [closeTabImmediately, effectiveItems, liveActivityBySideId, pendingLaunchBySideId]);

  const confirmCloseTemporary = useCallback((dontAskAgain: boolean) => {
    const target = pendingCloseConfirm;
    setPendingCloseConfirm(null);
    if (dontAskAgain && typeof window !== "undefined") {
      try { window.localStorage.setItem(SIDE_CHAT_SKIP_TEMP_CLOSE_CONFIRM_KEY, "true"); } catch { /* ignore */ }
    }
    if (target) {
      void closeTabImmediately(target.id, true);
    }
  }, [closeTabImmediately, pendingCloseConfirm]);

  const renameSideChat = useCallback(async (sideId: string, name: string) => {
    const originParentId = parentIdRef.current;
    if (!originParentId) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(originParentId)}/side-chats/${encodeURIComponent(sideId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const payload = await response.json().catch(() => null) as { sideChat?: SideChatSummary; error?: string } | null;
      if (!response.ok || !payload?.sideChat) throw new Error(payload?.error || `HTTP ${response.status}`);
      if (parentIdRef.current !== originParentId) return;
      setItemsState((current) => {
        if (current.parentSessionId !== originParentId) return current;
        return {
          parentSessionId: originParentId,
          items: current.items.map((item) => (item.id === sideId ? payload.sideChat! : item)),
        };
      });
    } catch (error) {
      if (parentIdRef.current === originParentId) {
        setErrorBanner(t("sideChat.actionFailed", { error: error instanceof Error ? error.message : String(error) }));
      }
    }
  }, [t]);

  const setArchivedSideChat = useCallback(async (sideId: string, archived: boolean) => {
    const originParentId = parentIdRef.current;
    if (!originParentId) return;
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(originParentId)}/side-chats/${encodeURIComponent(sideId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      const payload = await response.json().catch(() => null) as { sideChat?: SideChatSummary; error?: string } | null;
      if (!response.ok || !payload?.sideChat) throw new Error(payload?.error || `HTTP ${response.status}`);
      if (parentIdRef.current !== originParentId) return;
      setItemsState((current) => {
        if (current.parentSessionId !== originParentId) return current;
        const nextItems = current.items.map((item) => (item.id === sideId ? payload.sideChat! : item));
        itemsRef.current = nextItems;
        return {
          parentSessionId: originParentId,
          items: nextItems,
        };
      });
      if (archived) {
        await closeTabImmediately(sideId, false);
      } else if (payload.sideChat.parentSessionId === originParentId && !payload.sideChat.archived) {
        updateOpenIdsForParent(originParentId, (current) => current.includes(sideId) ? current : [...current, sideId]);
        setUnreadIdsState((current) => {
          if (current.parentSessionId !== originParentId || !current.ids.has(sideId)) return current;
          const next = new Set(current.ids);
          next.delete(sideId);
          return { parentSessionId: originParentId, ids: next };
        });
        setRightPanelTab(toSideChatTabId(sideId));
        setRightPanelOpen(true);
      }
    } catch (error) {
      if (parentIdRef.current === originParentId) {
        setErrorBanner(t("sideChat.actionFailed", { error: error instanceof Error ? error.message : String(error) }));
      }
    }
  }, [closeTabImmediately, setRightPanelOpen, setRightPanelTab, t, updateOpenIdsForParent]);

  const deleteSideChat = useCallback(async (sideId: string) => {
    if (!parentIdRef.current) return;
    await closeTabImmediately(sideId, true);
  }, [closeTabImmediately]);

  const promoteSideChat = useCallback(async (sideId: string) => {
    const originParentId = parentIdRef.current;
    if (!originParentId) return;
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(originParentId)}/side-chats/${encodeURIComponent(sideId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "promote" }),
      });
      const payload = await response.json().catch(() => null) as { promotedSession?: SessionInfo; error?: string } | null;
      if (!response.ok || !payload?.promotedSession) throw new Error(payload?.error || `HTTP ${response.status}`);
      if (parentIdRef.current !== originParentId) return;
      onPromotedSession(payload.promotedSession);
    } catch (error) {
      if (parentIdRef.current === originParentId) {
        setErrorBanner(t("sideChat.actionFailed", { error: error instanceof Error ? error.message : String(error) }));
      }
    }
  }, [onPromotedSession, t]);

  const restartExpiredSideChat = useCallback((expiredSideId: string) => {
    void (async () => {
      const closed = await closeTabImmediately(expiredSideId, true);
      if (closed) {
        await openOrCreateSideChat({ storage: "temporary", forceNew: true });
      }
    })();
  }, [closeTabImmediately, openOrCreateSideChat]);

  const markAgentEnd = useCallback((sideId: string) => {
    const ownerParentId = parentIdRef.current;
    const viewingThisSideChat = rightPanelOpenRef.current && rightPanelTabRef.current === toSideChatTabId(sideId);
    if (!viewingThisSideChat && ownerParentId) {
      setUnreadIdsState((current) => {
        const base = current.parentSessionId === ownerParentId ? current.ids : new Set<string>();
        if (base.has(sideId)) return current;
        const next = new Set(base);
        next.add(sideId);
        return { parentSessionId: ownerParentId, ids: next };
      });
    }
    if (ownerParentId) {
      void refreshSideChats(ownerParentId);
    }
  }, [refreshSideChats]);

  const consumeLaunch = useCallback((sideId: string) => {
    setPendingLaunchBySideId((current) => {
      if (!current.has(sideId)) return current;
      const next = new Map(current);
      next.delete(sideId);
      return next;
    });
  }, []);

  const canCreate = Boolean(enabled && parentId && !parentArchived);
  const anyRunning = useMemo(
    () => effectiveItems.some((item) => item.running) || scopedPendingCreates.length > 0,
    [effectiveItems, scopedPendingCreates.length],
  );

  const panelProps = useMemo(() => ({
    enabled,
    canCreate,
    items: effectiveItems,
    openIds,
    pendingCreates: scopedPendingCreates,
    unreadIds,
    parentSnapshot,
    parentRunning,
    errorBanner,
    onDismissError: () => setErrorBanner(null),
    onOpenNew: (storage: SideChatStorage = "attached") => { void openOrCreateSideChat({ storage, forceNew: true }); },
    onSelect: selectSideChat,
    onRequestCloseTab: requestCloseTab,
    onRename: renameSideChat,
    onToggleArchive: setArchivedSideChat,
    onDelete: deleteSideChat,
    onPromote: promoteSideChat,
    onRestartExpired: restartExpiredSideChat,
    onJumpToParent,
    onOpenFile,
    onAgentEnd: markAgentEnd,
    onActivityChange: reportSideChatActivity,
    pendingLaunchBySideId,
    onConsumeLaunch: consumeLaunch,
  }), [
    canCreate,
    consumeLaunch,
    deleteSideChat,
    effectiveItems,
    enabled,
    errorBanner,
    markAgentEnd,
    onJumpToParent,
    onOpenFile,
    openIds,
    openOrCreateSideChat,
    parentRunning,
    parentSnapshot,
    pendingLaunchBySideId,
    promoteSideChat,
    renameSideChat,
    reportSideChatActivity,
    requestCloseTab,
    restartExpiredSideChat,
    scopedPendingCreates,
    selectSideChat,
    setArchivedSideChat,
    unreadIds,
  ]);

  return {
    items: effectiveItems,
    parentArchived,
    openIds,
    activeSideChatId,
    unreadIds,
    unreadCount: unreadIds.size,
    anyRunning,
    canCreate,
    errorBanner,
    clearErrorBanner: () => setErrorBanner(null),
    pendingCloseConfirm,
    cancelCloseConfirm: () => setPendingCloseConfirm(null),
    confirmCloseTemporary,
    openOrCreateSideChat,
    selectSideChat,
    setArchivedSideChat,
    panelProps,
  };
}

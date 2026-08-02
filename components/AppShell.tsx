"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useGlobalKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { SessionSidebar, type SessionSidebarHandle } from "./SessionSidebar";
import { ChatWindow, type TaskControls } from "./ChatWindow";
import { FileViewer } from "./FileViewer";
import { TabBar, type Tab } from "./TabBar";
import { ModelsConfig } from "./ModelsConfig";
import { SkillsConfig } from "./SkillsConfig";
import { PluginsConfig } from "./PluginsConfig";
import { SettingsDialog } from "./SettingsDialog";
import { ProjectTrustDialog } from "./ProjectTrustDialog";
import { BranchNavigator } from "./BranchNavigator";
import { BackgroundSettings } from "./BackgroundSettings";
import { AppearanceLooks } from "./AppearanceLooks";
import { FontSettings } from "./FontSettings";
import { CompanionPet } from "./CompanionPet";
import { CompanionSettingsDialog } from "./CompanionSettingsDialog";
import { SessionHistoryDialog } from "./SessionHistoryDialog";
import { isDarkTheme, useTheme } from "@/hooks/useTheme";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useResizablePanel } from "@/hooks/useResizablePanel";
import { useCompletionNotification } from "@/hooks/useCompletionNotification";
import { useCompanionPets } from "@/hooks/useCompanionPets";
import { useCompanionPreferences } from "@/hooks/useCompanionPreferences";
import { copyText } from "@/lib/clipboard";
import { getFileName } from "@/lib/file-paths";
import { buildAtMentionText, buildFileAtMentionsText, buildFileLineMentionText } from "@/lib/file-fuzzy";
import { getInitialNavigation } from "@/lib/initial-navigation";
import {
  getDefaultRightPanelWidth,
  getRightPanelMaxWidth,
  getSidebarMaxWidth,
  RIGHT_PANEL_FALLBACK_WIDTH,
  RIGHT_PANEL_MAX_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from "@/lib/panel-layout";
import type { SessionInfo, SessionTreeNode } from "@/lib/types";
import type { ProjectTrustStatus } from "@/lib/api-types";
import type { ChatInputHandle } from "./ChatInput";
import type { SessionStatsInfo } from "@/lib/pi-types";
import { canSendCompanionPhrase, type CompanionActivity } from "@/lib/companion";
import { AliIcon } from "./AliIcon";

type SessionCopyField = "file" | "id";
type AutoNameStatus =
  | { kind: "idle" }
  | { kind: "naming" }
  | { kind: "success" }
  | { kind: "error"; message: string };
type TopPanel = "branches" | "project" | "system" | "session" | "language" | "taskControls";

const TOP_BAR_ICON_BUTTON_SIZE = 36;
const LANGUAGE_MENU_WIDTH = 176;
const PROJECT_MENU_WIDTH = 360;
const TASK_CONTROLS_MENU_WIDTH = 336;
const SYSTEM_PROMPT_MENU_WIDTH = 480;

export function AppShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [initialNavigation] = useState(() => getInitialNavigation(searchParams));
  const { theme, themes, setTheme } = useTheme();
  const { locale, setLocale, t: translate, supportedLocales } = useI18n();
  const {
    notificationEnabled,
    notificationCapability,
    onNotificationToggle,
    notifyCompletion,
  } = useCompletionNotification();
  const isMobile = useIsMobile();
  const [selectedSession, setSelectedSession] = useState<SessionInfo | null>(null);
  // When user clicks +, we only store the cwd — no fake session id
  const [newSessionCwd, setNewSessionCwd] = useState<string | null>(null);
  const [initialCwdStatus, setInitialCwdStatus] = useState<"idle" | "validating" | "ready" | "error">(
    () => initialNavigation.requestedCwd ? "validating" : "idle",
  );
  const [initialCwdError, setInitialCwdError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sessionKey, setSessionKey] = useState(0);
  const [explorerRefreshKey, setExplorerRefreshKey] = useState(0);
  const [modelsConfigOpen, setModelsConfigOpen] = useState(false);
  const [modelsRefreshKey, setModelsRefreshKey] = useState(0);
  const [skillsConfigOpen, setSkillsConfigOpen] = useState(false);
  const [pluginsConfigOpen, setPluginsConfigOpen] = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [projectTrust, setProjectTrust] = useState<ProjectTrustStatus | null>(null);
  const [projectTrustDialogOpen, setProjectTrustDialogOpen] = useState(false);
  const [projectTrustBusy, setProjectTrustBusy] = useState(false);
  const [projectTrustError, setProjectTrustError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [mobileSidebarReady, setMobileSidebarReady] = useState(false);
  const [desktopChrome, setDesktopChrome] = useState(false);
  const sidebarWidthRef = useRef(SIDEBAR_DEFAULT_WIDTH);
  const rightPanelWidthRef = useRef(RIGHT_PANEL_FALLBACK_WIDTH);
  const getResponsiveRightPanelWidth = useCallback(
    () => typeof window === "undefined"
      ? RIGHT_PANEL_FALLBACK_WIDTH
      : getDefaultRightPanelWidth(window.innerWidth),
    [],
  );
  const getResponsiveSidebarMaxWidth = useCallback(
    () => typeof window === "undefined"
      ? SIDEBAR_MAX_WIDTH
      : getSidebarMaxWidth({
        viewportWidth: window.innerWidth,
        rightPanelOpen,
        rightPanelWidth: rightPanelWidthRef.current,
      }),
    [rightPanelOpen],
  );
  const getResponsiveRightPanelMaxWidth = useCallback(
    () => typeof window === "undefined"
      ? RIGHT_PANEL_MAX_WIDTH
      : getRightPanelMaxWidth({
        viewportWidth: window.innerWidth,
        sidebarOpen,
        sidebarWidth: sidebarWidthRef.current,
      }),
    [sidebarOpen],
  );
  const sidebarResizer = useResizablePanel({
    ariaLabel: translate("layout.resizeSidebar"),
    cssVariable: "--sidebar-width",
    defaultWidth: SIDEBAR_DEFAULT_WIDTH,
    getMaxWidth: getResponsiveSidebarMaxWidth,
    growthDirection: "right",
    maxWidth: SIDEBAR_MAX_WIDTH,
    minWidth: SIDEBAR_MIN_WIDTH,
    storageKey: "pi-sidebar-width",
    widthRef: sidebarWidthRef,
  });
  const rightPanelResizer = useResizablePanel({
    ariaLabel: translate("layout.resizeFilePanel"),
    cssVariable: "--right-panel-width",
    defaultWidth: RIGHT_PANEL_FALLBACK_WIDTH,
    getDefaultWidth: getResponsiveRightPanelWidth,
    getMaxWidth: getResponsiveRightPanelMaxWidth,
    growthDirection: "left",
    maxWidth: RIGHT_PANEL_MAX_WIDTH,
    minWidth: RIGHT_PANEL_MIN_WIDTH,
    storageKey: "pi-right-panel-width",
    widthRef: rightPanelWidthRef,
  });
  const reclampSidebarWidth = sidebarResizer.reclampWidth;
  const reclampRightPanelWidth = rightPanelResizer.reclampWidth;
  // On mobile the sidebar is an overlay drawer; hide it by default so the chat
  // is visible on load. Runs once the breakpoint resolves after hydration.
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);
  useEffect(() => {
    setMobileSidebarReady(true);
  }, []);
  useEffect(() => {
    if (!rightPanelOpen) return;
    reclampSidebarWidth();
    reclampRightPanelWidth();
  }, [reclampRightPanelWidth, reclampSidebarWidth, rightPanelOpen]);
  const chatInputRef = useRef<ChatInputHandle | null>(null);
  const sessionSidebarRef = useRef<SessionSidebarHandle>(null);
  const {
    preferences: companionPreferences,
    setPreferences: setCompanionPreferences,
    setOpen: setCompanionOpen,
  } = useCompanionPreferences();
  const companionOpen = companionPreferences.open;
  const [companionSettingsOpen, setCompanionSettingsOpen] = useState(false);
  const companionPets = useCompanionPets(companionOpen || companionSettingsOpen);
  const activeCompanionPet = companionPets.catalog?.installed.find(
    (pet) => pet.id === companionPreferences.selectedPetId,
  ) ?? null;
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [companionActivity, setCompanionActivity] = useState<CompanionActivity>(() => ({
    status: "idle",
    cause: translate("companion.activity.idleCause"),
  }));
  const topBarRef = useRef<HTMLDivElement>(null);
  const projectBtnRef = useRef<HTMLButtonElement>(null);
  const taskControlsBtnRef = useRef<HTMLButtonElement>(null);
  const topPanelFrameRef = useRef<HTMLDivElement>(null);
  const autoFocusedTopPanelRef = useRef<TopPanel | null>(null);
  const appearanceDialogRef = useRef<HTMLDivElement>(null);

  // Branch navigator state — populated by ChatWindow via onBranchDataChange
  const [branchTree, setBranchTree] = useState<SessionTreeNode[]>([]);
  const [branchActiveLeafId, setBranchActiveLeafId] = useState<string | null>(null);
  const branchLeafChangeFnRef = useRef<((leafId: string | null) => void) | null>(null);

  const handleBranchDataChange = useCallback((tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => {
    setBranchTree(tree);
    setBranchActiveLeafId(activeLeafId);
    branchLeafChangeFnRef.current = onLeafChange;
  }, []);

  const handleBranchLeafChange = useCallback((leafId: string | null) => {
    branchLeafChangeFnRef.current?.(leafId);
  }, []);

  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);

  const handleSystemPromptChange = useCallback((prompt: string | null) => {
    setSystemPrompt(prompt);
  }, []);

  // Session stats (tokens + cost) — populated by ChatWindow, displayed in top bar
  const [sessionStats, setSessionStats] = useState<SessionStatsInfo | null>(null);
  const [autoNameStatus, setAutoNameStatus] = useState<AutoNameStatus>({ kind: "idle" });
  const autoNameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeSessionIdRef = useRef<string | null>(selectedSession?.id ?? null);
  activeSessionIdRef.current = selectedSession?.id ?? null;
  const handleSessionStatsChange = useCallback((stats: SessionStatsInfo | null) => {
    setSessionStats(stats);
  }, []);
  const [copiedSessionField, setCopiedSessionField] = useState<SessionCopyField | null>(null);
  const sessionCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [projectPathCopied, setProjectPathCopied] = useState(false);
  const projectPathCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCopySessionField = useCallback((field: SessionCopyField, value: string) => {
    void copyText(value).then(() => {
      if (sessionCopyTimerRef.current) clearTimeout(sessionCopyTimerRef.current);
      setCopiedSessionField(field);
      sessionCopyTimerRef.current = setTimeout(() => setCopiedSessionField(null), 1400);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (sessionCopyTimerRef.current) clearTimeout(sessionCopyTimerRef.current);
      if (projectPathCopyTimerRef.current) clearTimeout(projectPathCopyTimerRef.current);
      if (autoNameTimerRef.current) clearTimeout(autoNameTimerRef.current);
    };
  }, []);

  // Context usage — populated by ChatWindow, displayed in top bar
  const [contextUsage, setContextUsage] = useState<{ percent: number | null; contextWindow: number; tokens: number | null } | null>(null);
  const handleContextUsageChange = useCallback((usage: { percent: number | null; contextWindow: number; tokens: number | null } | null) => {
    setContextUsage(usage);
  }, []);

  useEffect(() => {
    setCompanionActivity((current) => current.status === "idle"
      ? { ...current, cause: translate("companion.activity.idleCause") }
      : current);
  }, [translate]);

  const handleSendCompanionPhrase = useCallback((text: string) => (
    chatInputRef.current?.sendText(text) ?? false
  ), []);

  const handleSelectCompanionPet = useCallback((petId: string) => {
    setCompanionPreferences((current) => ({ ...current, selectedPetId: petId }));
  }, [setCompanionPreferences]);

  const toggleCompanion = useCallback(() => {
    setCompanionPreferences((current) => ({ ...current, open: !current.open }));
  }, [setCompanionPreferences]);

  // Single active panel — only one dropdown open at a time
  const [activeTopPanel, setActiveTopPanel] = useState<TopPanel | null>(null);
  const [topPanelPos, setTopPanelPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [taskControls, setTaskControls] = useState<TaskControls | null>(null);

  const toggleTopPanel = useCallback((panel: TopPanel) => {
    if (isMobile) setSidebarOpen(false);
    setActiveTopPanel((cur) => cur === panel ? null : panel);
  }, [isMobile]);

  const openAppearanceSettings = useCallback(() => {
    setActiveTopPanel(null);
    if (isMobile) setSidebarOpen(false);
    setAppearanceOpen(true);
  }, [isMobile]);

  const closeAppearanceSettings = useCallback(() => {
    setAppearanceOpen(false);
  }, []);

  const openSessionStatsPanel = useCallback(() => {
    if (isMobile) setSidebarOpen(false);
    setActiveTopPanel("session");
  }, [isMobile]);

  const handleSidebarToggle = useCallback(() => {
    if (isMobile) setActiveTopPanel(null);
    setSidebarOpen((open) => !open);
  }, [isMobile]);

  const handleOpenProjectPicker = useCallback(() => {
    setActiveTopPanel(null);
    sessionSidebarRef.current?.openProjectPicker();
  }, []);

  useEffect(() => {
    if (!activeTopPanel || !topBarRef.current) return;
    const update = () => {
      const topBarRect = topBarRef.current!.getBoundingClientRect();
      const compactMenuButton = activeTopPanel === "project"
        ? projectBtnRef.current
        : activeTopPanel === "taskControls"
          ? taskControlsBtnRef.current
          : activeTopPanel === "system"
            ? taskControlsBtnRef.current
            : null;
      if (compactMenuButton && !isMobile) {
        const buttonRect = compactMenuButton.getBoundingClientRect();
        const menuWidth = activeTopPanel === "project"
          ? PROJECT_MENU_WIDTH
          : activeTopPanel === "language"
            ? LANGUAGE_MENU_WIDTH
            : activeTopPanel === "system"
              ? SYSTEM_PROMPT_MENU_WIDTH
              : TASK_CONTROLS_MENU_WIDTH;
        const horizontalInset = 6;
        const width = Math.min(menuWidth, Math.max(0, topBarRect.width - horizontalInset * 2));
        const leftInViewport = Math.min(
          Math.max(buttonRect.left, topBarRect.left + horizontalInset),
          topBarRect.right - width - horizontalInset,
        );
        setTopPanelPos({
          top: topBarRect.height + 6,
          left: leftInViewport - topBarRect.left,
          width,
        });
        return;
      }
      if (activeTopPanel === "language" && !isMobile) {
        const horizontalInset = 6;
        const width = Math.min(LANGUAGE_MENU_WIDTH, Math.max(0, topBarRect.width - horizontalInset * 2));
        setTopPanelPos({
          top: topBarRect.height + 6,
          left: Math.max(horizontalInset, topBarRect.width - width - horizontalInset),
          width,
        });
        return;
      }
      setTopPanelPos({ top: topBarRect.height + 6, left: 6, width: Math.max(0, topBarRect.width - 12) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(topBarRef.current);
    if (projectBtnRef.current) ro.observe(projectBtnRef.current);
    if (taskControlsBtnRef.current) ro.observe(taskControlsBtnRef.current);
    return () => ro.disconnect();
  }, [activeTopPanel, isMobile]);

  useEffect(() => {
    if (!activeTopPanel) {
      autoFocusedTopPanelRef.current = null;
      return;
    }
    if (
      activeTopPanel !== "project"
      && activeTopPanel !== "taskControls"
      && activeTopPanel !== "language"
    ) return;
    if (!topPanelPos || autoFocusedTopPanelRef.current === activeTopPanel) return;

    const frame = window.requestAnimationFrame(() => {
      if (autoFocusedTopPanelRef.current === activeTopPanel) return;
      const firstItem = topPanelFrameRef.current?.querySelector<HTMLElement>(
        '[role="menuitem"]:not([disabled]), [role="menuitemradio"]:not([disabled]), [role="menuitemcheckbox"]:not([disabled]), button:not([disabled])',
      );
      if (!firstItem) return;
      // preventScroll: opening a menu must never scroll the page/scroll
      // containers — otherwise the whole window visibly jumps at the bottom.
      firstItem.focus({ preventScroll: true });
      autoFocusedTopPanelRef.current = activeTopPanel;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeTopPanel, topPanelPos]);

  useEffect(() => {
    if (!activeTopPanel) return;
    const focusItems = () => Array.from(
      topPanelFrameRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], button:not([disabled])') ?? [],
    ).filter((item) => !item.hasAttribute("disabled"));
    const restoreTriggerFocus = () => {
      if (activeTopPanel === "project") projectBtnRef.current?.focus({ preventScroll: true });
      if (activeTopPanel === "taskControls") taskControlsBtnRef.current?.focus({ preventScroll: true });
    };
    const closePanel = () => {
      setActiveTopPanel(null);
      restoreTriggerFocus();
    };
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const frame = topPanelFrameRef.current;
      if (frame?.contains(target) || topBarRef.current?.contains(target)) return;
      setActiveTopPanel(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closePanel();
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const items = focusItems();
      if (items.length === 0) return;
      event.preventDefault();
      const activeIndex = items.indexOf(document.activeElement as HTMLElement);
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowDown"
            ? (activeIndex + 1 + items.length) % items.length
            : (activeIndex - 1 + items.length) % items.length;
      items[nextIndex]?.focus();
    };
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeTopPanel]);

  useEffect(() => {
    if (!appearanceOpen) return;
    const dialog = appearanceDialogRef.current;
    const focusTarget = dialog?.querySelector<HTMLElement>("[data-appearance-close]");
    focusTarget?.focus({ preventScroll: true });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAppearanceSettings();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [appearanceOpen, closeAppearanceSettings]);

  // Right panel — file tabs only
  const [fileTabs, setFileTabs] = useState<Tab[]>([]);
  const [activeFileTabId, setActiveFileTabId] = useState<string | null>(null);
  const hasDirtyFileTabs = fileTabs.some((tab) => tab.isDirty);

  useEffect(() => {
    if (!hasDirtyFileTabs) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = true;
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasDirtyFileTabs]);

  const handleFileDirtyChange = useCallback((tabId: string, dirty: boolean) => {
    setFileTabs((currentTabs) => {
      const target = currentTabs.find((tab) => tab.id === tabId);
      if (!target || Boolean(target.isDirty) === dirty) return currentTabs;
      return currentTabs.map((tab) => tab.id === tabId ? { ...tab, isDirty: dirty } : tab);
    });
  }, []);

  // Same @mention format as the chat input's @ autocomplete, so the agent's
  // read tool resolves it the same way (it strips the @ prefix).
  const handleAtMention = useCallback((relativePath: string, isDir: boolean) => {
    chatInputRef.current?.insertText(buildAtMentionText(relativePath, isDir));
  }, []);

  const handleAtMentions = useCallback((relativePaths: string[]) => {
    const mentions = buildFileAtMentionsText(relativePaths);
    if (mentions) chatInputRef.current?.insertText(mentions);
  }, []);

  const handleFileLineMention = useCallback((relativePath: string, startLine: number, endLine: number) => {
    chatInputRef.current?.insertText(buildFileLineMentionText(relativePath, startLine, endLine));
  }, []);

  const initialSessionId = initialNavigation.sessionId;
  const [activeCwd, setActiveCwd] = useState<string | null>(null);
  const activeProjectRootRef = useRef<string | null>(null);
  // True once the initial ?session= URL param has been resolved (or confirmed absent)
  const [initialSessionRestored, setInitialSessionRestored] = useState<boolean>(() => !initialSessionId);
  // Suppresses sessionKey bump in handleCwdChange during the initial URL restore
  const suppressCwdBumpRef = useRef(false);

  useEffect(() => {
    const requestedCwd = initialNavigation.requestedCwd;
    if (!requestedCwd) return;

    const controller = new AbortController();
    setInitialCwdStatus("validating");
    setInitialCwdError(null);

    void fetch("/api/cwd/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: requestedCwd }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({})) as { cwd?: string; error?: string };
        if (!response.ok || !data.cwd) {
          throw new Error(data.error ?? `HTTP ${response.status}`);
        }

        // The sidebar will notify us when it adopts this cwd. Avoid remounting
        // the just-created empty chat during that initial synchronization.
        suppressCwdBumpRef.current = true;
        setNewSessionCwd(data.cwd);
        setInitialCwdStatus("ready");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setInitialCwdError(error instanceof Error ? error.message : String(error));
        setInitialCwdStatus("error");
      });

    return () => controller.abort();
  }, [initialNavigation]);

  const handleCwdChange = useCallback((cwd: string | null, projectRoot?: string | null) => {
    setActiveCwd(cwd);
    // Skip if cwd is null (initial mount).
    if (!cwd) return;
    const newProject = projectRoot ?? cwd;
    const currentProject = activeProjectRootRef.current
      ?? (selectedSession ? (selectedSession.projectRoot ?? selectedSession.cwd) : null);
    // Selecting a session in another project updates the session and sidebar
    // cwd in the same React event. The following cwd notification synchronizes
    // that selected session; it must not turn the transition into an empty chat.
    const cwdBelongsToSelectedSession = selectedSession?.cwd === cwd;
    const dirtyTabs = fileTabs.filter((tab) => tab.isDirty);
    const keepDirtyTabs = currentProject !== null
      && currentProject !== newProject
      && dirtyTabs.length > 0
      && !window.confirm(
        `Discard unsaved changes in ${dirtyTabs.length} file${dirtyTabs.length === 1 ? "" : "s"} before switching projects?\n\nCancel keeps the edited file tabs open.`,
      );
    activeProjectRootRef.current = newProject;

    // Keep the project identity in sync during the initial URL restore without
    // remounting the just-created or restored chat.
    if (suppressCwdBumpRef.current) {
      suppressCwdBumpRef.current = false;
      return;
    }
    // Worktrees of one repo share a project root. Moving the effective cwd
    // within the same project (e.g. switching worktree, or clicking a session
    // that lives in another worktree) must not close the open session.
    if (currentProject === newProject) {
      return;
    }
    // Close any session that belongs to a different project — it no longer
    // matches the selected project directory.
    if (!cwdBelongsToSelectedSession) {
      setSelectedSession(null);
      setNewSessionCwd((prev) => {
        if (prev && prev !== cwd) return null;
        return prev;
      });
      setSessionKey((k) => k + 1);
    }
    setBranchTree([]);
    setBranchActiveLeafId(null);
    setSystemPrompt(null);
    setActiveTopPanel(null);
    // Clean tabs can close with the old project. If the user declines to
    // discard unsaved work, retain only those dirty tabs; each tab remembers
    // its original cwd so previews and git diffs remain correctly scoped.
    if (keepDirtyTabs) {
      setFileTabs(dirtyTabs);
      setActiveFileTabId(
        activeFileTabId && dirtyTabs.some((tab) => tab.id === activeFileTabId)
          ? activeFileTabId
          : dirtyTabs[dirtyTabs.length - 1]?.id ?? null,
      );
      setRightPanelOpen(true);
    } else {
      setFileTabs([]);
      setActiveFileTabId(null);
      setRightPanelOpen(false);
    }
    if (!cwdBelongsToSelectedSession) {
      router.replace("/", { scroll: false });
    }
  }, [activeFileTabId, fileTabs, router, selectedSession]);

  const handleSelectSession = useCallback((session: SessionInfo, isRestore = false) => {
    setNewSessionCwd(null);
    setSelectedSession(session);
    setSessionKey((k) => k + 1);
    setSystemPrompt(null);
    setInitialSessionRestored(true);
    // On mobile, collapse the overlay drawer so the chat is revealed after pick.
    if (isMobile && !isRestore) setSidebarOpen(false);
    if (isRestore) {
      // Suppress the redundant sessionKey bump that would come from the
      // onCwdChange effect firing after setSelectedCwd in the sidebar
      suppressCwdBumpRef.current = true;
    }
    // Skip router.replace when restoring from URL — the param is already correct
    // and calling replace in production Next.js triggers a Suspense remount loop
    if (!isRestore) {
      router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
    }
  }, [router, isMobile]);

  const handleNewSession = useCallback((_sessionId: string, cwd: string) => {
    setSelectedSession(null);
    setNewSessionCwd(cwd);
    setSessionKey((k) => k + 1);
    setBranchTree([]);
    setBranchActiveLeafId(null);
    setSystemPrompt(null);
    setActiveTopPanel(null);
    if (isMobile) setSidebarOpen(false);
    router.replace("/", { scroll: false });
  }, [router, isMobile]);

  // Native Electron menus stay deliberately thin: the renderer owns all
  // application state and receives only a small action name from preload.
  useEffect(() => {
    const unsubscribe = window.piDesktop?.onMenuAction?.((action) => {
      switch (action) {
        case "new-session":
          if (activeCwd) handleNewSession(`menu-${Date.now()}`, activeCwd);
          else setSidebarOpen(true);
          break;
        case "choose-project":
          handleOpenProjectPicker();
          break;
        case "toggle-sidebar":
          handleSidebarToggle();
          break;
        case "toggle-files":
          setRightPanelOpen((open) => !open);
          break;
        case "settings":
          setSettingsDialogOpen(true);
          break;
        case "models":
          setModelsConfigOpen(true);
          break;
        case "skills":
          setSkillsConfigOpen(true);
          break;
        case "plugins":
          setPluginsConfigOpen(true);
          break;
        case "appearance":
        case "theme":
          openAppearanceSettings();
          break;
        case "language":
          toggleTopPanel("language");
          break;
        case "toggle-companion":
          toggleCompanion();
          break;
        case "companion-settings":
          setCompanionSettingsOpen(true);
          break;
        default:
          break;
      }
    });
    return unsubscribe;
  }, [activeCwd, handleNewSession, handleOpenProjectPicker, handleSidebarToggle, openAppearanceSettings, toggleCompanion, toggleTopPanel]);

  // Electron's titleBarOverlay does not make the browser-only
  // `(display-mode: window-controls-overlay)` media query true. Use the
  // preload bridge as the authoritative desktop-runtime signal so the real
  // packaged window gets draggable regions and native-control safe areas.
  useEffect(() => {
    setDesktopChrome(Boolean(window.piDesktop));
  }, []);

  // Global keyboard shortcuts (handles Esc, Ctrl+Alt+N etc.)
  useGlobalKeyboardShortcuts({
    onNewSession: (cwd: string) => handleNewSession(`kb-${Date.now()}`, cwd),
    activeCwd,
  });

  // Client-built transient SessionInfo (new session / fork) lacks the
  // server-computed projectRoot, which the same-project check in
  // handleCwdChange relies on. Hydrate it from the session list so switching
  // worktrees right after creating a session doesn't close the chat.
  const hydrateSelectedSession = useCallback((sessionId: string) => {
    void fetch("/api/sessions")
      .then((r) => (r.ok ? (r.json() as Promise<{ sessions: SessionInfo[] }>) : null))
      .then((d) => {
        const full = d?.sessions.find((s) => s.id === sessionId);
        if (!full) return;
        setSelectedSession((prev) => (prev && prev.id === sessionId && !prev.projectRoot ? full : prev));
      })
      .catch(() => {});
  }, []);

  // Called by ChatWindow when a new session gets its real id from pi
  const handleSessionCreated = useCallback((session: SessionInfo) => {
    setNewSessionCwd(null);
    setSelectedSession(session);
    setRefreshKey((k) => k + 1);
    hydrateSelectedSession(session.id);
    router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
  }, [router, hydrateSelectedSession]);

  const handleAgentEnd = useCallback(() => {
    setRefreshKey((k) => k + 1);
    setExplorerRefreshKey((k) => k + 1);
    const taskTitle = selectedSession?.name
      || (activeCwd ? getFileName(activeCwd) || activeCwd : undefined);
    void notifyCompletion(taskTitle);
  }, [activeCwd, notifyCompletion, selectedSession?.name]);

  const handleTaskControlsChange = useCallback((controls: TaskControls | null) => {
    setTaskControls(controls);
  }, []);

  const handleAutoName = useCallback(async () => {
    const sessionId = selectedSession?.id;
    if (!sessionId || autoNameStatus.kind === "naming") return;
    if (autoNameTimerRef.current) clearTimeout(autoNameTimerRef.current);
    setActiveTopPanel(null);
    setAutoNameStatus({ kind: "naming" });

    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/auto-name`, {
        method: "POST",
      });
      const body = (await response.json().catch(() => ({}))) as { title?: string; error?: string };
      if (!response.ok || !body.title) {
        throw new Error(body.error || `HTTP ${response.status}`);
      }

      const title = body.title.trim();
      setRefreshKey((key) => key + 1);
      if (activeSessionIdRef.current !== sessionId) return;
      setSelectedSession((current) => current?.id === sessionId ? { ...current, name: title } : current);
      setSessionStats((current) => current?.sessionId === sessionId ? { ...current, sessionName: title } : current);
      setAutoNameStatus({ kind: "success" });
      autoNameTimerRef.current = setTimeout(() => setAutoNameStatus({ kind: "idle" }), 1800);
    } catch (error) {
      if (activeSessionIdRef.current !== sessionId) return;
      const message = error instanceof Error ? error.message : String(error);
      setAutoNameStatus({ kind: "error", message });
      autoNameTimerRef.current = setTimeout(() => setAutoNameStatus({ kind: "idle" }), 5000);
    }
  }, [autoNameStatus.kind, selectedSession?.id]);

  useEffect(() => {
    if (autoNameTimerRef.current) clearTimeout(autoNameTimerRef.current);
    setAutoNameStatus({ kind: "idle" });
  }, [selectedSession?.id]);

  const handleExplorerRefresh = useCallback(() => {
    setExplorerRefreshKey((k) => k + 1);
  }, []);

  const handleSessionForked = useCallback((newSessionId: string) => {
    setRefreshKey((k) => k + 1);
    setSessionKey((k) => k + 1);
    setNewSessionCwd(null);
    setSelectedSession((prev) => ({
      ...(prev ?? { path: "", cwd: "", created: "", modified: "", messageCount: 0, firstMessage: "" }),
      id: newSessionId,
    }));
    hydrateSelectedSession(newSessionId);
    router.replace(`?session=${encodeURIComponent(newSessionId)}`, { scroll: false });
  }, [router, hydrateSelectedSession]);

  const handleInitialRestoreDone = useCallback(() => {
    setInitialSessionRestored(true);
  }, []);

  const handleSessionDeleted = useCallback((sessionId: string) => {
    setRefreshKey((k) => k + 1);
    if (selectedSession?.id === sessionId) {
      const cwd = selectedSession.cwd;
      setSelectedSession(null);
      setNewSessionCwd(cwd ?? null);
      setSessionKey((k) => k + 1);
      setBranchTree([]);
      setBranchActiveLeafId(null);
      setSystemPrompt(null);
      setActiveTopPanel(null);
      router.replace("/", { scroll: false });
    }
  }, [selectedSession, router]);

  const handleOpenFile = useCallback((
    filePath: string,
    fileName: string,
    options?: { sourceSessionId?: string | null; modeHint?: "diff" },
  ) => {
    const sourceSessionId = options?.sourceSessionId;
    const modeHint = options?.modeHint;
    const tabId = `file:${filePath}`;
    setFileTabs((prev) => {
      const existing = prev.find((t) => t.id === tabId);
      if (!existing) {
        return [...prev, {
          id: tabId,
          label: fileName,
          filePath,
          cwd: activeCwd ?? undefined,
          sourceSessionId,
          initialDisplayMode: modeHint,
        }];
      }
      const sourceUnchanged = !sourceSessionId || existing.sourceSessionId === sourceSessionId;
      const modeUnchanged = !modeHint || existing.initialDisplayMode === modeHint;
      if (sourceUnchanged && modeUnchanged) return prev;
      return prev.map((t) => {
        if (t.id !== tabId) return t;
        const next: Tab = { ...t };
        if (sourceSessionId) next.sourceSessionId = sourceSessionId;
        if (modeHint) next.initialDisplayMode = modeHint;
        return next;
      });
    });
    setActiveFileTabId(tabId);
    setRightPanelOpen(true);
    // On mobile the file panel is full-screen; close the drawer so it shows.
    if (isMobile) setSidebarOpen(false);
  }, [activeCwd, isMobile]);

  const handleOpenLinkedFile = useCallback((filePath: string) => {
    handleOpenFile(filePath, getFileName(filePath), { sourceSessionId: selectedSession?.id ?? null });
  }, [handleOpenFile, selectedSession?.id]);

  const handleCloseFileTab = useCallback((tabId: string) => {
    const closingIndex = fileTabs.findIndex((tab) => tab.id === tabId);
    if (closingIndex < 0) return;

    const closingTab = fileTabs[closingIndex];
    if (closingTab.isDirty && !window.confirm(`Discard unsaved changes in ${closingTab.label}?`)) return;

    const remaining = fileTabs.filter((tab) => tab.id !== tabId);
    setFileTabs(remaining);
    if (remaining.length === 0) setRightPanelOpen(false);
    if (activeFileTabId === tabId) {
      const nextIndex = Math.min(closingIndex, remaining.length - 1);
      setActiveFileTabId(nextIndex >= 0 ? remaining[nextIndex].id : null);
    }
  }, [activeFileTabId, fileTabs]);

  const handleViewFullHistory = useCallback(() => {
    if (!selectedSession) return;
    setActiveTopPanel(null);
    setHistoryDialogOpen(true);
  }, [selectedSession]);

  // Show chat area if a session is selected, or if we have a cwd to start a new session in
  const effectiveNewSessionCwd = newSessionCwd ?? (selectedSession === null && activeCwd ? activeCwd : null);
  const showChat = selectedSession !== null || effectiveNewSessionCwd !== null;
  const projectTrustCwd = selectedSession?.cwd ?? effectiveNewSessionCwd;
  const currentProjectCwd = selectedSession?.cwd ?? effectiveNewSessionCwd ?? activeCwd;
  const currentProjectPath = selectedSession?.projectRoot ?? activeProjectRootRef.current ?? currentProjectCwd;
  const currentProjectName = currentProjectPath ? getFileName(currentProjectPath) || currentProjectPath : null;
  // While restoring initial session from URL, don't show the placeholder
  const showPlaceholder = initialSessionRestored && !showChat;

  const handleNewSessionInCurrentProject = useCallback(() => {
    if (!currentProjectCwd) return;
    handleNewSession(`project-menu-${Date.now()}`, currentProjectCwd);
  }, [currentProjectCwd, handleNewSession]);

  const handleCopyCurrentProjectPath = useCallback(() => {
    if (!currentProjectCwd) return;
    void copyText(currentProjectCwd).then(() => {
      if (projectPathCopyTimerRef.current) clearTimeout(projectPathCopyTimerRef.current);
      setProjectPathCopied(true);
      projectPathCopyTimerRef.current = setTimeout(() => setProjectPathCopied(false), 1400);
    }).catch(() => {});
  }, [currentProjectCwd]);

  useEffect(() => {
    setProjectTrust(null);
    setProjectTrustDialogOpen(false);
    setProjectTrustError(null);
    if (!projectTrustCwd) return;

    const controller = new AbortController();
    fetch(`/api/project-trust?cwd=${encodeURIComponent(projectTrustCwd)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json() as ProjectTrustStatus & { error?: string };
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
        setProjectTrust(data);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("Failed to load project trust:", error);
      });
    return () => controller.abort();
  }, [projectTrustCwd]);

  const handleTrustProject = useCallback(async () => {
    if (!projectTrustCwd || projectTrustBusy) return;
    setProjectTrustBusy(true);
    setProjectTrustError(null);
    try {
      const response = await fetch("/api/project-trust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: projectTrustCwd }),
      });
      const data = await response.json() as ProjectTrustStatus & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setProjectTrust(data);
      setProjectTrustDialogOpen(false);
      setModelsRefreshKey((key) => key + 1);
      setSessionKey((key) => key + 1);
    } catch (error) {
      setProjectTrustError(error instanceof Error ? error.message : String(error));
    } finally {
      setProjectTrustBusy(false);
    }
  }, [projectTrustBusy, projectTrustCwd]);

  const activeCwdName = activeCwd ? getFileName(activeCwd) || activeCwd : null;
  const windowTitle = activeCwdName ? `${activeCwdName} - piGUI` : "piGUI";

  useEffect(() => {
    const syncWindowTitle = () => {
      if (document.title !== windowTitle) document.title = windowTitle;
    };

    syncWindowTitle();
    const observer = new MutationObserver(syncWindowTitle);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [windowTitle]);

  const sidebarContent = (
    <SessionSidebar
      ref={sessionSidebarRef}
      selectedSessionId={selectedSession?.id ?? null}
      onSelectSession={handleSelectSession}
      onNewSession={handleNewSession}
      initialSessionId={initialSessionId}
      skipInitialProjectSelection={initialNavigation.requestedCwd !== null}
      onInitialRestoreDone={handleInitialRestoreDone}
      refreshKey={refreshKey}
      onSessionDeleted={handleSessionDeleted}
      selectedCwd={selectedSession?.cwd ?? newSessionCwd ?? null}
      onCwdChange={handleCwdChange}
      onOpenFile={handleOpenFile}
      explorerRefreshKey={explorerRefreshKey}
      onExplorerRefresh={handleExplorerRefresh}
      onAtMention={handleAtMention}
      onAtMentions={handleAtMentions}
    />
  );

  return (
    <>
    <style>{`
      @keyframes session-info-pop {
        0% {
          opacity: 0;
          transform: translateY(-24px);
          filter: blur(6px);
          box-shadow: 0 2px 8px rgba(0,0,0,0);
        }
        55% {
          opacity: 1;
          transform: translateY(0);
          filter: blur(0);
          background: color-mix(in srgb, var(--accent) 8%, var(--bg-panel));
          box-shadow: 0 18px 44px rgba(37,99,235,0.16);
        }
        100% {
          opacity: 1;
          transform: translateY(0);
          filter: blur(0);
          background: var(--bg-panel);
          box-shadow: 0 10px 28px rgba(0,0,0,0.10);
        }
      }
      @keyframes session-info-light-wash {
        0% {
          opacity: 0;
          transform: translateX(-110%) skewX(-16deg);
        }
        24% {
          opacity: 0.42;
        }
        100% {
          opacity: 0;
          transform: translateX(115%) skewX(-16deg);
        }
      }
      .session-info-popover {
        position: relative;
        overflow: hidden;
        transform-origin: top right;
        animation: session-info-pop 360ms ease-out both;
        will-change: transform, opacity, filter, background, box-shadow;
      }
      .session-info-popover::after {
        content: "";
        position: absolute;
        top: 0;
        bottom: 0;
        left: 0;
        width: 44%;
        pointer-events: none;
        background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 24%, transparent), transparent);
        animation: session-info-light-wash 620ms ease-out both;
      }
      @media (prefers-reduced-motion: reduce) {
        .session-info-popover,
        .session-info-popover::after {
          animation: none;
        }
      }
      @media (max-width: 640px) {
        .sidebar-overlay-backdrop.sidebar-mobile-pending {
          opacity: 0 !important;
          pointer-events: none !important;
        }
        .sidebar-container.sidebar-mobile-pending.sidebar-open {
          transform: translateX(-100%);
          box-shadow: none;
        }
      }
    `}</style>
    <div className={`app-shell${desktopChrome ? " desktop-chrome" : ""}`} style={{ display: "flex", height: "100dvh", overflow: "hidden", background: "var(--bg)" }}>
      {/* Mobile overlay backdrop */}
      <div
        className={`sidebar-overlay-backdrop${mobileSidebarReady ? "" : " sidebar-mobile-pending"}`}
        onClick={() => setSidebarOpen(false)}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 199,
          background: "rgba(0,0,0,0.4)",
          opacity: sidebarOpen ? 1 : 0,
          pointerEvents: sidebarOpen ? "auto" : "none",
          transition: "opacity 0.25s ease",
        }}
      />

      {/* Left sidebar */}
      <div
        ref={sidebarResizer.panelRef}
        id="session-sidebar"
        className={`sidebar-container${sidebarOpen ? " sidebar-open" : " sidebar-closed"}${mobileSidebarReady ? "" : " sidebar-mobile-pending"}${sidebarResizer.isResizing ? " sidebar-resizing" : ""}`}
        style={{
          "--sidebar-width": `${sidebarResizer.width}px`,
          background: "var(--bg-panel)",
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          zIndex: 200,
        } as React.CSSProperties}
      >
        {sidebarContent}
      </div>
      {sidebarOpen && (
        <div
          {...sidebarResizer.separatorProps}
          aria-controls="session-sidebar"
          className={`panel-resize-handle sidebar-resize-handle${sidebarResizer.isResizing ? " is-resizing" : ""}`}
          data-resize-handle="sidebar"
          title={`${translate("layout.resizeSidebar")}: ${translate("layout.resizeHint")}`}
        />
      )}

      {/* Center: chat */}
      <div className="workspace-main" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0, position: "relative" }}>
        {/* Quiet conversation chrome: identity on the left, contextual actions on the right. */}
        <div ref={topBarRef} className="app-topbar">
          <button
            className="topbar-control topbar-icon-button topbar-sidebar-toggle"
            onClick={handleSidebarToggle}
            title={sidebarOpen ? translate("sidebar.hide") : translate("sidebar.show")}
            aria-label={sidebarOpen ? translate("sidebar.hide") : translate("sidebar.show")}
          >
            {sidebarOpen ? (
              <AliIcon name="layout" size={16} />
            ) : (
              <AliIcon name="menu" size={18} />
            )}
           </button>
          <div className="app-topbar-identity" aria-live="polite">
            <button
              ref={projectBtnRef}
              className="app-topbar-title"
              type="button"
              onClick={() => toggleTopPanel("project")}
              title={currentProjectPath ?? translate("projectMenu.noProject")}
              aria-label={translate("projectMenu.title")}
              aria-haspopup="menu"
              aria-expanded={activeTopPanel === "project"}
              aria-pressed={activeTopPanel === "project"}
              data-active={activeTopPanel === "project" ? "true" : "false"}
            >
              <span className="app-topbar-title-icon" aria-hidden="true">
                <AliIcon name="folder-open" size={16} />
              </span>
              <span className="app-topbar-title-text">
                {currentProjectName ?? translate("projectMenu.noProject")}
              </span>
              <AliIcon name="arrowdown" size={12} style={{ color: "var(--text-dim)" }} />
            </button>
            {showChat ? <span className="app-topbar-title-separator" aria-hidden="true">/</span> : null}
            {showChat ? (
              <span
                className={`app-topbar-title-path${selectedSession?.name ? "" : " is-placeholder"}`}
                title={selectedSession?.name ?? translate("i18n.newSession")}
              >
                {selectedSession?.name ?? translate("i18n.newSession")}
              </span>
            ) : null}
          </div>
          {showChat && projectTrust?.requiresTrust && !projectTrust.trusted && (
            <button
              type="button"
              onClick={() => {
                setProjectTrustError(null);
                setProjectTrustDialogOpen(true);
              }}
              title={translate("trust.resourcesNotLoaded")}
              aria-label={translate("trust.resourcesNotLoaded")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                height: "100%",
                padding: isMobile ? "0 10px" : "0 12px",
                background: "none",
                border: "none",
                borderRight: "1px solid var(--border)",
                color: "#d97706",
                cursor: "pointer",
                flexShrink: 0,
                fontSize: "var(--font-xs)",
                whiteSpace: "nowrap",
              }}
            >
              <AliIcon name="warning" size={13} />
              {!isMobile && <span>{translate("trust.resourcesNotLoaded")}</span>}
            </button>
          )}
          {showChat && (
            <div className="conversation-toolbar-actions">
              <button
                className="topbar-control topbar-history-button"
                type="button"
                onClick={handleViewFullHistory}
                disabled={!selectedSession}
                title={selectedSession ? translate("history.full") : translate("history.unsaved")}
                aria-label={translate("history.full")}
                aria-haspopup="dialog"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  height: "100%",
                  padding: "0 12px",
                  background: "none",
                  border: "none",
                  borderTop: "2px solid transparent",
                  color: selectedSession ? "var(--text-muted)" : "var(--text-dim)",
                  cursor: selectedSession ? "pointer" : "not-allowed",
                  opacity: selectedSession ? 1 : 0.45,
                  flexShrink: 0,
                  fontSize: "var(--font-xs)",
                  whiteSpace: "nowrap",
                  transition: "color 0.1s, background 0.1s, opacity 0.1s",
                }}
                onMouseEnter={(e) => {
                  if (!selectedSession) return;
                  e.currentTarget.style.color = "var(--text)";
                  e.currentTarget.style.background = "var(--bg-hover)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = selectedSession ? "var(--text-muted)" : "var(--text-dim)";
                  e.currentTarget.style.background = "none";
                }}
              >
                <AliIcon name="history" size={15} />
                {!isMobile && <span className="topbar-action-label">{translate("history.label")}</span>}
              </button>
              <BranchNavigator
                tree={branchTree}
                activeLeafId={branchActiveLeafId}
                onLeafChange={handleBranchLeafChange}
                inline
                compact={isMobile}
                containerRef={topBarRef}
                open={activeTopPanel === "branches"}
                onToggle={() => toggleTopPanel("branches")}
                hasSession={Boolean(selectedSession)}
              />
              <button
                className="topbar-control topbar-icon-button topbar-more-button"
                ref={taskControlsBtnRef}
                type="button"
                onClick={() => toggleTopPanel("taskControls")}
                title={translate("conversationMenu.buttonLabel")}
                aria-label={translate("conversationMenu.buttonLabel")}
                aria-haspopup="menu"
                aria-expanded={activeTopPanel === "taskControls"}
                aria-pressed={activeTopPanel === "taskControls"}
                data-active={activeTopPanel === "taskControls" ? "true" : "false"}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: TOP_BAR_ICON_BUTTON_SIZE,
                  height: "100%",
                  padding: 0,
                  background: activeTopPanel === "taskControls" ? "var(--bg-selected)" : "none",
                  border: "none",
                  borderTop: activeTopPanel === "taskControls" ? "2px solid var(--accent)" : "2px solid transparent",
                  borderRadius: 7,
                  color: activeTopPanel === "taskControls" ? "var(--text)" : "var(--text-muted)",
                  cursor: "pointer",
                  transition: "color 0.1s, background 0.1s",
                }}
              >
                <AliIcon name="ellipsis" size={16} />
              </button>
            </div>
          )}
          {/* Top panel dropdown — shared, only one active at a time */}
          {activeTopPanel && activeTopPanel !== "branches" && topPanelPos && (
            <div ref={topPanelFrameRef} className="app-top-panel-frame" style={{
              position: "absolute",
              top: topPanelPos.top,
              left: topPanelPos.left,
              width: topPanelPos.width,
              maxHeight: "calc(100dvh - 76px)",
              overflowY: "auto",
              zIndex: 500,
            }}>
              {activeTopPanel === "project" && (
                <div
                  className="soft-top-panel"
                  role="menu"
                  aria-label={translate("projectMenu.title")}
                  data-project-menu
                >
                  <div className="soft-top-panel-header">
                    <span className="soft-top-panel-icon" aria-hidden="true">
                      <AliIcon name="folder-open" size={15} />
                    </span>
                    <span className="soft-top-panel-heading">
                      <span className="soft-top-panel-title">
                        {currentProjectName ?? translate("projectMenu.noProject")}
                      </span>
                      <span className="soft-top-panel-description" title={currentProjectPath ?? undefined}>
                        {currentProjectPath ?? translate("projectMenu.description")}
                      </span>
                    </span>
                  </div>
                  <div className="soft-top-panel-body">
                    <button
                      className="soft-menu-item"
                      type="button"
                      role="menuitem"
                      disabled={!currentProjectCwd}
                      onClick={handleNewSessionInCurrentProject}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "18px minmax(0, 1fr)",
                        columnGap: 8,
                        cursor: currentProjectCwd ? "pointer" : "not-allowed",
                        opacity: currentProjectCwd ? 1 : 0.5,
                      }}
                    >
                      <span aria-hidden="true" style={{ paddingTop: 2, color: "var(--text-muted)" }}>
                        <AliIcon name="plus" size={14} />
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <span className="soft-menu-item-title">{translate("projectMenu.newSession")}</span>
                        <span className="soft-menu-item-description">{translate("projectMenu.newSessionDescription")}</span>
                      </span>
                    </button>
                    <button
                      className="soft-menu-item"
                      type="button"
                      role="menuitem"
                      onClick={handleOpenProjectPicker}
                      style={{ display: "grid", gridTemplateColumns: "18px minmax(0, 1fr)", columnGap: 8, cursor: "pointer" }}
                    >
                      <span aria-hidden="true" style={{ paddingTop: 2, color: "var(--text-muted)" }}>
                        <AliIcon name="project" size={14} />
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <span className="soft-menu-item-title">{translate("projectMenu.switchProject")}</span>
                        <span className="soft-menu-item-description">{translate("projectMenu.switchProjectDescription")}</span>
                      </span>
                    </button>
                    <button
                      className="soft-menu-item"
                      type="button"
                      role="menuitem"
                      disabled={!currentProjectCwd}
                      onClick={handleCopyCurrentProjectPath}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "18px minmax(0, 1fr)",
                        columnGap: 8,
                        cursor: currentProjectCwd ? "pointer" : "not-allowed",
                        opacity: currentProjectCwd ? 1 : 0.5,
                      }}
                    >
                      <span aria-hidden="true" style={{ paddingTop: 2, color: projectPathCopied ? "var(--accent)" : "var(--text-muted)" }}>
                        {projectPathCopied ? (
                          <AliIcon name="check" size={14} />
                        ) : (
                          <AliIcon name="copy" size={14} />
                        )}
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <span className="soft-menu-item-title">
                          {translate(projectPathCopied ? "projectMenu.copied" : "projectMenu.copyPath")}
                        </span>
                        <span className="soft-menu-item-description" title={currentProjectCwd ?? undefined}>
                          {currentProjectCwd ?? translate("projectMenu.copyPathDescription")}
                        </span>
                      </span>
                    </button>
                    {!sidebarOpen && (
                      <>
                        <div className="soft-top-panel-divider" />
                        <button
                          className="soft-menu-item"
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setSidebarOpen(true);
                            setActiveTopPanel(null);
                          }}
                          style={{ display: "grid", gridTemplateColumns: "18px minmax(0, 1fr)", columnGap: 8, cursor: "pointer" }}
                        >
                          <span aria-hidden="true" style={{ paddingTop: 2, color: "var(--text-muted)" }}>
                            <AliIcon name="layout" size={14} />
                          </span>
                          <span style={{ minWidth: 0 }}>
                            <span className="soft-menu-item-title">{translate("projectMenu.showSidebar")}</span>
                            <span className="soft-menu-item-description">{translate("projectMenu.showSidebarDescription")}</span>
                          </span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
              {activeTopPanel === "taskControls" && (
                <div
                  className="soft-top-panel"
                  role="menu"
                  aria-label={translate("conversationMenu.title")}
                >
                  <div className="soft-top-panel-header">
                    <span className="soft-top-panel-icon" aria-hidden="true">
                      <AliIcon name="ellipsis" size={15} />
                    </span>
                    <span className="soft-top-panel-heading">
                      <span className="soft-top-panel-title">{translate("conversationMenu.title")}</span>
                      <span className="soft-top-panel-description">{translate("conversationMenu.description")}</span>
                    </span>
                  </div>
                  <div className="soft-top-panel-body">
                    <div className="soft-top-panel-section-label">{translate("conversationMenu.actions")}</div>
                    {(() => {
                      const hasMessages = Boolean(
                        selectedSession
                        && (sessionStats?.userMessages ?? selectedSession.messageCount) > 0,
                      );
                      const disabled = !selectedSession || !hasMessages || autoNameStatus.kind === "naming";
                      const label = autoNameStatus.kind === "naming"
                        ? translate("title.generating")
                        : autoNameStatus.kind === "success"
                          ? translate("title.updated")
                          : autoNameStatus.kind === "error"
                            ? translate("title.failed")
                            : translate("title.generate");
                      const description = !selectedSession
                        ? translate("title.unsaved")
                        : !hasMessages
                          ? translate("title.noMessages")
                          : autoNameStatus.kind === "error"
                            ? autoNameStatus.message
                            : translate("conversationMenu.generateTitleDescription");

                      return (
                        <button
                          className="soft-menu-item"
                          type="button"
                          role="menuitem"
                          disabled={disabled}
                          onClick={() => {
                            setActiveTopPanel(null);
                            void handleAutoName();
                          }}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "18px minmax(0, 1fr)",
                            columnGap: 8,
                            cursor: disabled ? "not-allowed" : "pointer",
                            opacity: disabled ? 0.5 : 1,
                          }}
                        >
                          <span aria-hidden="true" style={{ paddingTop: 2, color: autoNameStatus.kind === "error" ? "#dc2626" : "var(--text-muted)" }}>
                            {autoNameStatus.kind === "naming" ? (
                              <AliIcon className="animate-spin" name="reload" size={14} />
                            ) : autoNameStatus.kind === "success" ? (
                              <AliIcon name="check" size={14} />
                            ) : (
                              <AliIcon name="edit" size={14} />
                            )}
                          </span>
                          <span style={{ minWidth: 0 }}>
                            <span className="soft-menu-item-title">{label}</span>
                            <span className="soft-menu-item-description">{description}</span>
                          </span>
                        </button>
                      );
                    })()}
                    <button
                      className="soft-menu-item"
                      type="button"
                      role="menuitem"
                      onClick={() => setActiveTopPanel("system")}
                      style={{ display: "grid", gridTemplateColumns: "18px minmax(0, 1fr)", columnGap: 8, cursor: "pointer" }}
                    >
                      <span aria-hidden="true" style={{ paddingTop: 2, color: systemPrompt ? "var(--accent)" : "var(--text-muted)" }}>
                        <AliIcon name="file" size={14} />
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <span className="soft-menu-item-title">{translate("system.prompt")}</span>
                        <span className="soft-menu-item-description">{translate("conversationMenu.systemPromptDescription")}</span>
                      </span>
                    </button>
                    <div className="soft-top-panel-divider" />
                    {taskControls ? (
                      <>
                        <div className="soft-top-panel-section-label">{translate("taskControls.tools")}</div>
                        {([
                          { value: "none", label: translate("taskControls.presetOff"), description: translate("chat.noTools") },
                          { value: "default", label: translate("taskControls.presetDefault"), description: translate("chat.builtInTools", { count: 4 }) },
                          { value: "full", label: translate("taskControls.presetFull"), description: translate("chat.allBuiltInTools") },
                        ] as const).map((option) => {
                          const selected = taskControls.toolPreset === option.value;
                          return (
                            <button
                              className="soft-menu-item"
                              key={option.value}
                              type="button"
                              role="menuitemradio"
                              aria-checked={selected}
                              disabled={taskControls.disabled}
                              onClick={() => {
                                if (!selected) taskControls.onToolPresetChange(option.value);
                              }}
                              style={{
                                display: "grid",
                                gridTemplateColumns: "18px minmax(0, 1fr)",
                                columnGap: 8,
                                background: selected ? "var(--bg-selected)" : "transparent",
                                cursor: taskControls.disabled ? "not-allowed" : "pointer",
                                opacity: taskControls.disabled ? 0.55 : 1,
                              }}
                            >
                              <span aria-hidden="true" style={{ paddingTop: 2, color: selected ? "var(--accent)" : "transparent" }}>
                                <AliIcon name="check" size={12} />
                              </span>
                              <span style={{ minWidth: 0 }}>
                                <span className="soft-menu-item-title" style={{ fontWeight: selected ? 600 : 500 }}>{option.label}</span>
                                <span className="soft-menu-item-description">{option.description}</span>
                              </span>
                            </button>
                          );
                        })}
                        <div className="soft-top-panel-divider" />
                        <button
                          className="soft-menu-item"
                          type="button"
                          role="menuitemcheckbox"
                          aria-checked={notificationEnabled}
                          disabled={notificationCapability === "unsupported"}
                          onClick={() => void onNotificationToggle()}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "18px minmax(0, 1fr) auto",
                            columnGap: 8,
                            alignItems: "start",
                            cursor: notificationCapability === "unsupported" ? "not-allowed" : "pointer",
                            opacity: notificationCapability === "unsupported" ? 0.5 : 1,
                          }}
                        >
                          <span aria-hidden="true" style={{ paddingTop: 2, color: notificationEnabled ? "var(--accent)" : "var(--text-dim)" }}>
                            <AliIcon name="notification" size={13} />
                          </span>
                          <span style={{ minWidth: 0 }}>
                            <span className="soft-menu-item-title">{translate("taskControls.notifications")}</span>
                            <span className="soft-menu-item-description">
                              {notificationCapability === "unsupported"
                                ? translate("taskControls.notificationsUnsupported")
                                : translate("taskControls.notificationsDescription")}
                            </span>
                          </span>
                          <span className={`soft-switch${notificationEnabled ? " is-on" : ""}`} aria-hidden="true">
                            <span />
                          </span>
                        </button>
                      </>
                    ) : (
                      <div className="soft-top-panel-empty" role="status">{translate("taskControls.loading")}</div>
                    )}
                  </div>
                </div>
              )}
              {activeTopPanel === "language" && (
                <div
                  className="soft-top-panel soft-top-panel-compact"
                  role="menu"
                  aria-label={translate("common.language")}
                >
                  {supportedLocales.map((plugin) => (
                    <button
                      className="soft-menu-item soft-menu-item-single-line"
                      key={plugin.id}
                      type="button"
                      onClick={() => {
                        setLocale(plugin.id as typeof locale);
                        setActiveTopPanel(null);
                      }}
                      role="menuitemradio"
                      aria-checked={locale === plugin.id}
                      style={{
                        display: "flex", alignItems: "center",
                        width: "100%", minHeight: 34,
                        background: locale === plugin.id ? "var(--bg-selected)" : "transparent",
                        cursor: "pointer",
                      }}
                    >
                      <span>{plugin.label}</span>
                      {locale === plugin.id ? (
                        <AliIcon name="check" size={13} style={{ color: "var(--accent)" }} />
                      ) : null}
                    </button>
                  ))}
                </div>
              )}
              {activeTopPanel === "system" && (
                <div className="soft-top-panel">
                  <div className="soft-top-panel-header">
                    <span className="soft-top-panel-icon" aria-hidden="true">
                      <AliIcon name="file" size={15} />
                    </span>
                    <span className="soft-top-panel-heading">
                      <span className="soft-top-panel-title">{translate("system.prompt")}</span>
                      <span className="soft-top-panel-description">{translate("system.description")}</span>
                    </span>
                  </div>
                  <div className="soft-top-panel-body">
                    {systemPrompt ? (
                      <div className="system-prompt-content">{systemPrompt}</div>
                    ) : systemPrompt === "" ? (
                      <div className="soft-top-panel-empty">{translate("system.empty")}</div>
                    ) : (
                      <div className="soft-top-panel-empty">{translate("system.load")}</div>
                    )}
                  </div>
                </div>
              )}
              {activeTopPanel === "session" && (
                <div className="session-info-popover soft-top-panel" style={{
                  background: "var(--bg-panel)",
                  padding: "12px 16px",
                }}>
                  {sessionStats ? (() => {
                    const sessionRows = [
                       ...(sessionStats.sessionName ? [{ label: translate("session.name"), value: sessionStats.sessionName, copyField: null }] : []),
                       { label: translate("session.file"), value: sessionStats.sessionFile ?? translate("session.inMemory"), copyField: "file" as const },
                       { label: translate("session.id"), value: sessionStats.sessionId, copyField: "id" as const },
                    ];
                    const messageRows = [
                       [translate("session.user"), sessionStats.userMessages.toLocaleString(locale)],
                       [translate("session.assistant"), sessionStats.assistantMessages.toLocaleString(locale)],
                       [translate("session.toolCalls"), sessionStats.toolCalls.toLocaleString(locale)],
                       [translate("session.toolResults"), sessionStats.toolResults.toLocaleString(locale)],
                       [translate("session.total"), sessionStats.totalMessages.toLocaleString(locale)],
                    ];
                    const tokenRows = [
                       [translate("session.input"), sessionStats.tokens.input.toLocaleString(locale)],
                       [translate("session.output"), sessionStats.tokens.output.toLocaleString(locale)],
                       ...(sessionStats.tokens.cacheRead > 0 ? [[translate("session.cacheRead"), sessionStats.tokens.cacheRead.toLocaleString(locale)]] : []),
                       ...(sessionStats.tokens.cacheWrite > 0 ? [[translate("session.cacheWrite"), sessionStats.tokens.cacheWrite.toLocaleString(locale)]] : []),
                       [translate("session.total"), sessionStats.tokens.total.toLocaleString(locale)],
                    ];
                    const ctx = contextUsage ?? sessionStats.contextUsage;
                    const formatCompact = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n);
                    const extraTokenRows = [
                       ...(sessionStats.cost > 0 ? [[translate("session.cost"), `$${sessionStats.cost.toFixed(4)}`]] : []),
                       ...(ctx?.contextWindow ? [[translate("session.context"), `${ctx.percent !== null ? `${ctx.percent.toFixed(1)}%` : "?"} / ${formatCompact(ctx.contextWindow)}`]] : []),
                    ];
                    const section = (
                      title: string,
                      sectionRows: string[][],
                      valueAlign: "left" | "right" = "left",
                      compact = false,
                    ) => (
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: "var(--font-xs)", fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>{title}</div>
                          <div style={{
                            display: "grid",
                            gridTemplateColumns: compact ? "max-content max-content" : "auto minmax(0, 1fr)",
                            columnGap: compact ? 14 : 12,
                            rowGap: 4,
                            justifyContent: compact ? "start" : undefined,
                          }}>
                            {sectionRows.map(([label, value]) => (
                              <div key={`${title}:${label}`} style={{ display: "contents" }}>
                                <div style={{ color: "var(--text-dim)", whiteSpace: "nowrap" }}>{label}</div>
                                <div style={{
                                  color: "var(--text-muted)",
                                  minWidth: 0,
                                  overflowWrap: compact ? "normal" : "anywhere",
                                  textAlign: valueAlign,
                                  whiteSpace: valueAlign === "right" ? "nowrap" : "normal",
                                }}>{value}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    const copyButton = (field: SessionCopyField, value: string) => {
                      const copied = copiedSessionField === field;
                      return (
                        <button
                          type="button"
                           title={copied ? translate("session.copied") : translate(field === "file" ? "session.copyFile" : "session.copyId")}
                          onClick={() => handleCopySessionField(field, value)}
                          style={{
                            alignSelf: "start",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 22,
                            height: 22,
                            marginTop: -2,
                            color: copied ? "var(--accent)" : "var(--text-dim)",
                            background: "transparent",
                            border: "1px solid var(--border)",
                            borderRadius: 4,
                            cursor: "pointer",
                            flex: "0 0 auto",
                            transition: "color 0.12s, border-color 0.12s, background 0.12s",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.color = "var(--accent)";
                            e.currentTarget.style.borderColor = "var(--accent)";
                            e.currentTarget.style.background = "var(--bg-hover)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.color = copied ? "var(--accent)" : "var(--text-dim)";
                            e.currentTarget.style.borderColor = "var(--border)";
                            e.currentTarget.style.background = "transparent";
                          }}
                        >
                          {copied ? (
                            <AliIcon name="check" size={12} />
                          ) : (
                            <AliIcon name="copy" size={12} />
                          )}
                        </button>
                      );
                    };
                    const sessionInfoSection = (
                      <div style={{ minWidth: 0 }}>
                         <div style={{ fontSize: "var(--font-xs)", fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>{translate("session.infoSection")}</div>
                        <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr) auto", columnGap: 12, rowGap: 8, alignItems: "start" }}>
                          {sessionRows.map((row) => (
                            <div key={`session-info:${row.label}`} style={{ display: "contents" }}>
                              <div style={{ color: "var(--text-dim)", whiteSpace: "nowrap" }}>{row.label}</div>
                              <div style={{
                                color: "var(--text-muted)",
                                minWidth: 0,
                                overflowWrap: "anywhere",
                                wordBreak: "break-word",
                                whiteSpace: "normal",
                              }}>{row.value}</div>
                              <div>{row.copyField ? copyButton(row.copyField, row.value) : null}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );

                    return (
                      <div style={{
                        display: "grid",
                        gridTemplateColumns: isMobile
                          ? "1fr"
                          : "minmax(360px, 1.7fr) minmax(140px, 0.55fr) minmax(190px, 0.75fr)",
                        gap: isMobile ? 16 : 24,
                        fontSize: "var(--font-sm)",
                        lineHeight: 1.5,
                        fontFamily: "var(--font-mono)",
                      }}>
                        {sessionInfoSection}
                         {section(translate("session.messages"), messageRows)}
                         {section(translate("session.tokens"), [...tokenRows, ...extraTokenRows], "right", true)}
                      </div>
                    );
                  })() : (
                    <div style={{ fontSize: "var(--font-sm)", color: "var(--text-muted)", fontStyle: "italic" }}>
                       {translate("session.load")}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

        </div>

        <div className="workspace-body">
          <div className="workspace-layout">
            {/* Chat content */}
            <div className="workspace-chat">
            {showChat ? (
              <ChatWindow
                key={sessionKey}
                session={selectedSession}
                newSessionCwd={effectiveNewSessionCwd}
                onAgentEnd={handleAgentEnd}
                onSessionCreated={handleSessionCreated}
                onSessionForked={handleSessionForked}
                modelsRefreshKey={modelsRefreshKey}
                chatInputRef={chatInputRef}
                onBranchDataChange={handleBranchDataChange}
                onSystemPromptChange={handleSystemPromptChange}
                onSessionStatsChange={handleSessionStatsChange}
                onSessionStatsPanelOpen={openSessionStatsPanel}
                onContextUsageChange={handleContextUsageChange}
                onOpenFile={handleOpenLinkedFile}
                onCompanionActivityChange={setCompanionActivity}
                onTaskControlsChange={handleTaskControlsChange}
              />
            ) : initialCwdStatus === "validating" ? (
              <div
                role="status"
                style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 24, color: "var(--text-muted)", textAlign: "center" }}
              >
                 <div style={{ fontSize: "var(--font-base)", color: "var(--text)" }}>{translate("workspace.opening")}</div>
                <div style={{ maxWidth: "min(720px, 100%)", overflowWrap: "anywhere", fontFamily: "var(--font-mono)", fontSize: "var(--font-sm)" }}>
                  {initialNavigation.requestedCwd}
                </div>
              </div>
            ) : initialCwdStatus === "error" ? (
              <div
                role="alert"
                style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 24, color: "var(--text-muted)", textAlign: "center" }}
              >
                 <div style={{ fontSize: "var(--font-base)", color: "#dc2626" }}>{translate("workspace.unable")}</div>
                <div style={{ maxWidth: "min(720px, 100%)", overflowWrap: "anywhere", fontFamily: "var(--font-mono)", fontSize: "var(--font-sm)" }}>
                  {initialNavigation.requestedCwd}
                </div>
                <div style={{ maxWidth: 720, fontSize: "var(--font-sm)" }}>{initialCwdError}</div>
              </div>
            ) : showPlaceholder ? (
              activeCwd ? (
                <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: "var(--font-lg)" }}>
                   {translate("workspace.selectSession")}
                </div>
              ) : (
                <div className="workspace-empty-state">
                  <div className="workspace-empty-mark" aria-hidden="true">
                    <AliIcon name="folder-open" size={22} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className="workspace-empty-title">{translate("workspace.getStarted")}</div>
                    <div className="workspace-empty-steps">
                      <span><b>1</b>{translate("workspace.selectProject")}</span>
                      <span><b>2</b>{translate("workspace.addModels")}</span>
                    </div>
                  </div>
                </div>
              )
            ) : null}
            </div>
            <CompanionPet
              open={companionOpen}
              onOpenChange={setCompanionOpen}
              activity={companionActivity}
              canSendPhrase={canSendCompanionPhrase(companionActivity.status, showChat)}
              onSendPhrase={handleSendCompanionPhrase}
              preferences={companionPreferences}
              setPreferences={setCompanionPreferences}
              activePet={activeCompanionPet}
            />
          </div>
        </div>
      </div>

      <div
        aria-hidden="true"
        className={`right-panel-overlay-backdrop${rightPanelOpen ? " is-open" : ""}`}
        onClick={() => setRightPanelOpen(false)}
      />
      {rightPanelOpen && (
        <div
          {...rightPanelResizer.separatorProps}
          aria-controls="file-panel"
          className={`panel-resize-handle right-panel-resize-handle${rightPanelResizer.isResizing ? " is-resizing" : ""}`}
          data-resize-handle="right-panel"
          title={`${translate("layout.resizeFilePanel")}: ${translate("layout.resizeHint")}`}
        />
      )}

      {/* Right panel: file viewer — always mounted, width animated via CSS */}
      <div
        ref={rightPanelResizer.panelRef}
        id="file-panel"
        className={`right-panel-container${rightPanelOpen ? " right-panel-open" : " right-panel-closed"}${rightPanelResizer.isResizing ? " right-panel-resizing" : ""}`}
        style={{
          "--right-panel-width": `${rightPanelResizer.width}px`,
          display: "flex",
          flexDirection: "column",
          borderLeft: "1px solid var(--border)",
          background: "var(--bg)",
        } as React.CSSProperties}
      >
        {/* Right panel tab bar */}
        <div className="right-panel-tabs" style={{ display: "flex", alignItems: "center", flexShrink: 0, background: "var(--bg-panel)", borderBottom: "1px solid var(--border)", minHeight: "max(40px, calc(var(--font-sm) + 28px))" }}>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <TabBar
              tabs={fileTabs}
              activeTabId={activeFileTabId ?? ""}
              onSelectTab={setActiveFileTabId}
              onCloseTab={handleCloseFileTab}
            />
          </div>

        </div>

        {/* File content */}
        <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
          {fileTabs.length > 0 ? (
            fileTabs.map((tab) => {
              const isActive = tab.id === activeFileTabId;
              return (
                <div
                  key={tab.id}
                  aria-hidden={!isActive}
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: isActive ? "block" : "none",
                    overflow: "hidden",
                  }}
                >
                  <FileViewer
                    filePath={tab.filePath}
                    cwd={tab.cwd ?? activeCwd ?? undefined}
                    sourceSessionId={tab.sourceSessionId}
                    gitRefreshKey={explorerRefreshKey}
                    initialDisplayMode={tab.initialDisplayMode}
                    active={rightPanelOpen && isActive}
                    onDirtyChange={(dirty) => handleFileDirtyChange(tab.id, dirty)}
                    onSaved={handleExplorerRefresh}
                    onMentionLines={rightPanelOpen && isActive ? handleFileLineMention : undefined}
                    onOpenFile={(filePath) => handleOpenFile(
                      filePath,
                      getFileName(filePath),
                      { sourceSessionId: tab.sourceSessionId },
                    )}
                  />
                </div>
              );
            })
          ) : (
            <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: "var(--font-sm)" }}>
               {translate("files.noneOpen")}
            </div>
          )}
        </div>
      </div>
    {/* File panel toggle — always visible at top-right */}
    <button
      className={`right-panel-toggle ${rightPanelOpen ? "is-open" : "is-closed"}`}
      data-panel-open={rightPanelOpen ? "true" : "false"}
      onClick={() => setRightPanelOpen((v) => !v)}
       aria-controls="file-panel"
       aria-expanded={rightPanelOpen}
       title={rightPanelOpen ? translate("files.hidePanel") : translate("files.showPanel")}
       aria-label={rightPanelOpen ? translate("files.hidePanel") : translate("files.showPanel")}
      style={{
        position: "fixed", right: 8, zIndex: 300,
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 32, height: 32, padding: 0,
        background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-control)",
        color: rightPanelOpen ? "var(--text)" : "var(--text-muted)",
        cursor: "pointer", transition: "color 0.12s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = rightPanelOpen ? "var(--text)" : "var(--text-muted)"; }}
    >
      <AliIcon name="layout" size={16} />
    </button>
    </div>
    {historyDialogOpen && selectedSession ? (
      <SessionHistoryDialog
        sessionId={selectedSession.id}
        sessionName={selectedSession.name}
        appearance={isDarkTheme(theme) ? "dark" : "light"}
        onClose={() => setHistoryDialogOpen(false)}
      />
    ) : null}
    {appearanceOpen && (
      <div
        className="app-shell-dialog-backdrop"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeAppearanceSettings();
        }}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 900,
          display: "grid",
          placeItems: "center",
          padding: 12,
          background: "rgba(10, 12, 16, 0.48)",
          backdropFilter: "blur(7px)",
        }}
      >
        <div
          className="app-shell-dialog"
          ref={appearanceDialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="appearance-dialog-title"
          aria-describedby="appearance-dialog-description"
          style={{
            width: "min(760px, calc(100vw - 24px))",
            maxHeight: "calc(100dvh - 24px)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            border: "1px solid color-mix(in srgb, var(--border) 88%, transparent)",
            borderRadius: "var(--radius-panel)",
            background: "var(--bg-panel)",
            boxShadow: "var(--shadow-popover)",
            color: "var(--text)",
          }}
        >
          <div className="app-shell-dialog-header" style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <h2 id="appearance-dialog-title" style={{ margin: 0, fontSize: "var(--font-xl)", fontWeight: 650, letterSpacing: "-0.015em" }}>
                {translate("appearance.title")}
              </h2>
              <p id="appearance-dialog-description" style={{ margin: "3px 0 0", color: "var(--text-muted)", fontSize: "var(--font-xs)" }}>
                {translate("appearance.description")}
              </p>
            </div>
            <button
              type="button"
              data-appearance-close
              onClick={closeAppearanceSettings}
              title={translate("appearance.close")}
              aria-label={translate("appearance.close")}
              style={{
                width: 30,
                height: 30,
                padding: 0,
                display: "grid",
                placeItems: "center",
                flexShrink: 0,
                border: "none",
                borderRadius: "var(--radius-control)",
                background: "transparent",
                color: "var(--text-muted)",
                cursor: "pointer",
              }}
            >
              <AliIcon name="close" size={16} />
            </button>
          </div>
          <div className="app-shell-dialog-body" style={{ minHeight: 0, overflowY: "auto", padding: 16 }}>
            <AppearanceLooks />
            <section aria-labelledby="appearance-theme-title" style={{ paddingBottom: 16 }}>
              <div style={{ marginBottom: 9 }}>
                <h3 id="appearance-theme-title" style={{ margin: 0, fontSize: "var(--font-sm)", fontWeight: 700 }}>
                  {translate("appearance.theme")}
                </h3>
                <p style={{ margin: "2px 0 0", color: "var(--text-dim)", fontSize: "var(--font-2xs)" }}>
                  {translate("appearance.themeHint")}
                </p>
              </div>
              <div
                role="radiogroup"
                aria-label={translate("appearance.theme")}
                style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(108px, 1fr))", gap: 8 }}
              >
                {themes.map((preset) => {
                  const selected = theme === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className="theme-menu-option"
                      data-theme-id={preset.id}
                      onClick={(event) => {
                        const rect = event.currentTarget.getBoundingClientRect();
                        setTheme(preset.id, {
                          x: rect.left + rect.width / 2,
                          y: rect.top + rect.height / 2,
                        });
                      }}
                      style={{
                        minWidth: 0,
                        padding: 8,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        border: selected ? "1px solid var(--accent)" : "1px solid var(--border)",
                        borderRadius: "var(--radius-control)",
                        background: selected ? "var(--bg-selected)" : "var(--bg)",
                        color: "var(--text)",
                        cursor: "pointer",
                        textAlign: "left",
                        fontSize: "var(--font-xs)",
                        transition: "border-color 0.12s, background 0.12s",
                      }}
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          position: "relative",
                          width: 28,
                          height: 28,
                          flex: "0 0 28px",
                          overflow: "hidden",
                          borderRadius: "var(--radius-small)",
                          background: preset.preview.background,
                          border: "1px solid color-mix(in srgb, var(--border) 72%, var(--text-dim))",
                        }}
                      >
                        <span style={{ position: "absolute", right: 4, bottom: 4, width: 8, height: 8, borderRadius: "50%", background: preset.preview.accent }} />
                      </span>
                      <span style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {translate(`theme.${preset.id}.name`)}
                      </span>
                      {selected ? (
                        <AliIcon name="check" size={13} style={{ color: "var(--accent)" }} />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </section>
            <FontSettings />
            <BackgroundSettings />
          </div>
        </div>
      </div>
    )}
    {modelsConfigOpen && (
      <ModelsConfig
        cwd={projectTrustCwd ?? activeCwd ?? undefined}
        onModelsChanged={() => setModelsRefreshKey((key) => key + 1)}
        onClose={() => { setModelsConfigOpen(false); setModelsRefreshKey((key) => key + 1); }}
      />
    )}
    {projectTrustDialogOpen && projectTrustCwd && (
      <ProjectTrustDialog
        cwd={projectTrustCwd}
        busy={projectTrustBusy}
        error={projectTrustError}
        onCancel={() => {
          if (!projectTrustBusy) setProjectTrustDialogOpen(false);
        }}
        onConfirm={() => void handleTrustProject()}
      />
    )}
    {skillsConfigOpen && projectTrustCwd && (
      <SkillsConfig cwd={projectTrustCwd} onClose={() => setSkillsConfigOpen(false)} />
    )}
    {pluginsConfigOpen && projectTrustCwd && (
      <PluginsConfig
        cwd={projectTrustCwd}
        sessionId={selectedSession?.id ?? null}
        onClose={() => setPluginsConfigOpen(false)}
        onReloaded={() => setSessionKey((k) => k + 1)}
      />
    )}
    <SettingsDialog
      open={settingsDialogOpen}
      onClose={() => setSettingsDialogOpen(false)}
      onOpenModels={() => { setSettingsDialogOpen(false); setModelsConfigOpen(true); }}
      onOpenSkills={() => { setSettingsDialogOpen(false); setSkillsConfigOpen(true); }}
      onOpenPlugins={() => { setSettingsDialogOpen(false); setPluginsConfigOpen(true); }}
      onOpenAppearance={() => { setSettingsDialogOpen(false); openAppearanceSettings(); }}
      onOpenLanguage={() => { setSettingsDialogOpen(false); toggleTopPanel("language"); }}
      onOpenCompanion={() => { setSettingsDialogOpen(false); setCompanionSettingsOpen(true); }}
    />
    <CompanionSettingsDialog
      open={companionSettingsOpen}
      onClose={() => setCompanionSettingsOpen(false)}
      companionOpen={companionOpen}
      onCompanionOpenChange={setCompanionOpen}
      selectedPetId={companionPreferences.selectedPetId}
      onSelectPet={handleSelectCompanionPet}
      catalog={companionPets.catalog}
      loading={companionPets.loading}
      error={companionPets.error}
      importingPetKey={companionPets.importingPetKey}
      onRefresh={() => { void companionPets.loadPets(); }}
      onImportPet={companionPets.importPet}
    />
    </>
  );
}

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
import { useTheme } from "@/hooks/useTheme";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useResizablePanel } from "@/hooks/useResizablePanel";
import { useCompletionNotification } from "@/hooks/useCompletionNotification";
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
const TASK_CONTROLS_MENU_WIDTH = 292;
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
  const [companionOpen, setCompanionOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [sidebarMenuOpen, setSidebarMenuOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [currentModelInfo, setCurrentModelInfo] = useState<{ provider: string; modelId: string } | null>(null);
  const [companionActivity, setCompanionActivity] = useState<CompanionActivity>(() => ({
    status: "idle",
    cause: translate("companion.activity.idleCause"),
  }));
  const topBarRef = useRef<HTMLDivElement>(null);
  const projectBtnRef = useRef<HTMLButtonElement>(null);
  const themeBtnRef = useRef<HTMLButtonElement>(null);
  const languageBtnRef = useRef<HTMLButtonElement>(null);
  const taskControlsBtnRef = useRef<HTMLButtonElement>(null);
  const topPanelFrameRef = useRef<HTMLDivElement>(null);
  const autoFocusedTopPanelRef = useRef<TopPanel | null>(null);
  const appearanceDialogRef = useRef<HTMLDivElement>(null);
  const sidebarMenuRef = useRef<HTMLDivElement>(null);
  const appearanceReturnFocusRef = useRef<HTMLElement | null>(null);

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
  const systemBtnRef = useRef<HTMLButtonElement>(null);

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

  useEffect(() => {
    if (!sidebarMenuOpen) return;
    const handler = (event: MouseEvent) => {
      if (sidebarMenuRef.current && !sidebarMenuRef.current.contains(event.target as Node)) {
        setSidebarMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [sidebarMenuOpen]);

  const handleSendCompanionPhrase = useCallback((text: string) => (
    chatInputRef.current?.sendText(text) ?? false
  ), []);

  // Single active panel — only one dropdown open at a time
  const [activeTopPanel, setActiveTopPanel] = useState<TopPanel | null>(null);
  const [topPanelPos, setTopPanelPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [taskControls, setTaskControls] = useState<TaskControls | null>(null);

  const toggleTopPanel = useCallback((panel: TopPanel) => {
    if (isMobile) setSidebarOpen(false);
    setActiveTopPanel((cur) => cur === panel ? null : panel);
  }, [isMobile]);

  const openAppearanceSettings = useCallback((trigger?: HTMLElement | null) => {
    appearanceReturnFocusRef.current = trigger
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setActiveTopPanel(null);
    if (isMobile) setSidebarOpen(false);
    setAppearanceOpen(true);
  }, [isMobile]);

  const closeAppearanceSettings = useCallback(() => {
    setAppearanceOpen(false);
    const returnFocus = appearanceReturnFocusRef.current;
    appearanceReturnFocusRef.current = null;
    window.requestAnimationFrame(() => returnFocus?.focus());
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
        : activeTopPanel === "language"
          ? languageBtnRef.current
          : activeTopPanel === "taskControls"
            ? taskControlsBtnRef.current
            : activeTopPanel === "system"
              ? systemBtnRef.current
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
      setTopPanelPos({ top: topBarRect.height + 6, left: 6, width: Math.max(0, topBarRect.width - 12) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(topBarRef.current);
    if (projectBtnRef.current) ro.observe(projectBtnRef.current);
    if (languageBtnRef.current) ro.observe(languageBtnRef.current);
    if (taskControlsBtnRef.current) ro.observe(taskControlsBtnRef.current);
    if (systemBtnRef.current) ro.observe(systemBtnRef.current);
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
      firstItem.focus();
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
      if (activeTopPanel === "project") projectBtnRef.current?.focus();
      if (activeTopPanel === "taskControls") taskControlsBtnRef.current?.focus();
      if (activeTopPanel === "language") languageBtnRef.current?.focus();
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
    focusTarget?.focus();
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
    setSelectedSession(null);
    setNewSessionCwd((prev) => {
      if (prev && prev !== cwd) return null;
      return prev;
    });
    setSessionKey((k) => k + 1);
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
    router.replace("/", { scroll: false });
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
        case "models":
          setModelsConfigOpen(true);
          break;
        case "theme":
          openAppearanceSettings();
          break;
        default:
          break;
      }
    });
    return unsubscribe;
  }, [activeCwd, handleNewSession, handleOpenProjectPicker, handleSidebarToggle, openAppearanceSettings]);

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
    window.open(
      `/api/sessions/${encodeURIComponent(selectedSession.id)}/export?inline=1`,
      "_blank",
      "noopener,noreferrer",
    );
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
  const canOpenSkillsPlugins = Boolean(activeCwd || selectedSession?.cwd || newSessionCwd);
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
    <>
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
      <div
        ref={sidebarMenuRef}
        className="sidebar-user-menu"
        style={{ borderTop: "1px solid var(--border)", padding: "7px 8px 8px", flexShrink: 0, position: "relative" }}
      >
        <button
          type="button"
          onClick={() => setSidebarMenuOpen((v) => !v)}
          title={currentModelInfo
            ? `${currentModelInfo.provider}/${currentModelInfo.modelId}`
            : translate("sidebar.selectModel")}
          aria-expanded={sidebarMenuOpen}
          aria-haspopup="menu"
          style={{
            width: "100%", height: 34, padding: "0 9px", display: "flex", alignItems: "center", gap: 8,
            background: sidebarMenuOpen ? "var(--bg-selected)" : "transparent",
            border: "none", borderRadius: "var(--radius-control)",
            color: sidebarMenuOpen ? "var(--text)" : "var(--text-muted)",
            cursor: "pointer", fontSize: "var(--font-sm)", textAlign: "left",
            transition: "background 0.12s, color 0.12s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--bg-hover)";
            e.currentTarget.style.color = "var(--text)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = sidebarMenuOpen ? "var(--bg-selected)" : "transparent";
            e.currentTarget.style.color = sidebarMenuOpen ? "var(--text)" : "var(--text-muted)";
          }}
        >
          <span style={{
            flexShrink: 0, width: 22, height: 22, borderRadius: 6,
            background: "var(--bg-panel)", border: "1px solid var(--border)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="4" y="4" width="16" height="16" rx="2" />
              <rect x="9" y="9" width="6" height="6" />
            </svg>
          </span>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {currentModelInfo?.modelId ?? translate("sidebar.selectModel")}
          </span>
          <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, transform: sidebarMenuOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
            <polyline points="2 3.5 5 6.5 8 3.5" />
          </svg>
        </button>

        {sidebarMenuOpen && (
          <div
            role="menu"
            style={{
              position: "absolute", bottom: "calc(100% + 6px)", left: 8, right: 8, zIndex: 120,
              background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8,
              boxShadow: "0 -6px 20px rgba(0,0,0,0.12)", overflow: "hidden", padding: "4px 0",
            }}
          >
            {([
              {
                label: translate("sidebar.settings"),
                onClick: () => { setSettingsDialogOpen(true); setSidebarMenuOpen(false); },
                disabled: false,
                icon: (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                ),
              },
              {
                label: translate("common.models"),
                onClick: () => { setModelsConfigOpen(true); setSidebarMenuOpen(false); },
                disabled: false,
                icon: (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" />
                    <line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" />
                    <line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" />
                    <line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" />
                    <line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" />
                  </svg>
                ),
              },
              {
                label: translate("common.skills"),
                onClick: () => { setSkillsConfigOpen(true); setSidebarMenuOpen(false); },
                disabled: !canOpenSkillsPlugins,
                icon: (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2L2 7l10 5 10-5-10-5z" />
                    <path d="M2 17l10 5 10-5" />
                    <path d="M2 12l10 5 10-5" />
                  </svg>
                ),
              },
              {
                label: translate("common.plugins"),
                onClick: () => { setPluginsConfigOpen(true); setSidebarMenuOpen(false); },
                disabled: !canOpenSkillsPlugins,
                icon: (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 7V2" />
                    <path d="M15 7V2" />
                    <path d="M6 13V8a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v5a6 6 0 0 1-12 0Z" />
                    <path d="M12 19v3" />
                  </svg>
                ),
              },
              {
                label: translate("appearance.title"),
                onClick: () => { openAppearanceSettings(); setSidebarMenuOpen(false); },
                disabled: false,
                icon: (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3a9 9 0 1 0 0 18h1.4a1.6 1.6 0 0 0 1.1-2.7 1.6 1.6 0 0 1 1.1-2.7H18a3 3 0 0 0 3-3A9 9 0 0 0 12 3Z" />
                    <circle cx="7.5" cy="10" r="1" fill="currentColor" stroke="none" />
                    <circle cx="10.5" cy="6.8" r="1" fill="currentColor" stroke="none" />
                    <circle cx="15" cy="7.8" r="1" fill="currentColor" stroke="none" />
                  </svg>
                ),
              },
            ] as { label: string; onClick: () => void; disabled: boolean; icon: React.ReactNode }[]).map(({ label, onClick, disabled, icon }) => (
              <button
                key={label}
                type="button"
                role="menuitem"
                onClick={onClick}
                disabled={disabled}
                title={label}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  width: "100%", height: 34, padding: "0 10px",
                  background: "none", border: "none",
                  color: disabled ? "var(--text-dim)" : "var(--text-muted)",
                  cursor: disabled ? "default" : "pointer", fontSize: "var(--font-sm)", textAlign: "left",
                  opacity: disabled ? 0.45 : 1,
                  transition: "background 0.12s, color 0.12s",
                }}
                onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; } }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = disabled ? "var(--text-dim)" : "var(--text-muted)"; }}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
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
        {/* Top bar with sidebar toggle */}
        <div ref={topBarRef} className="app-topbar" style={{ display: "flex", alignItems: "center", flexShrink: 0, borderBottom: "1px solid var(--border)", minHeight: "max(48px, calc(var(--font-base) + 34px))", background: "var(--bg)" }}>
          <button
            className="topbar-control topbar-icon-button"
            onClick={handleSidebarToggle}
             title={sidebarOpen ? translate("sidebar.hide") : translate("sidebar.show")}
             aria-label={sidebarOpen ? translate("sidebar.hide") : translate("sidebar.show")}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: TOP_BAR_ICON_BUTTON_SIZE, height: TOP_BAR_ICON_BUTTON_SIZE, padding: 0,
              background: "none", border: "none",
              color: "var(--text-muted)", cursor: "pointer", flexShrink: 0, transition: "color 0.12s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            {sidebarOpen ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            )}
           </button>
          <div
            aria-live="polite"
            style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0, flex: "1 1 auto" }}
          >
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
              style={{
                flex: "0 1 auto",
                width: "auto",
                maxWidth: selectedSession?.name ? "55%" : "100%",
                border: "none",
                borderRadius: "var(--radius-control)",
                background: activeTopPanel === "project" ? "var(--bg-selected)" : "transparent",
                cursor: "pointer",
                textAlign: "left",
                transition: "background 0.12s ease, color 0.12s ease",
              }}
            >
              <span className="app-topbar-title-icon" aria-hidden="true">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4l2 2h7A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z" />
                </svg>
              </span>
              <span className="app-topbar-title-text">
                {currentProjectName ?? translate("projectMenu.noProject")}
              </span>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, color: "var(--text-dim)" }}>
                <path d="m3 4.5 3 3 3-3" />
              </svg>
            </button>
            {selectedSession?.name && (
              <span className="app-topbar-title-path" title={selectedSession.name}>
                {selectedSession.name}
              </span>
            )}
          </div>
          <div
            className="app-topbar-cluster app-topbar-appearance"
            aria-label={translate("appearance.title")}
            style={{ display: "flex", alignItems: "center" }}
          >
          <button
            className="topbar-control topbar-icon-button"
            ref={themeBtnRef}
            type="button"
            onClick={(event) => openAppearanceSettings(event.currentTarget)}
            title={translate("appearance.title")}
            aria-label={translate("appearance.title")}
            aria-haspopup="dialog"
            aria-expanded={appearanceOpen}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: TOP_BAR_ICON_BUTTON_SIZE, height: TOP_BAR_ICON_BUTTON_SIZE, padding: 0,
              background: appearanceOpen ? "var(--bg-selected)" : "none",
              border: "none",
              color: appearanceOpen ? "var(--text)" : "var(--text-muted)",
              cursor: "pointer", flexShrink: 0, transition: "color 0.12s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = appearanceOpen ? "var(--text)" : "var(--text-muted)";
            }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3a9 9 0 1 0 0 18h1.4a1.6 1.6 0 0 0 1.1-2.7 1.6 1.6 0 0 1 1.1-2.7H18a3 3 0 0 0 3-3A9 9 0 0 0 12 3Z" />
              <circle cx="7.5" cy="10" r="1" fill="currentColor" stroke="none" />
              <circle cx="10.5" cy="6.8" r="1" fill="currentColor" stroke="none" />
              <circle cx="15" cy="7.8" r="1" fill="currentColor" stroke="none" />
            </svg>
          </button>
           <button
             className="topbar-control topbar-icon-button"
             ref={languageBtnRef}
             type="button"
             onClick={() => toggleTopPanel("language")}
             title={translate("common.language")}
             aria-label={translate("common.language")}
             aria-haspopup="menu"
             aria-expanded={activeTopPanel === "language"}
             aria-pressed={activeTopPanel === "language"}
             style={{
               display: "flex", alignItems: "center", justifyContent: "center",
               width: TOP_BAR_ICON_BUTTON_SIZE, height: TOP_BAR_ICON_BUTTON_SIZE, padding: 0,
               background: activeTopPanel === "language" ? "var(--bg-selected)" : "none",
               border: "none",
               color: activeTopPanel === "language" ? "var(--text)" : "var(--text-muted)",
               cursor: "pointer", flexShrink: 0, transition: "color 0.12s",
             }}
             onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
             onMouseLeave={(e) => {
               e.currentTarget.style.color = activeTopPanel === "language" ? "var(--text)" : "var(--text-muted)";
             }}
           >
             <svg
               width="16"
               height="16"
               viewBox="0 0 24 24"
               fill="none"
               stroke="currentColor"
               strokeWidth="1.8"
               strokeLinecap="round"
               strokeLinejoin="round"
               aria-hidden="true"
             >
               <path d="m5 8 6 6" />
               <path d="m4 14 6-6 2-3" />
               <path d="M2 5h12" />
               <path d="M7 2h1" />
               <path d="m22 22-5-10-5 10" />
               <path d="M14 18h6" />
             </svg>
           </button>
          </div>
          <button
            className="topbar-control topbar-icon-button"
            type="button"
            onClick={() => setCompanionOpen((current) => !current)}
            title={translate(companionOpen ? "companion.close" : "companion.open")}
            aria-label={translate(companionOpen ? "companion.close" : "companion.open")}
            aria-pressed={companionOpen}
            style={{
              position: "relative",
              display: "flex", alignItems: "center", justifyContent: "center",
              width: TOP_BAR_ICON_BUTTON_SIZE, height: TOP_BAR_ICON_BUTTON_SIZE, padding: 0,
              background: companionOpen ? "var(--bg-selected)" : "none",
              border: "none",
              color: companionOpen ? "var(--text)" : "var(--text-muted)",
              cursor: "pointer", flexShrink: 0, transition: "color 0.12s, background 0.12s",
            }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m7 8-2.5-4L3 10v5a6 6 0 0 0 6 6h6a6 6 0 0 0 6-6v-5l-1.5-6L17 8" />
              <path d="M8.5 13h.01M15.5 13h.01M9.5 17c1.5 1.2 3.5 1.2 5 0" />
            </svg>
            <span
              aria-hidden="true"
              style={{
                position: "absolute", right: 6, bottom: 6, width: 6, height: 6,
                borderRadius: "50%",
                background: companionActivity.status === "failed" ? "#dc2626"
                  : companionActivity.status === "review" ? "#8b5cf6"
                    : companionActivity.status === "waiting" ? "#d97706"
                      : companionActivity.status === "running" ? "#2563eb" : "#22a06b",
                boxShadow: "0 0 0 2px var(--bg)",
              }}
            />
          </button>
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
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
                <path d="M12 8v4" />
                <path d="M12 16h.01" />
              </svg>
              {!isMobile && <span>{translate("trust.resourcesNotLoaded")}</span>}
            </button>
          )}
          {showChat && (
            <div className="app-topbar-cluster app-topbar-session-tools" style={{ display: "flex", alignItems: "stretch", height: 34 }}>
              <button
                className="topbar-control"
                onClick={handleViewFullHistory}
                disabled={!selectedSession}
                 title={selectedSession ? translate("history.full") : translate("history.unsaved")}
                 aria-label={translate("history.full")}
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
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    color: selectedSession ? "var(--text-muted)" : "var(--text-dim)",
                    flexShrink: 0,
                  }}
                >
                  <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                  <path d="M3 3v5h5" />
                  <path d="M12 7v5l3 2" />
                </svg>
                 {!isMobile && <span className="topbar-action-label">{translate("history.label")}</span>}
              </button>
              {(() => {
                const hasMessages = Boolean(
                  selectedSession
                  && (sessionStats?.userMessages ?? selectedSession.messageCount) > 0,
                );
                const disabled = !selectedSession || !hasMessages || autoNameStatus.kind === "naming";
                const isSuccess = autoNameStatus.kind === "success";
                const isError = autoNameStatus.kind === "error";
                const label = autoNameStatus.kind === "naming"
                   ? translate("title.generating")
                    : isSuccess
                    ? translate("title.updated")
                    : isError
                      ? translate("title.failed")
                      : translate("title.generate");
                const title = !selectedSession
                   ? translate("title.unsaved")
                   : !hasMessages
                     ? translate("title.noMessages")
                     : isError
                       ? autoNameStatus.message
                       : translate("title.generateSession");

                return (
                  <button
                    className="topbar-control"
                    type="button"
                    onClick={() => void handleAutoName()}
                    disabled={disabled}
                    title={title}
                    aria-label={label}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      height: "100%", padding: "0 12px",
                      background: "none", border: "none",
                      borderTop: "2px solid transparent",
                      color: isError ? "#dc2626" : isSuccess ? "var(--accent)" : disabled ? "var(--text-dim)" : "var(--text-muted)",
                      cursor: disabled ? "not-allowed" : "pointer",
                      opacity: disabled && autoNameStatus.kind !== "naming" ? 0.45 : 1,
                      flexShrink: 0, fontSize: "var(--font-xs)", whiteSpace: "nowrap",
                      transition: "color 0.1s, background 0.1s, opacity 0.1s",
                    }}
                    onMouseEnter={(e) => {
                      if (disabled) return;
                      e.currentTarget.style.color = isError ? "#dc2626" : "var(--text)";
                      e.currentTarget.style.background = "var(--bg-hover)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = isError ? "#dc2626" : isSuccess ? "var(--accent)" : disabled ? "var(--text-dim)" : "var(--text-muted)";
                      e.currentTarget.style.background = "none";
                    }}
                  >
                    {autoNameStatus.kind === "naming" ? (
                      <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    ) : isSuccess ? (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="m15 4 5 5L7 22l-5-5Z" />
                        <path d="m14 5 5 5" />
                        <path d="M6 4V2M5 3H3M19 19v3M17.5 20.5h3" />
                      </svg>
                    )}
                    {!isMobile && <span className="topbar-action-label">{label}</span>}
                  </button>
                );
              })()}
              <BranchNavigator
                tree={branchTree}
                activeLeafId={branchActiveLeafId}
                onLeafChange={handleBranchLeafChange}
                inline
                compact={isMobile}
                containerRef={topBarRef}
                open={activeTopPanel === "branches"}
                onToggle={() => toggleTopPanel("branches")}
                hasSession
              />
              <button
                className="topbar-control"
                ref={systemBtnRef}
                onClick={() => toggleTopPanel("system")}
                 title={translate("system.prompt")}
                 aria-label={translate("system.prompt")}
                aria-pressed={activeTopPanel === "system"}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  height: "100%", padding: "0 12px",
                  background: activeTopPanel === "system" ? "var(--bg-selected)" : "none",
                  border: "none",
                  borderTop: activeTopPanel === "system" ? "2px solid var(--accent)" : "2px solid transparent",
                  cursor: "pointer",
                  color: activeTopPanel === "system" ? "var(--text)" : "var(--text-muted)",
                  fontSize: "var(--font-xs)", whiteSpace: "nowrap", transition: "color 0.1s, background 0.1s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = activeTopPanel === "system" ? "var(--text)" : "var(--text-muted)"; }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: systemPrompt ? "var(--accent)" : "var(--text-dim)", flexShrink: 0 }}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="8" y1="13" x2="16" y2="13" />
                  <line x1="8" y1="17" x2="13" y2="17" />
                </svg>
                 {!isMobile && <span className="topbar-action-label">{translate("system.label")}</span>}
              </button>
              <button
                className="topbar-control topbar-icon-button"
                ref={taskControlsBtnRef}
                type="button"
                onClick={() => toggleTopPanel("taskControls")}
                title={translate("taskControls.buttonLabel")}
                aria-label={translate("taskControls.buttonLabel")}
                aria-haspopup="menu"
                aria-expanded={activeTopPanel === "taskControls"}
                aria-pressed={activeTopPanel === "taskControls"}
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
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <circle cx="5" cy="12" r="1.8" />
                  <circle cx="12" cy="12" r="1.8" />
                  <circle cx="19" cy="12" r="1.8" />
                </svg>
              </button>
            </div>
          )}
          {/* Session stats — right-aligned in top bar */}
          {showChat && (sessionStats || contextUsage) && (() => {
             const tokens = sessionStats?.tokens;
            const c = sessionStats?.cost ?? 0;
            const fmt = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n);
            const costStr = c > 0 ? (c >= 0.01 ? `$${c.toFixed(2)}` : `<$0.01`) : null;

            let ctxColor = "var(--text-muted)";
            let ctxStr: string | null = null;
            if (contextUsage?.contextWindow) {
              const pct = contextUsage.percent;
              if (pct !== null && pct > 90) ctxColor = "#ef4444";
              else if (pct !== null && pct > 70) ctxColor = "rgba(234,179,8,0.95)";
              ctxStr = pct !== null ? `${pct.toFixed(0)}% / ${fmt(contextUsage.contextWindow)}` : `? / ${fmt(contextUsage.contextWindow)}`;
            }

            const tooltipParts: string[] = [];
             if (tokens) {
               tooltipParts.push(`in: ${tokens.input.toLocaleString(locale)}`);
               tooltipParts.push(`out: ${tokens.output.toLocaleString(locale)}`);
               tooltipParts.push(`cache read: ${tokens.cacheRead.toLocaleString(locale)}`);
               tooltipParts.push(`cache write: ${tokens.cacheWrite.toLocaleString(locale)}`);
              if (c > 0) tooltipParts.push(`cost: $${c.toFixed(4)}`);
            }
            if (contextUsage?.contextWindow) {
              const pct = contextUsage.percent;
              tooltipParts.push(`context: ${pct !== null ? pct.toFixed(1) + "%" : "unknown"} of ${contextUsage.contextWindow.toLocaleString()} tokens`);
            }
            const tooltip = tooltipParts.join("  |  ");

            return (
              <button
                className="topbar-stats-control"
                type="button"
                onClick={() => toggleTopPanel("session")}
               title={tooltip || translate("session.title")}
                 aria-label={translate("session.title")}
                aria-pressed={activeTopPanel === "session"}
                style={{
                  marginLeft: "auto",
                  display: "flex", alignItems: "center", gap: 10,
                  paddingLeft: 12,
                  paddingRight: rightPanelOpen ? 12 : 48,
                  height: "100%",
                  background: activeTopPanel === "session" ? "var(--bg-selected)" : "none",
                  border: "none",
                  borderTop: activeTopPanel === "session" ? "2px solid var(--accent)" : "2px solid transparent",
                  fontSize: "var(--font-xs)", color: "var(--text-muted)",
                  whiteSpace: "nowrap", cursor: "pointer",
                  fontVariantNumeric: "tabular-nums",
                  transition: "color 0.1s, background 0.1s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = activeTopPanel === "session" ? "var(--text)" : "var(--text-muted)"; }}
              >
                {isMobile && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                )}
                 {!isMobile && tokens && tokens.input > 0 && (
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="8.5" x2="5" y2="1.5" /><polyline points="2 4 5 1.5 8 4" />
                    </svg>
                     {fmt(tokens.input)}
                  </span>
                )}
                 {!isMobile && tokens && tokens.output > 0 && (
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="1.5" x2="5" y2="8.5" /><polyline points="2 6 5 8.5 8 6" />
                    </svg>
                     {fmt(tokens.output)}
                  </span>
                )}
                 {!isMobile && tokens && tokens.cacheRead > 0 && (
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M8.5 5a3.5 3.5 0 1 1-1-2.45" /><polyline points="6.5 1.5 8.5 2.5 7.5 4.5" />
                    </svg>
                     {fmt(tokens.cacheRead)}
                  </span>
                )}
                {!isMobile && costStr && (
                  <span style={{ display: "flex", alignItems: "center", color: "var(--text)", fontWeight: 500 }}>
                    {costStr}
                  </span>
                )}
                {ctxStr && (
                  <span style={{ display: "flex", alignItems: "center", gap: 4, color: ctxColor }}>
                    <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 9 L1 5 Q1 1 5 1 Q9 1 9 5 L9 9" /><line x1="1" y1="9" x2="9" y2="9" />
                    </svg>
                    {ctxStr}
                  </span>
                )}
              </button>
            );
          })()}
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
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4l2 2h7A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z" />
                      </svg>
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
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 5v14M5 12h14" />
                        </svg>
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
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4l2 2h7A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z" />
                          <path d="m14 12 2 2 4-4" />
                        </svg>
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
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="m5 12 4 4L19 6" />
                          </svg>
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="9" y="9" width="11" height="11" rx="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
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
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3" y="3" width="18" height="18" rx="2" />
                              <path d="M9 3v18" />
                            </svg>
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
                  aria-label={translate("taskControls.title")}
                >
                  <div className="soft-top-panel-header">
                    <span className="soft-top-panel-icon" aria-hidden="true">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2v3M12 19v3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M2 12h3M19 12h3M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    </span>
                    <span className="soft-top-panel-heading">
                      <span className="soft-top-panel-title">{translate("taskControls.title")}</span>
                      <span className="soft-top-panel-description">{translate("taskControls.description")}</span>
                    </span>
                  </div>
                  <div className="soft-top-panel-body">
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
                                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="1.5 6 4.5 9 10.5 2.5" />
                                </svg>
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
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
                              <path d="M13.7 21a2 2 0 0 1-3.4 0" />
                            </svg>
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
                        <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                          <path d="m5 12 4 4L19 6" />
                        </svg>
                      ) : null}
                    </button>
                  ))}
                </div>
              )}
              {activeTopPanel === "system" && (
                <div className="soft-top-panel">
                  <div className="soft-top-panel-header">
                    <span className="soft-top-panel-icon" aria-hidden="true">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="8" y1="13" x2="16" y2="13" />
                        <line x1="8" y1="17" x2="13" y2="17" />
                      </svg>
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
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          ) : (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
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
                onModelInfoChange={setCurrentModelInfo}
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
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4l2 2h7A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z" />
                    </svg>
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
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="15" y1="3" x2="15" y2="21" />
      </svg>
    </button>
    </div>
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
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
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
                        <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                          <path d="m5 12 4 4L19 6" />
                        </svg>
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
    />
    </>
  );
}

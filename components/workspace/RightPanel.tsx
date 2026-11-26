"use client";

import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { useI18n } from "@/hooks/useI18n";
import { FileExplorer, type FileExplorerHandle } from "../FileExplorer";
import { FileViewer } from "../FileViewer";
import { TabBar, type Tab } from "../TabBar";
import { ReviewPanel } from "./ReviewPanel";
import { CommandPanel } from "./CommandPanel";
import { BrowserPanel } from "./BrowserPanel";
import { SafeHarmonyPanel } from "./HarmonyPanel";
import { RenderErrorBoundary } from "../RenderErrorBoundary";
import { AliIcon, type AliIconName } from "../AliIcon";
import styles from "./WorkspacePanel.module.css";
import { AutomationPanel } from "../AutomationPanel";
import { SSHPanel } from "./SSHPanel";
import { PlanSidePanelTab } from "../workflow/PlanSidePanelTab";
import { GoalSidePanelTab } from "../workflow/GoalSidePanelTab";
import { RunChangesPane } from "./RunChangesPane";
import {
  dispatchFocusSideChatComposer,
  isSideChatTab,
  parseSideChatTabId,
  toSideChatLoadingTabId,
  toSideChatTabId,
  type SideChatTabId,
} from "../side-chat/side-chat-events";
import {
  SideChatMenuEntries,
  SideChatTabPanels,
  SideChatTabStripItems,
  type RightPanelSideChatProps,
} from "../side-chat/SideChatRightPanelSlots";
import type { SessionCapabilitiesState } from "@/lib/session-capabilities";
import type { BrowserNavigationRequest } from "@/lib/answer-links";

type StaticToolTab = "automation" | "review" | "files" | "commands" | "ssh" | "browser" | "design" | "harmony" | "plan" | "goal";
export type RightPanelTab = "home" | StaticToolTab | SideChatTabId;
export interface RightPanelHandle { focusActiveTab: () => void; focusFileSearch: () => void; }

interface Props {
  sideChat?: RightPanelSideChatProps;
  answerNavigation?: BrowserNavigationRequest;
  onAnswerNavigationConsumed?: (id: string) => void;
  commitRequest?: { cwd: string; id: number } | null;
  contextHeader?: ReactNode;
  activeTab: RightPanelTab;
  onActiveTabChange: (tab: RightPanelTab) => void;
  cwd: string | null;
  refreshKey: number;
  active: boolean;
  maximized: boolean;
  onMaximizedChange: (maximized: boolean) => void;
  onClosePanel: () => void;
  fileTabs: Tab[];
  activeFileTabId: string | null;
  canReopenClosedFileTab: boolean;
  onSelectFileTab: (id: string) => void;
  onCloseFileTab: (id: string) => void;
  onCloseOtherFileTabs: (id: string) => void;
  onCloseFileTabsToRight: (id: string) => void;
  onMoveFileTab: (id: string, targetIndex: number) => void;
  onReopenClosedFileTab: () => void;
  onOpenFile: (path: string, name: string, options?: { sourceSessionId?: string | null; modeHint?: "diff"; line?: number; column?: number }) => void;
  onDirtyChange: (id: string, dirty: boolean) => void;
  onRefresh: () => void;
  onMention: (relativePath: string, isDir: boolean) => void;
  onMentions: (relativePaths: string[]) => void;
  onMentionLines: (relativePath: string, startLine: number, endLine: number) => void;
  selectedAutomationId: string | null;
  sessionId: string | null;
  sessionName?: string;
  sessionRunning?: boolean;
  onGuideAgent?: ((prompt?: string) => void) | undefined;
  onOpenShellSettings?: () => void;
  onSelectAutomation?: (id: string | null) => void;
  onAutomationChanged?: () => void;
  capabilities: SessionCapabilitiesState | null;
}

const TOOLS: Array<{ id: StaticToolTab; icon: AliIconName; shortcut?: string; labelKey?: string }> = [
  { id: "automation", icon: "calendar" },
  { id: "review", icon: "diff", shortcut: "Ctrl+Shift+G" },
  { id: "commands", icon: "code" },
  { id: "ssh", icon: "server" },
  { id: "browser", icon: "earth", shortcut: "Ctrl+T" },
  // Temporarily hide the Design to Harmony entry; retain its panel and implementation below.
  // { id: "design", icon: "workflow" },
  { id: "harmony", icon: "mobile" },
  { id: "files", icon: "folder-open", shortcut: "Ctrl+P" },
];

const DYNAMIC_TOOLS: Array<{ id: StaticToolTab; icon: AliIconName; labelKey: string }> = [
  { id: "plan", icon: "list-check", labelKey: "workflow.plan.panelTitle" },
  { id: "goal", icon: "target", labelKey: "workflow.goal.panelTitle" },
];

const ALL_TOOLS = [...TOOLS, ...DYNAMIC_TOOLS];

const DesignToHarmonyPanel = dynamic(
  () => import("./design-to-harmony/DesignToHarmonyPanel").then((module) => module.DesignToHarmonyPanel),
  { ssr: false },
);

type ToolTab = StaticToolTab;
const TREE_SPLIT_KEY = "piora-file-tree-share";
const TREE_HANDLE_WIDTH = 6;

interface FileViewerTabSlotProps {
  tab: Tab;
  selected: boolean;
  panelActive: boolean;
  cwd: string | null;
  refreshKey: number;
  onDirtyChange: (id: string, dirty: boolean) => void;
  onRefresh: () => void;
  onMentionLines: (relativePath: string, startLine: number, endLine: number) => void;
  onOpenFile: (path: string, name: string, options?: { sourceSessionId?: string | null; modeHint?: "diff"; line?: number; column?: number }) => void;
}

const FileViewerTabSlot = memo(function FileViewerTabSlot({
  tab,
  selected,
  panelActive,
  cwd,
  refreshKey,
  onDirtyChange,
  onRefresh,
  onMentionLines,
  onOpenFile,
}: FileViewerTabSlotProps) {
  const handleDirtyChange = useCallback(
    (dirty: boolean) => onDirtyChange(tab.id, dirty),
    [onDirtyChange, tab.id],
  );
  const handleOpenFile = useCallback(
    (path: string, options?: { sourceSessionId?: string | null; modeHint?: "diff"; line?: number; column?: number }) => {
      onOpenFile(path, path.replace(/\\/g, "/").split("/").pop() ?? path, options);
    },
    [onOpenFile],
  );
  return <div aria-hidden={!selected} style={{ position: "absolute", inset: 0, display: selected ? "block" : "none", overflow: "hidden" }}>
    <FileViewer
      filePath={tab.filePath}
      cwd={tab.cwd ?? cwd ?? undefined}
      sourceSessionId={tab.sourceSessionId}
      gitRefreshKey={refreshKey}
      initialDisplayMode={tab.initialDisplayMode}
      revealLine={tab.revealLine}
      revealColumn={tab.revealColumn}
      revealKey={tab.revealKey}
      active={panelActive && selected}
      onDirtyChange={handleDirtyChange}
      onSaved={onRefresh}
      onMentionLines={panelActive && selected ? onMentionLines : undefined}
      onOpenFile={handleOpenFile}
    />
  </div>;
});

export const RightPanel = memo(forwardRef<RightPanelHandle, Props>(function RightPanel(props, ref) {
  const { t } = useI18n();
  const explorerRef = useRef<FileExplorerHandle>(null);
  const filesRootRef = useRef<HTMLDivElement>(null);
  const [filesWidth, setFilesWidth] = useState(0);
  const [treeShare, setTreeShare] = useState(0.28);
  const [treeDrawerOpen, setTreeDrawerOpen] = useState(false);
  const [resizingTree, setResizingTree] = useState(false);
  const [fileNavMode, setFileNavMode] = useState<"tree" | "run">("tree");
  const [browserNavigation, setBrowserNavigation] = useState<BrowserNavigationRequest | undefined>();
  const activeTabRef = useRef<HTMLButtonElement | null>(null);
  const firstLauncherRef = useRef<HTMLButtonElement | null>(null);
  const addMenuRef = useRef<HTMLDivElement | null>(null);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const toolMenuRef = useRef<HTMLDivElement | null>(null);
  const { activeTab, onActiveTabChange, cwd, refreshKey, active, fileTabs, activeFileTabId, onOpenFile } = props;
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [addMenuPosition, setAddMenuPosition] = useState({ left: 8, top: 48, width: 278 });
  const [openTools, setOpenTools] = useState<ToolTab[]>(() => activeTab === "home" || isSideChatTab(activeTab) ? [] : [activeTab]);
  const [filesHasOpened, setFilesHasOpened] = useState(activeTab === "files");
  const [draggedTool, setDraggedTool] = useState<ToolTab | null>(null);
  const [dropTargetTool, setDropTargetTool] = useState<ToolTab | null>(null);
  const compactFiles = filesWidth > 0 && filesWidth < 600;
  const maxTreeWidth = Math.max(160, Math.min(Math.round(filesWidth * 0.55), filesWidth - TREE_HANDLE_WIDTH - 320, 900));
  const treeWidth = Math.max(160, Math.min(maxTreeWidth, Math.round((filesWidth - TREE_HANDLE_WIDTH) * treeShare)));

  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(TREE_SPLIT_KEY));
      if (Number.isFinite(saved) && saved >= 0.1 && saved <= 0.75) setTreeShare(saved);
    } catch { /* The splitter still works when storage is unavailable. */ }
  }, []);

  useEffect(() => {
    // The files subtree mounts one render after its first tab activation.
    if (activeTab !== "files" || !filesRootRef.current) return;
    const observer = new ResizeObserver(([entry]) => setFilesWidth(entry.contentRect.width));
    observer.observe(filesRootRef.current);
    return () => observer.disconnect();
  }, [activeTab, filesHasOpened]);

  useEffect(() => { if (!compactFiles) setTreeDrawerOpen(false); }, [compactFiles]);

  const selectedFilePath = useMemo(
    () => fileTabs.find((tab) => tab.id === activeFileTabId)?.filePath ?? null,
    [fileTabs, activeFileTabId],
  );
  const handleExplorerOpenFile = useCallback((
    path: string,
    name: string,
    options?: { sourceSessionId?: string | null; modeHint?: "diff"; line?: number; column?: number },
  ) => {
    onOpenFile(path, name, options);
    setTreeDrawerOpen(false);
  }, [onOpenFile]);
  const handleOpenReview = useCallback(() => onActiveTabChange("review"), [onActiveTabChange]);
  const handleOpenRunFile = useCallback((path: string, name: string, options?: { modeHint?: "diff" }) => {
    onOpenFile(path, name, options);
    setTreeDrawerOpen(false);
  }, [onOpenFile]);

  const changeTreeWidth = (candidate: number) => {
    const width = filesRootRef.current?.getBoundingClientRect().width ?? 0;
    if (width < 600) return;
    const maximum = Math.min(Math.round(width * 0.55), width - TREE_HANDLE_WIDTH - 320, 900);
    const nextShare = Math.max(160, Math.min(maximum, candidate)) / (width - TREE_HANDLE_WIDTH);
    setTreeShare(nextShare);
    try { window.localStorage.setItem(TREE_SPLIT_KEY, String(nextShare)); } catch { /* Keep the live split. */ }
  };
  const capabilityAccess = (kind: "browser" | "device") => {
    if (!props.capabilities) return null;
    const items = props.capabilities.items.filter((item) => item.kind === kind && item.available);
    const enabledCount = items.filter((item) => item.enabled).length;
    const status = items.length === 0
      ? "unavailable"
      : enabledCount === 0
        ? "off"
        : enabledCount === items.length
          ? "on"
          : "partial";
    if (kind === "browser" && status === "on") return null;
    const labelKey = kind === "device" && status === "unavailable"
      ? "sessionTools.panelDeviceUnavailable"
      : kind === "device" && status === "off"
        ? "sessionTools.panelDeviceAccessOff"
        : status === "on"
      ? "sessionTools.panelAccessOn"
      : status === "partial"
        ? "sessionTools.panelAccessPartial"
        : status === "unavailable"
          ? "sessionTools.panelUnavailable"
          : "sessionTools.panelAccessOff";
    return <div className={styles.capabilityAccess} data-enabled={status === "on" ? "true" : status}>
      <AliIcon name={status === "on" ? "check-circle" : "alert"} size={13} />
      <span>{t(labelKey)}</span>
    </div>;
  };
  useImperativeHandle(ref, () => ({
    focusActiveTab: () => {
      if (isSideChatTab(activeTab)) {
        dispatchFocusSideChatComposer(parseSideChatTabId(activeTab)?.id);
        return;
      }
      (activeTab === "home" ? firstLauncherRef.current : activeTabRef.current)?.focus({ preventScroll: true });
    },
    focusFileSearch: () => { setFileNavMode("tree"); setTreeDrawerOpen(true); requestAnimationFrame(() => explorerRef.current?.focusSearch()); },
  }), [activeTab]);

  useEffect(() => { setAddMenuOpen(false); }, [active, activeTab]);

  useEffect(() => {
    if (!addMenuOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (!addMenuRef.current?.contains(event.target as Node) && !toolMenuRef.current?.contains(event.target as Node)) setAddMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setAddMenuOpen(false);
        addButtonRef.current?.focus();
      }
    };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [addMenuOpen]);

  useLayoutEffect(() => {
    if (!addMenuOpen) return;
    const placeMenu = () => {
      const rect = addButtonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const inset = 8;
      const gap = 6;
      const width = Math.min(278, Math.max(180, window.innerWidth - inset * 2));
      const estimatedHeight = toolMenuRef.current?.offsetHeight ?? 164;
      const left = Math.min(Math.max(inset, rect.left), Math.max(inset, window.innerWidth - width - inset));
      const below = rect.bottom + gap;
      const top = below + estimatedHeight <= window.innerHeight - inset
        ? below
        : Math.max(inset, rect.top - estimatedHeight - gap);
      setAddMenuPosition({ left, top, width });
    };
    placeMenu();
    window.addEventListener("resize", placeMenu);
    window.addEventListener("scroll", placeMenu, true);
    return () => {
      window.removeEventListener("resize", placeMenu);
      window.removeEventListener("scroll", placeMenu, true);
    };
  }, [addMenuOpen]);

  useEffect(() => {
    if (activeTab === "files") setFilesHasOpened(true);
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === "home" || isSideChatTab(activeTab)) return;
    setOpenTools((current) => current.includes(activeTab) ? current : [...current, activeTab]);
  }, [activeTab]);

  const selectTool = (tab: ToolTab) => {
    setOpenTools((current) => current.includes(tab) ? current : [...current, tab]);
    onActiveTabChange(tab);
    setAddMenuOpen(false);
  };

  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTab, openTools]);

  const closeTool = (tab: ToolTab) => {
    const closingIndex = openTools.indexOf(tab);
    const remaining = openTools.filter((openTool) => openTool !== tab);
    setOpenTools(remaining);
    if (activeTab !== tab) return;
    onActiveTabChange(remaining[Math.min(closingIndex, remaining.length - 1)] ?? "home");
  };

  const moveTool = (source: ToolTab, target: ToolTab) => {
    if (source === target) return;
    setOpenTools((current) => {
      const sourceIndex = current.indexOf(source);
      const targetIndex = current.indexOf(target);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const reordered = [...current];
      reordered.splice(sourceIndex, 1);
      reordered.splice(targetIndex, 0, source);
      return reordered;
    });
  };

  const sideChatTabIds: RightPanelTab[] = props.sideChat?.enabled
    ? [
        ...props.sideChat.openIds
          .filter((sideId) => props.sideChat!.items.some((item) => item.id === sideId))
          .map((sideId) => toSideChatTabId(sideId)),
        ...props.sideChat.pendingCreates.map((entry) => toSideChatLoadingTabId(entry.clientId)),
      ]
    : [];
  const allRenderedTabs: RightPanelTab[] = [...openTools, ...sideChatTabIds];

  const moveToolTabFocus = (event: React.KeyboardEvent<HTMLButtonElement>, tab: RightPanelTab) => {
    const currentIndex = allRenderedTabs.indexOf(tab);
    if (currentIndex < 0 || allRenderedTabs.length === 0) return;
    let nextIndex: number;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % allRenderedTabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + allRenderedTabs.length) % allRenderedTabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = allRenderedTabs.length - 1;
    else return;
    event.preventDefault();
    const nextTab = allRenderedTabs[nextIndex];
    const parsedSide = parseSideChatTabId(nextTab);
    if (parsedSide?.kind === "live" && props.sideChat) props.sideChat.onSelect(parsedSide.id);
    else onActiveTabChange(nextTab);
    requestAnimationFrame(() => activeTabRef.current?.focus({ preventScroll: true }));
  };

  return <div className={`${styles.root} right-panel-surface`} style={{ height: "100%", minHeight: 0, minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
    {props.contextHeader}
    <div className={`${styles.panelChrome} right-panel-chrome`}>
      <div className={styles.toolTabs} role="tablist" aria-label={t("workspace.panelTabs")}>
        {openTools.map((toolId) => {
          const tool = ALL_TOOLS.find((candidate) => candidate.id === toolId);
          if (!tool) return null;
          const selected = activeTab === tool.id;
          return <div
            key={tool.id}
            className={styles.activeToolTab}
            data-active={selected ? "true" : "false"}
            data-dragging={draggedTool === tool.id ? "true" : undefined}
            data-drop-target={dropTargetTool === tool.id ? "true" : undefined}
            draggable
            onDragStart={(event) => {
              setDraggedTool(tool.id);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/piora-tool-tab", tool.id);
            }}
            onDragOver={(event) => {
              if (!draggedTool || draggedTool === tool.id) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDropTargetTool(tool.id);
            }}
            onDrop={(event) => {
              event.preventDefault();
              const source = (draggedTool ?? event.dataTransfer.getData("text/piora-tool-tab")) as ToolTab;
              if (ALL_TOOLS.some((candidate) => candidate.id === source)) moveTool(source, tool.id);
              setDraggedTool(null);
              setDropTargetTool(null);
            }}
            onDragEnd={() => { setDraggedTool(null); setDropTargetTool(null); }}
          >
            <button ref={selected ? activeTabRef : undefined} type="button" role="tab" aria-selected={selected} aria-controls={`workspace-${tool.id}`} id={`workspace-${tool.id}-tab`} tabIndex={selected ? 0 : -1} onClick={() => onActiveTabChange(tool.id)} onKeyDown={(event) => moveToolTabFocus(event, tool.id)}>
              <AliIcon name={tool.icon} size={14} />
              <span>{t(tool.labelKey ?? `workspace.${tool.id}`)}</span>
            </button>
            <button className={styles.closeToolTab} type="button" aria-label={t("workspace.closeTool")} onClick={() => closeTool(tool.id)}><AliIcon name="close" size={12} /></button>
          </div>;
        })}
        <SideChatTabStripItems
          sideChat={props.sideChat}
          activeTab={activeTab}
          tabClassName={styles.activeToolTab}
          closeClassName={styles.closeToolTab}
          activeTabRef={activeTabRef}
          onActivateTab={(tab) => onActiveTabChange(tab)}
          onTabKeyDown={moveToolTabFocus}
        />
      </div>
      <div className={styles.panelChromeActions}>
        <div ref={addMenuRef} className={styles.addToolWrap}>
          <button ref={addButtonRef} className={styles.addToolButton} type="button" aria-label={t("workspace.addTool")} aria-haspopup="menu" aria-expanded={addMenuOpen} onClick={() => setAddMenuOpen((open) => !open)}><AliIcon name="plus" size={15} /></button>
          {active && addMenuOpen ? createPortal(<div ref={toolMenuRef} className={styles.toolMenu} role="menu" style={addMenuPosition}>
            {TOOLS.map((tool) => <button key={tool.id} type="button" role="menuitem" data-active={activeTab === tool.id ? "true" : "false"} onClick={() => selectTool(tool.id)}>
              <AliIcon name={tool.icon} size={15} />
              <span>{t(`workspace.${tool.id}`)}</span>
              {tool.shortcut ? <kbd>{tool.shortcut}</kbd> : null}
            </button>)}
            <SideChatMenuEntries sideChat={props.sideChat} variant="menu" onAfterSelect={() => setAddMenuOpen(false)} />
          </div>, document.body) : null}
        </div>
        <button type="button" title={t(props.maximized ? "workspace.restorePanel" : "workspace.maximizePanel")} aria-label={t(props.maximized ? "workspace.restorePanel" : "workspace.maximizePanel")} onClick={() => props.onMaximizedChange(!props.maximized)}><AliIcon name={props.maximized ? "fullscreen-exit" : "fullscreen"} size={14} /></button>
        <button type="button" title={t("files.hidePanel")} aria-label={t("files.hidePanel")} onClick={props.onClosePanel}><AliIcon name="layout" size={15} /></button>
      </div>
    </div>
    {activeTab === "home" ? <div className={styles.toolLauncher} aria-label={t("workspace.panelTabs")}>
      {TOOLS.map((tool, index) => <button ref={index === 0 ? firstLauncherRef : undefined} key={tool.id} type="button" onClick={() => selectTool(tool.id)}>
        <AliIcon name={tool.icon} size={15} />
        <span>{t(`workspace.${tool.id}`)}</span>
        {tool.shortcut ? <kbd>{tool.shortcut}</kbd> : null}
      </button>)}
      <SideChatMenuEntries sideChat={props.sideChat} variant="launcher" />
    </div> : null}
    <section id="workspace-review" role="tabpanel" aria-labelledby="workspace-review-tab" hidden={activeTab !== "review"} className={styles.panel}>
      {activeTab === "review" ? <RenderErrorBoundary resetKey={`review:${refreshKey}`} fallbackLabel={t("workspace.panelRenderFailed")}><ReviewPanel cwd={cwd} commitRequest={props.commitRequest?.cwd === cwd ? props.commitRequest.id : undefined} refreshKey={refreshKey} onRefresh={props.onRefresh} onOpenFile={(path) => { props.onOpenFile(path, path.replace(/\\/g, "/").split("/").pop() ?? path); onActiveTabChange("files"); }} /></RenderErrorBoundary> : null}
    </section>
    <section id="workspace-files" role="tabpanel" aria-labelledby="workspace-files-tab" hidden={activeTab !== "files"} className={styles.panel} style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
      {filesHasOpened ? <RenderErrorBoundary resetKey={`files:${refreshKey}`} fallbackLabel={t("workspace.panelRenderFailed")}>
      <div ref={filesRootRef} className={styles.filesRoot} data-compact={compactFiles ? "true" : undefined} data-tree-open={treeDrawerOpen ? "true" : undefined} data-resizing={resizingTree ? "true" : undefined} style={{ position: "relative", display: "grid", height: "100%", minHeight: 0, minWidth: 0, gridTemplateColumns: compactFiles ? "40px minmax(0, 1fr)" : `${treeWidth}px ${TREE_HANDLE_WIDTH}px minmax(0, 1fr)` }}>
        {compactFiles ? <button className={styles.fileTreeRail} type="button" aria-label={t("files.explorer")} aria-expanded={treeDrawerOpen} onClick={() => setTreeDrawerOpen((open) => !open)}><AliIcon name="folder-open" size={16} /></button> : null}
        {compactFiles && treeDrawerOpen ? <button className={styles.fileTreeBackdrop} type="button" aria-label={t("i18n.close")} onClick={() => setTreeDrawerOpen(false)} /> : null}
        <div id="piora-file-explorer" className={styles.explorer} style={{ gridColumn: 1, minWidth: 0, minHeight: 0, overflow: "hidden", display: compactFiles ? treeDrawerOpen ? "flex" : "none" : "flex", flexDirection: "column", ...(compactFiles ? { position: "absolute" as const, zIndex: 12, left: 40, top: 0, bottom: 0, width: "min(320px, calc(100% - 40px))", background: "var(--bg-panel)", boxShadow: "var(--shadow-popover)" } : {}) }}>
          <RunChangesPane
            active={activeTab === "files"}
            sessionId={props.sessionId}
            sessionRunning={props.sessionRunning}
            refreshKey={refreshKey}
            fileNavMode={fileNavMode}
            onFileNavModeChange={setFileNavMode}
            onOpenReview={handleOpenReview}
            onOpenRunFile={handleOpenRunFile}
          >
            {cwd ? <FileExplorer ref={explorerRef} cwd={cwd} selectedFilePath={selectedFilePath} onOpenFile={handleExplorerOpenFile} refreshKey={refreshKey} onAtMention={props.onMention} onAtMentions={props.onMentions} changesCollapsed /> : <div className={styles.empty}>{t("workspace.selectProject")}</div>}
          </RunChangesPane>
        </div>
        <div className={styles.fileTreeSplitter} style={{ gridColumn: 2, display: compactFiles ? "none" : undefined, position: "relative", cursor: "col-resize", touchAction: "none" }} role="separator" tabIndex={compactFiles ? -1 : 0} aria-hidden={compactFiles} aria-label={t("files.resizeTree")} aria-orientation="vertical" aria-controls="piora-file-explorer piora-file-viewer" aria-valuemin={160} aria-valuemax={maxTreeWidth} aria-valuenow={treeWidth}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            changeTreeWidth(event.key === "Home" ? 160 : event.key === "End" ? maxTreeWidth : treeWidth + (event.key === "ArrowRight" ? 12 : -12));
          }}
          onPointerDown={(event) => { if (event.button !== 0 || compactFiles) return; event.currentTarget.setPointerCapture(event.pointerId); setResizingTree(true); event.preventDefault(); }}
          onPointerMove={(event) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const left = filesRootRef.current?.getBoundingClientRect().left; if (left !== undefined) changeTreeWidth(event.clientX - left - TREE_HANDLE_WIDTH / 2); }}
          onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
          onPointerCancel={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
          onLostPointerCapture={() => setResizingTree(false)} />
        <div id="piora-file-viewer" className={styles.fileViewer} style={{ gridColumn: compactFiles ? 2 : 3, minWidth: 0, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div className={styles.fileTabs} style={{ flex: "0 0 auto", minHeight: 36 }}><TabBar
            tabs={fileTabs}
            activeTabId={activeFileTabId ?? ""}
            canReopenClosedTab={props.canReopenClosedFileTab}
            onSelectTab={props.onSelectFileTab}
            onCloseTab={props.onCloseFileTab}
            onCloseOtherTabs={props.onCloseOtherFileTabs}
            onCloseTabsToRight={props.onCloseFileTabsToRight}
            onMoveTab={props.onMoveFileTab}
            onReopenClosedTab={props.onReopenClosedFileTab}
          /></div>
          <div className={styles.fileBody} style={{ position: "relative", flex: 1, minHeight: 0, overflow: "hidden" }}>{fileTabs.length ? fileTabs.map((tab) => (
            <FileViewerTabSlot
              key={tab.id}
              tab={tab}
              selected={tab.id === activeFileTabId}
              panelActive={active && activeTab === "files"}
              cwd={cwd}
              refreshKey={refreshKey}
              onDirtyChange={props.onDirtyChange}
              onRefresh={props.onRefresh}
              onMentionLines={props.onMentionLines}
              onOpenFile={props.onOpenFile}
            />
          )) : <div className={styles.empty}>{t("files.noneOpen")}</div>}</div>
        </div>
      </div>
      </RenderErrorBoundary> : null}
    </section>
    <section id="workspace-commands" role="tabpanel" aria-labelledby="workspace-commands-tab" hidden={activeTab !== "commands"} className={styles.panel}>
      {active && activeTab === "commands" ? <RenderErrorBoundary resetKey={`commands:${refreshKey}`} fallbackLabel={t("workspace.panelRenderFailed")}><CommandPanel cwd={cwd} sessionId={props.sessionId} onClose={() => closeTool("commands")} onSettings={props.onOpenShellSettings} onToChat={props.onGuideAgent} onOpenFile={file => { props.onOpenFile(file, file.replace(/\\/g, "/").split("/").pop() || file); onActiveTabChange("files"); }} onOpenUrl={url => { if (/^https?:\/\//i.test(url)) { setBrowserNavigation({ id: crypto.randomUUID(), url }); onActiveTabChange("browser"); } }} /></RenderErrorBoundary> : null}
    </section>
    <section id="workspace-ssh" role="tabpanel" aria-labelledby="workspace-ssh-tab" hidden={activeTab !== "ssh"} className={styles.panel}>
      {active && activeTab === "ssh" ? <RenderErrorBoundary resetKey={`ssh:${refreshKey}`} fallbackLabel={t("workspace.panelRenderFailed")}><SSHPanel agentSessionId={props.sessionId} /></RenderErrorBoundary> : null}
    </section>
    <section id="workspace-browser" role="tabpanel" aria-labelledby="workspace-browser-tab" hidden={activeTab !== "browser"} className={styles.panel}>
      {/* Native WebContentsView sits above DOM portals. Keep the panel mounted,
          but suspend its native surface until the tool menu closes. */}
      {activeTab === "browser" ? <div className={styles.capabilityPanel}>{capabilityAccess("browser")}<div className={styles.capabilityPanelBody}><RenderErrorBoundary resetKey={`browser:${props.sessionId ?? "manual"}:${refreshKey}`} fallbackLabel={t("workspace.panelRenderFailed")}>
        <BrowserPanel
          active={active && !addMenuOpen}
          maximized={props.maximized}
          sessionId={props.sessionId}
          workspace={cwd ? {
            cwd,
            openFile: (path, name) => { props.onOpenFile(path, name); selectTool("files"); },
            openFiles: () => { selectTool("files"); setFileNavMode("tree"); setTreeDrawerOpen(true); },
            openTerminal: () => selectTool("commands"),
          } : undefined}
          navigationRequest={props.answerNavigation ?? browserNavigation}
          onNavigationConsumed={(id) => {
            props.onAnswerNavigationConsumed?.(id);
            setBrowserNavigation(current => current?.id === id ? undefined : current);
          }}
        />
      </RenderErrorBoundary></div></div> : null}
    </section>
    <section id="workspace-harmony" role="tabpanel" aria-labelledby="workspace-harmony-tab" hidden={activeTab !== "harmony"} className={styles.panel}>
      {activeTab === "harmony" ? <div className={styles.capabilityPanel}>{capabilityAccess("device")}<div className={styles.capabilityPanelBody}><RenderErrorBoundary resetKey={`harmony:${refreshKey}`} fallbackLabel={t("workspace.panelRenderFailed")}><SafeHarmonyPanel active={active && activeTab === "harmony"} maximized={props.maximized} onMaximizedChange={props.onMaximizedChange} cwd={cwd} sessionId={props.sessionId} sessionRunning={props.sessionRunning} onGuideAgent={props.onGuideAgent} onOpenLocalTerminal={() => onActiveTabChange("commands")} /></RenderErrorBoundary></div></div> : null}
    </section>
    <section id="workspace-design" role="tabpanel" aria-labelledby="workspace-design-tab" hidden={activeTab !== "design"} className={styles.panel}>
      {activeTab === "design" ? <RenderErrorBoundary resetKey={`design:${cwd ?? "no-project"}:${refreshKey}`} fallbackLabel={t("workspace.panelRenderFailed")}><DesignToHarmonyPanel
        cwd={cwd}
        active={active && activeTab === "design"}
        onGuideAgent={props.onGuideAgent}
        onOpenFile={(path, name) => { props.onOpenFile(path, name); onActiveTabChange("files"); }}
        onOpenReview={() => onActiveTabChange("review")}
        onProjectChanged={() => {
          props.onRefresh();
          window.dispatchEvent(new CustomEvent("piora:git-status-changed", { detail: { cwd } }));
        }}
      /></RenderErrorBoundary> : null}
    </section>
    <section id="workspace-automation" role="tabpanel" aria-labelledby="workspace-automation-tab" hidden={activeTab !== "automation"} className={styles.panel}>
      {active && activeTab === "automation" ? <RenderErrorBoundary resetKey={`automation:${props.selectedAutomationId ?? "list"}:${refreshKey}`} fallbackLabel={t("workspace.panelRenderFailed")}><AutomationPanel automationId={props.selectedAutomationId} sessionId={props.sessionId} sessionName={props.sessionName} cwd={cwd} onSelectAutomation={props.onSelectAutomation} onAutomationChanged={props.onAutomationChanged} /></RenderErrorBoundary> : null}
    </section>
    <section id="workspace-plan" role="tabpanel" aria-labelledby="workspace-plan-tab" hidden={activeTab !== "plan"} className={styles.panel}>
      {activeTab === "plan" ? <RenderErrorBoundary resetKey={`plan:${props.sessionId ?? "none"}:${refreshKey}`} fallbackLabel={t("workspace.panelRenderFailed")}><PlanSidePanelTab sessionId={props.sessionId} cwd={cwd} sessionRunning={props.sessionRunning} refreshKey={refreshKey} /></RenderErrorBoundary> : null}
    </section>
    <section id="workspace-goal" role="tabpanel" aria-labelledby="workspace-goal-tab" hidden={activeTab !== "goal"} className={styles.panel}>
      {activeTab === "goal" ? <RenderErrorBoundary resetKey={`goal:${props.sessionId ?? "none"}:${refreshKey}`} fallbackLabel={t("workspace.panelRenderFailed")}><GoalSidePanelTab sessionId={props.sessionId} sessionRunning={props.sessionRunning} refreshKey={refreshKey} /></RenderErrorBoundary> : null}
    </section>
    <SideChatTabPanels sideChat={props.sideChat} panelActive={active} activeTab={activeTab} panelClassName={styles.panel} />
  </div>;
}));

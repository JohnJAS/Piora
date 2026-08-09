"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import { useI18n } from "@/hooks/useI18n";
import { FileExplorer, type FileExplorerHandle } from "../FileExplorer";
import { FileViewer } from "../FileViewer";
import { TabBar, type Tab } from "../TabBar";
import { ReviewPanel } from "./ReviewPanel";
import { CommandPanel } from "./CommandPanel";
import type { TaskControls } from "../ChatWindow";
import styles from "./WorkspacePanel.module.css";

export type RightPanelTab = "review" | "files" | "commands";
export interface RightPanelHandle { focusActiveTab: () => void; focusFileSearch: () => void; }

interface Props {
  activeTab: RightPanelTab;
  onActiveTabChange: (tab: RightPanelTab) => void;
  cwd: string | null;
  refreshKey: number;
  active: boolean;
  fileTabs: Tab[];
  activeFileTabId: string | null;
  onSelectFileTab: (id: string) => void;
  onCloseFileTab: (id: string) => void;
  onOpenFile: (path: string, name: string, options?: { sourceSessionId?: string | null; modeHint?: "diff"; line?: number }) => void;
  onDirtyChange: (id: string, dirty: boolean) => void;
  onRefresh: () => void;
  onMention: (relativePath: string, isDir: boolean) => void;
  onMentions: (relativePaths: string[]) => void;
  onMentionLines: (relativePath: string, startLine: number, endLine: number) => void;
  taskControls: TaskControls | null;
  projectTrusted: boolean;
}

const TABS: RightPanelTab[] = ["review", "files", "commands"];

export const RightPanel = forwardRef<RightPanelHandle, Props>(function RightPanel(props, ref) {
  const { t } = useI18n();
  const explorerRef = useRef<FileExplorerHandle>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const { activeTab, onActiveTabChange, cwd, refreshKey, active, fileTabs, activeFileTabId } = props;
  useImperativeHandle(ref, () => ({
    focusActiveTab: () => tabRefs.current[TABS.indexOf(activeTab)]?.focus({ preventScroll: true }),
    focusFileSearch: () => explorerRef.current?.focusSearch(),
  }), [activeTab]);

  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? TABS.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    onActiveTabChange(TABS[next]);
    tabRefs.current[next]?.focus({ preventScroll: true });
  };

  return <div className={styles.root}>
    <div className={styles.tabs} role="tablist" aria-label={t("workspace.panelTabs")}>
      {TABS.map((tab, index) => <button ref={(node) => { tabRefs.current[index] = node; }} key={tab} type="button" role="tab" tabIndex={activeTab === tab ? 0 : -1} aria-selected={activeTab === tab} aria-controls={`workspace-${tab}`} id={`workspace-${tab}-tab`} className={styles.tab} onClick={() => onActiveTabChange(tab)} onKeyDown={(event) => onTabKeyDown(event, index)}>{t(`workspace.${tab}`)}</button>)}
    </div>
    <section id="workspace-review" role="tabpanel" aria-labelledby="workspace-review-tab" hidden={activeTab !== "review"} className={styles.panel}>
      {activeTab === "review" ? <ReviewPanel cwd={cwd} refreshKey={refreshKey} onRefresh={props.onRefresh} onOpenFile={(path) => { props.onOpenFile(path, path.replace(/\\/g, "/").split("/").pop() ?? path); onActiveTabChange("files"); }} /> : null}
    </section>
    <section id="workspace-files" role="tabpanel" aria-labelledby="workspace-files-tab" hidden={activeTab !== "files"} className={styles.panel}>
      <div className={styles.filesRoot}>
        <div className={styles.explorer}>{cwd ? <FileExplorer ref={explorerRef} cwd={cwd} selectedFilePath={fileTabs.find((tab) => tab.id === activeFileTabId)?.filePath ?? null} onOpenFile={props.onOpenFile} refreshKey={refreshKey} onAtMention={props.onMention} onAtMentions={props.onMentions} changesCollapsed /> : <div className={styles.empty}>{t("workspace.selectProject")}</div>}</div>
        <div className={styles.fileViewer}>
          <div className={styles.fileTabs}><TabBar tabs={fileTabs} activeTabId={activeFileTabId ?? ""} onSelectTab={props.onSelectFileTab} onCloseTab={props.onCloseFileTab} /></div>
          <div className={styles.fileBody}>{fileTabs.length ? fileTabs.map((tab) => {
            const selected = tab.id === activeFileTabId;
            return <div key={tab.id} aria-hidden={!selected} style={{ position: "absolute", inset: 0, display: selected ? "block" : "none", overflow: "hidden" }}><FileViewer filePath={tab.filePath} cwd={tab.cwd ?? cwd ?? undefined} sourceSessionId={tab.sourceSessionId} gitRefreshKey={refreshKey} initialDisplayMode={tab.initialDisplayMode} revealLine={tab.revealLine} revealKey={tab.revealKey} active={active && activeTab === "files" && selected} onDirtyChange={(dirty) => props.onDirtyChange(tab.id, dirty)} onSaved={props.onRefresh} onMentionLines={active && selected ? props.onMentionLines : undefined} onOpenFile={(path) => props.onOpenFile(path, path.replace(/\\/g, "/").split("/").pop() ?? path)} /></div>;
          }) : <div className={styles.empty}>{t("files.noneOpen")}</div>}</div>
        </div>
      </div>
    </section>
    <section id="workspace-commands" role="tabpanel" aria-labelledby="workspace-commands-tab" hidden={activeTab !== "commands"} className={styles.panel}>
      <CommandPanel trusted={props.projectTrusted} controls={props.taskControls} />
    </section>
  </div>;
});

import type { SessionInfo } from "@/lib/types";
import type { CollaborationRoom } from "@/lib/room-types";

declare global {
  interface Window {
    piDesktop?: {
      selectDirectory: () => Promise<string | null>;
      getAgentDataDirectory?: () => Promise<{
        currentDirectory: string;
        defaultDirectory: string;
        configuredBy: "default" | "settings" | "environment";
        environmentOverride: boolean;
        portableRuntimeDirectory?: string;
      } | null>;
      selectAgentDataDirectory?: (defaultPath?: string) => Promise<string | null>;
      applyAgentDataDirectory?: (input: { directory: string; migrate: boolean }) => Promise<{
        ok: boolean;
        code?: "busy" | "environment-override" | "invalid-path" | "migration-required" | "same-path" | "overlapping-path" | "target-not-empty" | "migration-failed" | "persist-failed";
        error?: string;
        sourceDirectory?: string;
        currentDirectory?: string;
      }>;
      platform?: string;
      openMenu?: (menu: "file" | "edit" | "view" | "help", x: number, y: number) => Promise<boolean>;
      getUpdateState?: () => Promise<DesktopUpdateState | null>;
      checkForUpdates?: () => Promise<DesktopUpdateState | null>;
      downloadUpdate?: () => Promise<DesktopUpdateState | null>;
      installUpdate?: () => Promise<boolean>;
      onUpdateState?: (listener: (state: DesktopUpdateState) => void) => () => void;
      revealPath?: (filePath: string) => Promise<boolean>;
      openPath?: (filePath: string) => Promise<boolean>;
      setCompanionWindowVisible?: (visible: boolean) => Promise<boolean>;
      setCompanionWindowAlwaysOnTop?: (alwaysOnTop: boolean) => Promise<boolean>;
      setCompanionWindowExpanded?: (expanded: boolean) => Promise<boolean>;
      companionAction?: (action: "focus-main" | "open-settings" | "hide") => Promise<boolean>;
      setGlobalShortcut?: (enabled: boolean) => Promise<boolean>;
      selectHarmonyRuntimePath?: (kind: "sdk" | "hdc") => Promise<string | null>;
      onMenuAction?: (listener: (action: string) => void) => () => void;
      browser?: {
        getState: () => Promise<DesktopBrowserState | null>;
        action: (input: DesktopBrowserAction) => Promise<DesktopBrowserState | null>;
        setViewport: (bounds: { x: number; y: number; width: number; height: number }, visible: boolean) => Promise<boolean>;
        importChromeBookmarks: () => Promise<ChromeBookmarkImportResult | null>;
        onState: (listener: (state: DesktopBrowserState) => void) => () => void;
        onDownload: (listener: (download: DesktopBrowserDownload) => void) => () => void;
      };
    };
  }
}

export interface DesktopUpdateState {
  status: "unsupported" | "idle" | "checking" | "up-to-date" | "available" | "downloading" | "downloaded" | "error";
  currentVersion: string;
  availableVersion?: string;
  releaseNotes?: string;
  progressPercent?: number;
  bytesPerSecond?: number;
  transferredBytes?: number;
  totalBytes?: number;
  error?: string;
}

export interface DesktopBrowserState {
  activeTabId: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  tabs: Array<{ id: string; title: string; url: string }>;
  title: string;
  url: string;
}

export interface DesktopBrowserAction {
  action: "back" | "close_tab" | "forward" | "navigate" | "new_tab" | "reload" | "switch_tab";
  tabId?: string;
  url?: string;
}

export interface ImportedChromeBookmark {
  id: string;
  type: "bookmark";
  title: string;
  url: string;
}

export interface ImportedChromeBookmarkFolder {
  children: ImportedChromeBookmarkNode[];
  id: string;
  title: string;
  type: "folder";
}

export type ImportedChromeBookmarkNode = ImportedChromeBookmark | ImportedChromeBookmarkFolder;

export interface ImportedChromeBookmarkProfile {
  children: ImportedChromeBookmarkNode[];
  id: string;
  title: string;
}

export interface ChromeBookmarkImportResult {
  bookmarkCount: number;
  profiles: ImportedChromeBookmarkProfile[];
}

export interface DesktopBrowserDownload {
  filename: string;
  path: string;
  percent: number;
  state: "cancelled" | "completed" | "interrupted" | "progressing";
}

export interface SessionSidebarProps {
  selectedSessionId: string | null;
  selectedRoomId?: string | null;
  onSelectSession: (session: SessionInfo, isRestore?: boolean) => void;
  onSelectRoom?: (room: CollaborationRoom, isRestore?: boolean) => void;
  initialRoomId?: string | null;
  onInitialRoomRestoreDone?: () => void;
  onNewSession?: (sessionId: string, cwd: string) => void;
  onRequestNewSession?: () => void;
  initialSessionId?: string | null;
  skipInitialProjectSelection?: boolean;
  onInitialRestoreDone?: () => void;
  refreshKey?: number;
  onSessionDeleted?: (session: SessionInfo) => void;
  selectedCwd?: string | null;
  onCwdChange?: (cwd: string | null, projectRoot?: string | null) => void;
  onFocusFileSearch?: () => void;
  onOpenSettings?: () => void;
  activeProjectRoot?: string | null;
}

export interface SessionSidebarHandle {
  openProjectPicker: () => void;
  focusPrimaryNavigation: () => void;
  focusFileSearch: () => void;
}

export interface WorktreeEntry {
  path: string;
  branch: string | null;
  isMain: boolean;
}

export interface WorktreeState {
  forCwd: string;
  projectRoot: string;
  isGit: boolean;
  isTopLevel: boolean;
  worktrees: WorktreeEntry[];
}

import type { SessionInfo } from "@/lib/types";

declare global {
  interface Window {
    piDesktop?: {
      selectDirectory: () => Promise<string | null>;
      platform?: string;
      openMenu?: (menu: "file" | "edit" | "view" | "window" | "help", x: number, y: number) => Promise<boolean>;
      revealPath?: (filePath: string) => Promise<boolean>;
      openPath?: (filePath: string) => Promise<boolean>;
      setCompanionWindowVisible?: (visible: boolean) => Promise<boolean>;
      setCompanionWindowAlwaysOnTop?: (alwaysOnTop: boolean) => Promise<boolean>;
      setCompanionWindowExpanded?: (expanded: boolean) => Promise<boolean>;
      companionAction?: (action: "focus-main" | "open-settings" | "hide") => Promise<boolean>;
      setGlobalShortcut?: (enabled: boolean) => Promise<boolean>;
      selectHarmonyRuntimePath?: (kind: "sdk" | "hdc") => Promise<string | null>;
      onMenuAction?: (listener: (action: string) => void) => () => void;
    };
  }
}

export interface SessionSidebarProps {
  selectedSessionId: string | null;
  onSelectSession: (session: SessionInfo, isRestore?: boolean) => void;
  onNewSession?: (sessionId: string, cwd: string) => void;
  initialSessionId?: string | null;
  skipInitialProjectSelection?: boolean;
  onInitialRestoreDone?: () => void;
  refreshKey?: number;
  onSessionDeleted?: (session: SessionInfo) => void;
  selectedCwd?: string | null;
  onCwdChange?: (cwd: string | null, projectRoot?: string | null) => void;
  onFocusFileSearch?: () => void;
  onOpenSettings?: () => void;
}

export interface SessionSidebarHandle {
  openProjectPicker: () => void;
  focusTaskSearch: () => void;
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

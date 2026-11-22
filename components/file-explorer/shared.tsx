"use client";

import { encodeFilePathForApi, joinFilePath } from "@/lib/file-paths";
import type { GitFileStatus, GitFileStatusKind } from "@/lib/git-types";
import type { useI18n } from "@/hooks/useI18n";
import { AliIcon } from "../AliIcon";

export type Translate = ReturnType<typeof useI18n>["t"];

export interface FileEntry {
  name: string;
  isDir: boolean;
  size: number;
  modified: string;
}

export interface FileNode {
  name: string;
  fullPath: string;
  isDir: boolean;
  size: number;
  children?: FileNode[];
  loaded?: boolean;
}

export interface FileContextTarget {
  name: string;
  fullPath: string;
  isDir: boolean;
}

export interface FileContextMenuState {
  target: FileContextTarget;
  x: number;
  y: number;
}

export type OpenFileOptions = { sourceSessionId?: string | null; modeHint?: "diff" };
export type OpenFileHandler = (filePath: string, fileName: string, options?: OpenFileOptions) => void;

export interface FileExplorerProps {
  cwd: string;
  selectedFilePath?: string | null;
  onOpenFile: OpenFileHandler;
  refreshKey?: number;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  onAtMentions?: (relativePaths: string[]) => void;
  onUploadBusyChange?: (busy: boolean) => void;
  changesCollapsed: boolean;
  onChangesCountChange?: (count: number) => void;
}

export interface FileExplorerHandle {
  openUploadPicker: () => void;
  focusSearch: () => void;
}

export type UploadPhase = "idle" | "checking" | "uploading";
export type UploadConflictStrategy = "error" | "overwrite" | "skip";

export interface UploadError {
  name: string;
  error: string;
}

export interface UploadResponse {
  uploaded?: string[];
  skipped?: string[];
  errors?: UploadError[];
  conflicts?: string[];
  nonReplaceable?: string[];
  error?: string;
}

export interface UploadSummary {
  uploaded: string[];
  skipped: string[];
  errors: UploadError[];
}

export interface PendingConflict {
  files: File[];
  conflicts: string[];
  nonReplaceable: string[];
}

export async function fetchEntries(dirPath: string): Promise<FileNode[]> {
  const encoded = encodeFilePathForApi(dirPath);
  const res = await fetch(`/api/files/${encoded}?type=list`);
  if (!res.ok) {
    let message = `Failed to load files (HTTP ${res.status})`;
    try {
      const data = await res.json() as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // ignore non-JSON error bodies
    }
    throw new Error(message);
  }
  const data = await res.json() as { entries?: FileEntry[] };
  return (data.entries ?? []).map((e) => ({
    name: e.name,
    fullPath: joinFilePath(dirPath, e.name),
    isDir: e.isDir,
    size: e.size,
    children: e.isDir ? [] : undefined,
    loaded: !e.isDir,
  }));
}

export const GIT_STATUS_KEYS: Record<GitFileStatusKind, string> = {
  modified: "files.modified",
  added: "files.added",
  deleted: "files.deleted",
  renamed: "files.renamed",
  untracked: "files.untracked",
  conflict: "files.conflict",
};

export const GIT_STATUS_COLORS: Record<GitFileStatusKind, string> = {
  modified: "var(--file-status-modified)",
  added: "var(--file-status-added)",
  deleted: "var(--file-status-deleted)",
  renamed: "var(--file-status-renamed)",
  untracked: "var(--file-status-added)",
  conflict: "var(--file-status-deleted)",
};

export type DirectoryChangeKind = "modified" | "added" | "deleted";
export const DIRECTORY_CHANGE_ORDER: DirectoryChangeKind[] = ["modified", "added", "deleted"];
export const DIRECTORY_CHANGE_CODE: Record<DirectoryChangeKind, string> = { modified: "M", added: "+", deleted: "−" };

export function directoryChangeKind(status: GitFileStatusKind): DirectoryChangeKind {
  if (status === "deleted" || status === "conflict") return "deleted";
  if (status === "added" || status === "untracked") return "added";
  return "modified";
}

export function GitStatusBadge({ status, t }: { status: GitFileStatus; t: Translate }) {
  return (
    <span
      title={t(GIT_STATUS_KEYS[status.status])}
      aria-label={t(GIT_STATUS_KEYS[status.status])}
      style={{
        width: 14,
        height: 14,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: GIT_STATUS_COLORS[status.status],
        fontFamily: "var(--font-mono)",
        fontSize: "var(--text-xs)",
        fontWeight: 600,
      }}
    >
      {status.code}
    </span>
  );
}

export function uploadFiles(
  targetDirectory: string,
  files: File[],
  strategy: UploadConflictStrategy,
  onProgress: (progress: number) => void,
): Promise<{ status: number; data: UploadResponse }> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    files.forEach((file) => formData.append("files", file, file.name));

    const xhr = new XMLHttpRequest();
    xhr.open(
      "POST",
      `/api/files/${encodeFilePathForApi(targetDirectory)}?type=upload&conflict=${strategy}`,
    );
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onerror = () => reject(new Error("Network error while uploading files"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.onload = () => {
      let data: UploadResponse = {};
      try {
        data = JSON.parse(xhr.responseText) as UploadResponse;
      } catch {
        if (xhr.responseText) data.error = xhr.responseText;
      }
      resolve({ status: xhr.status, data });
    };
    xhr.send(formData);
  });
}

export function AddToChatIcon({ size = 13 }: { size?: number }) {
  return <AliIcon name="message-plus" size={size} strokeWidth={1.75} />;
}

export function DismissButton({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        width: 24,
        height: 24,
        padding: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        border: "none",
        borderRadius: 4,
        background: "none",
        color: "var(--text-dim)",
        cursor: "pointer",
      }}
      onMouseEnter={(event) => { event.currentTarget.style.color = "var(--text-muted)"; event.currentTarget.style.background = "var(--bg-hover)"; }}
      onMouseLeave={(event) => { event.currentTarget.style.color = "var(--text-dim)"; event.currentTarget.style.background = "none"; }}
    >
      <AliIcon name="close" size={13} />
    </button>
  );
}

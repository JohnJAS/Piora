"use client";

import { encodeFilePathForApi, getFileName } from "@/lib/file-paths";
import { useI18n } from "@/hooks/useI18n";
import { AliIcon } from "../AliIcon";
import editorStyles from "../FileEditor.module.css";

export type DisplayMode = "source" | "preview" | "diff" | "edit" | "split";

export interface FileViewerProps {
  filePath: string;
  cwd?: string;
  sourceSessionId?: string | null;
  onOpenFile?: (filePath: string, options?: { line?: number; column?: number }) => void;
  onMentionLines?: (relativePath: string, startLine: number, endLine: number) => void;
  gitRefreshKey?: number;
  initialDisplayMode?: DisplayMode;
  revealLine?: number;
  revealColumn?: number;
  revealKey?: number;
  active?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: () => void;
}

export interface FileData {
  content: string;
  language: string;
  size: number;
  version: string;
  mtime: string;
}

export const DISPLAY_MODE_LABEL_KEYS: Record<DisplayMode, string> = {
  source: "i18n.source",
  preview: "i18n.preview",
  diff: "i18n.diff",
  edit: "i18n.edit",
  split: "files.splitPreview",
};

export interface FileConflictData {
  error?: string;
  code?: string;
  currentVersion?: string;
  mtime?: string;
  size?: number;
  notice?: "changed" | "refreshFailed";
}

export type ConflictDecision = "reload" | "overwrite";

export interface SelectedLineRange {
  startLine: number;
  endLine: number;
}

export function getFileApiUrl(
  filePath: string,
  type: "read" | "download" | "meta" | "preview" | "watch",
  sourceSessionId?: string | null,
  params: Record<string, string | number | undefined> = {},
): string {
  const encoded = encodeFilePathForApi(filePath);
  const searchParams = new URLSearchParams({ type });
  if (sourceSessionId) searchParams.set("sessionId", sourceSessionId);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) searchParams.set(key, String(value));
  }
  return `/api/files/${encoded}?${searchParams.toString()}`;
}

export function getFileWriteApiUrl(filePath: string): string {
  return `/api/files/${encodeFilePathForApi(filePath)}`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "";
  const totalSeconds = Math.round(seconds);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function MentionIcon() {
  return <AliIcon name="link" size={14} />;
}

export function DownloadLink({ filePath, sourceSessionId }: { filePath: string; sourceSessionId?: string | null }) {
  const { t } = useI18n();
  return (
    <a
      href={getFileApiUrl(filePath, "download", sourceSessionId)}
      download={getFileName(filePath)}
      title={t("i18n.downloadFile")}
      aria-label={t("i18n.downloadFile")}
      className="file-viewer-icon-button"
    >
      <AliIcon name="download" size={14} />
    </a>
  );
}

export function ReadOnlyNotice() {
  const { t } = useI18n();
  return (
    <div className={editorStyles.readOnlyNotice} role="status">
      <AliIcon name="lock" size={13} />
      <span>
        <strong>{t("fileEditor.readOnlyTitle")}</strong>
        {t("fileEditor.readOnlyTypeBody")}
      </span>
    </div>
  );
}

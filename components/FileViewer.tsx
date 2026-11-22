"use client";

import {
  useEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
  useId,
} from "react";
import { useTheme } from "@/hooks/useTheme";
import { getFileViewerKind, isMarkdownPath } from "@/lib/file-types";
import { getFileDirectory, getFileName, getRelativeFilePath } from "@/lib/file-paths";
import { normalizeDisplayMath } from "@/lib/markdown";
import { useMarkdownRehypePlugins } from "@/hooks/useMarkdownRehypePlugins";
import type { GitFileDiffResponse } from "@/lib/git-types";
import { useI18n } from "@/hooks/useI18n";
import editorStyles from "./FileEditor.module.css";
import { AliIcon } from "./AliIcon";
import { DiffView } from "./DiffView";
import { FileCodeEditor, type FileCodeEditorHandle } from "./FileCodeEditor";
import type { CodeIntelligenceMode } from "@/lib/code-intelligence-types";
import {
  getDraftFileLineChanges,
  getFileLineSeparator,
  getGitFileLineChanges,
  normalizeFileLineEndings,
  preserveFileLineEndings,
} from "@/lib/file-editor-line-changes";
import {
  getAdjacentChangeIndex,
  getCurrentChangeIndex,
  getDiffChangeRanges,
  getEditorChangeRanges,
} from "@/lib/file-change-navigation";
import { FileReferenceRecovery } from "./FileReferenceRecovery";
import { FileConflictBanner, FileSaveErrorBanner } from "./file-viewer/FileConflictBanner";
import { FilePreviewPane } from "./file-viewer/FilePreviewPane";
import { AudioViewer, DocumentViewer, ImageViewer } from "./file-viewer/MediaViewers";
import { FileSourceView, getSelectedSourceLineRange } from "./file-viewer/SourceCodeView";
import {
  DISPLAY_MODE_LABEL_KEYS,
  DownloadLink,
  formatSize,
  getFileApiUrl,
  getFileWriteApiUrl,
  MentionIcon,
  utf8ByteLength,
  type ConflictDecision,
  type DisplayMode,
  type FileConflictData,
  type FileData,
  type FileViewerProps,
  type SelectedLineRange,
} from "./file-viewer/shared";

export type { DisplayMode } from "./file-viewer/shared";

export function FileViewer(props: FileViewerProps) {
  const { filePath: originalPath, onOpenFile, revealLine, revealColumn } = props;
  const [recovered, setRecovered] = useState<{ original: string; path: string } | null>(null);
  const filePath = recovered?.original === props.filePath ? recovered.path : props.filePath;
  const locate = useCallback((path: string) => {
    if (onOpenFile) onOpenFile(path, { line: revealLine, column: revealColumn });
    else setRecovered({ original: originalPath, path });
  }, [originalPath, onOpenFile, revealLine, revealColumn]);
  return <FileViewerContent {...props} filePath={filePath} onLocateFile={locate} />;
}

function FileViewerContent({
  filePath,
  cwd,
  sourceSessionId,
  onOpenFile,
  onMentionLines,
  gitRefreshKey,
  initialDisplayMode,
  revealLine,
  revealColumn,
  revealKey,
  active = true,
  onDirtyChange,
  onSaved,
  onLocateFile,
}: FileViewerProps & { onLocateFile: (path: string) => void }) {
  const viewerKind = getFileViewerKind(filePath);
  if (viewerKind === "image") {
    return <ImageViewer filePath={filePath} cwd={cwd} sourceSessionId={sourceSessionId} active={active} />;
  }
  if (viewerKind === "audio") {
    return <AudioViewer filePath={filePath} cwd={cwd} sourceSessionId={sourceSessionId} active={active} />;
  }
  if (viewerKind === "document") {
    return <DocumentViewer filePath={filePath} cwd={cwd} sourceSessionId={sourceSessionId} active={active} />;
  }
  return (
    <TextFileViewer
      filePath={filePath}
      cwd={cwd}
      sourceSessionId={sourceSessionId}
      onOpenFile={onOpenFile}
      onMentionLines={onMentionLines}
      gitRefreshKey={gitRefreshKey}
      initialDisplayMode={initialDisplayMode}
      revealLine={revealLine}
      revealColumn={revealColumn}
      revealKey={revealKey}
      active={active}
      onDirtyChange={onDirtyChange}
      onSaved={onSaved}
      onLocateFile={onLocateFile}
    />
  );
}

function TextFileViewer({
  filePath,
  cwd,
  sourceSessionId,
  onOpenFile,
  onMentionLines,
  gitRefreshKey,
  initialDisplayMode,
  revealLine,
  revealColumn,
  revealKey,
  active = true,
  onDirtyChange,
  onSaved,
  onLocateFile,
}: FileViewerProps & { onLocateFile: (path: string) => void }) {
  const updateBlockerId = useId();
  const { isDark } = useTheme();
  const { t } = useI18n();
  const [data, setData] = useState<FileData | null>(null);
  const [gitDiff, setGitDiff] = useState<GitFileDiffResponse | null>(null);
  const [gitDiffLoading, setGitDiffLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [displayMode, setDisplayMode] = useState<DisplayMode>(() => isMarkdownPath(filePath) ? "preview" : "edit");
  const [viewerWidth, setViewerWidth] = useState(0);
  const [compactSplitSide, setCompactSplitSide] = useState<"edit" | "preview">("edit");
  const [debouncedHtml, setDebouncedHtml] = useState("");
  const [wrapLines, setWrapLines] = useState(false);
  const [watching, setWatching] = useState(false);
  const [draftContent, setDraftContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [expectedVersion, setExpectedVersion] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [externalChange, setExternalChange] = useState<FileConflictData | null>(null);
  const [conflictDecision, setConflictDecision] = useState<ConflictDecision | null>(null);
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 });
  const [intelligence, setIntelligence] = useState<{ mode: CodeIntelligenceMode; message?: string } | null>(null);
  const [editorScrollTop, setEditorScrollTop] = useState(0);
  const [changeLine, setChangeLine] = useState<number | null>(null);
  const [diffChange, setDiffChange] = useState<{ patch: string; line: number; key: number } | null>(null);
  const [changeReveal, setChangeReveal] = useState<{ line: number; column?: number } | null>(null);
  const appliedChangeRevealRef = useRef<typeof changeReveal>(null);
  const [sourceHighlight, setSourceHighlight] = useState<typeof changeReveal>(null);
  const esRef = useRef<EventSource | null>(null);
  const editorRef = useRef<FileCodeEditorHandle | null>(null);
  const splitPreviewRef = useRef<HTMLDivElement | null>(null);
  const conflictConfirmRef = useRef<HTMLButtonElement | null>(null);
  const loadedRef = useRef(false);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const draftContentRef = useRef("");
  const expectedVersionRef = useRef("");
  const gitDiffRequestRef = useRef(0);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const viewerRootRef = useRef<HTMLDivElement | null>(null);
  const [selectedLineRange, setSelectedLineRange] = useState<SelectedLineRange | null>(null);

  const syncPreviewScroll = useCallback(() => {
    const preview = splitPreviewRef.current;
    if (!preview || !editorRef.current) return;
    preview.scrollTop = editorRef.current.getScrollProgress() * Math.max(0, preview.scrollHeight - preview.clientHeight);
  }, []);

  useEffect(() => {
    const preview = splitPreviewRef.current;
    if (!preview) return;
    // Preview images, rendered diagrams and pane resizing can change the scroll range.
    const observer = new ResizeObserver(syncPreviewScroll);
    observer.observe(preview);
    if (preview.firstElementChild) observer.observe(preview.firstElementChild, { box: "border-box" });
    const frame = requestAnimationFrame(syncPreviewScroll);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [active, displayMode, loading, data?.language, viewerWidth, syncPreviewScroll]);

  useEffect(() => {
    const root = viewerRootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(([entry]) => setViewerWidth(entry.contentRect.width));
    observer.observe(root);
    return () => observer.disconnect();
  }, [loading]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedHtml(draftContent), 300);
    return () => window.clearTimeout(timer);
  }, [draftContent]);

  useEffect(() => {
    if (!active || !revealLine || loading || !data) return;
    // Reuse the reveal observer: lazy syntax grammars may replace source rows
    // after the initial file render. State keeps both scrolling and highlight.
    setChangeReveal({ line: revealLine, column: revealColumn });
    if (displayMode === "preview" || displayMode === "diff") setDisplayMode("source");
    if (displayMode === "split") setCompactSplitSide("edit");
  }, [active, data, displayMode, loading, revealColumn, revealKey, revealLine]);

  const dirty = preserveFileLineEndings(draftContent, savedContent) !== savedContent;
  dirtyRef.current = dirty;
  savingRef.current = saving;
  draftContentRef.current = draftContent;
  expectedVersionRef.current = expectedVersion;

  const fetchContent = useCallback((targetPath: string, replaceDraft = true) => {
    return fetch(getFileApiUrl(targetPath, "read", sourceSessionId))
      .then(async (response) => {
        const next = await response.json() as FileData & { error?: string };
        if (!response.ok || next.error) {
          if (replaceDraft) setMissing(response.status === 404);
          throw new Error(next.error ?? `HTTP ${response.status}`);
        }
        return next;
      })
      .then((next) => {
        setError(null);
        setMissing(false);
        setData(next);
        loadedRef.current = true;
        if (replaceDraft) {
          setDraftContent(next.content);
          setSavedContent(next.content);
          setExpectedVersion(next.version);
          draftContentRef.current = next.content;
          expectedVersionRef.current = next.version;
          dirtyRef.current = false;
          setExternalChange(null);
          setConflictDecision(null);
          setSaveError(null);
        } else if (next.version !== expectedVersionRef.current) {
          setConflictDecision(null);
          setExternalChange({
            code: "FILE_CONFLICT",
            currentVersion: next.version,
            mtime: next.mtime,
            size: next.size,
            notice: "changed",
          });
        }
        return next;
      })
      .catch((cause: unknown) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        if (replaceDraft && !dirtyRef.current) {
          setError(message);
        } else {
          setConflictDecision(null);
          setExternalChange({
            error: message,
            code: "FILE_CONFLICT",
            notice: "refreshFailed",
          });
        }
        return null;
      });
  }, [sourceSessionId]);

  const fetchGitDiff = useCallback(async (targetPath: string) => {
    const requestId = ++gitDiffRequestRef.current;
    setGitDiffLoading(true);
    if (!cwd) {
      setGitDiff(null);
      setGitDiffLoading(false);
      return;
    }

    try {
      const params = new URLSearchParams({ cwd, path: targetPath });
      const response = await fetch(`/api/git/diff?${params.toString()}`);
      const next = await response.json() as GitFileDiffResponse & { error?: string };
      if (requestId !== gitDiffRequestRef.current) return;
      setGitDiff(response.ok && next.supported && typeof next.patch === "string" ? next : null);
    } catch {
      if (requestId === gitDiffRequestRef.current) setGitDiff(null);
    } finally {
      if (requestId === gitDiffRequestRef.current) setGitDiffLoading(false);
    }
  }, [cwd]);

  // Reset only when this mounted viewer is repointed to a different file.
  // Active-tab changes must not reset the draft.
  useEffect(() => {
    setLoading(true);
    setError(null);
    setData(null);
    setGitDiff(null);
    setDisplayMode(isMarkdownPath(filePath) ? "preview" : "edit");
    setWrapLines(false);
    setWatching(false);
    setDraftContent("");
    setSavedContent("");
    setExpectedVersion("");
    setSaving(false);
    setSaveError(null);
    setExternalChange(null);
    setConflictDecision(null);
    setCursorPosition({ line: 1, column: 1 });
    setEditorScrollTop(0);
    setChangeLine(null);
    setDiffChange(null);
    setChangeReveal(null);
    loadedRef.current = false;
    dirtyRef.current = false;
    savingRef.current = false;
    draftContentRef.current = "";
    expectedVersionRef.current = "";

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, [filePath]);

  // Only the active tab keeps an EventSource open. Inactive viewers stay
  // mounted so their unsaved drafts, cursor and view mode survive tab switches.
  useEffect(() => {
    if (!active) {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      setWatching(false);
      return;
    }

    const replaceDraft = !dirtyRef.current;
    if (!loadedRef.current) setLoading(true);
    fetchContent(filePath, replaceDraft).finally(() => setLoading(false));

    const es = new EventSource(getFileApiUrl(filePath, "watch", sourceSessionId));
    esRef.current = es;

    es.addEventListener("connected", () => { setWatching(true); });
    es.addEventListener("change", (event) => {
      if (dirtyRef.current || savingRef.current) {
        if (!savingRef.current) {
          let details: FileConflictData = { code: "FILE_CONFLICT", notice: "changed" };
          try {
            details = {
              ...details,
              ...JSON.parse((event as MessageEvent).data) as FileConflictData,
              notice: "changed",
            };
          } catch { /* keep the generic notice */ }
          setConflictDecision(null);
          setExternalChange(details);
        }
      } else {
        void fetchContent(filePath, true);
      }
      void fetchGitDiff(filePath);
    });
    es.addEventListener("error", () => { setWatching(false); });
    es.onerror = () => { setWatching(false); };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [active, filePath, fetchContent, fetchGitDiff, sourceSessionId]);

  useEffect(() => {
    if (active) void fetchGitDiff(filePath);
  }, [active, fetchGitDiff, filePath, gitRefreshKey]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    const key = `file:${updateBlockerId}`;
    void window.piDesktop?.setUpdateBlocker?.(key, dirty || saving);
    return () => { void window.piDesktop?.setUpdateBlocker?.(key, false); };
  }, [updateBlockerId, dirty, saving]);

  const hasGitDiff = gitDiff?.supported === true && typeof gitDiff.patch === "string";
  const isDeletedDiff = hasGitDiff && gitDiff.status === "deleted";
  const gitEditorLineChanges = useMemo(
    () => getGitFileLineChanges(hasGitDiff ? gitDiff.patch ?? null : null, normalizeFileLineEndings(savedContent).split("\n").length),
    [hasGitDiff, gitDiff?.patch, savedContent],
  );
  const computeDraftLineChanges = getDraftFileLineChanges;
  const editorLineChanges = useMemo(
    () => computeDraftLineChanges(gitEditorLineChanges, savedContent, draftContent),
    [computeDraftLineChanges, gitEditorLineChanges, savedContent, draftContent],
  );
  const editorChangeRanges = useMemo(() => getEditorChangeRanges(editorLineChanges), [editorLineChanges]);
  const diffChangeRanges = useMemo(() => getDiffChangeRanges(gitDiff?.patch ?? ""), [gitDiff?.patch]);
  const navigatingDiff = isDeletedDiff || displayMode === "diff";
  const diffReveal = diffChange?.patch === gitDiff?.patch ? diffChange : null;
  const changeRanges = navigatingDiff ? diffChangeRanges : editorChangeRanges;
  const changePosition = navigatingDiff ? diffReveal?.line ?? null : changeLine;
  const currentChangeIndex = getCurrentChangeIndex(changeRanges, changePosition);
  const changeCountLabel = !changeRanges.length
    ? t("fileEditor.noChanges")
    : t(currentChangeIndex < 0 ? "fileEditor.changeTotal" : "fileEditor.changePosition", {
      current: currentChangeIndex + 1,
      total: changeRanges.length,
    });

  const navigateChange = (direction: -1 | 1) => {
    const index = getAdjacentChangeIndex(changeRanges, changePosition, direction);
    if (index < 0) return;
    const line = changeRanges[index].from;
    if (navigatingDiff) {
      setDiffChange((previous) => ({ patch: gitDiff!.patch!, line, key: (previous?.key ?? 0) + 1 }));
    } else {
      setChangeLine(line);
      setChangeReveal({ line });
      if (displayMode === "preview") setDisplayMode("edit");
      if (displayMode === "split") setCompactSplitSide("edit");
    }
  };

  useEffect(() => {
    setSourceHighlight(null);
    if (!active || !changeReveal || appliedChangeRevealRef.current === changeReveal) return;
    let highlightTimer: ReturnType<typeof setTimeout> | undefined;
    let observer: MutationObserver | undefined;
    const reveal = () => {
      if (editorRef.current) editorRef.current.revealLine(changeReveal.line, changeReveal.column);
      else {
        const line = contentRef.current?.querySelector<HTMLElement>(`.file-source-line[data-line-number="${changeReveal.line}"]`);
        if (!line) return false;
        line.scrollIntoView({ block: "center" });
        // Keep the highlight in React state: lazy grammar registration can
        // replace source rows after the navigation frame has run.
        setSourceHighlight(changeReveal);
        highlightTimer = setTimeout(() => setSourceHighlight(current => current === changeReveal ? null : current), 1600);
      }
      appliedChangeRevealRef.current = changeReveal;
      observer?.disconnect();
      return true;
    };
    const frame = requestAnimationFrame(() => {
      if (!reveal() && contentRef.current) {
        observer = new MutationObserver(() => { reveal(); });
        observer.observe(contentRef.current, { childList: true, subtree: true });
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(highlightTimer);
      observer?.disconnect();
    };
  }, [active, changeReveal, displayMode, compactSplitSide]);

  useEffect(() => {
    if (!hasGitDiff && displayMode === "diff") setDisplayMode("source");
  }, [displayMode, hasGitDiff]);

  useEffect(() => {
    if (!isDeletedDiff || !esRef.current) return;
    esRef.current.close();
    esRef.current = null;
    setWatching(false);
  }, [isDeletedDiff]);

  // Markdown starts in preview; other text files start in edit mode. Explicit
  // callers (the Changes list uses `diff`) may request another initial view
  // once it is available. Apply the hint only once so a user's later view
  // choice is not overwritten.
  const initialDisplayModeAppliedRef = useRef(false);
  useEffect(() => {
    initialDisplayModeAppliedRef.current = false;
  }, [filePath]);
  useEffect(() => {
    if (!initialDisplayMode || initialDisplayModeAppliedRef.current) return;
    if (initialDisplayMode === "diff" && !hasGitDiff) return;
    if (initialDisplayMode === "preview" && data?.language !== "markdown" && data?.language !== "html") return;
    initialDisplayModeAppliedRef.current = true;
    setDisplayMode(initialDisplayMode);
  }, [data?.language, initialDisplayMode, hasGitDiff]);

  const saveFile = useCallback(async (force = false) => {
    if (savingRef.current) return;

    const contentToSave = preserveFileLineEndings(draftContentRef.current, savedContent);
    if (contentToSave !== draftContentRef.current) {
      draftContentRef.current = contentToSave;
      setDraftContent(contentToSave);
    }
    if (!force && contentToSave === savedContent) return;

    setSaving(true);
    savingRef.current = true;
    setSaveError(null);

    try {
      const response = await fetch(getFileWriteApiUrl(filePath), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: contentToSave,
          expectedVersion: expectedVersionRef.current,
          ...(force ? { force: true } : {}),
        }),
      });
      const next = await response.json().catch(() => ({})) as Partial<FileData> & FileConflictData;

      if (response.status === 409 || next.code === "FILE_CONFLICT") {
        setConflictDecision(null);
        setExternalChange({ ...next, code: "FILE_CONFLICT", notice: "changed" });
        return;
      }
      if (!response.ok || next.error) {
        throw new Error(next.error ?? `HTTP ${response.status}`);
      }
      if (typeof next.version !== "string") {
        throw new Error(t("fileEditor.saveMissingVersion"));
      }

      const savedData: FileData = {
        content: typeof next.content === "string" ? next.content : contentToSave,
        language: typeof next.language === "string" ? next.language : (data?.language ?? "text"),
        size: typeof next.size === "number" ? next.size : utf8ByteLength(contentToSave),
        version: next.version,
        mtime: typeof next.mtime === "string" ? next.mtime : new Date().toISOString(),
      };
      setData(savedData);
      setSavedContent(contentToSave);
      setExpectedVersion(savedData.version);
      expectedVersionRef.current = savedData.version;
      dirtyRef.current = draftContentRef.current !== contentToSave;
      setExternalChange(null);
      onSaved?.();
      void fetchGitDiff(filePath);
    } catch (cause: unknown) {
      setSaveError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [data?.language, fetchGitDiff, filePath, onSaved, savedContent, t]);

  const reloadFromDisk = useCallback(async () => {
    setConflictDecision(null);
    setLoading(true);
    const next = await fetchContent(filePath, true);
    setLoading(false);
    if (next) {
      setExternalChange(null);
      void fetchGitDiff(filePath);
    }
  }, [fetchContent, fetchGitDiff, filePath]);

  const overwriteDisk = useCallback(() => {
    setConflictDecision(null);
    void saveFile(true);
  }, [saveFile]);

  useEffect(() => {
    if (conflictDecision) conflictConfirmRef.current?.focus();
  }, [conflictDecision]);

  useEffect(() => {
    if (!active || (displayMode !== "edit" && (displayMode !== "split" || (viewerWidth < 650 && compactSplitSide !== "edit")))) return;
    const focusFrame = requestAnimationFrame(() => editorRef.current?.focus());
    return () => cancelAnimationFrame(focusFrame);
  }, [active, compactSplitSide, displayMode, viewerWidth]);

  useEffect(() => {
    if (!active || (displayMode !== "edit" && displayMode !== "split")) return;
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key.toLowerCase() !== "s" || (!event.ctrlKey && !event.metaKey)) return;
      event.preventDefault();
      void saveFile(false);
    };
    window.addEventListener("keydown", handleSaveShortcut);
    return () => window.removeEventListener("keydown", handleSaveShortcut);
  }, [active, displayMode, saveFile]);

  const markdownPreview = useMemo(
    () => (data?.language === "markdown" ? normalizeDisplayMath(draftContent) : ""),
    [data?.language, draftContent],
  );
  const markdownPreviewRehypePluginsWithMath = useMarkdownRehypePlugins(markdownPreview, true);

  useEffect(() => {
    const updateSelectedLineRange = () => {
      const root = contentRef.current;
      setSelectedLineRange(
        onMentionLines && displayMode === "source" && root
          ? getSelectedSourceLineRange(root, window.getSelection())
          : null,
      );
    };

    updateSelectedLineRange();
    if (!onMentionLines || displayMode !== "source") return;

    document.addEventListener("selectionchange", updateSelectedLineRange);
    return () => document.removeEventListener("selectionchange", updateSelectedLineRange);
  }, [draftContent, displayMode, onMentionLines]);

  const mentionLineRange = useCallback((lineRange: SelectedLineRange | null) => {
    if (!onMentionLines || !lineRange) return;
    onMentionLines(
      getRelativeFilePath(filePath, cwd),
      lineRange.startLine,
      lineRange.endLine,
    );
  }, [cwd, filePath, onMentionLines]);

  const handleMentionSelectedLines = useCallback(() => {
    mentionLineRange(selectedLineRange);
  }, [mentionLineRange, selectedLineRange]);

  useEffect(() => {
    if (!onMentionLines || displayMode !== "source") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.key.toLowerCase() !== "i" || (!event.metaKey && !event.ctrlKey) || event.altKey || event.shiftKey) return;

      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, [contenteditable='true']")) return;

      const root = contentRef.current;
      const lineRange = root ? getSelectedSourceLineRange(root, window.getSelection()) : null;
      if (!lineRange) return;

      event.preventDefault();
      mentionLineRange(lineRange);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [displayMode, mentionLineRange, onMentionLines]);

  if (loading || (initialDisplayMode === "diff" && gitDiffLoading && !data)) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: "var(--text-base)" }}>
        {t("i18n.loading")}
      </div>
    );
  }

  if (error && !isDeletedDiff) {
    if (missing) return <FileReferenceRecovery key={filePath} filePath={filePath} cwd={cwd} active={active} onFound={onLocateFile} />;
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#f87171", fontSize: "var(--text-base)" }}>
        {t("fileReference.readFailed", { error })}
      </div>
    );
  }

  if (!data && !isDeletedDiff) return null;

  const language = data?.language ?? "text";
  const content = draftContent;
  const isHtml = language === "html";
  const isMarkdown = language === "markdown";
  const hasPreview = isHtml || isMarkdown;
  const markdownDirectory = getFileDirectory(filePath);
  const lines = content.split("\n");
  const effectiveDisplayMode = isDeletedDiff ? "diff" : displayMode;
  const displayModes: DisplayMode[] = isDeletedDiff
    ? ["diff"]
    : [
        "edit",
        "source",
        ...(hasPreview ? ["preview" as const] : []),
        ...(hasPreview ? ["split" as const] : []),
        ...(hasGitDiff ? ["diff" as const] : []),
      ];
  const metadata = isDeletedDiff
    ? t("files.deleted")
    : `${language} · ${t(lines.length === 1 ? "fileEditor.lineCountOne" : "fileEditor.lineCount", { count: lines.length })} · ${formatSize(dirty ? utf8ByteLength(content) : data!.size)}`;

  const renderEditor = () => (
    <div className={`${editorStyles.editorShell} file-editor-shell`}>
      <div className={editorStyles.editorBody}>
        <FileCodeEditor
          key={`${filePath}:${getFileLineSeparator(savedContent)}`}
          ref={editorRef}
          value={preserveFileLineEndings(draftContent, savedContent)}
          filePath={filePath}
          cwd={cwd}
          lineSeparator={getFileLineSeparator(savedContent)}
          scrollTop={editorScrollTop}
          ariaLabel={t("fileEditor.editFile", { file: getFileName(filePath) })}
          onChange={(nextValue) => {
            setDraftContent(nextValue);
            draftContentRef.current = nextValue;
            setSaveError(null);
          }}
          onCursorChange={(position) => { setCursorPosition(position); setChangeLine(position.line); }}
          onScrollChange={(top) => { setEditorScrollTop(top); syncPreviewScroll(); }}
          onSave={() => void saveFile(false)}
          onNavigate={(target) => onOpenFile?.(target.filePath, { line: target.line, column: target.column })}
          onIntelligenceMode={(mode, message) => setIntelligence({ mode, message })}
          lineChanges={editorLineChanges}
        />
      </div>
      <div className={`${editorStyles.statusBar} file-editor-status`}>
        <span className={dirty ? editorStyles.unsavedStatus : editorStyles.savedStatus}>
          <span className={editorStyles.statusDot} aria-hidden="true" />
          {dirty ? t("fileEditor.unsaved") : t("i18n.saved")}
        </span>
        <span>{t("fileEditor.cursorPosition", { line: cursorPosition.line, column: cursorPosition.column })}</span>
        {intelligence ? (
          <span title={intelligence.message} aria-label={intelligence.message}>
            {intelligence.mode === "arkts-basic" ? t("fileEditor.arktsBasic") : t("fileEditor.tsIntelligence")}
          </span>
        ) : null}
        <span>UTF-8</span>
        <span>{formatSize(utf8ByteLength(draftContent))}</span>
      </div>
    </div>
  );

  const renderPreview = (live = false) => (
    <FilePreviewPane
      isHtml={isHtml}
      live={live}
      content={content}
      debouncedHtml={debouncedHtml}
      markdownPreview={markdownPreview}
      markdownRehypePlugins={markdownPreviewRehypePluginsWithMath}
      markdownDirectory={markdownDirectory}
      cwd={cwd}
      sourceSessionId={sourceSessionId}
      onOpenFile={onOpenFile}
    />
  );

  return (
    <div ref={viewerRootRef} className={`${editorStyles.container} file-viewer-shell`} style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div
        className="file-viewer-toolbar"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 12px",
          borderBottom: "1px solid var(--border)",
          fontSize: "var(--text-xs)",
          color: "var(--text-dim)",
          background: "var(--file-panel-surface, var(--bg))",
          flexShrink: 0,
        }}
      >
        <span className="file-viewer-path" style={{ fontFamily: "var(--font-mono)" }} title={filePath}>
          {getRelativeFilePath(filePath, cwd)}
        </span>

        <span className="file-viewer-meta" title={metadata}>{metadata}</span>
        {!isDeletedDiff && (
          <span
            title={watching ? t("i18n.liveSync") : t("i18n.notWatching")}
            aria-label={watching ? t("i18n.liveSync") : t("i18n.notWatching")}
            className="file-viewer-live-indicator"
            style={{
              background: watching ? "#4ade80" : "var(--border)",
              boxShadow: watching ? "0 0 4px #4ade80" : "none",
            }}
          />
        )}

        <div className="file-viewer-controls">
          {displayModes.length > 1 && (
            <div className="file-viewer-mode-switch" aria-label={t("i18n.fileViewMode")}>
              {displayModes.map((mode) => {
                const modeActive = effectiveDisplayMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setDisplayMode(mode)}
                    title={mode === "diff" ? t("i18n.compareHead") : mode === "edit" ? t("fileEditor.editModeTitle") : undefined}
                    aria-label={mode === "edit" ? t("fileEditor.editModeTitle") : t(DISPLAY_MODE_LABEL_KEYS[mode])}
                    aria-pressed={modeActive}
                    className={`file-viewer-mode-button${mode === "edit" ? ` ${editorStyles.editModeButton}` : ""}`}
                    data-active={mode === "edit" && modeActive ? "true" : undefined}
                    style={{
                      background: modeActive ? "var(--bg-selected)" : "transparent",
                      color: modeActive ? "var(--text)" : "var(--text-muted)",
                    }}
                  >
                    {mode === "edit" && <AliIcon name="edit" size={12} />}
                    {t(DISPLAY_MODE_LABEL_KEYS[mode])}
                  </button>
                );
              })}
            </div>
          )}
          {effectiveDisplayMode === "split" && viewerWidth < 650 ? (
            <div className="file-viewer-mode-switch" aria-label={t("files.splitPreview")}>
              <button type="button" aria-pressed={compactSplitSide === "edit"} onClick={() => setCompactSplitSide("edit")}>{t("i18n.edit")}</button>
              <button type="button" aria-pressed={compactSplitSide === "preview"} onClick={() => setCompactSplitSide("preview")}>{t("i18n.preview")}</button>
            </div>
          ) : null}

          <div className="file-viewer-actions">
            <div className={editorStyles.changeNavigation} role="group" aria-label={t("fileEditor.changeNavigation")}>
              <span className={editorStyles.changeCount} role="status" aria-live="polite" aria-atomic="true" title={changeCountLabel}>
                <span aria-hidden="true">{currentChangeIndex + 1}/{changeRanges.length}</span>
                <span className="sr-only">{changeCountLabel}</span>
              </span>
              <button type="button" className="file-viewer-icon-button" onClick={() => navigateChange(-1)} disabled={!changeRanges.length}
                title={t("fileEditor.previousChange")} aria-label={t("fileEditor.previousChange")}><AliIcon name="arrowup" size={14} /></button>
              <button type="button" className="file-viewer-icon-button" onClick={() => navigateChange(1)} disabled={!changeRanges.length}
                title={t("fileEditor.nextChange")} aria-label={t("fileEditor.nextChange")}><AliIcon name="arrowdown" size={14} /></button>
            </div>
            {effectiveDisplayMode === "source" && (
              <>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={handleMentionSelectedLines}
                  title={t("i18n.mentionSelectedLines")}
                  aria-label={t("i18n.mentionSelectedLines")}
                  disabled={!selectedLineRange}
                  className="file-viewer-icon-button"
                >
                  <MentionIcon />
                </button>
                <button
                  type="button"
                  onClick={() => setWrapLines((value) => !value)}
                  title={wrapLines ? t("i18n.disableWrap") : t("i18n.enableWrap")}
                  aria-label={wrapLines ? t("i18n.disableWrap") : t("i18n.enableWrap")}
                  aria-pressed={wrapLines}
                  className="file-viewer-icon-button"
                  style={{
                    background: wrapLines ? "var(--bg-selected)" : "transparent",
                    color: wrapLines ? "var(--text)" : "var(--text-muted)",
                  }}
                >
                  <AliIcon name="enter" size={14} />
                </button>
              </>
            )}
          </div>

          {!isDeletedDiff && (
            <button
              type="button"
              onClick={() => void saveFile(false)}
              disabled={!dirty || saving}
              className={editorStyles.saveButton}
              title={dirty ? t("fileEditor.saveShortcutTitle") : t("fileEditor.noUnsavedChanges")}
              aria-label={saving ? t("fileEditor.savingFile") : t("fileEditor.saveFile")}
              aria-keyshortcuts="Control+S Meta+S"
            >
              {saving ? (
                <span className={editorStyles.spinner} aria-hidden="true" />
              ) : (
                <AliIcon name="save" size={13} />
              )}
              <span className={editorStyles.saveLabel}>{saving ? t("i18n.saving") : dirty ? t("i18n.save") : t("i18n.saved")}</span>
            </button>
          )}

          {!isDeletedDiff && <DownloadLink filePath={filePath} sourceSessionId={sourceSessionId} />}
        </div>
      </div>

      {externalChange && !isDeletedDiff && (
        <FileConflictBanner
          externalChange={externalChange}
          conflictDecision={conflictDecision}
          saving={saving}
          conflictConfirmRef={conflictConfirmRef}
          onSetConflictDecision={setConflictDecision}
          onKeepEditing={() => {
            setExternalChange(null);
            setDisplayMode("edit");
            requestAnimationFrame(() => editorRef.current?.focus());
          }}
          onReloadFromDisk={() => void reloadFromDisk()}
          onOverwriteDisk={overwriteDisk}
        />
      )}

      {saveError && !isDeletedDiff && (
        <FileSaveErrorBanner
          saveError={saveError}
          onRetry={() => void saveFile(false)}
          onDismiss={() => setSaveError(null)}
        />
      )}

      {/* Content area */}
      <div
        ref={contentRef}
        className="file-viewer-content"
        style={{
          flex: 1,
          overflow: effectiveDisplayMode === "edit" || (effectiveDisplayMode === "split" && (viewerWidth >= 650 || compactSplitSide === "edit")) ? "hidden" : "auto",
          background: "var(--file-panel-surface, var(--bg))",
        }}
      >
        {effectiveDisplayMode === "edit" ? (
          renderEditor()
        ) : effectiveDisplayMode === "split" ? (
          viewerWidth >= 650 ? (
            <div className={editorStyles.splitPreviewLayout}>
              <div className={editorStyles.splitEditorPane}>{renderEditor()}</div>
              <div ref={isMarkdown ? splitPreviewRef : undefined} className={editorStyles.splitPreviewPane}>{renderPreview(true)}</div>
            </div>
          ) : (
            compactSplitSide === "edit" ? renderEditor() : renderPreview(true)
          )
        ) : effectiveDisplayMode === "diff" && hasGitDiff ? (
          <DiffView patch={gitDiff.patch!} revealDiffLine={diffReveal} />
        ) : (isHtml || isMarkdown) && effectiveDisplayMode === "preview" ? (
          renderPreview()
        ) : (
          <FileSourceView
            content={content}
            language={language}
            isDark={isDark}
            wrapLines={wrapLines}
            highlightedLine={sourceHighlight === changeReveal ? sourceHighlight?.line : undefined}
          />
        )}
      </div>
    </div>
  );
}

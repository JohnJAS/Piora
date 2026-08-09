"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vs, vscDarkPlus } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { parseUnifiedDiff, type DiffFile, type DiffLine, type Hunk } from "@/lib/diff-parse";
import { DIFF_PROGRESSIVE_THRESHOLD, DIFF_RENDER_BATCH, getDiffRenderWindow, getNextDiffRenderCount } from "@/lib/diff-progressive";
import { AliIcon } from "./AliIcon";
import styles from "./DiffView.module.css";

export interface DiffViewProps {
  patch: string;
  filePath?: string;
  language?: string;
  mode?: "unified" | "split";
  contextLines?: number;
  collapsed?: boolean;
  hunkActions?: (hunk: Hunk) => ReactNode;
  onOpenFile?: (path: string, line: number) => void;
}

const HIGHLIGHT_LIMIT = 600;

export function DiffView({
  patch,
  filePath,
  language,
  mode = "unified",
  contextLines = 3,
  collapsed = false,
  hunkActions,
  onOpenFile,
}: DiffViewProps) {
  const { t } = useI18n();
  const parsed = useMemo(() => parseUnifiedDiff(patch), [patch]);
  const [renderBudget, setRenderBudget] = useState(() => ({ patch, lines: DIFF_RENDER_BATCH }));
  const [collapsedHunks, setCollapsedHunks] = useState<Set<string>>(() => new Set());
  const requestedLines = parsed.lineCount <= DIFF_PROGRESSIVE_THRESHOLD
    ? parsed.lineCount
    : renderBudget.patch === patch ? renderBudget.lines : DIFF_RENDER_BATCH;
  const renderWindow = getDiffRenderWindow(parsed.lineCount, requestedLines);
  const limited = renderWindow.remaining > 0;
  const loadMoreRef = useRef<HTMLButtonElement>(null);
  let remaining = renderWindow.endIndex;

  const loadMore = useCallback(() => {
    startTransition(() => {
      setRenderBudget((current) => ({
        patch,
        lines: getNextDiffRenderCount(current.patch === patch ? current.lines : DIFF_RENDER_BATCH, parsed.lineCount),
      }));
    });
  }, [parsed.lineCount, patch]);

  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!limited || !sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) loadMore();
    }, { rootMargin: "240px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [limited, loadMore]);

  if (parsed.files.length === 0) return <div className={styles.notice}>{t("diff.empty")}</div>;

  return (
    <div className={styles.root} data-context-lines={contextLines}>
      {parsed.files.map((file, fileIndex) => {
        if (remaining <= 0) return null;
        const displayPath = filePath ?? bestPath(file);
        return (
          <section key={`${displayPath}-${fileIndex}`}>
            <div className={styles.fileHeader}>
              <span className={styles.filePath} title={displayPath}>{displayPath || t("diff.unknownFile")}</span>
              <span className={styles.fileStatus}>{t(`diff.status.${file.status}`)}</span>
              {displayPath && onOpenFile && (
                <button className={styles.button} type="button" onClick={() => onOpenFile(displayPath, firstLine(file))} title={t("diff.openFile")} aria-label={t("diff.openFile")}>
                  <AliIcon name="file" size={13} />
                </button>
              )}
              <button className={styles.button} type="button" onClick={() => void navigator.clipboard.writeText(patch)} title={t("diff.copy")} aria-label={t("diff.copy")}>
                <AliIcon name="copy" size={13} />
              </button>
            </div>
            {file.binary ? <div className={styles.notice}>{t("diff.binary")}</div> : file.hunks.map((hunk, hunkIndex) => {
              if (remaining <= 0) return null;
              const key = `${fileIndex}:${hunkIndex}`;
              const isCollapsed = collapsed || collapsedHunks.has(key);
              const lines = hunk.lines.slice(0, remaining);
              remaining -= lines.length;
              return (
                <div key={key}>
                  <div className={styles.hunk}>
                    <button
                      type="button"
                      className={styles.hunkToggle}
                      title={hunk.header}
                      onClick={() => setCollapsedHunks((current) => toggleSet(current, key))}
                      aria-expanded={!isCollapsed}
                    ><span className={styles.hunkChevron} aria-hidden="true">{isCollapsed ? "›" : "⌄"}</span>{compactHunkHeader(hunk.header)}</button>
                    {hunkActions?.(hunk)}
                  </div>
                  {!isCollapsed && (mode === "split"
                    ? <SplitLines lines={lines} language={language ?? languageFor(displayPath)} highlight={parsed.lineCount <= HIGHLIGHT_LIMIT} />
                    : <UnifiedLines lines={lines} language={language ?? languageFor(displayPath)} highlight={parsed.lineCount <= HIGHLIGHT_LIMIT} />)}
                </div>
              );
            })}
          </section>
        );
      })}
      {limited ? <div className={styles.limit}><button ref={loadMoreRef} type="button" className={styles.loadMore} onClick={loadMore}>{t("diff.loadMore", { shown: renderWindow.endIndex, total: parsed.lineCount })}</button></div> : null}
    </div>
  );
}

function UnifiedLines({ lines, language, highlight }: { lines: DiffLine[]; language: string; highlight: boolean }) {
  return <>{lines.map((line, index) => <UnifiedLine key={index} line={line} language={language} highlight={highlight} />)}</>;
}

function UnifiedLine({ line, language, highlight }: { line: DiffLine; language: string; highlight: boolean }) {
  const marker = line.kind === "added" ? "+" : line.kind === "removed" ? "−" : line.kind === "meta" ? "\\" : " ";
  return (
    <div className={`${styles.line} ${styles[line.kind]}`}>
      <span className={styles.lineNumber}>{line.oldLine ?? ""}</span>
      <span className={styles.lineNumber}>{line.newLine ?? ""}</span>
      <span className={styles.marker}>{marker}</span>
      <Code text={line.text} language={language} highlight={highlight} className={styles.code} />
    </div>
  );
}

function SplitLines({ lines, language, highlight }: { lines: DiffLine[]; language: string; highlight: boolean }) {
  const rows = pairLines(lines);
  return <div className={styles.splitGrid}>{rows.flatMap((row, index) => [
    <SplitCell key={`l-${index}`} line={row.left} side="left" language={language} highlight={highlight} />,
    <SplitCell key={`r-${index}`} line={row.right} side="right" language={language} highlight={highlight} />,
  ])}</div>;
}

function SplitCell({ line, side, language, highlight }: { line: DiffLine | null; side: "left" | "right"; language: string; highlight: boolean }) {
  if (!line) return <div className={`${styles.splitCell} ${styles.empty}`}><span className={styles.lineNumber} /><span /><span /></div>;
  const lineNumber = side === "left" ? line.oldLine : line.newLine;
  const marker = line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " ";
  return <div className={`${styles.splitCell} ${styles[line.kind]}`}><span className={styles.lineNumber}>{lineNumber ?? ""}</span><span className={styles.marker}>{marker}</span><Code text={line.text} language={language} highlight={highlight} className={styles.splitCode} /></div>;
}

function Code({ text, language, highlight, className }: { text: string; language: string; highlight: boolean; className: string }) {
  const { isDark } = useTheme();
  if (!highlight || !text) return <code className={className}>{text || "\u00a0"}</code>;
  return <SyntaxHighlighter language={language} style={isDark ? vscDarkPlus : vs} PreTag="span" CodeTag="span" customStyle={{ margin: 0, padding: 0, background: "transparent", overflow: "visible" }} codeTagProps={{ className }}>{text}</SyntaxHighlighter>;
}

function pairLines(lines: DiffLine[]): Array<{ left: DiffLine | null; right: DiffLine | null }> {
  const rows: Array<{ left: DiffLine | null; right: DiffLine | null }> = [];
  let removed: DiffLine[] = [];
  let added: DiffLine[] = [];
  const flush = () => {
    const count = Math.max(removed.length, added.length);
    for (let index = 0; index < count; index++) rows.push({ left: removed[index] ?? null, right: added[index] ?? null });
    removed = []; added = [];
  };
  for (const line of lines) {
    if (line.kind === "removed") removed.push(line);
    else if (line.kind === "added") added.push(line);
    else { flush(); rows.push({ left: line, right: line }); }
  }
  flush();
  return rows;
}

function bestPath(file: DiffFile): string { return file.newPath && file.newPath !== "/dev/null" ? file.newPath : file.oldPath ?? ""; }
function firstLine(file: DiffFile): number { return file.hunks[0]?.newStart || file.hunks[0]?.oldStart || 1; }
function languageFor(path: string): string { return path.split(".").pop()?.toLowerCase() || "text"; }
function toggleSet(current: Set<string>, key: string): Set<string> { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; }
function compactHunkHeader(header: string): string { return header.match(/^@@[^@]*@@/)?.[0] ?? header; }

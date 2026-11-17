"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { copyText } from "@/lib/clipboard";
import { getFileName } from "@/lib/file-paths";
import { resolveWorkspaceFilePath } from "@/lib/file-links";
import { useI18n } from "@/hooks/useI18n";

/** Only a confirmed 404 enters filename search; read/permission failures stay distinct. */
export function FileReferenceRecovery({ filePath, cwd, onFound, active = true }: { filePath: string; cwd?: string; onFound: (path: string) => void; active?: boolean }) {
  const { t } = useI18n();
  const [matches, setMatches] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const onFoundRef = useRef(onFound);
  const activeRef = useRef(active);
  onFoundRef.current = onFound;
  activeRef.current = active;
  const search = useCallback(async () => {
    if (!cwd || !active) return;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setSearching(true); setError(""); setSearched(false); setMatches([]);
    try {
      const response = await fetch(`/api/file-index?${new URLSearchParams({ cwd, name: getFileName(filePath) })}`, { signal: request.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json() as { matches?: Array<{ path: string; isDir?: boolean }>; truncated?: boolean };
      if (request.signal.aborted || !activeRef.current) return;
      const found = (result.matches ?? []).filter(match => !match.isDir && resolveWorkspaceFilePath(match.path, cwd));
      setMatches(found.map(match => match.path)); setTruncated(Boolean(result.truncated)); setSearched(true);
      if (found.length === 1 && !result.truncated) onFoundRef.current(resolveWorkspaceFilePath(found[0].path, cwd)!);
    } catch {
      if (!request.signal.aborted) setError(t("fileReference.searchFailed"));
    } finally { if (!request.signal.aborted) setSearching(false); }
  }, [active, cwd, filePath, t]);
  useEffect(() => { void search(); return () => controller.current?.abort(); }, [search]);
  return <div className="file-reference-recovery" style={{ padding: 20, overflow: "auto", height: "100%", fontSize: "var(--text-base)" }}>
    <p role="alert">{t("fileReference.missing")}</p><p style={{ overflowWrap: "anywhere", color: "var(--text-muted)" }}>{filePath}</p>
    {cwd ? <button type="button" disabled={searching} onClick={() => void search()}>{t(searching ? "i18n.loading" : "fileReference.search")}</button> : null}
    <button type="button" onClick={() => { void copyText(filePath).catch(() => setError(t("chatContext.copyFailed"))); }}>{t("files.copyPath")}</button>
    {error ? <p role="alert">{error}</p> : null}
    {searched && !matches.length ? <p role="status">{t("fileReference.noMatches")}</p> : null}
    {matches.length ? <div role="group" aria-label={t("fileReference.choose")}><p>{t("fileReference.choose")}</p>
      {matches.map(path => <button type="button" key={path} style={{ display: "block", maxWidth: "100%", overflowWrap: "anywhere", textAlign: "left" }} onClick={() => onFoundRef.current(resolveWorkspaceFilePath(path, cwd)!)}>{path}</button>)}
    </div> : null}
    {truncated ? <p role="status">{t("fileReference.truncated")}</p> : null}
  </div>;
}

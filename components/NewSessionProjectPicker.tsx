"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getProjectLabel } from "@/lib/session-project-groups";
import type { SessionInfo } from "@/lib/types";
import { AliIcon } from "./AliIcon";
import styles from "./NewSessionProjectPicker.module.css";

interface ProjectChoice {
  root: string;
  cwd: string;
  sessionCount: number;
}

export function NewSessionProjectPicker({
  activeCwd,
  activeProjectRoot,
  onSelect,
  onBrowse,
}: {
  activeCwd?: string | null;
  activeProjectRoot?: string | null;
  onSelect: (cwd: string, projectRoot: string) => void;
  onBrowse: () => void;
}) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/sessions", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as { sessions?: SessionInfo[] };
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (!cancelled) setSessions(data.sessions ?? []);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    window.requestAnimationFrame(() => searchRef.current?.focus());
    return () => { cancelled = true; };
  }, []);

  const projects = useMemo(() => {
    const choices = new Map<string, ProjectChoice>();
    for (const session of sessions) {
      const root = session.projectRoot ?? session.cwd;
      const existing = choices.get(root);
      choices.set(root, {
        root,
        cwd: existing?.cwd ?? session.cwd,
        sessionCount: (existing?.sessionCount ?? 0) + 1,
      });
    }
    if (activeCwd) {
      const root = activeProjectRoot ?? activeCwd;
      if (!choices.has(root)) choices.set(root, { root, cwd: activeCwd, sessionCount: 0 });
    }
    const needle = query.trim().toLocaleLowerCase();
    return [...choices.values()].filter((choice) => (
      !needle || getProjectLabel(choice.root).toLocaleLowerCase().includes(needle) || choice.root.toLocaleLowerCase().includes(needle)
    ));
  }, [activeCwd, activeProjectRoot, query, sessions]);

  return (
    <div className={styles.root}>
      <div className={styles.mark} aria-hidden="true">π</div>
      <h1>你想在哪个项目中构建什么？</h1>
      <div className={styles.picker}>
        <label className={styles.search}>
          <AliIcon name="search" size={14} />
          <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目" aria-label="搜索项目" />
        </label>
        <div className={styles.list} role="listbox" aria-label="选择项目">
          {projects.map((choice) => (
            <button key={choice.root} type="button" role="option" aria-selected={choice.root === activeProjectRoot} onClick={() => onSelect(choice.cwd, choice.root)} title={choice.root}>
              <AliIcon name="folder" size={15} />
              <span><strong>{getProjectLabel(choice.root)}</strong><small>{choice.root}</small></span>
              {choice.root === activeProjectRoot ? <AliIcon name="check" size={14} /> : <small>{choice.sessionCount} 个对话</small>}
            </button>
          ))}
          {!loading && projects.length === 0 ? <p>没有匹配的项目</p> : null}
          {loading ? <p>正在加载项目…</p> : null}
        </div>
        <div className={styles.footer}>
          <button type="button" onClick={onBrowse}><AliIcon name="plus" size={14} />新建或选择其他项目</button>
        </div>
      </div>
    </div>
  );
}

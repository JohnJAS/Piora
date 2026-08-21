"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { setDraft } from "@/lib/draft-store";
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
  const [draft, setLandingDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(true);
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
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [menuOpen]);

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
    return [...choices.values()]
      .filter((choice) => (
        !needle || getProjectLabel(choice.root).toLocaleLowerCase().includes(needle) || choice.root.toLocaleLowerCase().includes(needle)
      ))
      .sort((left, right) => {
        const leftActive = left.root === activeProjectRoot ? 1 : 0;
        const rightActive = right.root === activeProjectRoot ? 1 : 0;
        return rightActive - leftActive
          || right.sessionCount - left.sessionCount
          || getProjectLabel(left.root).localeCompare(getProjectLabel(right.root));
      });
  }, [activeCwd, activeProjectRoot, query, sessions]);

  const chooseProject = (choice: ProjectChoice) => {
    if (draft.trim()) setDraft(`new:${choice.cwd}`, { value: draft, images: [] });
    onSelect(choice.cwd, choice.root);
  };

  const requestProjectChoice = () => {
    setMenuOpen(true);
    window.requestAnimationFrame(() => searchRef.current?.focus());
  };

  return (
    <main className={styles.root} aria-labelledby="new-session-heading">
      <section className={styles.hero}>
        <div className={styles.mark} aria-hidden="true">
          <AliIcon name="cloud" size={50} />
          <span>&gt;_</span>
        </div>
        <h1 id="new-session-heading">
          你想在
          <button type="button" onClick={requestProjectChoice} aria-haspopup="listbox" aria-expanded={menuOpen}>选择项目</button>
          中构建什么？
        </h1>

        <div className={styles.composer}>
          <textarea
            value={draft}
            onChange={(event) => setLandingDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                requestProjectChoice();
              }
            }}
            onFocus={() => { if (!menuOpen) setMenuOpen(true); }}
            placeholder="描述你想构建或修复的内容…"
            aria-label="新对话内容"
          />
          <div className={styles.composerBar}>
            <button className={styles.iconButton} type="button" disabled title="选择项目后可添加附件" aria-label="添加附件">
              <AliIcon name="plus" size={16} />
            </button>
            <div className={styles.projectAnchor}>
              {menuOpen ? (
                <div className={styles.projectPopover}>
                  <label className={styles.search}>
                    <AliIcon name="search" size={14} />
                    <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目" aria-label="搜索项目" />
                  </label>
                  <div className={styles.list} role="listbox" aria-label="选择项目">
                    {projects.map((choice) => (
                      <button key={choice.root} type="button" role="option" aria-selected="false" onClick={() => chooseProject(choice)} title={choice.root}>
                        <AliIcon name="folder" size={15} />
                        <span><strong>{getProjectLabel(choice.root)}</strong><small>{choice.root}</small></span>
                        <small>{choice.sessionCount > 0 ? `${choice.sessionCount} 个对话` : ""}</small>
                      </button>
                    ))}
                    {!loading && projects.length === 0 ? <p>没有匹配的项目</p> : null}
                    {loading ? <p>正在加载项目…</p> : null}
                  </div>
                  <div className={styles.footer}>
                    <button type="button" onClick={onBrowse}><AliIcon name="plus" size={14} />新建或选择其他项目</button>
                  </div>
                </div>
              ) : null}
              <button className={styles.projectChip} type="button" onClick={() => setMenuOpen((open) => !open)} aria-haspopup="listbox" aria-expanded={menuOpen}>
                <AliIcon name="folder" size={14} />
                <span>选择项目</span>
                <AliIcon name="arrowdown" size={11} />
              </button>
            </div>
            <span className={styles.contextChip}><AliIcon name="desktop" size={14} />本地</span>
            <span className={styles.selectionHint}>先选择项目再开始</span>
            <button className={styles.sendButton} type="button" onClick={requestProjectChoice} title="请先选择项目" aria-label="发送">
              <AliIcon name="arrowup" size={16} />
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

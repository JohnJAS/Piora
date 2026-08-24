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
  const [menuOpen, setMenuOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const projectSelectorRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!projectSelectorRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
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

  const openProjectChoice = () => {
    setMenuOpen(true);
  };

  const browseForProject = () => {
    setMenuOpen(false);
    onBrowse();
  };

  return (
    <main className={styles.root} aria-labelledby="new-session-heading">
      <section className={styles.hero}>
        <div className={styles.intro}>
          <div className={styles.mark} aria-hidden="true">
            <AliIcon name="cloud" size={50} />
            <span>&gt;_</span>
          </div>
          <h1 id="new-session-heading">开始一个新会话</h1>
          <p className={styles.introCopy}>先完成模型配置和项目选择，然后描述任务即可开始。</p>
          <ol className={styles.steps} aria-label="开始使用 Piora">
            <li>
              <span className={styles.stepNumber}>1</span>
              <span className={styles.stepCopy}>
                <strong>配置模型</strong>
                <small>打开左上角“设置”，进入“智能体 → 模型”添加并启用模型。</small>
              </span>
            </li>
            <li>
              <span className={styles.stepNumber}>2</span>
              <button
                type="button"
                className={styles.stepCopy}
                onClick={openProjectChoice}
                aria-haspopup="listbox"
                aria-expanded={menuOpen}
              >
                <strong>选择项目文件夹</strong>
                <small>从已有项目中选择，或打开一个文件夹作为新项目。</small>
              </button>
            </li>
          </ol>
        </div>

        <div className={styles.workspaceDock}>
          <div className={styles.contextRail}>
            <span className={styles.brandChip}><AliIcon name="cloud" size={14} />Piora</span>
            <div ref={projectSelectorRef} className={styles.projectAnchor}>
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
                    <button type="button" onClick={browseForProject}><AliIcon name="folder-open" size={14} />选择其他文件夹</button>
                  </div>
                </div>
              ) : null}
              <button className={styles.projectChip} type="button" onClick={() => setMenuOpen((open) => !open)} aria-haspopup="listbox" aria-expanded={menuOpen}>
                <AliIcon name="folder" size={14} />
                <span>选择项目</span>
                <AliIcon name="arrowdown" size={11} />
              </button>
            </div>
          </div>
          <div className={styles.composer}>
            <textarea
              value={draft}
              onChange={(event) => setLandingDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  openProjectChoice();
                }
              }}
              placeholder="描述你想构建或修复的内容…"
              aria-label="新对话内容"
            />
            <div className={styles.composerBar}>
              <button className={styles.iconButton} type="button" disabled title="选择项目后可添加附件" aria-label="添加附件">
                <AliIcon name="plus" size={16} />
              </button>
              <span className={styles.selectionHint}>先选择项目再开始</span>
              <button className={styles.sendButton} type="button" onClick={openProjectChoice} title="请先选择项目" aria-label="发送">
                <AliIcon name="arrowup" size={16} />
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

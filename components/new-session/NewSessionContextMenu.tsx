"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useAnchoredMenuPosition } from "@/hooks/useAnchoredMenuPosition";
import { useI18n } from "@/hooks/useI18n";
import type { GitBranchesResponse } from "@/lib/git-branches";
import { getProjectLabel } from "@/lib/session-project-groups";
import { AliIcon } from "../AliIcon";
import { ContextSearchList } from "./ContextSearchList";
import styles from "./NewSessionContextMenu.module.css";

export interface ProjectChoice {
  root: string;
  cwd: string;
}

export interface WorktreeChoice {
  branch: string | null;
}

type Panel = "projects" | "git" | "branches" | "create";

export function NewSessionContextMenu({
  projects, project, loadingProjects, requestKey, disabled, worktree,
  onProject, onBrowse, onWorktree, onGitBusyChange,
}: {
  projects: ProjectChoice[];
  project: ProjectChoice | null;
  loadingProjects: boolean;
  requestKey: number;
  disabled: boolean;
  worktree: WorktreeChoice | null;
  onProject: (project: ProjectChoice | null) => void;
  onBrowse: () => void;
  onWorktree: (choice: WorktreeChoice | null) => void;
  onGitBusyChange: (busy: boolean) => void;
}) {
  const { t } = useI18n();
  const popupId = useId();
  const projectTrigger = useRef<HTMLButtonElement>(null);
  const moreTrigger = useRef<HTMLButtonElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const branchField = useRef<HTMLInputElement>(null);
  const branchTrigger = useRef<HTMLButtonElement>(null);
  const mutationRef = useRef(false);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [git, setGit] = useState<GitBranchesResponse | null>(null);
  const [gitError, setGitError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);
  const cwd = project?.cwd;
  const gitOpen = Boolean(panel && panel !== "projects" && cwd);
  const showingBranches = panel === "branches" || panel === "create";
  const projectName = project ? getProjectLabel(project.root) : null;
  const anchor = gitOpen ? moreTrigger : projectTrigger;
  const position = useAnchoredMenuPosition(
    anchor, panel !== null, panel === "projects" ? 288 : showingBranches ? 530 : 250,
    panel === "git" ? 180 : 320,
  );
  const positioned = position !== null;

  useEffect(() => {
    if (requestKey > 0) {
      setQuery("");
      setPanel("projects");
    }
  }, [requestKey]);

  useEffect(() => {
    if (!gitOpen) return;
    const controller = new AbortController();
    setGit(null);
    setGitError(null);
    void fetch(`/api/git/branches?cwd=${encodeURIComponent(cwd!)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as GitBranchesResponse & { error?: string; code?: string };
        if (!response.ok) throw new Error(data.code === "not_git_repository" ? t("newSession.notGit") : data.error || `HTTP ${response.status}`);
        if (!controller.signal.aborted) setGit(data);
      })
      .catch((error: Error) => { if (!controller.signal.aborted) setGitError(error.message); });
    return () => controller.abort();
  }, [cwd, gitOpen, t]);

  useEffect(() => {
    if (!positioned) return;
    if (panel === "git") (git ? branchTrigger.current : popup.current)?.focus({ preventScroll: true });
    if (panel === "create") branchField.current?.focus({ preventScroll: true });
  }, [git, panel, positioned]);

  useEffect(() => {
    if (!panel) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!mutationRef.current && !controls.current?.contains(target) && !popup.current?.contains(target)) setPanel(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      if (mutationRef.current) return;
      setMutationError(null);
      setQuery("");
      if (panel === "create") setPanel("branches");
      else if (panel === "branches") setPanel("git");
      else {
        setPanel(null);
        anchor.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape, true);
    };
  }, [anchor, panel]);

  const openPanel = (next: Panel) => {
    setQuery("");
    setMutationError(null);
    if (next === "git" && !gitOpen) {
      setGit(null);
      setGitError(null);
    }
    setPanel((current) => current === next ? null : next);
  };
  const choose = (next: ProjectChoice | null) => {
    setPanel(null);
    onProject(next);
  };
  const switchBranch = async (branch: string, create = false) => {
    if (!cwd || mutationRef.current) return;
    if (worktree && !create) {
      onWorktree({ branch });
      setPanel("git");
      return;
    }
    if (!create && branch === git?.currentBranch) {
      setPanel("git");
      return;
    }
    mutationRef.current = true;
    setMutating(true);
    onGitBusyChange(true);
    setMutationError(null);
    try {
      const response = await fetch("/api/git/branches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, branch, create }),
      });
      const data = await response.json() as GitBranchesResponse & { error?: string };
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setGit(data);
      setPanel("git");
      window.dispatchEvent(new CustomEvent("piora:git-status-changed", { detail: { cwd } }));
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : String(error));
    } finally {
      mutationRef.current = false;
      setMutating(false);
      onGitBusyChange(false);
    }
  };

  const needle = query.trim().toLocaleLowerCase();
  const matchedProjects = panel === "projects"
    ? projects.filter(({ root }) => root.toLocaleLowerCase().includes(needle))
    : [];
  const selectedBranch = worktree?.branch ?? git?.currentBranch ?? null;
  const branchList = git?.branches.filter((branch) => branch.toLocaleLowerCase().includes(needle)) ?? [];
  const branchLabel = t(worktree ? "newSession.baseBranch" : "newSession.branch");
  const searchBranchesLabel = t("newSession.searchBranches", { project: projectName ?? "" });

  return (
    <div ref={controls} className={styles.controls}>
      <button
        ref={projectTrigger}
        type="button"
        className={styles.projectTrigger}
        disabled={disabled}
        data-selected={Boolean(project)}
        aria-haspopup="dialog"
        aria-expanded={panel === "projects"}
        aria-controls={panel === "projects" ? popupId : undefined}
        aria-label={projectName ? t("newSession.changeProject", { project: projectName }) : t("newSession.chooseProject")}
        title={project?.root ?? t("newSession.chooseProject")}
        onClick={() => openPanel("projects")}
      >
        <AliIcon name="folder" size={15} />
        <span>{projectName ?? t("newSession.chooseProject")}</span>
        <AliIcon name="chevron-down" size={12} />
      </button>
      {project && (
        <button
          ref={moreTrigger}
          type="button"
          className={styles.moreTrigger}
          data-worktree={Boolean(worktree)}
          aria-label={t("newSession.gitOptions")}
          title={t(worktree ? "newSession.newWorktree" : "newSession.gitOptions")}
          aria-haspopup="dialog"
          aria-expanded={gitOpen}
          aria-controls={gitOpen ? popupId : undefined}
          disabled={disabled}
          onClick={() => openPanel("git")}
        >
          <AliIcon name="ellipsis" size={17} />
        </button>
      )}
      {panel && position && createPortal(
        <>
          <button type="button" className={styles.backdrop} data-session-context-backdrop aria-label={t("chat.close")} tabIndex={-1}
            disabled={mutating} onClick={() => { setPanel(null); anchor.current?.focus(); }} />
          <div
            ref={popup}
            id={popupId}
            role="dialog"
            tabIndex={-1}
            aria-label={t(panel === "projects" ? "newSession.chooseProject" : "newSession.gitOptions")}
            className={styles.popover}
            data-session-context={panel}
            data-expanded={showingBranches}
            aria-busy={mutating}
            style={{
              "--menu-left": `${position.left}px`,
              "--menu-width": `${position.width}px`,
              "--menu-top": position.top === undefined ? "auto" : `${position.top}px`,
              "--menu-bottom": position.bottom === undefined ? "auto" : `${position.bottom}px`,
              "--menu-height": `${position.maxHeight}px`,
            } as CSSProperties}
          >
            {panel === "projects" ? (
              <ContextSearchList
                label={t("newSession.searchProjects")}
                options={matchedProjects.map(({ root }) => {
                  const label = getProjectLabel(root);
                  return {
                    id: root, name: label, icon: "folder", selected: root === project?.root, title: root,
                    detail: projects.some((entry) => entry.root !== root && getProjectLabel(entry.root) === label)
                      ? root.replace(/[\\/][^\\/]+[\\/]*$/, "") : undefined,
                  };
                })}
                empty={t(loadingProjects ? "newSession.loadingProjects" : "newSession.noProjects")}
                onSearch={setQuery}
                onSelect={(root) => {
                  const next = matchedProjects.find((entry) => entry.root === root);
                  if (next) choose(next);
                }}
                footer={<>
                  <button type="button" className={styles.row} onClick={() => { setPanel(null); onBrowse(); }}>
                    <AliIcon name="folder-open" size={15} /><span>{t("newSession.browseProject")}</span>
                  </button>
                  <button type="button" className={styles.row} onClick={() => choose(null)}>
                    <AliIcon name="close" size={15} /><span>{t("newSession.projectless")}</span>
                    {!project && <AliIcon name="check" size={14} className={styles.check} />}
                  </button>
                </>}
              />
            ) : (
              <>
                <div className={styles.gitActions}>
                  {git ? <>
                    <button type="button" className={styles.row} role="switch" aria-checked={Boolean(worktree)} title={t("newSession.worktreeOnSend")}
                      onClick={() => onWorktree(worktree ? null : { branch: null })} disabled={mutating}>
                      <AliIcon name="git-commit" size={15} /><span>{t("newSession.newWorktree")}</span>
                      <span className={styles.switch} aria-hidden="true" />
                    </button>
                    <button ref={branchTrigger} type="button" className={styles.row} aria-expanded={showingBranches}
                      onClick={() => showingBranches ? setPanel("git") : openPanel("branches")} disabled={mutating}>
                      <AliIcon name="branches" size={15} /><span>{branchLabel}</span>
                      <small title={selectedBranch ?? undefined}>{selectedBranch ?? t("gitTools.detached")}</small>
                      <AliIcon name="chevron-right" size={13} />
                    </button>
                  </> : <p className={styles.status} role={gitError ? "alert" : "status"}>{gitError ?? t("gitTools.loading")}</p>}
                </div>
                {showingBranches && <div className={styles.branchPane} inert={mutating}>
                  <button type="button" className={styles.back} data-back-to-git={panel === "branches"}
                    onClick={() => openPanel(panel === "create" ? "branches" : "git")}>
                    <AliIcon name="arrowleft" size={14} />{t(panel === "create" ? "newSession.branch" : "newSession.gitOptions")}
                  </button>
                  {panel === "create" ? (
                    <form className={styles.createForm} onSubmit={(event) => { event.preventDefault(); if (name.trim()) void switchBranch(name.trim(), true); }}>
                      <label htmlFor={`${popupId}-name`}>{t("gitTools.branchName")}</label>
                      <input ref={branchField} id={`${popupId}-name`} value={name} onChange={(event) => setName(event.target.value)} />
                      <button type="submit" className={styles.createButton} disabled={!name.trim()}>{t("newSession.createBranch")}</button>
                    </form>
                  ) : (
                    <ContextSearchList
                      label={searchBranchesLabel}
                      options={branchList.map((branch) => ({ id: branch, name: branch, icon: "branches", selected: branch === selectedBranch }))}
                      empty={t("newSession.noBranches")}
                      onSearch={setQuery}
                      onSelect={(branch) => { void switchBranch(branch); }}
                      footer={!worktree && (
                        <button type="button" className={styles.row} onClick={() => { setName(""); openPanel("create"); }}>
                          <AliIcon name="plus" size={15} /><span>{t("newSession.createBranchMenu")}</span>
                        </button>
                      )}
                    />
                  )}
                </div>}
                {mutating && <p className={styles.status} role="status">{t("newSession.updatingBranch")}</p>}
                {mutationError && <p className={styles.error} role="alert">{mutationError}</p>}
              </>
            )}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

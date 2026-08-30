"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { setDraft, type ChatDraft, type ChatDraftFile } from "@/lib/draft-store";
import { LARGE_PASTE_CHARACTER_THRESHOLD } from "@/lib/prompt-input-policy";
import { getProjectLabel } from "@/lib/session-project-groups";
import { fetchModelCatalog } from "@/lib/model-catalog-client";
import type { SessionInfo } from "@/lib/types";
import { AliIcon } from "./AliIcon";
import styles from "./NewSessionProjectPicker.module.css";

interface ProjectChoice {
  root: string;
  cwd: string;
  sessionCount: number;
}

interface ModelChoice {
  id: string;
  name: string;
  provider: string;
}

interface SelectedModel {
  modelId: string;
  provider: string;
}

const MAX_LANDING_PASTES = 8;

function resizeLandingComposer(textarea: HTMLTextAreaElement): void {
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 360)}px`;
}

export function NewSessionProjectPicker({
  activeCwd,
  activeProjectRoot,
  onSelect,
  onBrowse,
}: {
  activeCwd?: string | null;
  activeProjectRoot?: string | null;
  onSelect: (cwd: string, projectRoot: string, model?: SelectedModel) => void;
  onBrowse: (draft: ChatDraft, model: SelectedModel) => void;
}) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [models, setModels] = useState<ModelChoice[]>([]);
  const [selectedModelKey, setSelectedModelKey] = useState("");
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelsReloadKey, setModelsReloadKey] = useState(0);
  const [modelSelectionRequired, setModelSelectionRequired] = useState(false);
  const [selectedProject, setSelectedProject] = useState<ProjectChoice | null>(null);
  const [projectSelectionRequired, setProjectSelectionRequired] = useState(false);
  const [query, setQuery] = useState("");
  const [draft, setLandingDraft] = useState("");
  const [pastedMaterials, setPastedMaterials] = useState<ChatDraftFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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
    let cancelled = false;
    const controller = new AbortController();
    setModelsLoading(true);
    setModelsError(null);
    void fetchModelCatalog({
      forceRefresh: modelsReloadKey > 0,
      signal: controller.signal,
    })
      .then((data) => {
        if (cancelled) return;
        const nextModels: ModelChoice[] = data.modelList ?? [];
        setModels(nextModels);
        setModelsError(data.modelError ?? null);
        if (nextModels.length > 0) setModelSelectionRequired(false);
        setSelectedModelKey((current) => {
          if (nextModels.some((entry) => `${entry.provider}/${entry.id}` === current)) return current;
          const preferred = data.defaultModel
            ? `${data.defaultModel.provider}/${data.defaultModel.modelId}`
            : "";
          if (preferred && nextModels.some((entry) => `${entry.provider}/${entry.id}` === preferred)) return preferred;
          const first = nextModels[0];
          return first ? `${first.provider}/${first.id}` : "";
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (!cancelled) setModelsError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => { if (!cancelled) setModelsLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [modelsReloadKey]);

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

  const getLandingDraft = (): ChatDraft => ({ value: draft, images: [], files: pastedMaterials });

  const selectedModel = useMemo(() => {
    const model = models.find((entry) => `${entry.provider}/${entry.id}` === selectedModelKey);
    return model ? { provider: model.provider, modelId: model.id } : undefined;
  }, [models, selectedModelKey]);

  const requireSelectedModel = (): SelectedModel | undefined => {
    if (selectedModel) return selectedModel;
    setModelSelectionRequired(true);
    setMenuOpen(false);
    return undefined;
  };

  const chooseProject = (choice: ProjectChoice) => {
    setSelectedProject(choice);
    setProjectSelectionRequired(false);
    setMenuOpen(false);
  };

  const startSelectedProjectChat = () => {
    const model = requireSelectedModel();
    if (!model) return;
    if (!selectedProject) {
      setProjectSelectionRequired(true);
      return;
    }
    if (draft.trim() || pastedMaterials.length > 0) {
      setDraft(`new:${selectedProject.cwd}`, getLandingDraft());
    }
    setMenuOpen(false);
    onSelect(selectedProject.cwd, selectedProject.root, model);
  };

  const browseForProject = () => {
    const model = requireSelectedModel();
    if (!model) return;
    setMenuOpen(false);
    onBrowse(getLandingDraft(), model);
  };

  const canStartChat = Boolean(selectedModel && selectedProject);

  const restorePastedMaterial = (index: number) => {
    const material = pastedMaterials[index];
    if (!material?.text) return;
    setPastedMaterials((current) => current.filter((_, currentIndex) => currentIndex !== index));
    setLandingDraft((current) => current ? `${current}\n\n${material.text}` : material.text!);
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      resizeLandingComposer(textarea);
    });
  };

  return (
    <main className={styles.root} aria-label="新对话">
      <section className={styles.hero}>
        <header className={styles.intro}>
          <span className={styles.welcomeBadge}>新会话</span>
          <h1>准备好模型和项目，再开始聊天</h1>
          <p>按顺序完成两项设置，Piora 才会进入与你当前工作匹配的会话。</p>
        </header>
        <section className={styles.setup} aria-label="会话准备">
          <div className={styles.setupRow} data-complete={Boolean(selectedModel)}>
            <span className={styles.stepNumber}>{selectedModel ? <AliIcon name="check" size={13} /> : "1"}</span>
            <div className={styles.stepCopy}>
              <strong>配置模型</strong>
              <small>{modelsLoading ? "正在读取你的可用模型" : models.length > 0 ? `已加载 ${models.length} 个可用模型` : "需要先加载一个可用模型"}</small>
            </div>
            <label className={styles.modelSelect}>
              <AliIcon name="robot" size={15} />
              <select
                value={selectedModelKey}
                onChange={(event) => {
                  setSelectedModelKey(event.target.value);
                  setModelSelectionRequired(false);
                }}
                aria-label="选择模型"
                aria-invalid={modelSelectionRequired}
                disabled={modelsLoading || models.length === 0}
              >
                <option value="" disabled>
                  {modelsLoading ? "正在加载模型…" : modelsError && models.length === 0 ? "模型加载失败" : models.length === 0 ? "暂无可用模型" : "选择模型"}
                </option>
                {models.map((model) => (
                  <option key={`${model.provider}/${model.id}`} value={`${model.provider}/${model.id}`}>
                    {model.name || model.id} · {model.provider}
                  </option>
                ))}
              </select>
            </label>
            {(modelsError || (!modelsLoading && models.length === 0)) ? (
              <button
                type="button"
                className={styles.reloadButton}
                onClick={() => setModelsReloadKey((key) => key + 1)}
                disabled={modelsLoading}
                title="重新加载可用模型"
              >
                <AliIcon name="reload" size={13} />
                重新加载
              </button>
            ) : null}
          </div>
          {modelsError ? (
            <div className={styles.modelNotice} role={models.length === 0 ? "alert" : "status"}>
              <AliIcon name="warning" size={13} />
              <span>{models.length === 0 ? "暂时没有加载到可用模型，请重新加载。" : "可用模型已加载，但部分扩展模型暂时不可用。"}</span>
            </div>
          ) : null}
          <div className={styles.setupDivider} />
          <div className={styles.setupRow} data-complete={Boolean(selectedProject)}>
            <span className={styles.stepNumber}>{selectedProject ? <AliIcon name="check" size={13} /> : "2"}</span>
            <div className={styles.stepCopy}>
              <strong>创建或选择项目</strong>
              <small>{selectedProject ? selectedProject.root : "指定 Piora 可以读取和修改的工作目录"}</small>
            </div>
            <div ref={projectSelectorRef} className={styles.projectAnchor}>
              {menuOpen ? (
                <div className={styles.projectPopover}>
                  <label className={styles.search}>
                    <AliIcon name="search" size={14} />
                    <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目" aria-label="搜索项目" />
                  </label>
                  <div className={styles.list} role="listbox" aria-label="选择项目">
                    {projects.map((choice) => (
                      <button key={choice.root} type="button" role="option" aria-selected={choice.root === selectedProject?.root} onClick={() => chooseProject(choice)} title={choice.root}>
                        <AliIcon name="folder" size={15} />
                        <span><strong>{getProjectLabel(choice.root)}</strong><small>{choice.root}</small></span>
                        <small>{choice.sessionCount > 0 ? `${choice.sessionCount} 个对话` : ""}</small>
                      </button>
                    ))}
                    {!loading && projects.length === 0 ? <p>没有匹配的项目</p> : null}
                    {loading ? <p>正在加载项目…</p> : null}
                  </div>
                  <div className={styles.footer}>
                    <button type="button" onClick={browseForProject}><AliIcon name="folder-open" size={14} />创建或打开其他项目</button>
                  </div>
                </div>
              ) : null}
              <button
                className={`${styles.projectButton}${projectSelectionRequired ? ` ${styles.selectionError}` : ""}`}
                type="button"
                onClick={() => {
                  if (!requireSelectedModel()) return;
                  setMenuOpen((open) => !open);
                  setProjectSelectionRequired(false);
                }}
                aria-haspopup="listbox"
                aria-expanded={menuOpen}
              >
                <AliIcon name="folder" size={14} />
                <span>{selectedProject ? getProjectLabel(selectedProject.root) : "选择项目"}</span>
                <AliIcon name="arrowdown" size={10} />
              </button>
            </div>
            <button className={styles.browseButton} type="button" onClick={browseForProject} disabled={!selectedModel}>
              <AliIcon name="folder-open" size={14} />
              创建项目
            </button>
          </div>
        </section>

        <section className={styles.chatStep} data-ready={canStartChat} aria-label="开始聊天">
          <header className={styles.chatStepHeader}>
            <span className={styles.stepNumber}>3</span>
            <div className={styles.stepCopy}>
              <strong>开始聊天</strong>
              <small>{canStartChat ? "描述你想构建、修复或了解的内容" : "完成上面的模型和项目设置后即可输入"}</small>
            </div>
          </header>
          <div className={styles.composer}>
            {pastedMaterials.length > 0 ? (
              <div className={styles.materials} aria-label="粘贴的长内容">
                {pastedMaterials.map((material, index) => (
                  <div className={styles.material} key={`${material.name}:${index}`}>
                    <AliIcon name="file" size={13} />
                    <span>{material.name}</span>
                    <button type="button" onClick={() => restorePastedMaterial(index)}>展开编辑</button>
                    <button
                      type="button"
                      className={styles.removeMaterial}
                      onClick={() => setPastedMaterials((current) => current.filter((_, currentIndex) => currentIndex !== index))}
                      aria-label={`移除 ${material.name}`}
                    >
                      <AliIcon name="close" size={9} />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => {
                setLandingDraft(event.target.value);
                resizeLandingComposer(event.currentTarget);
              }}
              onPaste={(event) => {
                const text = event.clipboardData.getData("text/plain");
                if (text.length <= LARGE_PASTE_CHARACTER_THRESHOLD || pastedMaterials.length >= MAX_LANDING_PASTES) return;
                event.preventDefault();
                const index = pastedMaterials.length + 1;
                setPastedMaterials((current) => [...current, {
                  name: `粘贴内容 ${index}.txt`,
                  size: new TextEncoder().encode(text).byteLength,
                  text,
                  kind: "paste",
                }]);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  startSelectedProjectChat();
                }
              }}
              placeholder={canStartChat ? "描述你想构建或修复的内容…" : "请先配置模型并选择项目"}
              aria-label="新对话内容"
              disabled={!canStartChat}
            />
            <div className={styles.composerBar}>
              <button className={styles.iconButton} type="button" disabled title="选择项目后可添加附件" aria-label="添加附件">
                <AliIcon name="plus" size={16} />
              </button>
              <span
                className={`${styles.selectionHint}${modelSelectionRequired || projectSelectionRequired ? ` ${styles.selectionError}` : ""}`}
                role={modelSelectionRequired || projectSelectionRequired ? "alert" : undefined}
              >
                {!selectedModel ? "请先选择模型" : !selectedProject ? "请先创建或选择项目" : `${getProjectLabel(selectedProject.root)} · ${models.find((entry) => `${entry.provider}/${entry.id}` === selectedModelKey)?.name ?? selectedModel.modelId}`}
              </span>
              <button className={styles.sendButton} type="button" onClick={startSelectedProjectChat} disabled={!canStartChat} title={canStartChat ? "开始聊天" : "请先配置模型并选择项目"} aria-label="开始聊天">
                <AliIcon name="arrowup" size={16} />
              </button>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { setDraft, type ChatDraft, type ChatDraftFile } from "@/lib/draft-store";
import { LARGE_PASTE_CHARACTER_THRESHOLD } from "@/lib/prompt-input-policy";
import { getProjectLabel } from "@/lib/session-project-groups";
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
  onStartChat,
  onBrowse,
  onOpenModelSettings,
}: {
  activeCwd?: string | null;
  activeProjectRoot?: string | null;
  onSelect: (cwd: string, projectRoot: string, model?: SelectedModel) => void;
  onStartChat: (draft: ChatDraft, model?: SelectedModel) => void;
  onBrowse: (draft: ChatDraft) => void;
  onOpenModelSettings: () => void;
}) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [models, setModels] = useState<ModelChoice[]>([]);
  const [selectedModelKey, setSelectedModelKey] = useState("");
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelsReloadKey, setModelsReloadKey] = useState(0);
  const [modelSelectionRequired, setModelSelectionRequired] = useState(false);
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
    setModelsLoading(true);
    setModelsError(null);
    const query = modelsReloadKey > 0 ? "?refresh=1" : "";
    void fetch(`/api/models${query}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as {
          modelList?: ModelChoice[];
          defaultModel?: SelectedModel | null;
          error?: string;
          modelError?: string | null;
        };
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        if (cancelled) return;
        const nextModels = data.modelList ?? [];
        setModels(nextModels);
        setModelsError(data.modelError ?? null);
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
        if (!cancelled) setModelsError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => { if (!cancelled) setModelsLoading(false); });
    return () => { cancelled = true; };
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
    const model = requireSelectedModel();
    if (!model) return;
    if (draft.trim() || pastedMaterials.length > 0) setDraft(`new:${choice.cwd}`, getLandingDraft());
    onSelect(choice.cwd, choice.root, model);
  };

  const startProjectlessChat = () => {
    const model = requireSelectedModel();
    if (!model) return;
    setMenuOpen(false);
    onStartChat(getLandingDraft(), model);
  };

  const browseForProject = () => {
    setMenuOpen(false);
    onBrowse(getLandingDraft());
  };

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
          <span className={styles.welcomeBadge}>PIORA 快速开始</span>
          <h1>开始新的聊天</h1>
          <p>直接输入就会进入普通聊天；只有需要 Piora 读取、修改或运行项目时，才选择项目文件夹。</p>
        </header>
        <ol className={styles.guide} aria-label="Piora 使用步骤">
          <li><span>1</span><div><strong>描述目标</strong><small>问问题、写内容或说明要完成的任务</small></div></li>
          <li><span>2</span><div><strong>按需选择项目</strong><small>不选进入聊天，选择后进入对应项目</small></div></li>
          <li><span>3</span><div><strong>发送并跟进</strong><small>Piora 会展示思考、工具执行和最终结果</small></div></li>
        </ol>
        <div className={styles.workspaceDock}>
          <div className={styles.contextRail}>
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
                    <button type="button" onClick={startProjectlessChat}><AliIcon name="message" size={14} />不使用项目，直接聊天</button>
                    <button type="button" onClick={browseForProject}><AliIcon name="folder-open" size={14} />选择其他文件夹</button>
                  </div>
                </div>
              ) : null}
              <button className={styles.projectChip} type="button" onClick={() => setMenuOpen((open) => !open)} aria-haspopup="listbox" aria-expanded={menuOpen}>
                <AliIcon name="folder" size={14} />
                <span>选择项目（可选）</span>
              </button>
            </div>
            <label className={styles.modelChip}>
              <AliIcon name="robot" size={14} />
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
          </div>
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
                  startProjectlessChat();
                }
              }}
              placeholder="描述你想构建或修复的内容…"
              aria-label="新对话内容"
            />
            <div className={styles.composerBar}>
              <button className={styles.iconButton} type="button" disabled title="选择项目后可添加附件" aria-label="添加附件">
                <AliIcon name="plus" size={16} />
              </button>
              <span className={`${styles.selectionHint}${modelSelectionRequired ? ` ${styles.selectionError}` : ""}`} role={modelSelectionRequired ? "alert" : undefined}>
                {modelsError && models.length === 0
                  ? "模型不可用，请重试或检查设置"
                  : modelsError
                    ? "已加载可用模型；部分配置有警告"
                  : modelSelectionRequired || (!modelsLoading && !selectedModel)
                    ? "请先选择模型"
                    : "未选择项目时默认进入聊天"}
              </span>
              <button className={styles.sendButton} type="button" onClick={startProjectlessChat} disabled={!selectedModel} title={selectedModel ? "开始聊天" : "请先选择模型"} aria-label="开始聊天">
                <AliIcon name="arrowup" size={16} />
              </button>
            </div>
          </div>
          {modelsError ? (
            <div className={styles.modelRecovery} role={models.length === 0 ? "alert" : "status"}>
              <AliIcon name="warning" size={14} />
              <span>{models.length === 0 ? "没有加载到可用模型。" : "部分模型配置未能加载，当前可用模型仍可正常使用。"}</span>
              <button type="button" onClick={() => setModelsReloadKey((key) => key + 1)} disabled={modelsLoading}>重新加载</button>
              <button type="button" onClick={onOpenModelSettings}>检查模型设置</button>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}

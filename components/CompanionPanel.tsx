"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRunningTaskSnapshots } from "@/hooks/useTaskStatus";
import type { ModelsData } from "@/lib/models-cache";
import type { CompanionRuntimeState } from "@/lib/companion-runtime";
import { createCompanionId, type CompanionLibraryKind } from "@/lib/companion-store";
import styles from "./CompanionPanel.module.css";

type Tab = "now" | "tasks" | "library" | "memory" | "mind";

function emptyRuntimeState(): CompanionRuntimeState {
  return {
    version: 1,
    updatedAt: 0,
    migratedFromLocalStorage: false,
    settings: {
      interactionModel: null,
      shareWorkContext: true,
      autonomyLevel: "balanced",
      autonomyPaused: false,
      personality: "温暖、聪明、克制；关注事实，不打断专注。",
      quietHours: { enabled: false, start: "22:30", end: "08:00" },
      allowMovement: true,
      allowProactiveSpeech: true,
    },
    todos: [],
    library: [],
    memories: [],
    mind: { mood: "calm", lastDecision: null, decisionHistory: [], nextWakeAt: null },
  };
}

async function saveState(state: CompanionRuntimeState): Promise<CompanionRuntimeState> {
  const response = await fetch("/api/companion/state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state }),
  });
  const payload = await response.json().catch(() => null) as CompanionRuntimeState | { error?: string } | null;
  if (!response.ok || !payload || "error" in payload) throw new Error(payload && "error" in payload ? payload.error : `HTTP ${response.status}`);
  return payload as CompanionRuntimeState;
}

function formatTime(value: number | null | undefined): string {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "尚未安排";
}

export function CompanionPanel() {
  const [tab, setTab] = useState<Tab>("now");
  const [state, setState] = useState<CompanionRuntimeState>(emptyRuntimeState);
  const [models, setModels] = useState<ModelsData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");
  const [draft, setDraft] = useState("");
  const [libraryTitle, setLibraryTitle] = useState("");
  const [libraryContent, setLibraryContent] = useState("");
  const [libraryKind, setLibraryKind] = useState<CompanionLibraryKind>("note");
  const runningTasks = useRunningTaskSnapshots();

  const refresh = useCallback(async () => {
    const response = await fetch("/api/companion/state", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    setState(await response.json() as CompanionRuntimeState);
  }, []);

  useEffect(() => {
    void refresh().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
    void fetch("/api/models", { cache: "no-store" }).then((response) => response.ok ? response.json() as Promise<ModelsData> : null).then(setModels);
    const source = new EventSource("/api/companion/events");
    source.addEventListener("companion", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as { state?: CompanionRuntimeState };
        if (payload.state) setState(payload.state);
      } catch { /* ignore malformed event */ }
    });
    return () => source.close();
  }, [refresh]);

  const mutate = useCallback(async (update: (current: CompanionRuntimeState) => CompanionRuntimeState) => {
    setBusy(true);
    setError("");
    try { setState(await saveState(update(state))); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }, [state]);

  const ask = async () => {
    if (!question.trim()) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/companion/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "user.ask", question, locale: "zh-CN" }),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
      setQuestion("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const activeTasks = useMemo(() => state.todos.filter((item) => !item.completed), [state.todos]);
  const tabs: Array<[Tab, string]> = [["now", "现在"], ["tasks", "任务"], ["library", "资料"], ["memory", "记忆"], ["mind", "心智"]];

  return (
    <main className={styles.panel}>
      <header className={styles.header}>
        <div><h1>Piora 随身舱</h1><p>你的桌面伙伴、任务管家与临时资料架</p></div>
        <span className={styles.mood}>{state.mind.mood}</span>
      </header>
      <nav className={styles.tabs} aria-label="随身舱功能">
        {tabs.map(([id, label]) => <button key={id} data-active={tab === id} onClick={() => setTab(id)}>{label}</button>)}
      </nav>
      {error ? <div className={styles.error}>{error}</div> : null}

      <section className={styles.content}>
        {tab === "now" ? <>
          <article className={styles.hero}>
            <span>刚才的想法</span>
            <h2>{state.mind.lastDecision?.thoughtSummary || "我正在安静陪伴，等待新的工作信号。"}</h2>
            {state.mind.lastDecision?.speech ? <blockquote>{state.mind.lastDecision.speech}</blockquote> : null}
          </article>
          <div className={styles.grid}>
            <article className={styles.card}><b>待办</b><strong>{activeTasks.length}</strong><small>项未完成</small></article>
            <article className={styles.card}><b>下次观察</b><small>{formatTime(state.mind.nextWakeAt)}</small></article>
          </div>
          <article className={styles.card}>
            <b>我看见的事实</b>
            <ul>{state.mind.lastDecision?.observedFacts.length ? state.mind.lastDecision.observedFacts.map((fact) => <li key={fact}>{fact}</li>) : <li>尚无可用的工作上下文</li>}</ul>
          </article>
          <div className={styles.composer}><input value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void ask(); }} placeholder="问问你的桌宠……" /><button disabled={busy || !question.trim()} onClick={() => void ask()}>发送</button></div>
        </> : null}

        {tab === "tasks" ? <>
          {runningTasks.length ? <article className={styles.card}><b>正在运行的 Piora 任务</b><div className={styles.agentTasks}>{runningTasks.map((task) => <div key={task.id}><strong>{task.title || task.taskRun?.objective || task.id.slice(0, 8)}</strong><span>{task.activity?.message || task.taskRun?.progress || task.runtime}</span></div>)}</div></article> : null}
          <div className={styles.composer}><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="添加一个待办任务" /><button disabled={busy || !draft.trim()} onClick={() => { const now = Date.now(); const text = draft.trim(); setDraft(""); void mutate((current) => ({ ...current, todos: [{ id: createCompanionId("todo"), text, completed: false, progress: 0, createdAt: now, updatedAt: now }, ...current.todos] })); }}>添加</button></div>
          <div className={styles.list}>{state.todos.map((item) => <article className={styles.row} key={item.id}>
            <button className={styles.check} data-done={item.completed} onClick={() => void mutate((current) => ({ ...current, todos: current.todos.map((todo) => todo.id === item.id ? { ...todo, completed: !todo.completed, progress: !todo.completed ? 100 : 0, updatedAt: Date.now() } : todo) }))}>{item.completed ? "✓" : ""}</button>
            <div><b>{item.text}</b><label>进度 {item.progress}%<input type="range" min="0" max="100" value={item.progress} onChange={(event) => { const progress = Number(event.target.value); void mutate((current) => ({ ...current, todos: current.todos.map((todo) => todo.id === item.id ? { ...todo, progress, completed: progress === 100, updatedAt: Date.now() } : todo) })); }} /></label></div>
            <button className={styles.danger} onClick={() => void mutate((current) => ({ ...current, todos: current.todos.filter((todo) => todo.id !== item.id) }))}>删除</button>
          </article>)}</div>
        </> : null}

        {tab === "library" ? <>
          <div className={styles.stack}><div className={styles.inline}><select value={libraryKind} onChange={(event) => setLibraryKind(event.target.value as CompanionLibraryKind)}><option value="note">笔记</option><option value="code">代码</option><option value="command">命令</option></select><input value={libraryTitle} onChange={(event) => setLibraryTitle(event.target.value)} placeholder="标题" /></div><textarea value={libraryContent} onChange={(event) => setLibraryContent(event.target.value)} placeholder="保存一段文字、代码或命令" /><button disabled={busy || !libraryTitle.trim() || !libraryContent.trim()} onClick={() => { const now = Date.now(); const title = libraryTitle.trim(); const content = libraryContent.trim(); setLibraryTitle(""); setLibraryContent(""); void mutate((current) => ({ ...current, library: [{ id: createCompanionId("library"), kind: libraryKind, title, content, pinned: false, createdAt: now, updatedAt: now }, ...current.library] })); }}>保存到资料架</button></div>
          <label className={styles.imageUpload}>保存一张图片<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; if (file.size > 1_250_000) { setError("图片不能超过 1.25 MB"); return; } const reader = new FileReader(); reader.onload = () => { if (typeof reader.result !== "string") return; const now = Date.now(); void mutate((current) => ({ ...current, library: [{ id: createCompanionId("library"), kind: "image", title: file.name.slice(0, 120), content: reader.result as string, pinned: false, createdAt: now, updatedAt: now }, ...current.library] })); }; reader.readAsDataURL(file); }} /></label>
          <div className={styles.list}>{state.library.map((item) => <article className={styles.libraryItem} key={item.id}><div><span>{item.kind}</span><b>{item.title}</b></div>{item.kind === "image" ? <span className={styles.libraryImage} role="img" aria-label={item.title} style={{ backgroundImage: `url(${JSON.stringify(item.content)})` }} /> : <pre>{item.content}</pre>}<div className={styles.itemActions}>{item.kind !== "image" ? <button onClick={() => void navigator.clipboard.writeText(item.content)}>复制</button> : null}<button className={styles.danger} onClick={() => void mutate((current) => ({ ...current, library: current.library.filter((entry) => entry.id !== item.id) }))}>删除</button></div></article>)}</div>
        </> : null}

        {tab === "memory" ? <>
          <p className={styles.hint}>记忆只保存你明确留下的偏好或事实，可随时删除。</p>
          <div className={styles.composer}><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="例如：提醒我每 90 分钟休息" /><button disabled={busy || !draft.trim()} onClick={() => { const now = Date.now(); const text = draft.trim(); setDraft(""); void mutate((current) => ({ ...current, memories: [{ id: `memory:${crypto.randomUUID()}`, text, source: "user", createdAt: now, updatedAt: now }, ...current.memories] })); }}>记住</button></div>
          <div className={styles.list}>{state.memories.map((item) => <article className={styles.row} key={item.id}><div><b>{item.text}</b><small>{formatTime(item.updatedAt)}</small></div><button className={styles.danger} onClick={() => void mutate((current) => ({ ...current, memories: current.memories.filter((memory) => memory.id !== item.id) }))}>忘记</button></article>)}</div>
        </> : null}

        {tab === "mind" ? <div className={styles.settings}>
          <label>互动模型<select value={state.settings.interactionModel ? JSON.stringify(state.settings.interactionModel) : ""} onChange={(event) => { const value = event.target.value; void mutate((current) => ({ ...current, settings: { ...current.settings, interactionModel: value ? JSON.parse(value) as { provider: string; modelId: string } : null } })); }}><option value="">请选择模型</option>{models?.modelList.map((model) => <option key={`${model.provider}:${model.id}`} value={JSON.stringify({ provider: model.provider, modelId: model.id })}>{model.provider} · {model.name || model.id}</option>)}</select></label>
          <label>自主程度<select value={state.settings.autonomyLevel} onChange={(event) => void mutate((current) => ({ ...current, settings: { ...current.settings, autonomyLevel: event.target.value as "quiet" | "balanced" | "active" } }))}><option value="quiet">安静</option><option value="balanced">平衡</option><option value="active">活跃</option></select></label>
          <label>性格<textarea value={state.settings.personality} onChange={(event) => setState((current) => ({ ...current, settings: { ...current.settings, personality: event.target.value } }))} onBlur={() => void mutate((current) => current)} /></label>
          <label className={styles.toggle}><input type="checkbox" checked={!state.settings.autonomyPaused} onChange={() => void mutate((current) => ({ ...current, settings: { ...current.settings, autonomyPaused: !current.settings.autonomyPaused } }))} />允许自主观察</label>
          <label className={styles.toggle}><input type="checkbox" checked={state.settings.shareWorkContext} onChange={() => void mutate((current) => ({ ...current, settings: { ...current.settings, shareWorkContext: !current.settings.shareWorkContext } }))} />向互动模型发送汇总后的工作上下文</label>
          <label className={styles.toggle}><input type="checkbox" checked={state.settings.allowProactiveSpeech} onChange={() => void mutate((current) => ({ ...current, settings: { ...current.settings, allowProactiveSpeech: !current.settings.allowProactiveSpeech } }))} />允许任务变化或定时观察时主动说话</label>
          <label className={styles.toggle}><input type="checkbox" checked={state.settings.allowMovement} onChange={() => void mutate((current) => ({ ...current, settings: { ...current.settings, allowMovement: !current.settings.allowMovement } }))} />允许桌宠在屏幕底部移动</label>
          <label className={styles.toggle}><input type="checkbox" checked={state.settings.quietHours.enabled} onChange={() => void mutate((current) => ({ ...current, settings: { ...current.settings, quietHours: { ...current.settings.quietHours, enabled: !current.settings.quietHours.enabled } } }))} />启用安静时段</label>
          {state.settings.quietHours.enabled ? <div className={styles.quietHours}><label>开始<input type="time" value={state.settings.quietHours.start} onChange={(event) => void mutate((current) => ({ ...current, settings: { ...current.settings, quietHours: { ...current.settings.quietHours, start: event.target.value } } }))} /></label><span>至</span><label>结束<input type="time" value={state.settings.quietHours.end} onChange={(event) => void mutate((current) => ({ ...current, settings: { ...current.settings, quietHours: { ...current.settings.quietHours, end: event.target.value } } }))} /></label></div> : null}
          <article className={styles.card}><b>隐私说明</b><p>只发送任务标题、进度、工作时长和 Token 等汇总字段；不会把代码正文、文件内容或密钥自动发给互动模型。</p></article>
        </div> : null}
      </section>
    </main>
  );
}

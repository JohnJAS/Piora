"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type {
  DesignAnalysisRun,
  DesignCredentialStatus,
  DesignImportRecord,
  DesignTreeNodeSummary,
} from "@/lib/design-to-harmony/types";
import { AliIcon, type AliIconName } from "../../AliIcon";
import styles from "./DesignToHarmonyPanel.module.css";

type PanelProps = {
  cwd: string | null;
  active: boolean;
  onGuideAgent?: (() => void) | undefined;
};

type ImportResponse = { record: DesignImportRecord; cached: boolean };
type CredentialResponse = { status: DesignCredentialStatus };
type ImportListResponse = { imports: DesignImportRecord[] };
type AnalysisResponse = { run: DesignAnalysisRun; cached: boolean };
type NavigationSection = "document" | "flows" | "components" | "tokens";

function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => ({})) as T & { error?: unknown };
  if (!response.ok) {
    const error = recordOf(payload.error);
    throw new Error(typeof error?.message === "string" ? error.message : `Request failed (${response.status})`);
  }
  return payload;
}

function findTreeNode(nodes: DesignTreeNodeSummary[], id: string): DesignTreeNodeSummary | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findTreeNode(node.children, id);
    if (child) return child;
  }
  return null;
}

function nodeIcon(type: DesignTreeNodeSummary["type"]): AliIconName {
  if (type === "CANVAS") return "project";
  if (type === "SECTION") return "layout";
  if (type === "COMPONENT" || type === "COMPONENT_SET" || type === "INSTANCE") return "package";
  if (type === "TEXT") return "file";
  return "file";
}

function DocumentTree({
  nodes,
  selectedId,
  selectedScopeIds,
  expanded,
  onSelect,
  onToggleScope,
  onToggle,
  expandLabel,
  collapseLabel,
  addLabel,
  removeLabel,
  depth = 0,
}: {
  nodes: DesignTreeNodeSummary[];
  selectedId: string;
  selectedScopeIds: ReadonlySet<string>;
  expanded: ReadonlySet<string>;
  onSelect: (node: DesignTreeNodeSummary) => void;
  onToggleScope: (node: DesignTreeNodeSummary) => void;
  onToggle: (id: string) => void;
  expandLabel: string;
  collapseLabel: string;
  addLabel: string;
  removeLabel: string;
  depth?: number;
}) {
  return <div role={depth === 0 ? "tree" : "group"} className={styles.tree}>
    {nodes.map((node) => {
      const hasChildren = node.children.length > 0;
      const open = expanded.has(node.id);
      const selectedForAnalysis = selectedScopeIds.has(node.id);
      return <div key={node.id} className={styles.treeBranch}>
        <div
          className={styles.treeRow}
          data-selected={selectedId === node.id ? "true" : undefined}
          data-hidden={node.visible ? undefined : "true"}
          style={{ "--tree-depth": depth } as React.CSSProperties}
        >
          <button
            type="button"
            className={styles.treeToggle}
            disabled={!hasChildren}
            aria-label={open ? collapseLabel : expandLabel}
            aria-expanded={hasChildren ? open : undefined}
            onClick={() => onToggle(node.id)}
          >
            {hasChildren ? <AliIcon name="chevron-right" size={12} /> : <span />}
          </button>
          <button
            type="button"
            role="treeitem"
            aria-selected={selectedId === node.id}
            aria-level={depth + 1}
            className={styles.treeNode}
            onClick={() => onSelect(node)}
          >
            <AliIcon name={nodeIcon(node.type)} size={13} />
            <span>{node.name}</span>
            {node.childCount ? <small>{node.childCount}</small> : null}
          </button>
          <button
            type="button"
            className={styles.treeSelection}
            aria-label={`${selectedForAnalysis ? removeLabel : addLabel}: ${node.name}`}
            aria-pressed={selectedForAnalysis}
            onClick={() => onToggleScope(node)}
          >
            <AliIcon name={selectedForAnalysis ? "check-circle" : "plus"} size={12} />
          </button>
        </div>
        {hasChildren && open ? <DocumentTree
          nodes={node.children}
          selectedId={selectedId}
          selectedScopeIds={selectedScopeIds}
          expanded={expanded}
          onSelect={onSelect}
          onToggleScope={onToggleScope}
          onToggle={onToggle}
          expandLabel={expandLabel}
          collapseLabel={collapseLabel}
          addLabel={addLabel}
          removeLabel={removeLabel}
          depth={depth + 1}
        /> : null}
      </div>;
    })}
  </div>;
}

export function DesignToHarmonyPanel({ cwd, active, onGuideAgent }: PanelProps) {
  const { locale } = useI18n();
  const chinese = locale === "zh-CN";
  const copy = useCallback((zh: string, en: string) => chinese ? zh : en, [chinese]);
  const [credential, setCredential] = useState<DesignCredentialStatus>({ provider: "figma", configured: false });
  const [imports, setImports] = useState<DesignImportRecord[]>([]);
  const [activeImportId, setActiveImportId] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [token, setToken] = useState("");
  const [section, setSection] = useState<NavigationSection>("document");
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [selectedScopeIds, setSelectedScopeIds] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisRun, setAnalysisRun] = useState<DesignAnalysisRun | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const activeImport = useMemo(
    () => imports.find((item) => item.id === activeImportId) ?? imports[0] ?? null,
    [activeImportId, imports],
  );
  const selectedNode = useMemo(
    () => activeImport ? findTreeNode(activeImport.document.pages, selectedNodeId) : null,
    [activeImport, selectedNodeId],
  );

  const chooseImport = useCallback((record: DesignImportRecord) => {
    setActiveImportId(record.id);
    setSourceUrl(record.source.url);
    setSection("document");
    const initialNode = record.source.nodeId
      ? findTreeNode(record.document.pages, record.source.nodeId)
      : record.document.pages[0]?.children[0] ?? record.document.pages[0];
    setSelectedNodeId(initialNode?.id ?? "");
    setSelectedScopeIds(new Set(initialNode ? [initialNode.id] : []));
    setAnalysisRun(null);
    setExpanded(new Set(record.document.pages.map((page) => page.id)));
  }, []);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const load = async () => {
      setInitializing(true);
      setError(null);
      try {
        const [credentialPayload, importPayload] = await Promise.all([
          jsonRequest<CredentialResponse>("/api/design-to-harmony/sources/figma/connect", { signal: controller.signal }),
          cwd
            ? jsonRequest<ImportListResponse>(`/api/design-to-harmony/imports?projectRoot=${encodeURIComponent(cwd)}`, { signal: controller.signal })
            : Promise.resolve<ImportListResponse>({ imports: [] }),
        ]);
        if (controller.signal.aborted) return;
        setCredential(credentialPayload.status);
        setImports(importPayload.imports);
        if (importPayload.imports[0]) chooseImport(importPayload.imports[0]);
      } catch (loadError) {
        if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : copy("无法读取设计工作区", "Unable to load the design workspace"));
      } finally {
        if (!controller.signal.aborted) setInitializing(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [active, chooseImport, copy, cwd]);

  const importDesign = useCallback(async (forceRefresh = false) => {
    if (!cwd || !sourceUrl.trim() || loading) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      let nextCredential = credential;
      if (token.trim()) {
        const connected = await jsonRequest<CredentialResponse>("/api/design-to-harmony/sources/figma/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: token.trim() }),
        });
        nextCredential = connected.status;
        setCredential(connected.status);
        setToken("");
      }
      if (!nextCredential.configured) throw new Error(copy("请先填写 Figma 访问令牌", "Enter a Figma access token first"));
      const payload = await jsonRequest<ImportResponse>("/api/design-to-harmony/imports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectRoot: cwd, url: sourceUrl.trim(), forceRefresh }),
      });
      setImports((current) => [payload.record, ...current.filter((item) => item.id !== payload.record.id)]);
      chooseImport(payload.record);
      setNotice(payload.cached
        ? copy("已载入本地缓存；点击“同步”可获取最新版本。", "Loaded from local cache. Use Sync to fetch the latest version.")
        : copy("完整设计文件已导入，只读分析不会修改项目。", "The full design file was imported. Read-only analysis did not modify the project."));
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : copy("导入失败", "Import failed"));
    } finally {
      setLoading(false);
    }
  }, [chooseImport, copy, credential, cwd, loading, sourceUrl, token]);

  const disconnect = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const payload = await jsonRequest<CredentialResponse>("/api/design-to-harmony/sources/figma/connect", { method: "DELETE" });
      setCredential(payload.status);
      setNotice(copy("Figma 令牌已从本机移除，已导入的只读摘要仍然保留。", "The Figma token was removed locally. Imported read-only summaries remain available."));
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : copy("断开连接失败", "Unable to disconnect"));
    } finally {
      setLoading(false);
    }
  }, [copy, loading]);

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleScope = useCallback((node: DesignTreeNodeSummary) => {
    setSelectedNodeId(node.id);
    setAnalysisRun(null);
    setSelectedScopeIds((current) => {
      const next = new Set(current);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      return next;
    });
  }, []);

  const selectSingleScope = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setSelectedScopeIds(new Set([nodeId]));
    setAnalysisRun(null);
  }, []);

  const analyzeSelection = useCallback(async () => {
    if (!cwd || !activeImport || analyzing || selectedScopeIds.size === 0) return;
    setAnalyzing(true);
    setError(null);
    setNotice(null);
    try {
      const payload = await jsonRequest<AnalysisResponse>("/api/design-to-harmony/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectRoot: cwd,
          importId: activeImport.id,
          targetNodeIds: [...selectedScopeIds].sort(),
        }),
      });
      setAnalysisRun(payload.run);
      setNotice(payload.cached
        ? copy("已载入同一设计版本的分析计划。", "Loaded the existing plan for this design version.")
        : copy("只读分析完成；计划尚未生成或写入任何 ArkUI 文件。", "Read-only analysis is complete. No ArkUI files were generated or written."));
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : copy("分析失败", "Analysis failed"));
    } finally {
      setAnalyzing(false);
    }
  }, [activeImport, analyzing, copy, cwd, selectedScopeIds]);

  if (!cwd) return <div className={styles.projectGate}>
    <span className={styles.heroIcon}><AliIcon name="workflow" size={22} /></span>
    <strong>{copy("先选择一个鸿蒙项目", "Select a Harmony project first")}</strong>
    <p>{copy("设计文件将与当前项目绑定，后续生成结果也只会进入该项目的暂存区。", "The design file and future staged output are scoped to the current project.")}</p>
  </div>;

  if (initializing) return <div className={styles.loadingState} role="status">
    <AliIcon name="sync" size={17} />
    <span>{copy("正在读取设计工作区…", "Loading design workspace…")}</span>
  </div>;

  if (!activeImport) return <div className={styles.setupRoot}>
    <div className={styles.setupCard}>
      <div className={styles.setupHero}>
        <span className={styles.heroIcon}><AliIcon name="workflow" size={22} /></span>
        <div>
          <small>DESIGN TO ARKUI</small>
          <h2>{copy("导入完整设计稿", "Import a complete design file")}</h2>
          <p>{copy("读取 Figma 的页面、画板、组件、流程、样式和变量。这里不是截图识别。", "Read pages, frames, components, flows, styles, and variables from Figma—not a screenshot.")}</p>
        </div>
      </div>
      <ol className={styles.steps}>
        <li data-active="true"><span>1</span><div><b>{copy("连接设计源", "Connect source")}</b><small>{copy("令牌仅保存在本机", "Token stays on this device")}</small></div></li>
        <li><span>2</span><div><b>{copy("理解文档结构", "Understand structure")}</b><small>{copy("选择页面或用户流程", "Choose a page or user flow")}</small></div></li>
        <li><span>3</span><div><b>{copy("生成并验证", "Generate and verify")}</b><small>{copy("先暂存，再明确应用", "Stage before explicit apply")}</small></div></li>
      </ol>
      <form className={styles.connectionForm} onSubmit={(event) => { event.preventDefault(); void importDesign(false); }}>
        <label>
          <span>{copy("Figma 文件链接", "Figma file link")}</span>
          <div className={styles.inputShell}><AliIcon name="link" size={14} /><input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://www.figma.com/design/…" autoComplete="off" /></div>
        </label>
        <label>
          <span>{credential.configured ? copy("更新访问令牌（可选）", "Replace access token (optional)") : copy("Figma 访问令牌", "Figma access token")}</span>
          <div className={styles.inputShell}><AliIcon name="lock" size={14} /><input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder={credential.configured ? "••••••••" : "figd_…"} autoComplete="off" /></div>
        </label>
        {error ? <div className={styles.errorBanner} role="alert"><AliIcon name="alert" size={14} /><span>{error}</span></div> : null}
        <button className={styles.primaryButton} type="submit" disabled={loading || !sourceUrl.trim() || (!credential.configured && !token.trim())}>
          {loading ? <AliIcon name="sync" size={14} /> : <AliIcon name="arrowright" size={14} />}
          {loading ? copy("正在读取完整设计稿…", "Reading the complete design…") : copy("连接并导入", "Connect and import")}
        </button>
        <div className={styles.privacyNote}><AliIcon name="lock" size={12} /><span>{copy("只读访问；当前阶段不会创建、覆盖或删除项目文件。", "Read-only access; this phase never creates, overwrites, or deletes project files.")}</span></div>
      </form>
    </div>
  </div>;

  const document = activeImport.document;
  const plan = analysisRun?.plan ?? null;
  const navItems: Array<{ id: NavigationSection; icon: AliIconName; label: string; count: number }> = [
    { id: "document", icon: "project", label: copy("页面与图层", "Pages & layers"), count: document.counts.pages },
    { id: "flows", icon: "workflow", label: copy("原型流程", "Prototype flows"), count: document.counts.flows },
    { id: "components", icon: "package", label: copy("组件与样式", "Components & styles"), count: document.counts.components + document.counts.componentSets },
    { id: "tokens", icon: "skin", label: copy("变量与令牌", "Variables & tokens"), count: document.counts.variables },
  ];

  return <div className={styles.workbench}>
    <header className={styles.sourceBar}>
      <div className={styles.sourceIdentity}>
        <span className={styles.figmaMark}>F</span>
        <div><strong>{document.name}</strong><small>{copy("Figma 完整文件", "Complete Figma file")} · v{document.version.id.slice(0, 8)}</small></div>
      </div>
      <div className={styles.sourceActions}>
        {imports.length > 1 ? <select aria-label={copy("切换设计稿", "Switch design file")} value={activeImport.id} onChange={(event) => {
          const record = imports.find((item) => item.id === event.target.value);
          if (record) chooseImport(record);
        }}>{imports.map((item) => <option key={item.id} value={item.id}>{item.document.name}</option>)}</select> : null}
        <button type="button" title={copy("从 Figma 同步最新结构", "Sync latest structure from Figma")} disabled={loading || !credential.configured} onClick={() => { void importDesign(true); }}>
          <AliIcon name="sync" size={14} /><span>{copy("同步", "Sync")}</span>
        </button>
        <button type="button" title={copy("连接设置", "Connection settings")} disabled={loading} onClick={() => { void disconnect(); }}><AliIcon name="unlock" size={14} /></button>
      </div>
    </header>

    {(error || notice) ? <div className={error ? styles.errorBanner : styles.noticeBanner} role={error ? "alert" : "status"}>
      <AliIcon name={error ? "alert" : "check-circle"} size={14} /><span>{error ?? notice}</span>
    </div> : null}

    <div className={styles.workspaceGrid}>
      <aside className={styles.navigator} aria-label={copy("设计文档导航", "Design document navigation")}>
        <div className={styles.navTabs}>
          {navItems.map((item) => <button key={item.id} type="button" aria-pressed={section === item.id} onClick={() => setSection(item.id)}>
            <AliIcon name={item.icon} size={14} /><span>{item.label}</span><small>{item.count}</small>
          </button>)}
        </div>
        <div className={styles.navigatorBody}>
          {section === "document" ? <DocumentTree
            nodes={document.pages}
            selectedId={selectedNodeId}
            selectedScopeIds={selectedScopeIds}
            expanded={expanded}
            onSelect={(node) => setSelectedNodeId(node.id)}
            onToggleScope={toggleScope}
            onToggle={toggleExpanded}
            expandLabel={copy("展开", "Expand")}
            collapseLabel={copy("折叠", "Collapse")}
            addLabel={copy("加入分析范围", "Add to analysis scope")}
            removeLabel={copy("移出分析范围", "Remove from analysis scope")}
          /> : null}
          {section === "flows" ? <div className={styles.resourceList}>{document.flows.length ? document.flows.map((flow) => <button type="button" key={flow.id} aria-pressed={selectedScopeIds.has(flow.nodeId)} onClick={() => { selectSingleScope(flow.nodeId); setSection("document"); }}><AliIcon name="workflow" size={13} /><span><b>{flow.name}</b><small>{flow.nodeId}</small></span></button>) : <EmptyResource text={copy("这个文件没有原型起点", "No prototype starting points in this file")} />}</div> : null}
          {section === "components" ? <div className={styles.resourceList}>{[...document.componentSets, ...document.components].length ? [...document.componentSets, ...document.components].map((component) => <button type="button" key={component.nodeId} aria-pressed={selectedScopeIds.has(component.nodeId)} onClick={() => selectSingleScope(component.nodeId)}><AliIcon name="package" size={13} /><span><b>{component.name}</b><small>{component.componentSetId ? copy("组件变体", "Component variant") : copy("组件", "Component")}</small></span></button>) : <EmptyResource text={copy("这个文件没有发布组件", "No published components in this file")} />}</div> : null}
          {section === "tokens" ? <div className={styles.resourceList}>{document.variables.variables.length ? document.variables.variables.map((variable) => <div key={variable.id}><AliIcon name="skin" size={13} /><span><b>{variable.name}</b><small>{variable.resolvedType}</small></span></div>) : <EmptyResource text={document.variables.reason ?? copy("没有可用的设计变量", "No design variables available")} />}</div> : null}
        </div>
      </aside>

      <main className={styles.canvas}>
        <div className={styles.canvasHeader}>
          <div><small>{copy("当前分析范围", "CURRENT ANALYSIS SCOPE")}</small><strong>{selectedNode?.name ?? document.name}</strong></div>
          <span>{copy(`${selectedScopeIds.size} 个选择`, `${selectedScopeIds.size} selected`)}</span>
        </div>
        <div className={styles.scopePreview}>
          <div className={styles.previewStack}>
            <div className={styles.previewFrame}>
              <span className={styles.previewGlyph}><AliIcon name={selectedNode ? nodeIcon(selectedNode.type) : "workflow"} size={26} /></span>
              <strong>{plan ? copy("分析计划已就绪", "Analysis plan is ready") : selectedNode?.name ?? document.name}</strong>
              <p>{plan
                ? copy(`已标准化 ${plan.stats.irNodes} 个设计节点，计划新增 ${plan.stats.outputFiles} 个 ArkUI 文件；当前尚未写入项目。`, `${plan.stats.irNodes} design nodes were normalized and ${plan.stats.outputFiles} ArkUI files are planned. Nothing has been written.`)
                : selectedNode
                  ? copy(`当前已选择 ${selectedScopeIds.size} 个范围。分析时会深度读取节点、组件依赖、变量和原型跳转。`, `${selectedScopeIds.size} scope items selected. Analysis reads their descendants, component dependencies, variables, and prototype links.`)
                  : copy("选择一个页面、画板或原型流程作为第一批分析范围。", "Choose a page, frame, or prototype flow as the first analysis scope.")}</p>
              <div className={styles.scopeFacts}>
                {plan ? <>
                  <span><b>{plan.stats.outputFiles}</b>{copy("计划文件", "files")}</span>
                  <span><b>{plan.componentMappings.length}</b>{copy("组件映射", "mappings")}</span>
                  <span><b>{plan.stats.blockingIssues}</b>{copy("阻断项", "blockers")}</span>
                  <span><b>{plan.stats.confirmationIssues + plan.stats.reminders}</b>{copy("待确认", "reviews")}</span>
                </> : <>
                  <span><b>{document.counts.pages}</b>{copy("页面", "pages")}</span>
                  <span><b>{document.counts.components + document.counts.componentSets}</b>{copy("组件", "components")}</span>
                  <span><b>{document.counts.variables}</b>{copy("变量", "variables")}</span>
                  <span><b>{document.counts.flows}</b>{copy("流程", "flows")}</span>
                </>}
              </div>
            </div>
            {plan ? <div className={styles.compactPlan}>
              <small>{copy("需要处理的问题", "ISSUES TO REVIEW")}</small>
              {plan.issues.length ? <div className={styles.issueList}>{plan.issues.map((issue) => <div key={issue.id} data-severity={issue.severity}><b>{issue.title}</b><span>{issue.message}</span><small>{copy(`${issue.sourceNodeIds.length} 个相关节点`, `${issue.sourceNodeIds.length} related nodes`)}</small></div>)}</div> : <p>{copy("未发现阻断或降级项。", "No blockers or fallbacks were found.")}</p>}
            </div> : null}
          </div>
        </div>
        <footer className={styles.canvasFooter}>
          <span><AliIcon name="lock" size={12} />{plan ? copy("只读计划；项目未改动", "Read-only plan; project unchanged") : copy("只读导入已就绪", "Read-only import is ready")}</span>
          <button type="button" disabled={analyzing || selectedScopeIds.size === 0 || !credential.configured} title={copy("只生成分析计划，不写入项目", "Creates a plan without writing to the project")} onClick={() => { void analyzeSelection(); }}>
            <AliIcon name={analyzing ? "sync" : "sparkles"} size={14} />
            {analyzing ? copy("正在分析…", "Analyzing…") : copy("分析所选范围", "Analyze selection")}
          </button>
        </footer>
      </main>

      <aside className={styles.inspector} aria-label={copy("设计检查器", "Design inspector")}>
        <div className={styles.inspectorSection}>
          <small>{copy("导入状态", "IMPORT STATUS")}</small>
          <div className={styles.statusLine}><span data-status="ready" /><b>{copy("结构已就绪", "Structure ready")}</b></div>
          <dl>
            <div><dt>{copy("更新时间", "Updated")}</dt><dd>{new Date(activeImport.updatedAt).toLocaleString(locale)}</dd></div>
            <div><dt>{copy("顶层节点", "Top-level nodes")}</dt><dd>{document.counts.topLevelNodes}</dd></div>
            <div><dt>{copy("样式", "Styles")}</dt><dd>{document.counts.styles}</dd></div>
          </dl>
        </div>
        <div className={styles.inspectorSection}>
          <small>{plan ? copy("分析结果", "ANALYSIS RESULT") : copy("接下来", "NEXT")}</small>
          <ol className={styles.pipeline}>
            <li data-ready="true"><span>1</span><div><b>{copy("读取设计结构", "Read design structure")}</b><small>{copy("已完成", "Complete")}</small></div></li>
            <li data-ready={plan ? "true" : undefined}><span>2</span><div><b>{copy("标准化为 Design IR", "Normalize to Design IR")}</b><small>{plan ? copy("已完成", "Complete") : copy("等待分析", "Awaiting analysis")}</small></div></li>
            <li><span>3</span><div><b>{copy("生成 ArkUI 暂存结果", "Generate staged ArkUI")}</b><small>{copy("尚未开始", "Not started")}</small></div></li>
            <li><span>4</span><div><b>{copy("预览差异并验证", "Review diff and verify")}</b><small>{copy("确认后应用", "Apply after approval")}</small></div></li>
          </ol>
        </div>
        {plan ? <>
          <div className={styles.inspectorSection}>
            <small>{copy("计划文件", "PLANNED FILES")}</small>
            <div className={styles.planList}>{plan.files.map((file) => <div key={file.relativePath}><AliIcon name="file" size={12} /><span><b>{file.symbolName}</b><small>{file.relativePath}</small></span></div>)}</div>
          </div>
          <div className={styles.inspectorSection}>
            <small>{copy("依赖与映射", "DEPENDENCIES & MAPPINGS")}</small>
            <dl>
              <div><dt>{copy("设计组件", "Design components")}</dt><dd>{plan.dependencies.componentNodeIds.length}</dd></div>
              <div><dt>{copy("设计变量", "Design variables")}</dt><dd>{plan.dependencies.variableIds.length}</dd></div>
              <div><dt>{copy("图片资源", "Image assets")}</dt><dd>{plan.dependencies.assetRefs.length}</dd></div>
              <div><dt>{copy("原型跳转", "Prototype links")}</dt><dd>{plan.interactionMappings.length}</dd></div>
              <div><dt>{copy("复用项目组件", "Reused project components")}</dt><dd>{plan.componentMappings.filter((mapping) => mapping.strategy === "project_component").length}</dd></div>
            </dl>
          </div>
          <div className={styles.inspectorSection}>
            <small>{copy("问题清单", "ISSUE LIST")}</small>
            {plan.issues.length ? <div className={styles.issueList}>{plan.issues.map((issue) => <div key={issue.id} data-severity={issue.severity}><b>{issue.title}</b><span>{issue.message}</span><small>{issue.code} · {copy(`${issue.sourceNodeIds.length} 个节点`, `${issue.sourceNodeIds.length} nodes`)}</small></div>)}</div> : <div className={styles.noIssues}><AliIcon name="check-circle" size={13} />{copy("未发现阻断或降级项", "No blockers or fallbacks")}</div>}
          </div>
        </> : null}
        {document.warnings.length ? <div className={styles.warningBox}><AliIcon name="alert" size={14} /><div><b>{copy("部分能力受限", "Some capabilities are limited")}</b>{document.warnings.map((warning) => <span key={warning}>{warning}</span>)}</div></div> : null}
        <button className={styles.guideButton} type="button" onClick={onGuideAgent}><AliIcon name="message" size={14} />{copy("让 Codex 帮我选择范围", "Ask Codex to choose a scope")}</button>
      </aside>
    </div>
  </div>;
}

function EmptyResource({ text }: { text: string }) {
  return <div className={styles.emptyResource}><AliIcon name="archive" size={18} /><span>{text}</span></div>;
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { createDiscoveryAbort, requestDiscoveredModels, type DiscoveredModel } from "@/lib/model-discovery";
import { clearLimitMetaField, modelLimitProblem, parseModelLimitDraft, stripModelLimitUiMeta, validateCustomModelLimits } from "@/lib/model-limits";
import type { ModelCatalogRecommendation } from "@/lib/model-catalog";
import { requestConfirmation } from "./ConfirmDialog";
import { ModelErrorText } from "./ModelErrorText";
import { ModelFallbackSetting } from "./ModelFallbackSetting";
import { ApiKeyDetail, OAuthDetail, VisionAgentDetail, API_OPTIONS, type ApiKeyProvider, type OAuthProvider, type ModelEntry, type ModelsJson, type ProviderEntry, type ModelScopeResponse } from "./ModelsConfig";
import styles from "./ModelsExperience.module.css";

const copy = {
  zh: {
    title: "模型设置", subtitle: "连接 AI 服务，让对话开始工作", add: "添加渠道", default: "默认模型", none: "还没有可用的模型", noneHint: "添加渠道并选择模型，即可开始对话。", custom: "自定义渠道", account: "使用服务商账号或密钥", first: "第一次使用？", tip1: "填写服务商提供的接口地址", tip2: "输入访问密钥", tip3: "选择想使用的模型", vision: "视觉与回退", visionHint: "设置图片理解与模型不可用时的回退方式", manage: "管理模型", settings: "连接设置", configured: "已配置", noModels: "暂无模型", back: "返回", connect: "连接渠道", choose: "选择模型", finish: "完成", name: "渠道名称", nameHint: "起一个容易辨认的名称，例如服务商名称。", address: "接口地址", addressHint: "填写服务商提供的 API 地址，通常以 https:// 开头。", key: "访问密钥", keyHint: "填写服务商提供的 API Key；部分本地服务可能要求占位密钥。", show: "显示密钥", hide: "隐藏密钥", protocol: "接口类型", fetch: "获取可用模型", fetching: "正在获取模型…", cancel: "取消", where: "在哪里获取？", where1: "登录服务商控制台，找到 API 接口地址。", where2: "创建或复制访问密钥。", where3: "填入左侧，然后获取可用模型。", select: "选择要使用的模型", search: "搜索模型名称", manual: "找不到模型？手动添加", manualId: "模型 ID", manualAdd: "添加模型", selected: "已选择", selectedUnit: "个模型", previous: "上一步", next: "继续", completing: "正在补全模型信息…", save: "保存并完成", saving: "正在保存…", saved: "配置已保存", savedHint: "返回对话后即可选择已启用的模型。", return: "返回模型设置", limits: "补全模型信息", limitsHint: "渠道和模型目录没有提供完整信息。请查看服务商文档，填写准确数值。", context: "上下文长度", output: "最大输出", limitHint: "这两个数字通常可在服务商的模型说明中找到。", invalidLimits: "请填写有效的正整数，最大输出不能超过上下文长度。", invalidName: "请填写未被使用的渠道名称。", invalidUrl: "请输入有效的 http 或 https 接口地址。", chooseOne: "请至少选择一个模型。", failed: "获取模型失败，请检查地址、密钥和接口类型，也可以手动添加。", noResults: "没有找到模型，可手动添加。", test: "测试模型", testing: "正在测试…", testHint: "测试会向服务商发送一次请求，可能产生费用。", testOk: "测试通过", testFailed: "测试失败", edit: "编辑模型", saveChanges: "保存修改", remove: "删除", removeQuestion: "确定删除？此操作会立即更新配置。", setDefault: "设为默认", defaultBadge: "默认", enabled: "已启用", hidden: "已隐藏", enable: "启用", hideModel: "隐藏", addModel: "添加模型", nameLabel: "显示名称", image: "支持图片输入", readError: "无法读取模型配置", retry: "重试", auth: "连接服务商", authHint: "选择你已有的服务商账号或 API 密钥。", syncedWarning: "配置已保存，但部分模型无法启用。请检查渠道认证及项目模型范围。", duplicate: "模型已存在。", saveError: "保存失败，请重试。", finishStep: "模型信息已准备好", ready: "确认模型后保存；也可以先进行测试。", statusSource: "模型信息来源", sourceEndpoint: "渠道", sourceCatalog: "模型目录", sourceManual: "手动填写", noSelection: "没有匹配的模型", showOther: "使用其他服务商", deleteProvider: "删除渠道", saveConnection: "保存连接", editConnectionHint: "更改连接信息后，可以重新获取模型。", completeMissing: "模型信息不完整", unverified: "连接尚未测试", loading: "正在加载…", restore: "恢复渠道", manageTitle: "模型管理", defaultModel: "默认模型", skipDiscovery: "手动添加模型", modelName: "模型名称", endpointOnly: "模型列表已获取；模型测试需单独进行。", providerList: "选择服务商", close: "关闭", costNotice: "已有高级配置会保留并继续生效。"
  },
  en: {
    title: "Model settings", subtitle: "Connect an AI service to start chatting", add: "Add provider", default: "Default model", none: "No models available yet", noneHint: "Add a provider and choose a model to start chatting.", custom: "Custom provider", account: "Use a provider account or API key", first: "New here?", tip1: "Enter your provider's API address", tip2: "Enter your API key", tip3: "Choose the models you want", vision: "Vision and fallback", visionHint: "Configure image understanding and fallback models", manage: "Manage models", settings: "Connection settings", configured: "Configured", noModels: "No models yet", back: "Back", connect: "Connect", choose: "Choose models", finish: "Finish", name: "Provider name", nameHint: "Choose a recognizable name, such as the service name.", address: "API address", addressHint: "Enter the API address supplied by your provider.", key: "API key", keyHint: "Enter the API key provided by your service; some local services require a placeholder key.", show: "Show key", hide: "Hide key", protocol: "API type", fetch: "Get available models", fetching: "Getting models…", cancel: "Cancel", where: "Where do I find these?", where1: "Find the API address in your provider's dashboard.", where2: "Create or copy an API key.", where3: "Enter them here and get available models.", select: "Choose models", search: "Search models", manual: "Can't find a model? Add it manually", manualId: "Model ID", manualAdd: "Add model", selected: "Selected", selectedUnit: "models", previous: "Back", next: "Continue", completing: "Completing model information…", save: "Save and finish", saving: "Saving…", saved: "Configuration saved", savedHint: "You can select enabled models in chat.", return: "Back to model settings", limits: "Complete model information", limitsHint: "The provider and catalog did not supply all required information. Check the provider's documentation for accurate values.", context: "Context length", output: "Maximum output", limitHint: "Find these values in the provider's model documentation.", invalidLimits: "Enter positive whole numbers; maximum output must not exceed context length.", invalidName: "Enter a unique provider name.", invalidUrl: "Enter a valid http or https API address.", chooseOne: "Choose at least one model.", failed: "Could not get models. Check the address, key and API type, or add a model manually.", noResults: "No models found; add one manually.", test: "Test model", testing: "Testing…", testHint: "Testing sends one request to the provider and may incur a charge.", testOk: "Test passed", testFailed: "Test failed", edit: "Edit model", saveChanges: "Save changes", remove: "Delete", removeQuestion: "Delete this item? The configuration will be updated immediately.", setDefault: "Set default", defaultBadge: "Default", enabled: "Enabled", hidden: "Hidden", enable: "Enable", hideModel: "Hide", addModel: "Add model", nameLabel: "Display name", image: "Supports image input", readError: "Unable to load model configuration", retry: "Retry", auth: "Connect a provider", authHint: "Choose a provider account or API key.", syncedWarning: "Saved, but some models could not be enabled. Check provider authentication and project scope.", duplicate: "That model already exists.", saveError: "Save failed. Please retry.", finishStep: "Model information is ready", ready: "Review your models before saving; testing is optional.", statusSource: "Information source", sourceEndpoint: "Provider", sourceCatalog: "Model catalog", sourceManual: "Entered manually", noSelection: "No matching models", showOther: "Use another provider", deleteProvider: "Delete provider", saveConnection: "Save connection", editConnectionHint: "You can get models again after changing connection details.", completeMissing: "Model information incomplete", unverified: "Connection not tested", loading: "Loading…", restore: "Restore provider", manageTitle: "Manage models", defaultModel: "Default model", skipDiscovery: "Add a model manually", modelName: "Model name", endpointOnly: "Model list retrieved; test models separately.", providerList: "Choose a provider", close: "Close", costNotice: "Existing advanced settings are preserved and remain effective."
  },
} as const;

type View = { kind: "home" } | { kind: "picker" } | { kind: "auth"; mode: "api" | "oauth"; id: string } | { kind: "vision" } | { kind: "manage"; id: string } | { kind: "wizard"; id?: string } | { kind: "edit"; provider: string; index: number };
type WizardStep = "connect" | "choose" | "limits" | "finish" | "done";
type CatalogModel = ModelEntry;

async function jsonRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const body = await response.json() as T & { error?: string };
  if (!response.ok || body.error) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

export function ModelsExperience({ cwd, onClose, onModelsChanged, embedded = false }: { cwd?: string; onClose: () => void; onModelsChanged?: () => void; embedded?: boolean }) {
  const { locale, t } = useI18n();
  const c = locale === "zh-CN" ? copy.zh : copy.en;
  const rootRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ kind: "home" });
  const [config, setConfig] = useState<ModelsJson>({ providers: {} });
  const [scope, setScope] = useState<ModelScopeResponse | null>(null);
  const [oauth, setOauth] = useState<OAuthProvider[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyProvider[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const requestRef = useRef(0);
  const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
  useFocusTrap(rootRef, !embedded, { onEscape: busy ? undefined : onClose });

  const reload = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true); setError(null);
    try {
      const [nextConfig, nextScope, nextOAuth, nextApi] = await Promise.all([
        jsonRequest<ModelsJson>("/api/models-config", { cache: "no-store" }),
        jsonRequest<ModelScopeResponse>(`/api/models/scope${query}`, { cache: "no-store" }),
        jsonRequest<{ providers: OAuthProvider[] }>("/api/auth/providers", { cache: "no-store" }),
        jsonRequest<{ providers: ApiKeyProvider[] }>("/api/auth/all-providers", { cache: "no-store" }),
      ]);
      if (request !== requestRef.current) return;
      setConfig(nextConfig); setScope(nextScope); setOauth(nextOAuth.providers ?? []); setApiKeys(nextApi.providers ?? []);
    } catch (cause) { if (request === requestRef.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (request === requestRef.current) setLoading(false); }
  }, [query]);
  useEffect(() => { const requests = requestRef; void reload(); return () => { ++requests.current; }; }, [reload]);

  const scopeAction = async (action: string, provider: string, id?: string) => {
    const result = await jsonRequest<ModelScopeResponse>("/api/models/scope", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, provider, ...(id ? { id } : {}), ...(cwd ? { cwd } : {}) }) });
    setScope(result); onModelsChanged?.(); return result;
  };

  const saveProvider = async (name: string, provider: ProviderEntry, newModels: ModelEntry[], originalName?: string) => {
    setBusy(true); setError(null); setWarning(null);
    try {
      const current = await jsonRequest<ModelsJson>("/api/models-config", { cache: "no-store" });
      const providers = { ...(current.providers ?? {}) };
      if ((!originalName || name !== originalName) && Object.hasOwn(providers, name)) throw new Error(c.invalidName);
      if (originalName && !Object.hasOwn(providers, originalName)) throw new Error(c.readError);
      if (originalName && JSON.stringify(providers[originalName]) !== JSON.stringify(config.providers?.[originalName])) throw new Error(locale === "zh-CN" ? "渠道配置已被其他操作修改，请返回并刷新后重试。" : "The provider changed elsewhere. Go back and refresh before retrying.");
      if (originalName && name !== originalName) delete providers[originalName];
      const normalizedProvider = provider.apiKey === "" ? { ...provider, apiKey: undefined } : provider;
      const next = { ...current, providers: { ...providers, [name]: normalizedProvider } };
      validateCustomModelLimits(stripModelLimitUiMeta(next), current);
      await jsonRequest("/api/models-config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(stripModelLimitUiMeta(next)) });
      setDirty(false);
      onModelsChanged?.();
      let syncFailed = false;
      const modelsToEnable = originalName && originalName !== name ? (provider.models ?? []) : newModels;
      let refreshedScope: ModelScopeResponse | null = null;
      if (modelsToEnable.length > 0) {
        try { refreshedScope = await jsonRequest<ModelScopeResponse>(`/api/models/scope${query}`, { cache: "no-store" }); }
        catch { /* The restore calls below provide a second chance. */ }
      }
      for (const model of modelsToEnable) {
        if (refreshedScope?.models.some(item => item.provider === name && item.id === model.id && item.enabled)) continue;
        try { await scopeAction("restore", name, model.id); } catch { syncFailed = true; }
      }
      if (syncFailed) setWarning(c.syncedWarning);
      onModelsChanged?.();
      await reload();
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return false; }
    finally { setBusy(false); }
  };

  const mutate = async (action: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await action(); await reload(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const remove = async (provider: string, id?: string) => {
    if (!await requestConfirmation({ title: c.remove, message: c.removeQuestion, confirmLabel: c.remove, tone: "danger" })) return;
    await mutate(async () => { await jsonRequest("/api/models-config", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, ...(id ? { id } : {}) }) }); onModelsChanged?.(); if (!id) setView({ kind: "home" }); });
  };

  const providerIds = [...new Set([...Object.keys(config.providers ?? {}), ...(scope?.models ?? []).map(model => model.provider), ...apiKeys.filter(item => item.configured).map(item => item.id), ...oauth.filter(item => item.loggedIn).map(item => item.id)])];
  const authRefresh = () => { onModelsChanged?.(); void reload(); };
  const leaveView = async () => {
    if (dirty && !await requestConfirmation({ title: locale === "zh-CN" ? "放弃未保存的修改？" : "Discard unsaved changes?", message: locale === "zh-CN" ? "返回后，本次填写的内容不会保存。" : "Your changes will be lost when you leave.", confirmLabel: locale === "zh-CN" ? "放弃修改" : "Discard", tone: "danger" })) return;
    setDirty(false); setView({ kind: "home" }); setError(null);
  };
  const selectedProvider = view.kind === "manage" ? view.id : "";
  const managedModels = (scope?.models ?? []).filter(model => model.provider === selectedProvider);
  const configuredModels = config.providers?.[selectedProvider]?.models ?? [];
  const allModelIds = [...new Set([...managedModels.map(model => model.id), ...configuredModels.map(model => model.id)])];

  return <div ref={rootRef} className={styles.root} role={embedded ? "region" : "dialog"} aria-modal={embedded ? undefined : true} aria-label={c.title}>
    <div className={styles.page}>
      {!embedded && <button className={`${styles.quiet} ${styles.close}`} onClick={onClose} aria-label={c.close}>{c.close}</button>}
      {view.kind !== "home" && <button className={styles.quiet} onClick={() => void leaveView()} disabled={busy}>← {c.back}</button>}
      {error && <div className={styles.error} role="alert"><ModelErrorText value={error} /> {loading ? null : <button className={styles.quiet} onClick={() => void reload()}>{c.retry}</button>}</div>}
      {warning && <div className={styles.notice} role="status">{warning}</div>}
      {loading && view.kind === "home" ? <p>{c.loading}</p> : null}
      {view.kind === "home" && !loading && <>
        <header className={styles.header}><div><h2>{c.title}</h2><p>{c.subtitle}</p></div><button className={styles.primary} onClick={() => setView({ kind: "picker" })}>+ {c.add}</button></header>
        <div className={styles.columns}><div className={styles.stack}>
          <section className={styles.card}><h3>{c.default}</h3><p className={styles.hint}>{scope?.effectiveDefault ? `${scope.effectiveDefault.provider} · ${scope.effectiveDefault.modelId}` : c.none}</p></section>
          {providerIds.length === 0 ? <section className={styles.card}><h3>{c.none}</h3><p className={styles.hint}>{c.noneHint}</p><div className={styles.actionsEnd}><button className={styles.primary} onClick={() => setView({ kind: "wizard" })}>+ {c.custom}</button></div></section> : providerIds.map(id => {
            const models = (scope?.models ?? []).filter(model => model.provider === id && model.enabled);
            const custom = config.providers?.[id];
            return <section className={styles.provider} key={id}><div className={styles.providerTitle}><strong>{id}</strong><span className={styles.status}>{custom ? c.unverified : c.configured}</span><button className={styles.button} onClick={() => setView({ kind: "manage", id })}>{c.manage}</button>{custom && <button className={styles.button} onClick={() => setView({ kind: "wizard", id })}>{c.settings}</button>}</div>
              {models.length ? models.slice(0, 4).map(model => <div className={styles.modelRow} key={model.id}><span className={styles.modelName}>{model.name || model.id}</span>{scope?.effectiveDefault?.provider === id && scope.effectiveDefault.modelId === model.id && <span className={styles.badge}>{c.defaultBadge}</span>}</div>) : <span className={styles.status}>{c.noModels}</span>}
            </section>;
          })}
          <button className={styles.card} style={{ textAlign: "left", cursor: "pointer", color: "inherit" }} onClick={() => setView({ kind: "vision" })}><h3>{c.vision} →</h3><span className={styles.hint}>{c.visionHint}</span></button>
        </div><aside className={styles.help}><h3>{c.first}</h3><ol><li>{c.tip1}</li><li>{c.tip2}</li><li>{c.tip3}</li></ol></aside></div>
      </>}
      {view.kind === "picker" && <><header className={styles.header}><div><h2>{c.providerList}</h2><p>{c.authHint}</p></div></header><div className={styles.stack}><button className={styles.card} style={{ textAlign: "left", cursor: "pointer", color: "inherit" }} onClick={() => setView({ kind: "wizard" })}><h3>+ {c.custom}</h3><span className={styles.hint}>{c.tip1} · {c.tip2}</span></button><section className={styles.card}><h3>{c.account}</h3><div className={styles.actions}>{apiKeys.filter(p => !p.configured).map(p => <button className={styles.button} key={`api-${p.id}`} onClick={() => setView({ kind: "auth", mode: "api", id: p.id })}>{p.displayName}</button>)}{oauth.filter(p => !p.loggedIn).map(p => <button className={styles.button} key={`oauth-${p.id}`} onClick={() => setView({ kind: "auth", mode: "oauth", id: p.id })}>{p.name} · {t("models.login.oauth")}</button>)}</div></section></div></>}
      {view.kind === "auth" && <section className={styles.card}><h3>{c.auth}</h3>{view.mode === "api" ? (() => { const p = apiKeys.find(item => item.id === view.id); return p ? <ApiKeyDetail provider={p} onRefresh={authRefresh} /> : null; })() : (() => { const p = oauth.find(item => item.id === view.id); return p ? <OAuthDetail provider={p} onRefresh={authRefresh} /> : null; })()}</section>}
      {view.kind === "vision" && <div className={styles.stack}><section className={styles.card}><ModelFallbackSetting /></section><section className={styles.card}><VisionAgentDetail cwd={cwd} /></section></div>}
      {view.kind === "manage" && <><header className={styles.header}><div><h2>{selectedProvider}</h2><p>{c.manageTitle}</p></div><div className={styles.actions}>{config.providers?.[selectedProvider] ? <><button className={styles.button} onClick={() => setView({ kind: "wizard", id: selectedProvider })}>+ {c.addModel}</button><button className={styles.quiet} onClick={() => void remove(selectedProvider)} disabled={busy}>{c.deleteProvider}</button></> : <>{apiKeys.some(p => p.id === selectedProvider && p.configured) && <button className={styles.button} onClick={() => setView({ kind: "auth", mode: "api", id: selectedProvider })}>{c.settings}</button>}{oauth.some(p => p.id === selectedProvider && p.loggedIn) && <button className={styles.button} onClick={() => setView({ kind: "auth", mode: "oauth", id: selectedProvider })}>{c.settings}</button>}</>}</div></header><section className={styles.card}>
        {allModelIds.length === 0 && <p className={styles.hint}>{c.noModels}</p>}
        {allModelIds.map(id => { const managed = managedModels.find(item => item.id === id); const index = configuredModels.findIndex(item => item.id === id); const custom = index >= 0; const isDefault = scope?.effectiveDefault?.provider === selectedProvider && scope.effectiveDefault.modelId === id; return <div className={styles.modelRow} key={id}><div className={styles.modelName}><strong>{managed?.name || configuredModels[index]?.name || id}</strong><div className={styles.status}>{id} · {managed ? (managed.enabled ? c.enabled : c.hidden) : c.unverified}{custom && modelLimitProblem(configuredModels[index]) ? ` · ${c.completeMissing}` : ""}</div></div>{isDefault ? <span className={styles.badge}>{c.defaultBadge}</span> : managed?.enabled && <button className={styles.button} disabled={busy} onClick={() => void mutate(async () => { await scopeAction("set-default", selectedProvider, id); })}>{c.setDefault}</button>}{managed && <button className={styles.quiet} disabled={busy || scope?.projectOverride} onClick={() => void mutate(async () => { await scopeAction(managed.enabled ? "hide" : "restore", selectedProvider, id); })}>{managed.enabled ? c.hideModel : c.enable}</button>}{custom && <><button className={styles.button} onClick={() => setView({ kind: "edit", provider: selectedProvider, index })}>{c.edit}</button><button className={styles.quiet} disabled={busy} onClick={() => void remove(selectedProvider, id)}>{c.remove}</button></>}</div>; })}
        {scope?.projectOverride && <p className={styles.hint}>{t("models.projectScopeOverride")}</p>}
      </section><p className={styles.hint}>{c.costNotice}</p></>}
      {view.kind === "wizard" && <div onChangeCapture={() => setDirty(true)}><ProviderWizard key={view.id ?? "new"} initialName={view.id} initialProvider={view.id ? config.providers?.[view.id] : undefined} busy={busy} error={error} setError={setError} saveProvider={saveProvider} onCancel={() => void leaveView()} c={c} /></div>}
      {view.kind === "edit" && (() => { const provider = config.providers?.[view.provider]; const model = provider?.models?.[view.index]; return provider && model ? <div onChangeCapture={() => setDirty(true)}><ModelEdit key={`${view.provider}/${view.index}`} model={model} busy={busy} c={c} onSave={async next => { const models = [...(provider.models ?? [])]; models[view.index] = next; if (await saveProvider(view.provider, { ...provider, models }, [], view.provider)) setView({ kind: "manage", id: view.provider }); }} /></div> : null; })()}
    </div>
  </div>;
}

type Text = typeof copy.zh | typeof copy.en;

function ProviderWizard({ initialName, initialProvider, busy, error, setError, saveProvider, onCancel, c }: {
  initialName?: string; initialProvider?: ProviderEntry; busy: boolean; error: string | null; setError: (message: string | null) => void;
  saveProvider: (name: string, provider: ProviderEntry, newModels: ModelEntry[], originalName?: string) => Promise<boolean>;
  onCancel: () => void; c: Text;
}) {
  const [step, setStep] = useState<WizardStep>("connect");
  const [name, setName] = useState(initialName ?? "");
  const [provider, setProvider] = useState<ProviderEntry>(initialProvider ?? { api: "openai-completions" });
  const [showKey, setShowKey] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredModel[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [hadMissingLimits, setHadMissingLimits] = useState(false);
  const [manual, setManual] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [testStatus, setTestStatus] = useState<string | null>(null);
  const discoveryRef = useRef<ReturnType<typeof createDiscoveryAbort> | null>(null);
  const operationRef = useRef(0);
  useEffect(() => () => { ++operationRef.current; discoveryRef.current?.cancel(); discoveryRef.current?.dispose(); }, []);
  const existingIds = new Set((initialProvider?.models ?? []).map(model => model.id));
  const validConnection = () => {
    if (!name.trim()) { setError(c.invalidName); return false; }
    try { const url = new URL(provider.baseUrl?.trim() ?? ""); if (!/^https?:$/.test(url.protocol)) throw new Error(); }
    catch { setError(c.invalidUrl); return false; }
    return true;
  };
  const discover = async () => {
    if (!validConnection()) return;
    const operation = ++operationRef.current;
    discoveryRef.current?.cancel(); discoveryRef.current?.dispose();
    const controller = createDiscoveryAbort(); discoveryRef.current = controller;
    setLoading(true); setError(null);
    try {
      const result = await requestDiscoveredModels({ providerName: name.trim(), provider, signal: controller.signal });
      if (operation !== operationRef.current) return;
      setDiscovered(result.models); setSelected(new Set()); setStep("choose");
    } catch (cause) {
      if (operation === operationRef.current) setError(`${c.failed} ${cause instanceof Error ? cause.message : ""}`);
    } finally {
      controller.dispose(); if (discoveryRef.current === controller) discoveryRef.current = null;
      if (operation === operationRef.current) setLoading(false);
    }
  };
  const chooseManual = () => { if (!validConnection()) return; ++operationRef.current; discoveryRef.current?.cancel(); setError(null); setLoading(false); setStep("choose"); };
  const addManual = () => {
    const id = manual.trim(); if (!id) return;
    if (existingIds.has(id)) { setError(c.duplicate); return; }
    setDiscovered(current => current.some(model => model.id === id) ? current : [...current, { id }]);
    setSelected(current => new Set([...current, id])); setManual(""); setError(null);
  };
  const complete = async () => {
    const chosen = discovered.filter(model => selected.has(model.id) && !existingIds.has(model.id));
    if (!chosen.length) { setError(c.chooseOne); return; }
    const operation = ++operationRef.current;
    setLoading(true); setError(null);
    const completed: CatalogModel[] = [];
    // Keep lookup traffic bounded even when a provider returns a large catalogue.
    for (let start = 0; start < chosen.length; start += 6) {
      const batch = await Promise.all(chosen.slice(start, start + 6).map(async item => {
        let next: CatalogModel = { ...item, limitsMeta: { ...(item.contextWindow !== undefined ? { contextWindow: "endpoint" } : {}), ...(item.maxTokens !== undefined ? { maxTokens: "endpoint" } : {}) } };
        try {
            const params = new URLSearchParams({ q: item.id, provider: name.trim(), baseUrl: provider.baseUrl ?? "" });
            const response = await jsonRequest<{ recommendation?: ModelCatalogRecommendation }>(`/api/models-config/catalog?${params}`, { cache: "no-store", signal: AbortSignal.timeout(16000) });
            const recommendation = response.recommendation;
            const reliable = recommendation && (recommendation.metadataMethod === "provider" || recommendation.metadataMethod === "base-url" || (recommendation.metadataMethod === "consensus" && recommendation.exactMatches >= 2));
            if (reliable) {
              const preset = recommendation.preset;
              const contextFromCatalog = next.contextWindow === undefined && preset.contextWindow !== undefined;
              const outputFromCatalog = next.maxTokens === undefined && preset.maxTokens !== undefined;
              next = { ...next, ...(contextFromCatalog ? { contextWindow: preset.contextWindow } : {}), ...(outputFromCatalog ? { maxTokens: preset.maxTokens } : {}), ...(preset.reasoning === true ? { reasoning: true } : {}), ...(preset.input?.length ? { input: preset.input } : {}), limitsMeta: { ...next.limitsMeta, ...(contextFromCatalog ? { contextWindow: "models.dev" } : {}), ...(outputFromCatalog ? { maxTokens: "models.dev" } : {}) } };
            }
        } catch { /* Missing catalog data is handled by the manual step. */ }
        return next;
      }));
      completed.push(...batch);
      if (operation !== operationRef.current) return;
    }
    const missing = completed.some(modelLimitProblem);
    setModels(completed); setHadMissingLimits(missing); setLoading(false); setStep(missing ? "limits" : "finish");
  };
  const updateModel = (index: number, update: Partial<CatalogModel>) => setModels(current => current.map((model, i) => {
    if (i !== index) return model;
    let meta = model.limitsMeta;
    if (Object.hasOwn(update, "contextWindow")) meta = clearLimitMetaField(meta, "contextWindow");
    if (Object.hasOwn(update, "maxTokens")) meta = clearLimitMetaField(meta, "maxTokens");
    return { ...model, ...update, limitsMeta: meta };
  }));
  const validateLimits = () => { if (models.some(modelLimitProblem)) { setError(c.invalidLimits); return false; } setError(null); return true; };
  const save = async () => {
    if (!validateLimits()) return;
    const additions = models;
    const next = { ...provider, baseUrl: provider.baseUrl?.trim(), models: [...(initialProvider?.models ?? []), ...additions] };
    if (await saveProvider(name.trim(), next, additions, initialName)) setStep("done");
  };
  const saveConnection = async () => {
    if (!validConnection() || !initialName) return;
    if (await saveProvider(name.trim(), { ...provider, baseUrl: provider.baseUrl?.trim() }, [], initialName)) setStep("done");
  };
  const testModel = async (model: CatalogModel) => {
    setLoading(true); setTestStatus(null);
    try {
      const data = await jsonRequest<{ ok?: boolean; error?: string }>("/api/models-config/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerName: name.trim(), provider, model }) });
      setTestStatus(data.ok ? c.testOk : `${c.testFailed}: ${data.error ?? ""}`);
    } catch (cause) { setTestStatus(`${c.testFailed}: ${cause instanceof Error ? cause.message : String(cause)}`); }
    finally { setLoading(false); }
  };
  const visible = discovered.filter(model => `${model.name ?? ""} ${model.id}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const stepNumber = step === "connect" ? 1 : step === "choose" ? 2 : 3;
  return <><header className={styles.header}><div><h2>{c.custom}</h2><p>{initialName ? c.editConnectionHint : c.subtitle}</p></div></header>
    <ol className={styles.steps}>{[c.connect, c.choose, c.finish].map((label, index) => <li key={label} aria-current={stepNumber === index + 1 ? "step" : undefined}><span>{index + 1}</span>{label}</li>)}</ol>
    {step === "connect" && <div className={styles.columns}><section className={styles.card}>
      <div className={styles.field}><label htmlFor="model-provider-name">{c.name}</label><input id="model-provider-name" disabled={busy || loading} value={name} onChange={event => setName(event.currentTarget.value)} placeholder={c.nameHint} /><small>{c.nameHint}</small></div>
      <div className={styles.field}><label htmlFor="model-provider-url">{c.address}</label><input id="model-provider-url" disabled={busy || loading} value={provider.baseUrl ?? ""} onChange={event => setProvider({ ...provider, baseUrl: event.currentTarget.value })} placeholder="https://api.example.com/v1" /><small>{c.addressHint}</small></div>
      <div className={styles.field}><label htmlFor="model-provider-key">{c.key}</label><div className={styles.actions}><input id="model-provider-key" disabled={busy || loading} style={{ flex: 1 }} type={showKey ? "text" : "password"} value={provider.apiKey ?? ""} onChange={event => setProvider({ ...provider, apiKey: event.currentTarget.value })} autoComplete="off" /><button type="button" className={styles.quiet} onClick={() => setShowKey(value => !value)}>{showKey ? c.hide : c.show}</button></div><small>{c.keyHint}</small></div>
      <div className={styles.field}><label htmlFor="model-provider-api">{c.protocol}</label><select id="model-provider-api" disabled={busy || loading} value={provider.api ?? "openai-completions"} onChange={event => setProvider({ ...provider, api: event.currentTarget.value })}>{API_OPTIONS.map(api => <option key={api} value={api}>{api === "openai-completions" ? "OpenAI compatible" : api}</option>)}</select></div>
      <div className={`${styles.actions} ${styles.actionsEnd}`}><button className={styles.quiet} onClick={onCancel} disabled={busy || loading}>{c.cancel}</button>{initialName && <button className={styles.button} onClick={() => void saveConnection()} disabled={busy || loading}>{c.saveConnection}</button>}<button className={styles.button} onClick={chooseManual} disabled={busy || loading}>{c.skipDiscovery}</button><button className={styles.primary} onClick={() => void discover()} disabled={busy || loading}>{loading ? c.fetching : c.fetch} →</button></div>
    </section><aside className={styles.help}><h3>{c.where}</h3><ol><li>{c.where1}</li><li>{c.where2}</li><li>{c.where3}</li></ol></aside></div>}
    {step === "choose" && <div className={styles.columns}><section className={styles.card}><h3>{c.select}</h3><p className={styles.hint}>{c.endpointOnly}</p><div className={styles.field}><label htmlFor="model-search">{c.search}</label><input id="model-search" value={search} onChange={event => setSearch(event.currentTarget.value)} placeholder={c.search} /></div>
      <div className={styles.list}>{visible.length === 0 ? <p className={styles.empty}>{c.noSelection}</p> : visible.map(model => <label className={styles.choice} key={model.id}><input type="checkbox" checked={selected.has(model.id)} disabled={loading || existingIds.has(model.id)} onChange={event => { const checked = event.currentTarget.checked; setSelected(current => { const next = new Set(current); if (checked) next.add(model.id); else next.delete(model.id); return next; }); }} /><span>{model.name || model.id} {existingIds.has(model.id) ? `(${c.configured})` : ""}<br /><small className={styles.status}>{model.id}</small></span></label>)}</div>
      <div className={styles.field}><label htmlFor="model-manual">{c.manual}</label><div className={styles.actions}><input id="model-manual" disabled={loading} style={{ flex: 1 }} value={manual} onChange={event => setManual(event.currentTarget.value)} placeholder={c.manualId} /><button className={styles.button} disabled={loading} onClick={addManual}>{c.manualAdd}</button></div></div>
      <div className={`${styles.actions} ${styles.actionsEnd}`}><button className={styles.quiet} onClick={() => { setStep("connect"); setError(null); }} disabled={loading}>{c.previous}</button><button className={styles.primary} onClick={() => void complete()} disabled={loading || selected.size === 0}>{loading ? c.completing : c.next}</button></div>
    </section><aside className={styles.help}><h3>{c.selected} {selected.size} {c.selectedUnit}</h3><p className={styles.hint}>{c.limitsHint}</p></aside></div>}
    {step === "limits" && <section className={styles.card}><h3>{c.limits}</h3><p className={styles.hint}>{c.limitsHint}</p>{models.map((model, index) => modelLimitProblem(model) && <div key={model.id}><h3>{model.name || model.id}</h3><LimitInputs c={c} model={model} onChange={update => updateModel(index, update)} /></div>)}<div className={`${styles.actions} ${styles.actionsEnd}`}><button className={styles.quiet} onClick={() => { setStep("choose"); setError(null); }}>{c.previous}</button><button className={styles.primary} onClick={() => { if (validateLimits()) setStep("finish"); }}>{c.next}</button></div></section>}
    {step === "finish" && <section className={styles.card}><h3>{c.finishStep}</h3><p className={styles.hint}>{c.ready}</p>{models.map(model => { const source = (field: "contextWindow" | "maxTokens") => model.limitsMeta?.[field] === "models.dev" ? c.sourceCatalog : model.limitsMeta?.[field] === "endpoint" ? c.sourceEndpoint : c.sourceManual; return <div className={styles.modelRow} key={model.id}><div className={styles.modelName}><strong>{model.name || model.id}</strong><div className={styles.status}>{c.context}: {source("contextWindow")} · {c.output}: {source("maxTokens")}</div></div><button className={styles.button} onClick={() => void testModel(model)} disabled={loading || busy}>{loading ? c.testing : c.test}</button></div>; })}<p className={styles.hint}>{c.testHint}</p>{testStatus && <p role="status">{testStatus}</p>}<div className={`${styles.actions} ${styles.actionsEnd}`}><button className={styles.quiet} onClick={() => { setStep(hadMissingLimits ? "limits" : "choose"); setError(null); }} disabled={busy || loading}>{c.previous}</button><button className={styles.primary} onClick={() => void save()} disabled={busy || loading}>{busy ? c.saving : c.save}</button></div></section>}
    {step === "done" && <section className={styles.card}><h3>✓ {c.saved}</h3><p className={styles.hint}>{c.savedHint}</p><div className={styles.actionsEnd}><button className={styles.primary} onClick={onCancel}>{c.return}</button></div></section>}
    {error && <span className="sr-only">{error}</span>}
  </>;
}

function LimitInputs({ model, onChange, c }: { model: ModelEntry; onChange: (update: Partial<ModelEntry>) => void; c: Text }) {
  return <div className={styles.actions}><label className={styles.field} style={{ flex: 1 }}><span>{c.context}</span><input type="number" min="1" value={model.contextWindow ?? ""} onChange={event => onChange({ contextWindow: parseModelLimitDraft(event.currentTarget.value) })} /></label><label className={styles.field} style={{ flex: 1 }}><span>{c.output}</span><input type="number" min="1" value={model.maxTokens ?? ""} onChange={event => onChange({ maxTokens: parseModelLimitDraft(event.currentTarget.value) })} /></label><small className={styles.hint}>{c.limitHint}</small></div>;
}

function ModelEdit({ model, busy, c, onSave }: { model: ModelEntry; busy: boolean; c: Text; onSave: (next: ModelEntry) => Promise<void> }) {
  const [draft, setDraft] = useState(model);
  const [invalid, setInvalid] = useState(false);
  return <section className={styles.card}><h3>{c.edit}</h3><div className={styles.field}><label htmlFor="model-display-name">{c.nameLabel}</label><input id="model-display-name" value={draft.name ?? ""} onChange={event => setDraft({ ...draft, name: event.currentTarget.value || undefined })} /></div><p className={styles.hint}>{model.id}</p><LimitInputs model={draft} c={c} onChange={update => setDraft(current => ({ ...current, ...update }))} /><label><input type="checkbox" checked={draft.input?.includes("image") ?? false} onChange={event => setDraft({ ...draft, input: event.currentTarget.checked ? ["text", "image"] : ["text"] })} /> {c.image}</label>{invalid && <p className={styles.error} role="alert">{c.invalidLimits}</p>}<p className={styles.hint}>{c.costNotice}</p><div className={styles.actionsEnd}><button className={styles.primary} disabled={busy} onClick={() => { if (modelLimitProblem(draft)) { setInvalid(true); return; } setInvalid(false); void onSave(draft); }}>{busy ? c.saving : c.saveChanges}</button></div></section>;
}

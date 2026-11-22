"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { createDiscoveryAbort, requestDiscoveredModels, type DiscoveredModel } from "@/lib/model-discovery";
import {
  applyDiscoveredLimits,
  applyEndpointLimits,
  automaticModelLimitSources,
  customModelsMissingLimits,
  firstCustomModelSaveBlocker,
  stripModelLimitUiMeta,
} from "@/lib/model-limits";
import { prioritizeProvider } from "@/lib/model-policy";
import { AliIcon } from "./AliIcon";
import { requestConfirmation } from "./ConfirmDialog";
import { ModelErrorText } from "./ModelErrorText";
import styles from "./ModelsConfig.module.css";
import { AddProviderPicker } from "./models-config/AddProviderPicker";
import { ApiKeyDetail, OAuthDetail } from "./models-config/AuthDetails";
import { ManagedModelsList } from "./models-config/ManagedModelsList";
import { ModelDetail } from "./models-config/ModelDetail";
import { ProviderDetail } from "./models-config/ProviderDetail";
import { ProviderSidebarTree } from "./models-config/ProviderSidebarTree";
import {
  collectConfiguredModelRefs,
  configuredModelKey,
  type ApiKeyProvider,
  type ConfiguredModelRef,
  type ManagedModel,
  type ModelEntry,
  type ModelScopeResponse,
  type ModelsJson,
  type ModelTestState,
  type OAuthProvider,
  type ProviderEntry,
  type Selection,
} from "./models-config/types";
import { VisionAgentDetail } from "./models-config/VisionAgentDetail";

export {
  API_OPTIONS,
  type ApiKeyProvider,
  type ManagedModel,
  type ModelEntry,
  type ModelScopeResponse,
  type ModelsJson,
  type OAuthProvider,
  type ProviderEntry,
} from "./models-config/types";
export { ApiKeyDetail, OAuthDetail } from "./models-config/AuthDetails";
export { VisionAgentDetail } from "./models-config/VisionAgentDetail";

// ── Main component ────────────────────────────────────────────────────────────

export function ModelsConfig({
  cwd,
  onClose,
  onModelsChanged,
  embedded = false,
}: {
  cwd?: string;
  onClose: () => void;
  onModelsChanged?: () => void;
  embedded?: boolean;
}) {
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const [config, setConfig] = useState<ModelsJson>({ providers: {} });
  const [providerNameDrafts, setProviderNameDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadConfig, setReloadConfig] = useState(0);
  const [savedOk, setSavedOk] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const limitsBannerAbortRef = useRef<ReturnType<typeof createDiscoveryAbort> | null>(null);
  const limitsBannerUndoRef = useRef<ModelsJson | null>(null);
  const limitsBannerBusyRef = useRef(false);
  const [limitsBannerBusy, setLimitsBannerBusy] = useState(false);
  const [limitsBannerError, setLimitsBannerError] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<"connection" | "models">("connection");
  useEffect(() => setDetailTab("connection"), [selection]);
  const [oauthProviders, setOauthProviders] = useState<OAuthProvider[]>([]);
  const [apiKeyProviders, setApiKeyProviders] = useState<ApiKeyProvider[]>([]);
  const [oauthProvidersLoaded, setOauthProvidersLoaded] = useState(false);
  const [apiKeyProvidersLoaded, setApiKeyProvidersLoaded] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [modelScope, setModelScope] = useState<ModelScopeResponse | null>(null);
  const [modelScopeLoading, setModelScopeLoading] = useState(true);
  const [modelScopeError, setModelScopeError] = useState<string | null>(null);
  const [modelScopeBusyKey, setModelScopeBusyKey] = useState<string | null>(null);
  const [managedModelTests, setManagedModelTests] = useState<Record<string, ModelTestState>>({});
  const [modelImageInput, setModelImageInput] = useState<Record<string, boolean>>({});
  const [modelCapabilityBusyKey, setModelCapabilityBusyKey] = useState<string | null>(null);
  const modelScopeMutationRef = useRef(false);
  const modelScopeRequestRef = useRef(0);
  const persistedConfiguredModelKeysRef = useRef<Set<string>>(new Set());
  const persistedConfigRef = useRef<ModelsJson>({ providers: {} });
  const configMutationRef = useRef(false);
  const persistedProviderNamesRef = useRef(new Map<string, string>());
  const persistedModelTargetsRef = useRef(new WeakMap<ModelEntry, ConfiguredModelRef>());
  const rememberPersistedConfig = useCallback((saved: ModelsJson) => {
    persistedConfigRef.current = structuredClone(stripModelLimitUiMeta(saved));
    persistedProviderNamesRef.current = new Map();
    persistedModelTargetsRef.current = new WeakMap();
    for (const [provider, value] of Object.entries(saved.providers ?? {})) {
      persistedProviderNamesRef.current.set(provider, provider);
      for (const model of value.models ?? []) {
        if (model.id.trim()) persistedModelTargetsRef.current.set(model, { provider, id: model.id });
      }
    }
  }, []);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, !embedded, {
    onEscape: modelScopeBusyKey === null && !saving ? onClose : undefined,
  });

  const loadOAuthProviders = useCallback(() => {
    setOauthProvidersLoaded(false);
    fetch("/api/auth/providers")
      .then((r) => r.json())
      .then((d: { providers: OAuthProvider[] }) => setOauthProviders(d.providers))
      .catch(() => {})
      .finally(() => setOauthProvidersLoaded(true));
  }, []);

  const loadApiKeyProviders = useCallback(() => {
    setApiKeyProvidersLoaded(false);
    fetch("/api/auth/all-providers")
      .then((r) => r.json())
      .then((d: { providers: ApiKeyProvider[] }) => setApiKeyProviders(d.providers))
      .catch(() => {})
      .finally(() => setApiKeyProvidersLoaded(true));
  }, []);

  const loadModelScope = useCallback(async () => {
    const request = ++modelScopeRequestRef.current;
    setModelScopeLoading(true);
    setModelScopeError(null);
    try {
      const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
      const response = await fetch(`/api/models/scope${query}`, { cache: "no-store" });
      const body = await response.json() as ModelScopeResponse & { error?: string };
      if (!response.ok || body.error) throw new Error(body.error ?? `HTTP ${response.status}`);
      if (request === modelScopeRequestRef.current) setModelScope(body);
    } catch (error) {
      if (request === modelScopeRequestRef.current) {
        setModelScope(null);
        setModelScopeError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (request === modelScopeRequestRef.current) setModelScopeLoading(false);
    }
  }, [cwd]);

  const loadModelCapabilities = useCallback(async () => {
    try {
      const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
      const response = await fetch(`/api/model-capabilities${query}`);
      const body = await response.json() as { imageInput?: Record<string, boolean>; error?: string };
      if (!response.ok || body.error) throw new Error(body.error ?? `HTTP ${response.status}`);
      setModelImageInput(body.imageInput ?? {});
    } catch {
      setModelImageInput({});
    }
  }, [cwd]);

  const updateModelImageInput = useCallback(async (model: ManagedModel, imageInput: boolean) => {
    const key = `${model.provider}/${model.id}`;
    setModelCapabilityBusyKey(key);
    try {
      const response = await fetch("/api/model-capabilities", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(cwd ? { cwd } : {}), provider: model.provider, id: model.id, imageInput }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok || body.error) throw new Error(body.error ?? `HTTP ${response.status}`);
      setModelImageInput((current) => ({ ...current, [key]: imageInput }));
      onModelsChanged?.();
    } catch (error) {
      setModelScopeError(error instanceof Error ? error.message : String(error));
    } finally {
      setModelCapabilityBusyKey(null);
    }
  }, [cwd, onModelsChanged]);

  // A dual-auth provider moves between the two lists when its credential type
  // changes, so any auth change has to reload both — refreshing only one leaves
  // the provider rendered twice, and disconnecting the stale row would delete
  // the credential that was just created (#309).
  const refreshAuthProviders = useCallback(() => {
    loadOAuthProviders();
    loadApiKeyProviders();
  }, [loadOAuthProviders, loadApiKeyProviders]);

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    fetch("/api/models-config", { cache: "no-store" })
      .then(async (r) => { const data = await r.json(); if (!r.ok || data.error) throw new Error(data.error ?? `HTTP ${r.status}`); return data; })
      .then((d: ModelsJson) => {
        const normalized = d.providers ? d : { ...d, providers: {} };
        setConfig(normalized);
        rememberPersistedConfig(normalized);
        persistedConfiguredModelKeysRef.current = new Set(
          collectConfiguredModelRefs(normalized).map(configuredModelKey),
        );
      })
      .catch((error) => setLoadError(error instanceof Error ? error.message : String(error)))
      .finally(() => setLoading(false));
    refreshAuthProviders();
    void loadModelScope();
    void loadModelCapabilities();
  }, [loadModelCapabilities, loadModelScope, refreshAuthProviders, rememberPersistedConfig, reloadConfig]);

  useEffect(() => {
    setManagedModelTests({});
  }, [cwd]);

  const addCustomProvider = useCallback(() => {
    let finalName = "new-provider";
    let n = 1;
    while (config.providers?.[finalName]) finalName = `new-provider-${n++}`;
    setConfig((prev) => ({ ...prev, providers: { ...(prev.providers ?? {}), [finalName]: { api: "openai-completions" } } }));
    setSelection({ type: "provider", name: finalName });
  }, [config.providers]);

  const updateProvider = useCallback((name: string, p: ProviderEntry) => {
    setConfig((prev) => ({ ...prev, providers: { ...(prev.providers ?? {}), [name]: p } }));
  }, []);

  const reorderProviders = useCallback((source: string, target: string) => {
    if (source === target) return;
    setConfig((prev) => {
      const entries = Object.entries(prev.providers ?? {});
      const sourceIndex = entries.findIndex(([name]) => name === source);
      const targetIndex = entries.findIndex(([name]) => name === target);
      if (sourceIndex < 0 || targetIndex < 0) return prev;
      const [entry] = entries.splice(sourceIndex, 1);
      entries.splice(sourceIndex < targetIndex ? targetIndex - 1 : targetIndex, 0, entry);
      return { ...prev, providers: Object.fromEntries(entries) };
    });
    setSavedOk(false);
    setSaveError(null);
  }, []);

  const editProviderName = useCallback((name: string, value: string) => {
    setProviderNameDrafts((prev) => ({ ...prev, [name]: value }));
    setSavedOk(false);
    setSaveError(null);
  }, []);

  const persistDeletion = useCallback(async (target: { provider: string; id?: string } | undefined, apply: () => void) => {
    if (configMutationRef.current) return;
    configMutationRef.current = true;
    setSaving(true); setSaveError(null); setSavedOk(false);
    try {
      if (target) {
        const response = await fetch("/api/models-config", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(target) });
        const result = await response.json() as { success?: boolean; error?: string };
        if (!response.ok || !result.success) throw new Error(result.error ?? `HTTP ${response.status}`);
        for (const key of persistedConfiguredModelKeysRef.current) {
          if (target.id === undefined ? key.startsWith(`${target.provider}/`) : key === configuredModelKey({ provider: target.provider, id: target.id })) persistedConfiguredModelKeysRef.current.delete(key);
        }
      }
      apply(); setManagedModelTests({});
      if (target) { onModelsChanged?.(); refreshAuthProviders(); await loadModelScope(); }
    } catch (error) { setSaveError(error instanceof Error ? error.message : String(error)); }
    finally { configMutationRef.current = false; setSaving(false); }
  }, [loadModelScope, onModelsChanged, refreshAuthProviders]);

  const deleteProvider = useCallback((name: string) => {
    const provider = persistedProviderNamesRef.current.get(name);
    void persistDeletion(provider ? { provider } : undefined, () => {
      setConfig((prev) => { const providers = { ...(prev.providers ?? {}) }; delete providers[name]; return { ...prev, providers }; });
      setProviderNameDrafts((prev) => { const drafts = { ...prev }; delete drafts[name]; return drafts; });
      persistedProviderNamesRef.current.delete(name); setSelection(null);
    });
  }, [persistDeletion]);

  const addModel = useCallback((providerName: string) => {
    const index = config.providers?.[providerName]?.models?.length ?? 0;
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      const models = [...(provider.models ?? []), { id: "" }];
      return { ...prev, providers: { ...(prev.providers ?? {}), [providerName]: { ...provider, models } } };
    });
    setSelection({ type: "model", providerName, index });
  }, [config.providers]);

  const addDiscoveredModels = useCallback((providerName: string, discovered: DiscoveredModel[]) => {
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      const models = [...(provider.models ?? [])];
      const existingIds = new Set(models.map((model) => model.id));
      for (const discoveredModel of discovered) {
        if (existingIds.has(discoveredModel.id)) continue;
        existingIds.add(discoveredModel.id);
        const draft: ModelEntry = { id: discoveredModel.id };
        if (discoveredModel.name) draft.name = discoveredModel.name;
        models.push(applyEndpointLimits(draft, discoveredModel).model);
      }
      return { ...prev, providers: { ...(prev.providers ?? {}), [providerName]: { ...provider, models } } };
    });
  }, []);

  const updateModel = useCallback((providerName: string, index: number, m: ModelEntry) => {
    const previous = config.providers?.[providerName]?.models?.[index];
    const target = previous && persistedModelTargetsRef.current.get(previous);
    if (target) persistedModelTargetsRef.current.set(m, target);
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      const models = [...(provider.models ?? [])];
      models[index] = m;
      return { ...prev, providers: { ...(prev.providers ?? {}), [providerName]: { ...provider, models } } };
    });
  }, [config.providers]);

  const removeModel = useCallback((providerName: string, index: number) => {
    const model = config.providers?.[providerName]?.models?.[index];
    if (!model) return;
    const apply = () => {
      setConfig((prev) => {
        const provider = prev.providers?.[providerName] ?? {};
        const models = (provider.models ?? []).filter(entry => entry !== model);
        return { ...prev, providers: { ...(prev.providers ?? {}), [providerName]: { ...provider, models: models.length ? models : undefined } } };
      });
      setSelection({ type: "provider", name: providerName });
    };
    const target = persistedModelTargetsRef.current.get(model);
    // An incomplete new row has no disk identity and requires no API mutation.
    // It must remain removable even while another settings request is pending.
    if (!target) apply();
    else void persistDeletion(target, apply);
  }, [config.providers, persistDeletion]);

  const updateModelScope = useCallback(async (
    action: "set-default" | "hide" | "restore" | "hide-provider" | "restore-provider" | "restore-all" | "remove-provider" | "restore-removed-provider",
    target?: Pick<ManagedModel, "provider" | "id"> | { provider: string },
  ): Promise<boolean> => {
    if (modelScopeMutationRef.current) return false;
    modelScopeMutationRef.current = true;
    ++modelScopeRequestRef.current;
    setModelScopeLoading(false);
    const busyKey = action === "restore-all"
      ? "restore-all"
      : `${action}:${target?.provider ?? ""}${"id" in (target ?? {}) ? `/${(target as Pick<ManagedModel, "id">).id}` : ""}`;
    setModelScopeBusyKey(busyKey);
    setModelScopeError(null);
    try {
      const response = await fetch("/api/models/scope", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(cwd ? { cwd } : {}),
          action,
          ...(target ?? {}),
        }),
      });
      const body = await response.json() as ModelScopeResponse & { code?: string; error?: string };
      if (!response.ok || body.error) {
        const message = body.code === "last_model"
          ? t("models.lastVisibleModel")
          : body.code === "project_scope_override"
            ? t("models.projectScopeOverride")
            : body.error ?? `HTTP ${response.status}`;
        throw new Error(message);
      }
      setModelScope(body);
      if (action === "remove-provider") setSelection(null);
      if (
        (action === "hide" || action === "hide-provider")
        && target?.provider
        && body.models.some((model) => model.provider === target.provider)
        && body.models.filter((model) => model.provider === target.provider).every((model) => !model.enabled)
      ) {
        setSelection(null);
      }
      if (body.changed) onModelsChanged?.();
      return true;
    } catch (error) {
      setModelScopeError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      modelScopeMutationRef.current = false;
      setModelScopeBusyKey(null);
    }
  }, [cwd, onModelsChanged, t]);

  const handleManagedModelTest = useCallback(async (model: ManagedModel) => {
    const key = `${model.provider}/${model.id}`;
    if (managedModelTests[key]?.phase === "testing") return;
    setManagedModelTests((current) => ({ ...current, [key]: { phase: "testing" } }));
    try {
      const response = await fetch("/api/models-config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerName: model.provider,
          modelId: model.id,
          ...(cwd ? { cwd } : {}),
        }),
      });
      const body = await response.json() as {
        ok?: boolean;
        error?: string;
        latencyMs?: number;
        status?: number;
        responseText?: string;
      };
      const nextState: ModelTestState = response.ok && body.ok
        ? {
            phase: "success",
            latencyMs: body.latencyMs,
            status: body.status,
            responseText: body.responseText,
          }
        : {
            phase: "error",
            message: body.error ?? `HTTP ${response.status}`,
            latencyMs: body.latencyMs,
            status: body.status,
          };
      setManagedModelTests((current) => ({ ...current, [key]: nextState }));
    } catch (error) {
      setManagedModelTests((current) => ({
        ...current,
        [key]: {
          phase: "error",
          message: error instanceof Error ? error.message : String(error),
        },
      }));
    }
  }, [cwd, managedModelTests]);

  const refreshProviderState = useCallback(() => {
    setManagedModelTests({});
    refreshAuthProviders();
    void loadModelScope();
    onModelsChanged?.();
  }, [loadModelScope, onModelsChanged, refreshAuthProviders]);

  const handleSave = useCallback(async () => {
    if (configMutationRef.current) return;
    const blocker = firstCustomModelSaveBlocker(config.providers, { previous: persistedConfigRef.current });
    if (blocker) {
      const blocked = config.providers?.[blocker.providerName]?.models?.[blocker.index];
      setSelection({ type: "model", providerName: blocker.providerName, index: blocker.index });
      setDetailTab("connection");
      setSaveError(blocker.kind === "modelId"
        ? t("models.modelIdRequired")
        : blocker.kind === "sampling"
          ? t("models.sampling.invalid", { error: blocker.error })
          : t("models.limits.saveError", { model: `${blocker.providerName}/${blocked?.id?.trim() || blocker.index}` }));
      return;
    }
    // Keep names as drafts until the same save that persists the other fields.
    // Resolve all names together so collisions cannot silently drop a provider.
    const names = new Map<string, string>();
    const usedNames = new Set<string>();
    for (const name of Object.keys(config.providers ?? {})) {
      const nextName = Object.hasOwn(providerNameDrafts, name) ? providerNameDrafts[name].trim() : name;
      if (!nextName || usedNames.has(nextName)) {
        setSaveError(t(!nextName ? "models.providerNameRequired" : "models.providerNameDuplicate", { name: nextName }));
        return;
      }
      names.set(name, nextName);
      usedNames.add(nextName);
    }
    const configToSave = { ...config, providers: Object.fromEntries(
      Object.entries(config.providers ?? {}).map(([name, provider]) => [names.get(name) ?? name, provider]),
    ) };
    configMutationRef.current = true;
    const configuredModels = collectConfiguredModelRefs(configToSave);
    const newlyConfiguredModels = configuredModels.filter(
      (model) => !persistedConfiguredModelKeysRef.current.has(configuredModelKey(model)),
    );
    setSaving(true);
    setSaveError(null);
    setSavedOk(false);
    try {
      const res = await fetch("/api/models-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(stripModelLimitUiMeta(configToSave)),
      });
      const d = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || d.error) setSaveError(d.error ?? `HTTP ${res.status}`);
      else {
        // Notify mounted chat selectors immediately after the durable write,
        // even if the user leaves settings while scope synchronization runs.
        onModelsChanged?.();
        rememberPersistedConfig(configToSave);
        setConfig((current) => ({ ...current, providers: Object.fromEntries(
          Object.entries(current.providers ?? {}).map(([name, provider]) => [names.get(name) ?? name, provider]),
        ) }));
        setProviderNameDrafts((current) => Object.fromEntries(
          Object.entries(current)
            .filter(([name, value]) => value !== providerNameDrafts[name])
            .map(([name, value]) => [names.get(name) ?? name, value]),
        ));
        setSelection((current) => {
          if (current?.type === "provider" && names.get(current.name) !== current.name) return { ...current, name: names.get(current.name) ?? current.name };
          if (current?.type === "model" && names.get(current.providerName) !== current.providerName) return { ...current, providerName: names.get(current.providerName) ?? current.providerName };
          return current;
        });
        setManagedModelTests({});
        let scopeUpdated = true;
        for (const model of newlyConfiguredModels) {
          if (!await updateModelScope("restore", model)) scopeUpdated = false;
        }
        if (newlyConfiguredModels.length === 0) await loadModelScope();
        if (scopeUpdated) {
          persistedConfiguredModelKeysRef.current = new Set(configuredModels.map(configuredModelKey));
          setSavedOk(true);
          setTimeout(() => setSavedOk(false), 2000);
        } else {
          setSaveError(t("models.savedScopeRefreshFailed"));
        }
        refreshAuthProviders();
        onModelsChanged?.();
      }
    } catch (e) {
      setSaveError(String(e));
    } finally {
      configMutationRef.current = false;
      setSaving(false);
    }
  }, [config, providerNameDrafts, t, loadModelScope, onModelsChanged, refreshAuthProviders, updateModelScope, rememberPersistedConfig]);

  useEffect(() => () => {
    const current = limitsBannerAbortRef.current;
    limitsBannerAbortRef.current = null;
    current?.cancel();
    current?.dispose();
  }, []);

  const missingLimits = customModelsMissingLimits(config.providers, persistedConfigRef.current);
  const limitsFetchable = automaticModelLimitSources().includes("endpoint") && missingLimits.some(({ providerName }) => {
    const provider = config.providers?.[providerName];
    return Boolean(provider?.baseUrl?.trim() && provider.models?.some((model) => (
      model.id.trim() && (model.contextWindow === undefined || model.maxTokens === undefined)
    )));
  });

  const fetchMissingLimits = async () => {
    // Decision (a): the configured endpoint is the only automatic source.
    if (!automaticModelLimitSources().includes("endpoint") || limitsBannerBusyRef.current) return;
    const targets = Object.entries(config.providers ?? {}).filter(([, provider]) => (
      Boolean(provider.baseUrl?.trim()) && (provider.models ?? []).some((model) => (
        model.id.trim() && (model.contextWindow === undefined || model.maxTokens === undefined)
      ))
    ));
    if (targets.length === 0) {
      setLimitsBannerError(t("models.limits.fetchNeedsEndpoint"));
      return;
    }
    const previous = limitsBannerAbortRef.current;
    limitsBannerAbortRef.current = null;
    previous?.cancel();
    previous?.dispose();
    const discovery = createDiscoveryAbort();
    limitsBannerAbortRef.current = discovery;
    limitsBannerBusyRef.current = true;
    setLimitsBannerBusy(true);
    setLimitsBannerError(null);
    const discoveredByProvider: Record<string, DiscoveredModel[]> = {};
    const errors: string[] = [];
    await Promise.all(targets.map(async ([name, provider]) => {
      try {
        const data = await requestDiscoveredModels({ providerName: name, provider, signal: discovery.signal });
        discoveredByProvider[name] = data.models;
      } catch (error) {
        if (discovery.signal.aborted && !discovery.timedOut()) return;
        const message = discovery.timedOut()
          ? t("models.limits.fetchTimeout")
          : error instanceof Error ? error.message : String(error);
        errors.push(`${name}: ${message}`);
      }
    }));
    if (limitsBannerAbortRef.current !== discovery) {
      discovery.dispose();
      return;
    }
    setConfig((prev) => {
      const applied = applyDiscoveredLimits(prev.providers, discoveredByProvider);
      if (!applied.changed || !applied.providers) return prev;
      for (const [name, provider] of Object.entries(prev.providers ?? {})) {
        const nextModels = applied.providers?.[name]?.models;
        (provider.models ?? []).forEach((model, index) => {
          const next = nextModels?.[index];
          if (!next || next === model) return;
          const target = persistedModelTargetsRef.current.get(model);
          if (target) persistedModelTargetsRef.current.set(next, target);
        });
      }
      limitsBannerUndoRef.current = prev;
      return { ...prev, providers: applied.providers };
    });
    if (errors.length) setLimitsBannerError(errors.join("\n"));
    discovery.dispose();
    if (limitsBannerAbortRef.current === discovery) {
      limitsBannerAbortRef.current = null;
      limitsBannerBusyRef.current = false;
      setLimitsBannerBusy(false);
    }
  };

  const configuredProviders = prioritizeProvider(
    Object.entries(config.providers ?? {}),
    ([provider]) => provider,
  );
  const managedProviderIds = prioritizeProvider(
    [...new Set((modelScope?.models ?? []).map((model) => model.provider))],
    (provider) => provider,
  );
  const hiddenProviderIds = [...new Set([...(modelScope?.removedProviders ?? []), ...managedProviderIds.filter((providerId) => {
    const providerModels = (modelScope?.models ?? []).filter((model) => model.provider === providerId);
    return providerModels.length > 0 && providerModels.every((model) => !model.enabled);
  })])];
  const hiddenProviderIdSet = new Set(hiddenProviderIds);
  const providers = configuredProviders.filter(([provider]) => !hiddenProviderIdSet.has(provider));
  const activeOAuth = prioritizeProvider(
    oauthProviders.filter((p) => p.loggedIn && !hiddenProviderIdSet.has(p.id)),
    (provider) => provider.id,
  );
  const activeApiKey = prioritizeProvider(
    apiKeyProviders.filter((p) => p.configured && !hiddenProviderIdSet.has(p.id)),
    (provider) => provider.id,
  );
  const representedProviderIds = new Set([
    ...activeOAuth.map((provider) => provider.id),
    ...activeApiKey.map((provider) => provider.id),
    ...configuredProviders.map(([provider]) => provider),
  ]);
  const scopeOnlyProviderIds = managedProviderIds.filter((provider) =>
    !representedProviderIds.has(provider) && !hiddenProviderIdSet.has(provider));
  const hiddenProviders = hiddenProviderIds.filter(id => managedProviderIds.includes(id) || configuredProviders.some(([name]) => name === id)
    || apiKeyProviders.some(provider => provider.id === id) || oauthProviders.some(provider => provider.id === id)).map((providerId) => ({
    id: providerId,
    label: apiKeyProviders.find((provider) => provider.id === providerId)?.displayName
      ?? oauthProviders.find((provider) => provider.id === providerId)?.name
      ?? providerId,
  }));
  const firstApiKeyProviderId = activeApiKey[0]?.id;
  const firstOAuthProviderId = activeOAuth[0]?.id;
  const firstScopeOnlyProviderId = scopeOnlyProviderIds[0];
  const firstCustomProviderName = providers[0]?.[0];

  const removeManagedProvider = (id: string, name: string) => <button
    type="button" aria-label={t("models.removeProviderNamed", { name })} title={t("models.removeProvider")}
    disabled={modelScopeBusyKey !== null || saving}
    onClick={async event => {
      event.stopPropagation();
      if (!await requestConfirmation({ title: t("models.removeProvider"), message: t("models.removeProviderConfirm", { name }), confirmLabel: t("models.removeProvider"), tone: "danger" })) return;
      await updateModelScope("remove-provider", { provider: id });
    }}
    style={{ flexShrink: 0, display: "inline-flex", padding: 4, border: 0, background: "transparent", color: "var(--text-muted)", cursor: "pointer" }}
  ><AliIcon name="delete" size={13} /></button>;

  useEffect(() => {
    if (selection) return;
    if (!oauthProvidersLoaded || !apiKeyProvidersLoaded || modelScopeLoading) return;
    if (firstApiKeyProviderId) {
      setSelection({ type: "apikey", providerId: firstApiKeyProviderId });
      return;
    }
    if (firstOAuthProviderId) {
      setSelection({ type: "oauth", providerId: firstOAuthProviderId });
      return;
    }
    if (firstScopeOnlyProviderId) {
      setSelection({ type: "managed", providerId: firstScopeOnlyProviderId });
      return;
    }
    if (firstCustomProviderName) {
      setSelection({ type: "provider", name: firstCustomProviderName });
    }
  }, [apiKeyProvidersLoaded, firstApiKeyProviderId, firstCustomProviderName, firstOAuthProviderId, firstScopeOnlyProviderId, modelScopeLoading, oauthProvidersLoaded, selection]);

  const renderManagedModels = (providerId: string) => (
    <ManagedModelsList
      providerId={providerId}
      config={config}
      modelScope={modelScope}
      modelScopeLoading={modelScopeLoading}
      modelScopeError={modelScopeError}
      modelScopeBusyKey={modelScopeBusyKey}
      managedModelTests={managedModelTests}
      modelImageInput={modelImageInput}
      modelCapabilityBusyKey={modelCapabilityBusyKey}
      updateModelScope={updateModelScope}
      onUpdateModelImageInput={updateModelImageInput}
      onTestManagedModel={handleManagedModelTest}
      removeModel={removeModel}
    />
  );

  // Resolve current detail
  const detailContent = (() => {
    if (!selection) return null;
    if (selection.type === "vision-agent") return <div className={styles.visionPage}><VisionAgentDetail cwd={cwd} /></div>;
    const selectedProvider = selection.type === "provider" ? selection.name : selection.type === "model" ? selection.providerName : selection.providerId;
    if (selection.type === "managed" || (detailTab === "models" && selection.type !== "model")) return renderManagedModels(selectedProvider);
    if (selection.type === "oauth") {
      const p = oauthProviders.find((p) => p.id === selection.providerId);
      if (!p) return null;
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <OAuthDetail key={p.id} provider={p} onRefresh={refreshProviderState} />
        </div>
      );
    }
    if (selection.type === "apikey") {
      const p = apiKeyProviders.find((p) => p.id === selection.providerId);
      if (!p) return null;
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <ApiKeyDetail key={p.id} provider={p} onRefresh={refreshProviderState} />
        </div>
      );
    }
    if (selection.type === "provider") {
      const provider = config.providers?.[selection.name];
      if (!provider) return null;
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <ProviderDetail
            key={selection.name}
            name={selection.name}
            editingName={Object.hasOwn(providerNameDrafts, selection.name) ? providerNameDrafts[selection.name] : selection.name}
            provider={provider}
            onChange={(p) => updateProvider(selection.name, p)}
            onNameChange={(n) => editProviderName(selection.name, n)}
            onDelete={() => deleteProvider(selection.name)}
            onAddModels={(models) => addDiscoveredModels(selection.name, models)}
          />
        </div>
      );
    }
    const provider = config.providers?.[selection.providerName];
    const model = provider?.models?.[selection.index];
    if (!model) return null;
    return (
      <ModelDetail
        key={`${selection.providerName}-${selection.index}`}
        providerName={selection.providerName}
        provider={provider}
        model={model}
        onChange={(m) => updateModel(selection.providerName, selection.index, m)}
        onDelete={() => removeModel(selection.providerName, selection.index)}
      />
    );
  })();

  return (
    <>
    <div className={embedded ? undefined : "app-shell-dialog-backdrop"} style={{ position: embedded ? "relative" : "fixed", inset: embedded ? undefined : 0, zIndex: embedded ? undefined : 1000, width: "100%", height: "100%", minHeight: 0, background: embedded ? "var(--bg)" : "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (!embedded && e.target === e.currentTarget && modelScopeBusyKey === null && !saving) onClose(); }}>
      <div ref={dialogRef} className={`${styles.dialog} ${embedded ? "" : "app-shell-dialog"}`} role={embedded ? "region" : "dialog"} aria-modal={embedded ? undefined : true} aria-label={t("common.models")} style={{ width: embedded ? "100%" : isMobile ? "calc(100vw - 16px)" : 1100, maxWidth: embedded ? "none" : "calc(100vw - 16px)", height: embedded ? "100%" : isMobile ? "calc(100dvh - 16px)" : "88vh", maxHeight: embedded ? "none" : "calc(100dvh - 16px)", background: "var(--bg)", border: embedded ? "none" : "1px solid var(--border)", borderRadius: embedded ? 0 : 14, display: "flex", flexDirection: "column", boxShadow: embedded ? "none" : "0 8px 32px rgba(0,0,0,0.18)", overflow: "hidden" }}>

        {/* Header */}
        <div className={`app-shell-dialog-header ${styles.header}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
             <span className={styles.heading}><AliIcon name="setting" size={22} />{t("models.ui.title")}</span>
            <span className={styles.subtitle}>{t("models.form.subtitle")}</span>
          </div>
          {!embedded && <button onClick={onClose} disabled={modelScopeBusyKey !== null || saving} title={t("i18n.close")} aria-label={t("i18n.close")} style={{ display: "inline-flex", width: 28, height: 28, alignItems: "center", justifyContent: "center", background: "none", border: "none", borderRadius: "var(--radius-control)", color: "var(--text-muted)", cursor: modelScopeBusyKey !== null || saving ? "not-allowed" : "pointer", opacity: modelScopeBusyKey !== null || saving ? 0.55 : 1, padding: 0 }}><AliIcon name="close" size={16} /></button>}
        </div>

        {missingLimits.length > 0 && (
          <div data-model-limits-banner role="status" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "8px 18px", borderBottom: "1px solid var(--border)", background: "color-mix(in srgb, #ef4444 8%, var(--bg))", color: "#b91c1c", fontSize: "var(--text-xs)", lineHeight: 1.45, flexShrink: 0 }}>
            <span style={{ flex: "1 1 220px", minWidth: 0 }}>{t("models.limits.missingBanner", { count: missingLimits.length })}</span>
            {limitsFetchable && (
              <button type="button" onClick={() => void fetchMissingLimits()} disabled={limitsBannerBusy} style={{ height: 28, padding: "0 10px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-panel)", color: limitsBannerBusy ? "var(--text-dim)" : "var(--text)", cursor: limitsBannerBusy ? "not-allowed" : "pointer", fontSize: "var(--text-xs)" }}>
                {limitsBannerBusy ? t("models.limits.fetching") : t("models.limits.fetch")}
              </button>
            )}
            {limitsBannerUndoRef.current && (
              <button type="button" onClick={() => {
                const previous = limitsBannerUndoRef.current;
                if (!previous) return;
                limitsBannerUndoRef.current = null;
                setLimitsBannerError(null);
                setConfig(previous);
              }} style={{ padding: "0 2px", border: "none", background: "none", color: "var(--accent)", cursor: "pointer", fontSize: "var(--text-xs)" }}>
                {t("models.catalogUndo")}
              </button>
            )}
            {limitsBannerError && <span role="alert" style={{ flexBasis: "100%", whiteSpace: "pre-line" }}><ModelErrorText value={limitsBannerError} /></span>}
          </div>
        )}

        {/* Body */}
        <div inert={saving || loading || !!loadError} aria-busy={saving || loading} style={{ flex: 1, display: loadError ? "none" : "flex", flexDirection: isMobile ? "column" : "row", overflow: "hidden" }}>

          {/* Left: tree */}
          <ProviderSidebarTree
            isMobile={isMobile}
            loading={loading}
            saving={saving}
            selection={selection}
            onSelect={setSelection}
            onOpenPicker={() => setPickerOpen(true)}
            activeApiKey={activeApiKey}
            activeOAuth={activeOAuth}
            scopeOnlyProviderIds={scopeOnlyProviderIds}
            providers={providers}
            modelScope={modelScope}
            persistedModelTargets={persistedModelTargetsRef.current}
            renderRemoveManagedProvider={removeManagedProvider}
            onReorderProviders={reorderProviders}
            deleteProvider={deleteProvider}
            onAddModel={addModel}
            removeModel={removeModel}
          />

          {/* Right: detail */}
          <div className={styles.detail} style={{ flex: 1, overflowY: "auto", padding: 20 }}>
            <nav className={styles.tabs} aria-label={t("models.ui.sections")}>
              {selection?.type === "vision-agent" ? (
                <button aria-pressed="true">{t("models.ui.vision")}</button>
              ) : selection?.type === "model" || selection?.type === "managed" ? (
                <button aria-pressed="true"><AliIcon name="brain" size={17} />{t("models.ui.models")}</button>
              ) : selection ? (
                <>
                  <button aria-pressed={detailTab === "connection"} onClick={() => setDetailTab("connection")}><AliIcon name="link" size={17} />{t("models.ui.connection")}</button>
                  <button aria-pressed={detailTab === "models"} onClick={() => setDetailTab("models")}><AliIcon name="brain" size={17} />{t("models.ui.models")}</button>
                </>
              ) : null}
            </nav>
            {loading ? null : detailContent ?? (
              <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: "var(--text-base)" }}>
                 {t("i18n.selectProviderModel")}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        {loadError && <div role="alert" style={{ padding: 20, color: "#f87171", flex: 1 }}><ModelErrorText value={loadError} /><button onClick={() => setReloadConfig(n => n + 1)}>{t("common.retry")}</button></div>}
        <div className={styles.footer} style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, padding: "10px 18px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
          {modelScopeError && detailTab !== "models" && selection?.type !== "managed" && <span role="alert" style={{ fontSize: "var(--text-sm)", color: "#f87171", flex: 1 }}><ModelErrorText value={modelScopeError} /></span>}
          {saveError && <span role="alert" style={{ fontSize: "var(--text-sm)", color: "#f87171", flex: 1 }}>{<ModelErrorText value={saveError} />}</span>}
          {!embedded && <button onClick={onClose} disabled={modelScopeBusyKey !== null || saving} style={{ padding: "6px 14px", background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", color: "var(--text-muted)", cursor: modelScopeBusyKey !== null || saving ? "not-allowed" : "pointer", opacity: modelScopeBusyKey !== null || saving ? 0.55 : 1, fontSize: "var(--text-base)" }}>
             {t("i18n.close")}
          </button>}
          <button onClick={handleSave} disabled={saving || savedOk || loading || !!loadError} style={{
            position: "relative",
            padding: "6px 16px",
            minWidth: 92,
            background: savedOk ? "#16a34a" : saving ? "var(--bg-panel)" : "var(--accent)",
            border: "none", borderRadius: "var(--radius-control)",
            color: savedOk ? "#fff" : saving ? "var(--text-muted)" : "#fff",
            cursor: (saving || savedOk) ? "default" : "pointer", fontSize: "var(--text-base)", fontWeight: 600,
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
            transition: "background-color 0.2s ease, color 0.2s ease",
            animation: savedOk ? "saved-pop 0.45s ease" : undefined,
          }}>
            {savedOk && (
              <AliIcon name="check" size={14} style={{ animation: "saved-check-draw 0.35s ease forwards" }} />
            )}
             <span>{savedOk ? t("i18n.saved") : saving ? t("i18n.saving") : t("i18n.save")}</span>
          </button>
        </div>
      </div>
    </div>
    {pickerOpen && (
      <AddProviderPicker
        oauthProviders={oauthProviders}
        apiKeyProviders={apiKeyProviders}
        hiddenProviders={hiddenProviders}
        onSelectOAuth={(id) => setSelection({ type: "oauth", providerId: id })}
        onSelectApiKey={(id) => setSelection({ type: "apikey", providerId: id })}
        onRestoreProvider={async (id) => {
          const restored = modelScope?.removedProviders?.includes(id)
            ? await updateModelScope("restore-removed-provider", { provider: id })
            : await updateModelScope("restore-provider", { provider: id });
          if (!restored) return false;
          if (config.providers?.[id]) setSelection({ type: "provider", name: id });
          else if (apiKeyProviders.some((provider) => provider.id === id && provider.configured)) {
            setSelection({ type: "apikey", providerId: id });
          } else if (oauthProviders.some((provider) => provider.id === id && provider.loggedIn)) {
            setSelection({ type: "oauth", providerId: id });
          } else setSelection({ type: "managed", providerId: id });
          return true;
        }}
        onAddCustom={addCustomProvider}
        onClose={() => setPickerOpen(false)}
      />
    )}
    </>
  );
}

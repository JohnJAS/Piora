import type { SettingsManager } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { invalidateModelsCache, loadModelsWithCache, withModelRuntimeError, type ModelsData } from "@/lib/models-cache";
import { resolveVisibleModels, selectInitialModelScope } from "@/lib/model-scope";
import { prioritizeProvider, resolveDefaultModelPreference } from "@/lib/model-policy";
import {
  createTrustedModelServices,
  ModelRequestCwdError,
  resolveModelRequestCwd,
} from "@/lib/model-runtime-context";

export const dynamic = "force-dynamic";

async function loadModels(cwd: string): Promise<ModelsData> {
  const nameMap = new Map<string, string>();
  let modelList: { id: string; name: string; provider: string; contextWindow?: number }[] = [];
  let defaultModel: { provider: string; modelId: string } | null = null;
  const thinkingLevels: Record<string, string[]> = {};
  const thinkingLevelMaps: Record<string, Record<string, string | null>> = {};

  const services = await createTrustedModelServices(cwd);
  const modelError = services.modelRuntime.getError();
  const settings: SettingsManager = services.settingsManager;
  // `enabledModels` supports globs and fuzzy patterns, so resolve it the same
  // way the CLI does instead of comparing pattern strings literally (#307).
  const scope = await resolveVisibleModels(
    services.modelRuntime,
    settings.getEnabledModels(),
  );
  const { visible, thinkingLevelPins, warnings } = scope;
  const orderedVisible = prioritizeProvider(visible, (model) => model.provider);
  modelList = orderedVisible.map((m) => ({
    id: m.id,
    name: m.name,
    provider: m.provider,
    contextWindow: m.contextWindow,
  }));
  for (const m of orderedVisible) {
    const key = `${m.provider}:${m.id}`;
    nameMap.set(key, m.name);
    thinkingLevels[key] = getSupportedThinkingLevels(m);
    if (m.thinkingLevelMap) thinkingLevelMaps[key] = m.thinkingLevelMap;
  }

  const defaultProvider = settings.getDefaultProvider();
  const defaultModelId = settings.getDefaultModel();
  const preferredDefault = resolveDefaultModelPreference({
    models: visible,
    settingsProvider: defaultProvider,
    settingsModel: defaultModelId,
    environment: process.env,
  });
  const initial = selectInitialModelScope(scope, {
    ...(preferredDefault ? { defaultModel: preferredDefault } : {}),
  });
  if (initial.model) {
    defaultModel = { provider: initial.model.provider, modelId: initial.model.id };
  }

  return withModelRuntimeError(
    {
      models: Object.fromEntries(nameMap),
      modelList,
      defaultModel,
      thinkingLevels,
      thinkingLevelMaps,
      thinkingLevelPins,
      ...(warnings.length > 0 ? { modelScopeWarnings: warnings } : {}),
    },
    modelError,
  );
}

const EMPTY_MODELS: ModelsData = {
  models: {},
  modelList: [],
  defaultModel: null,
  thinkingLevels: {},
  thinkingLevelMaps: {},
  thinkingLevelPins: {},
};

export async function GET(req: Request) {
  const requestUrl = new URL(req.url);
  let cwd: string;
  try {
    cwd = await resolveModelRequestCwd(requestUrl.searchParams.get("cwd"));
  } catch (error) {
    if (error instanceof ModelRequestCwdError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  try {
    if (requestUrl.searchParams.get("refresh") === "1") invalidateModelsCache();
    return Response.json(await loadModelsWithCache(cwd, () => loadModels(cwd)));
  } catch (error) {
    const message = error instanceof Error && error.message.trim()
      ? error.message.trim().slice(0, 500)
      : "Unable to load the model catalog";
    return Response.json({ ...EMPTY_MODELS, modelError: message });
  }
}

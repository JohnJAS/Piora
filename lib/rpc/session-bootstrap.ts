import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  getAgentDir,
  initTheme,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  bindSessionAgentRuntimeProfile,
  quarantineUnboundSessionFile,
  readAgentProfileStore,
  resolveSessionAgentRuntimeProfile,
} from "../agent-profile-store";
import { assertCurrentAgentRuntimeProfile, getAgentRuntimeProfile } from "../agent-runtime-profile";
import { installAnalyticsFileObserver, installAnalyticsModelObserver } from "../analytics-telemetry";
import { installModelAwareCompactionSettings } from "../compaction-settings";
import { readDefaultModel } from "../default-model-store";
import { applyExtensionLoadPlan, installExtensionLoadPlanReload, resolveExtensionLoadPlan } from "../extension-config";
import { FILE_REFERENCE_INSTRUCTIONS } from "../file-references";
import { installImageContextPolicy } from "../image-context";
import { applyConfiguredImageInput } from "../model-capabilities";
import { readModelFallbackConfig } from "../model-fallback-config";
import { resolveDefaultModelPreference } from "../model-policy";
import { resolveVisibleModels, selectInitialModelScope } from "../model-scope";
import { installModelStallGuard } from "../model-stall-guard";
import { getNativeMcpController, NativeMcpController, setNativeMcpController } from "../native-mcp";
import type { AgentSessionLike } from "../pi-types";
import {
  projectToolPolicyHistory,
  projectToolSelection,
  readProjectToolSettings,
} from "../project-tool-settings";
import { installProviderPayloadValidation } from "../provider-payload";
import { readRemoteSessionPolicy, remotePolicyResources } from "../remote-session-policy";
import {
  appendSessionCapabilityPolicy,
  buildSessionCapabilityCatalog,
  createSessionCapabilityPolicy,
  restoreSessionCapabilityPolicy,
  selectionFromToolNames,
} from "../session-capabilities";
import { clearPendingSessionModel, readPendingSessionModel } from "../session-model-selection";
import { assertSessionNotMutating, drainSessionFileOperations } from "../session-mutation";
import { persistLazySessionManager } from "../session-persistence";
import { cacheSessionPath } from "../session-reader";
import {
  appendSessionSystemPromptBinding,
  buildSessionAppendSystemPrompt,
  createSessionSystemPromptBinding,
  readLatestSessionSystemPromptBinding,
  resolveSessionSystemPrompt,
} from "../session-system-prompt";
import { listSSHSessionSummariesForAgent, subscribeSSHRegistry } from "../ssh/session-manager";
import { readSystemPromptConfig } from "../system-prompt-config";
import { buildSideSystemInstructions } from "../side-chat/policy";
import { readSideChatSettings } from "../side-chat/settings";
import { isTemporarySideChatExpired, readSideChatMetaFromEntries } from "../side-chat/store";
import { readEffectiveToolPermission } from "../tool-approval-settings";
import { readDefaultToolPermission, writeToolPermission } from "../tool-permission-store";
import { DEVICE_CONTROL_AGENT_TOOLS, resolveAgentToolsForRuntimeProfile } from "../tool-presets";
import { ensureWindowsBashShellPath } from "../windows-bash";
import { resolveProject } from "../worktree";
import { getLocks, getRegistry, getServicesCache, trackStartingSession } from "./registry";
import { AgentSessionWrapper, registerRpcSessionStarter } from "./session-wrapper";
import type { RpcSessionStartOptions } from "./types";

/**
 * Get or create an AgentSession for the given session.
 * For new sessions (sessionFile === ""), pi generates its own id.
 * New sessions resolve enabledModels before construction so the initial model,
 * thinking pin, and SDK scopedModels share one settings snapshot.
 * Pass options.toolNames to pre-configure active tools (empty = all disabled).
 */
export async function startRpcSession(
  sessionId: string,
  sessionFile: string,
  cwd: string,
  options: RpcSessionStartOptions = {},
): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
  assertSessionNotMutating(sessionId);
  const { initialModel, thinkingLevel, capabilitySelection, systemPromptSelection } = options;
  const processRuntimeProfile = getAgentRuntimeProfile();
  const runtimeProfile = options.runtimeProfile ?? processRuntimeProfile;
  assertCurrentAgentRuntimeProfile(runtimeProfile);
  if (sessionFile) {
    await resolveSessionAgentRuntimeProfile(sessionId, runtimeProfile);
  } else {
    // Validate the authoritative store before the SDK creates a new session
    // file. Device-control never falls back to an unbound session.
    readAgentProfileStore();
  }
  const toolNames = resolveAgentToolsForRuntimeProfile(runtimeProfile, options.toolNames);
  assertSessionNotMutating(sessionId);
  const registry = getRegistry();
  const locks = getLocks();

  const existing = registry.get(sessionId);
  if (existing?.isAlive()) {
    if (existing.runtimeProfile !== runtimeProfile) {
      throw new Error(`Live session ${sessionId} has a mismatched or unknown runtime profile.`);
    }
    return { session: existing, realSessionId: sessionId };
  }

  const lockKey = `${runtimeProfile}:${sessionId}`;
  const inflight = locks.get(lockKey);
  if (inflight) return inflight;

  const sessionServicesKey = `${runtimeProfile}:${sessionId}`;
  let startupInner: AgentSessionLike | undefined;
  let startupWrapper: AgentSessionWrapper | undefined;
  const finishStartingSession = trackStartingSession(cwd);
  const starting = (async () => {
    // destroy() removes the live wrapper before its async writers and extension
    // shutdown settle. Fence a replacement so those callbacks cannot touch its
    // newly attached workflow or overwrite the session it is about to restore.
    await drainSessionFileOperations([sessionId]);
    assertSessionNotMutating(sessionId);
    // Some extensions access the SDK's global theme even outside the terminal UI.
    initTheme();
    const agentDir = getAgentDir();
    const projectRoot = (await resolveProject(cwd)).projectRoot;
    assertSessionNotMutating(sessionId);
    if (sessionFile && !existsSync(sessionFile)) throw new Error("Session file no longer exists");
    const projectToolRecord = readProjectToolSettings(projectRoot);

    const sessionManager = sessionFile
      ? SessionManager.open(sessionFile, undefined)
      : options.preparedSessionFile
        ? SessionManager.open(options.preparedSessionFile, undefined)
        : SessionManager.create(cwd, options.subagentDirectory);

    if (options.preparedSessionFile && (sessionManager.getSessionId() !== sessionId
      || resolve(sessionManager.getCwd()) !== resolve(cwd)
      || readRemoteSessionPolicy(sessionManager.getEntries()) !== options.remotePolicy)) {
      throw new Error("Prepared remote session identity or policy does not match the creation request.");
    }

    if (!sessionFile && options.remotePolicy === "notes") {
      if (runtimeProfile !== "normal") throw new Error("Notes-only sessions require the normal process runtime");
      if (readRemoteSessionPolicy(sessionManager.getEntries()) !== "notes") sessionManager.appendCustomEntry("piora-remote-policy", { policy: "notes" });
    }
    const remotePolicy = readRemoteSessionPolicy(sessionManager.getEntries());
    const notesOnly = remotePolicy === "notes";
    const sideChatMeta = readSideChatMetaFromEntries(sessionManager.getEntries());
    if (sideChatMeta) {
      if (runtimeProfile !== "normal") {
        throw new Error("Side conversations require the normal runtime profile.");
      }
      if (!readSideChatSettings().enabled) {
        throw new Error("Side Chat is disabled in Settings → Laboratory.");
      }
      const persistedFile = sessionFile || sessionManager.getSessionFile();
      if (persistedFile && existsSync(persistedFile) && isTemporarySideChatExpired(sideChatMeta, statSync(persistedFile).mtimeMs)) {
        throw new Error("This temporary side chat has expired.");
      }
    }

    if (
      runtimeProfile === "normal"
      && !readLatestSessionSystemPromptBinding(sessionManager.getEntries())
    ) {
      appendSessionSystemPromptBinding(
        sessionManager,
        createSessionSystemPromptBinding(!sessionFile && systemPromptSelection
          ? systemPromptSelection
          : { mode: "default" }),
      );
    }

    // Determine which tools to pass based on requested toolNames.
    // Since v0.68.0, session creation expects string[] tool names instead of Tool[] instances.
    let toolsOption: string[] | undefined;
    if (notesOnly) {
      toolsOption = [];
    } else if (runtimeProfile === "device-control") {
      // Passing the exact allow-list prevents built-in coding tools from even
      // entering the AgentSession registry. This is stronger than merely
      // marking them inactive after extensions have loaded.
      toolsOption = toolNames ?? [...DEVICE_CONTROL_AGENT_TOOLS];
    } else {
      // Normal sessions always register every globally available tool. Session
      // capabilities narrow only the active set so a disabled tool can be
      // re-enabled later without rebuilding the AgentSession.
      toolsOption = undefined;
    }

    // Build services first so extension-registered providers are available
    // before the SDK restores the saved model from the session file.
    // Services belong to this session only: extension runtime bindings are
    // mutable and must never be shared with another task in the same cwd.
    let services = getServicesCache().get(sessionServicesKey);
    if (!services && notesOnly) {
      services = await createAgentSessionServices({ cwd, agentDir, settingsManager: SettingsManager.create(cwd, agentDir), resourceLoaderOptions: remotePolicyResources(remotePolicy) });
      getServicesCache().set(sessionServicesKey, services);
    }
    if (!services) {
      const settingsManager = SettingsManager.create(cwd, agentDir);
      const extensionPlan = await resolveExtensionLoadPlan({ cwd, agentDir, settingsManager, profile: runtimeProfile, installMissing: true });
      const nativeMcp = runtimeProfile === "normal" ? new NativeMcpController(cwd, agentDir) : undefined;
      services = await createAgentSessionServices({
        cwd,
        agentDir,
        settingsManager,
        ...(runtimeProfile === "device-control"
          ? {
              resourceLoaderOptions: {
                additionalExtensionPaths: extensionPlan.enabledPaths,
                noExtensions: true,
                noSkills: true,
                noPromptTemplates: true,
                noThemes: true,
                noContextFiles: true,
                systemPromptOverride: () => undefined,
                appendSystemPromptOverride: () => [],
                agentsFilesOverride: () => ({ agentsFiles: [] }),
                extensionsOverride: (result) => applyExtensionLoadPlan(result, extensionPlan),
              },
            }
          : {
              resourceLoaderOptions: {
                additionalExtensionPaths: extensionPlan.enabledPaths,
                noExtensions: true,
                extensionFactories: nativeMcp?.factories,
                extensionsOverride: (result) => applyExtensionLoadPlan(result, extensionPlan),
                systemPromptOverride: (base) => resolveSessionSystemPrompt(
                  sessionManager.getEntries(),
                  base,
                  readSystemPromptConfig(),
                ),
                appendSystemPromptOverride: (baseAppend) => buildSessionAppendSystemPrompt(baseAppend, {
                  fileReferenceInstructions: FILE_REFERENCE_INSTRUCTIONS,
                  subagentSystemPrompt: options.subagentSystemPrompt,
                  sideChatInstructions: sideChatMeta
                    ? buildSideSystemInstructions(sideChatMeta.storage, sideChatMeta.parentSessionId)
                    : undefined,
                }),
              },
            }),
      });
      installExtensionLoadPlanReload(services.resourceLoader, extensionPlan, async () => {
        await settingsManager.reload();
        return resolveExtensionLoadPlan({ cwd, agentDir, settingsManager, profile: runtimeProfile, installMissing: true });
      });
      if (nativeMcp) setNativeMcpController(services, nativeMcp);
      if (runtimeProfile === "device-control") {
        if (
          services.resourceLoader.getSkills().skills.length > 0
          || services.resourceLoader.getPrompts().prompts.length > 0
          || services.resourceLoader.getAgentsFiles().agentsFiles.length > 0
          || services.resourceLoader.getSystemPrompt() !== undefined
          || services.resourceLoader.getAppendSystemPrompt().length > 0
        ) {
          throw new Error("The device-control resource loader admitted user skills, prompts, system prompts, or context files.");
        }
      }
      getServicesCache().set(sessionServicesKey, services);
    }
    if (runtimeProfile === "normal") ensureWindowsBashShellPath(services.settingsManager);
    // Fail stalled model requests as retryable timeouts instead of hanging the
    // session on a silently dead provider stream. Installed per services
    // instance and idempotent across cached reuse.
    // Also cover sessions that were being constructed when global settings changed.
    await services.settingsManager.reload();
    installModelAwareCompactionSettings(services.settingsManager);
    installProviderPayloadValidation(services.modelRuntime);
    installAnalyticsModelObserver(services.modelRuntime, "chat");
    installModelStallGuard(services.modelRuntime, process.env, services.settingsManager);
    const scope = await resolveVisibleModels(
      services.modelRuntime,
      services.settingsManager.getEnabledModels(),
    );
    if (scope.providerRestricted && !scope.visible.length) throw new Error("没有可用渠道，请在模型设置中添加或恢复渠道。");
    const defaultProvider = services.settingsManager.getDefaultProvider();
    const defaultModelId = services.settingsManager.getDefaultModel();
    const preferredDefault = resolveDefaultModelPreference({
      models: scope.visible,
      explicitDefault: readDefaultModel(),
      settingsProvider: defaultProvider,
      settingsModel: defaultModelId,
      environment: process.env,
    });
    const pendingModel = readPendingSessionModel(sessionId);
    const initial = sessionFile && !pendingModel
      ? { scopedModels: [...scope.scopedModels] }
      : selectInitialModelScope(scope, {
          allowUnavailableRequestedModel: options.allowModelFallback !== false && readModelFallbackConfig().enabled,
          ...(pendingModel ? { requestedModel: pendingModel } : initialModel ? { requestedModel: initialModel } : {}),
          ...(preferredDefault ? { defaultModel: preferredDefault } : {}),
          ...(thinkingLevel ? { thinkingLevel } : {}),
        });
    const { session: inner } = await createAgentSessionFromServices({
      services,
      sessionManager,
      ...(initial.model ? { model: initial.model } : {}),
      ...(initial.thinkingLevel ? { thinkingLevel: initial.thinkingLevel } : {}),
      ...(initial.scopedModels.length > 0 ? { scopedModels: initial.scopedModels } : {}),
      ...(toolsOption !== undefined ? { tools: toolsOption } : {}),
    });
    startupInner = inner;
    installAnalyticsFileObserver(inner, cwd, inner.sessionId);
    // The SDK stream function reads this from SettingsManager on every request.
    // Leave the Agent override unset so its startup snapshot cannot mask updates.
    inner.agent.maxRetryDelayMs = undefined;
    installImageContextPolicy(inner.agent);
    if (pendingModel && inner.model?.provider === pendingModel.provider && inner.model.id === pendingModel.modelId) {
      await inner.setModel(applyConfiguredImageInput(inner.model));
      persistLazySessionManager(inner.sessionManager);
      clearPendingSessionModel(sessionId, pendingModel.revision);
    }
    if (inner.model) {
      const configuredModel = applyConfiguredImageInput(inner.model);
      // Do not re-select an unchanged restored model: packaged smoke tests use
      // an intentionally credential-less placeholder model, and a redundant
      // setModel would turn that harmless placeholder into an API-key lookup.
      if (configuredModel !== inner.model) await inner.setModel(configuredModel);
    }

    const nativeMcp = getNativeMcpController(services);
    const capabilityCatalog = [...buildSessionCapabilityCatalog(inner.getAllTools().map(tool => ({
      ...tool,
      defaultActive: inner.getToolDefinition?.(tool.name)?.defaultActive,
      ...(nativeMcp?.isNativeTool(tool.name) ? { defaultEnabled: true } : {}),
    })), runtimeProfile), ...nativeMcp?.resourceCatalog() ?? []];
    const restoredPolicy = projectToolRecord
      ? createSessionCapabilityPolicy(
          projectToolSelection(projectToolRecord),
          capabilityCatalog,
          runtimeProfile,
          projectToolRecord.revision - 1,
          projectToolPolicyHistory(projectToolRecord),
        )
      : options.subagentParent && toolNames !== undefined
        ? createSessionCapabilityPolicy(
            selectionFromToolNames(toolNames, capabilityCatalog),
            capabilityCatalog,
            runtimeProfile,
          )
        : sessionFile
          ? restoreSessionCapabilityPolicy(inner.sessionManager.getEntries(), capabilityCatalog, runtimeProfile)
          : createSessionCapabilityPolicy(
              capabilitySelection ?? (toolNames !== undefined ? selectionFromToolNames(toolNames, capabilityCatalog) : undefined),
              capabilityCatalog,
              runtimeProfile,
            );
    if (!sessionFile && !projectToolRecord) appendSessionCapabilityPolicy(inner.sessionManager, restoredPolicy);

    const realSessionId = inner.sessionId as string;
    // Existing chats retain their previous behavior until explicitly changed.
    // Forks get a new id and never inherit their parent's grant.
    if (!sessionFile) {
      writeToolPermission(
        realSessionId,
        options.subagentParent ? readEffectiveToolPermission(options.subagentParent.sessionId, getAgentDir()).mode : readDefaultToolPermission(getAgentDir()),
        getAgentDir(),
      );
    }
    if (!sessionFile && initialModel && inner.model
      && (initialModel.provider !== inner.model.provider || initialModel.modelId !== inner.model.id)) {
      await inner.sendCustomMessage({
        customType: "piora-model-fallback",
        content: `Requested model ${initialModel.provider}/${initialModel.modelId} is unavailable. Starting this task with ${inner.model.provider}/${inner.model.id}.`,
        display: true,
        details: { from: `${initialModel.provider}/${initialModel.modelId}`, to: `${inner.model.provider}/${inner.model.id}`, attempt: 1 },
      }, { triggerTurn: false });
    }
    const realSessionFile = inner.sessionFile as string | undefined;
    try {
      await bindSessionAgentRuntimeProfile(realSessionId, runtimeProfile);
    } catch (error) {
      if (!sessionFile && realSessionFile) quarantineUnboundSessionFile(realSessionFile);
      throw error;
    }

    const wrapper = new AgentSessionWrapper(inner, runtimeProfile, {
      policy: restoredPolicy,
      projectRoot,
      projectManaged: Boolean(projectToolRecord),
      nativeMcp,
      subagentParent: options.subagentParent,
      sideChatMeta,
      ...(notesOnly ? { toolNameCeiling: [] } : toolNames !== undefined ? { toolNameCeiling: toolNames } : {}),
    });
    startupWrapper = wrapper;
    nativeMcp?.bind(
      name => wrapper.isToolAllowedByCapability(name),
      server => wrapper.isMcpResourceServerAllowed(server),
      () => wrapper.refreshNativeMcpCapabilities(),
    );
    wrapper.onDestroy(() => {
      if (registry.get(realSessionId) === wrapper) registry.delete(realSessionId);
      // A disposed AgentSession owns the ResourceLoader/runtime binding held by
      // its service bundle. Never reuse that bundle after the wrapper dies.
      getServicesCache().delete(sessionServicesKey);
    });
    wrapper.initializeSessionCapabilities();
    wrapper.start();

    if (realSessionFile) cacheSessionPath(realSessionId, realSessionFile);

    registry.set(realSessionId, wrapper);
    let previousSSHInventory = JSON.stringify(listSSHSessionSummariesForAgent(realSessionId).map(item => [item.id, item.connected]));
    const unsubscribeSSH = subscribeSSHRegistry((owner) => {
      if (owner && owner !== realSessionId) return;
      const current = JSON.stringify(listSSHSessionSummariesForAgent(realSessionId).map(item => [item.id, item.connected]));
      if (current === previousSSHInventory) return;
      previousSSHInventory = current;
      if (!inner.isStreaming || !inner.getActiveToolNames().includes("ssh")) return;
      const available = listSSHSessionSummariesForAgent(realSessionId).map(item => item.id + " | " + (item.hostName || item.host) + " | " + (item.connected ? "connected" : "disconnected")).join("\n");
      void inner.sendCustomMessage({
        customType: "piora-ssh-availability",
        content: "SSH connections linked to this task changed. Call ssh sessions for the current list.\n" + (available || "None."),
        display: false,
      }, { deliverAs: "steer", triggerTurn: true }).catch(error => console.error("[pi-web] SSH availability update failed:", error));
    });
    wrapper.onDestroy(unsubscribeSSH);
    wrapper.beginExtensionBinding({ forceEmptySystemPrompt: inner.getActiveToolNames().length === 0 });

    return { session: wrapper, realSessionId };
  })().catch(async (error) => {
    // Model selection, profile binding and capability setup can fail after
    // allocating services or an SDK session. A retry must start with clean
    // extension bindings, and failed starts must not retain their histories.
    getServicesCache().delete(sessionServicesKey);
    try {
      if (startupWrapper) {
        startupWrapper.destroy();
        await startupWrapper.shutdownForFileMutation();
      } else if (startupInner) {
        try { await startupInner.extensionRunner.emit?.({ type: "session_shutdown", reason: "shutdown" }); }
        finally { startupInner.dispose?.(); }
      }
    } catch (cleanupError) {
      console.error("[pi-web] Failed session startup cleanup:", cleanupError instanceof Error ? cleanupError.message : cleanupError);
    }
    throw error;
  }).finally(() => {
    locks.delete(lockKey);
    finishStartingSession();
  });

  locks.set(lockKey, starting);
  return starting;
}

registerRpcSessionStarter(startRpcSession);

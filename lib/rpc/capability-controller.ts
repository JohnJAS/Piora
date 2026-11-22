import type { AgentRuntimeProfile } from "../agent-runtime-profile";
import { readLaboratorySettings } from "../laboratory-settings";
import { type NativeMcpController, nativeMcpResourceCapabilityId } from "../native-mcp";
import type { AgentSessionLike, ToolInfo } from "../pi-types";
import {
  projectToolPolicyHistory,
  projectToolSelection,
  type ProjectToolSettingsRecord,
} from "../project-tool-settings";
import type { RemoteSessionPolicy } from "../remote-session-policy";
import {
  appendSessionCapabilityPolicy,
  buildSessionCapabilitiesState,
  buildSessionCapabilityCatalog,
  createSessionCapabilityPolicy,
  resolveSessionCapabilityToolNames,
  restoreSessionCapabilityPolicy,
  selectionFromToolNames,
  type SessionCapabilitiesState,
  type SessionCapabilityPolicy,
  type SessionCapabilitySelection,
} from "../session-capabilities";
import { invalidateSessionListCache } from "../session-reader";
import { readSideChatSettings } from "../side-chat/settings";
import { isSideChatTool, type SideChatMetaEntry } from "../side-chat/types";
import { readSubagentSettings } from "../subagent-settings";
import { isSubagentTool } from "../subagent-types";
import { isWorkflowTool } from "../workflow-tools";
import type { AgentEvent } from "./types";

export interface CapabilityControllerHost {
  readonly runtimeProfile: AgentRuntimeProfile;
  readonly remotePolicy: RemoteSessionPolicy;
  getInner: () => AgentSessionLike;
  isAlive: () => boolean;
  isRunning: () => boolean;
  assertSessionIdle: (action: string) => void;
  getPermissionParent: () => { isToolAllowedByCapability: (name: string) => boolean } | undefined;
  getSideChatMeta?: () => SideChatMetaEntry | undefined;
  setForceEmptySystemPrompt: (force: boolean) => void;
  applyForcedEmptySystemPrompt: () => void;
  emit: (event: AgentEvent) => void;
}

export interface CapabilityControllerOptions {
  policy?: SessionCapabilityPolicy;
  toolNameCeiling?: readonly string[];
  projectManaged?: boolean;
  nativeMcp?: NativeMcpController;
}

export class SessionCapabilityController {
  private capabilityPolicy: SessionCapabilityPolicy;
  private capabilityCatalog: ReturnType<typeof buildSessionCapabilityCatalog>;
  private toolNameCeiling: Set<string> | undefined;
  private capabilitiesInitialized = false;
  private pendingProjectCapabilityPolicy: SessionCapabilityPolicy | null = null;
  private pendingProjectAllowedToolNames: Set<string> | null = null;
  private projectAllowedToolNames: Set<string> | undefined;
  private projectManaged: boolean;
  readonly nativeMcp?: NativeMcpController;

  constructor(
    private readonly host: CapabilityControllerHost,
    options: CapabilityControllerOptions = {},
  ) {
    const inner = host.getInner();
    this.nativeMcp = options.nativeMcp;
    this.nativeMcp?.captureActiveTools([...inner.getActiveToolNames(), ...(inner.settingsManager?.getDefaultTools?.() ?? [])]);
    this.capabilityCatalog = [...buildSessionCapabilityCatalog(inner.getAllTools().map(tool => ({
      ...tool,
      defaultActive: inner.getToolDefinition?.(tool.name)?.defaultActive,
      ...(this.nativeMcp?.isNativeTool(tool.name) ? { defaultEnabled: true } : {}),
    })), host.runtimeProfile), ...this.nativeMcp?.resourceCatalog() ?? []];
    this.capabilityPolicy = options.policy
      ?? restoreSessionCapabilityPolicy(inner.sessionManager.getEntries(), this.capabilityCatalog, host.runtimeProfile);
    this.toolNameCeiling = host.remotePolicy === "notes"
      ? new Set<string>()
      : options.toolNameCeiling
        ? new Set(options.toolNameCeiling)
        : undefined;
    this.projectManaged = options.projectManaged === true;
    if (this.projectManaged) {
      this.projectAllowedToolNames = new Set([
        ...resolveSessionCapabilityToolNames(this.capabilityCatalog, this.capabilityPolicy, inner.getAllTools().map(tool => tool.name)),
        ...this.capabilityPolicy.enabledCapabilityIds.filter(id => id.startsWith("tool:")).map(id => id.slice(5)),
      ]);
    }
  }

  getPolicy(): SessionCapabilityPolicy {
    return this.capabilityPolicy;
  }

  private refreshCapabilityCatalog(): void {
    const inner = this.host.getInner();
    this.capabilityCatalog = [...buildSessionCapabilityCatalog(inner.getAllTools().map(tool => ({
      ...tool,
      defaultActive: inner.getToolDefinition?.(tool.name)?.defaultActive,
      ...(this.nativeMcp?.isNativeTool(tool.name) ? { defaultEnabled: true } : {}),
    })), this.host.runtimeProfile), ...this.nativeMcp?.resourceCatalog() ?? []];
  }

  isToolAllowedByCapability(name: string): boolean {
    if (!this.host.isAlive() || this.host.remotePolicy === "notes") return false;
    const permissionParent = this.host.getPermissionParent();
    if (permissionParent && !permissionParent.isToolAllowedByCapability(name)) return false;
    const sideChatMeta = this.host.getSideChatMeta?.();
    if (isSideChatTool(name)) return Boolean(sideChatMeta) && this.automaticWorkflowToolNames().includes(name);
    if (sideChatMeta && (isSubagentTool(name) || isWorkflowTool(name))) return false;
    if (sideChatMeta?.storage === "temporary" && name === "piora_automation") return false;
    if (isSubagentTool(name)) return this.automaticWorkflowToolNames().includes(name);
    if (isWorkflowTool(name)) return this.automaticWorkflowToolNames().includes(name);
    this.refreshCapabilityCatalog();
    const permitted = resolveSessionCapabilityToolNames(
      this.capabilityCatalog,
      this.capabilityPolicy,
      this.host.getInner().getAllTools().map(tool => tool.name),
      this.toolNameCeiling,
    );
    // Room coordination is enabled by internal Team admission, independently
    // of project workspace tools. It still requires an active capability.
    return permitted.includes(name) && (name === "piora_room" || !this.projectAllowedToolNames || this.projectAllowedToolNames.has(name));
  }

  isMcpResourceServerAllowed(server: string): boolean {
    return this.host.isAlive() && this.host.remotePolicy !== "notes" && this.host.runtimeProfile === "normal"
      && this.capabilityPolicy.enabledCapabilityIds.includes(nativeMcpResourceCapabilityId(server));
  }

  refreshNativeMcpCapabilities(): void {
    if (!this.host.isAlive()) return;
    this.applySessionCapabilities();
    this.host.emit({ type: "capabilities_changed", capabilities: this.getSessionCapabilities() });
  }

  private resolveCapabilityTools(
    policy: SessionCapabilityPolicy,
  ): { policy: SessionCapabilityPolicy; toolNames: string[] } {
    const sideChatMeta = this.host.getSideChatMeta?.();
    const baseToolNames = resolveSessionCapabilityToolNames(
      this.capabilityCatalog,
      policy,
      this.host.getInner().getAllTools().map(tool => tool.name),
      this.toolNameCeiling,
    ).filter(name => !(sideChatMeta?.storage === "temporary" && name === "piora_automation"));
    const requestedToolNames = [...baseToolNames, ...this.automaticWorkflowToolNames()];
    const toolNames = this.nativeMcp?.declarationNames(requestedToolNames, policy.preset === "custom") ?? requestedToolNames;
    return { policy, toolNames };
  }

  private automaticWorkflowToolNames(): string[] {
    if (this.host.runtimeProfile !== "normal" || this.host.remotePolicy === "notes") return [];
    if (this.host.getPermissionParent()) return [];
    const sideChatMeta = this.host.getSideChatMeta?.();
    if (sideChatMeta) {
      let sideChatEnabled = false;
      try { sideChatEnabled = readSideChatSettings().enabled; } catch { /* Invalid configuration fails closed. */ }
      if (!sideChatEnabled) return [];
      return this.host.getInner().getAllTools()
        .filter(tool => isSideChatTool(tool.name) && tool.exposure !== "hidden" && (!this.toolNameCeiling || this.toolNameCeiling.has(tool.name)))
        .map(tool => tool.name);
    }
    // Corrupt Laboratory settings must not break ordinary Agent chats. Workflow
    // admission still reports the settings error through its existing guard.
    let workflows = false, subagents = false;
    try { workflows = readLaboratorySettings().planGoalEnabled; } catch { /* Invalid configuration fails closed. */ }
    try { subagents = readSubagentSettings().enabled; } catch { /* Invalid configuration fails closed. */ }
    return this.host.getInner().getAllTools().filter(tool => ((workflows && isWorkflowTool(tool.name)) || (subagents && isSubagentTool(tool.name)))
      && tool.exposure !== "hidden" && (!this.toolNameCeiling || this.toolNameCeiling.has(tool.name)))
      .map(tool => tool.name);
  }

  applySessionCapabilities(): void {
    this.capabilitiesInitialized = true;
    this.refreshCapabilityCatalog();
    if (this.host.runtimeProfile === "normal" && this.capabilityPolicy.preset === "coding") {
      this.capabilityPolicy = {
        ...this.capabilityPolicy,
        enabledCapabilityIds: [...new Set([...this.capabilityPolicy.enabledCapabilityIds,
          ...this.capabilityCatalog.filter(item => item.available && item.defaultEnabled).map(item => item.id)])].sort(),
      };
      if (this.projectManaged) {
        this.projectAllowedToolNames = new Set(this.capabilityPolicy.enabledCapabilityIds
          .filter(id => id.startsWith("tool:")).map(id => id.slice(5)));
      }
    }
    const resolved = this.resolveCapabilityTools(this.capabilityPolicy);
    this.capabilityPolicy = resolved.policy;
    this.host.setForceEmptySystemPrompt(resolved.toolNames.length === 0);
    this.host.getInner().setActiveToolsByName(resolved.toolNames);
    this.host.applyForcedEmptySystemPrompt();
  }

  reapplySessionCapabilities(): void {
    // Bare SDK wrappers can retain their original prompt/loadout. Lifecycle
    // refreshes only reapply a capability policy once the host has installed it.
    if (this.capabilitiesInitialized) this.applySessionCapabilities();
    else this.host.applyForcedEmptySystemPrompt();
  }

  getSessionCapabilities(): SessionCapabilitiesState {
    this.refreshCapabilityCatalog();
    return buildSessionCapabilitiesState(
      this.capabilityCatalog,
      this.capabilityPolicy,
      this.host.getInner().getActiveToolNames(),
    );
  }

  initializeSessionCapabilities(): void {
    this.applySessionCapabilities();
  }

  applyProjectCapabilitySettings(record: ProjectToolSettingsRecord): "applied" | "deferred" {
    this.refreshCapabilityCatalog();
    const policy = createSessionCapabilityPolicy(
      projectToolSelection(record),
      this.capabilityCatalog,
      this.host.runtimeProfile,
      record.revision - 1,
      { ...this.capabilityPolicy, knownCapabilityIds: [...this.capabilityPolicy.knownCapabilityIds, ...projectToolPolicyHistory(record).knownCapabilityIds] },
    );
    const resolved = this.resolveCapabilityTools(policy);
    const projectAllowedToolNames = new Set([
      ...resolveSessionCapabilityToolNames(this.capabilityCatalog, resolved.policy, this.host.getInner().getAllTools().map(tool => tool.name)),
      ...resolved.policy.enabledCapabilityIds.filter(id => id.startsWith("tool:")).map(id => id.slice(5)),
    ]);
    this.projectManaged = true;
    if (this.host.isRunning()) {
      this.pendingProjectCapabilityPolicy = resolved.policy;
      this.pendingProjectAllowedToolNames = projectAllowedToolNames;
      return "deferred";
    }
    this.capabilityPolicy = resolved.policy;
    this.projectAllowedToolNames = projectAllowedToolNames;
    this.pendingProjectCapabilityPolicy = null;
    this.pendingProjectAllowedToolNames = null;
    this.applySessionCapabilities();
    this.host.emit({ type: "capabilities_changed", capabilities: this.getSessionCapabilities() });
    invalidateSessionListCache();
    return "applied";
  }

  flushPendingProjectCapabilitySettings(): void {
    if (!this.pendingProjectCapabilityPolicy || this.host.isRunning()) return;
    this.capabilityPolicy = this.pendingProjectCapabilityPolicy;
    if (this.pendingProjectAllowedToolNames) this.projectAllowedToolNames = this.pendingProjectAllowedToolNames;
    this.pendingProjectCapabilityPolicy = null;
    this.pendingProjectAllowedToolNames = null;
    this.applySessionCapabilities();
    this.host.emit({ type: "capabilities_changed", capabilities: this.getSessionCapabilities() });
    invalidateSessionListCache();
  }

  updateSessionCapabilities(selection: SessionCapabilitySelection): SessionCapabilitiesState {
    if (this.projectManaged) {
      throw new Error("Tools are managed by this project's settings.");
    }
    this.host.assertSessionIdle("change session tools");
    if (
      selection.expectedRevision !== undefined
      && selection.expectedRevision !== this.capabilityPolicy.revision
    ) {
      throw new Error("Session tools changed in another view. Refresh and try again.");
    }
    const nextPolicy = createSessionCapabilityPolicy(
      selection,
      this.capabilityCatalog,
      this.host.runtimeProfile,
      this.capabilityPolicy.revision,
      this.capabilityPolicy,
    );
    this.refreshCapabilityCatalog();
    const resolved = this.resolveCapabilityTools(nextPolicy);
    this.capabilityPolicy = resolved.policy;
    appendSessionCapabilityPolicy(this.host.getInner().sessionManager, this.capabilityPolicy);
    this.applySessionCapabilities();
    const capabilities = this.getSessionCapabilities();
    this.host.emit({ type: "capabilities_changed", capabilities });
    invalidateSessionListCache();
    return capabilities;
  }

  getToolsSummary(): Array<{ name: string; description: string; active: boolean }> {
    const inner = this.host.getInner();
    const all: ToolInfo[] = inner.getAllTools();
    const active = new Set<string>(inner.getActiveToolNames());
    return all.map((t) => ({
      name: t.name,
      description: t.description,
      active: active.has(t.name),
    }));
  }

  setTools(rawToolNames: unknown): SessionCapabilitiesState {
    const requested = Array.isArray(rawToolNames)
      ? rawToolNames.filter((name): name is string => typeof name === "string")
      : [];
    return this.updateSessionCapabilities(selectionFromToolNames(requested, this.capabilityCatalog));
  }

  setCapabilities(command: Record<string, unknown>): SessionCapabilitiesState {
    const preset = command.preset;
    if (preset !== "chat" && preset !== "coding" && preset !== "research" && preset !== "device" && preset !== "custom") {
      throw new Error("Invalid session tool preset.");
    }
    const enabledCapabilityIds = Array.isArray(command.enabledCapabilityIds)
      ? command.enabledCapabilityIds.filter((id): id is string => typeof id === "string")
      : undefined;
    const expectedRevision = command.expectedRevision;
    if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || Number(expectedRevision) < 0)) {
      throw new Error("Invalid session tool revision.");
    }
    return this.updateSessionCapabilities({
      preset,
      ...(enabledCapabilityIds ? { enabledCapabilityIds } : {}),
      ...(expectedRevision !== undefined ? { expectedRevision: Number(expectedRevision) } : {}),
    });
  }

  setTeamTools(rawToolNames: unknown): null {
    this.host.assertSessionIdle("change Team tools");
    if (this.host.runtimeProfile !== "normal") throw new Error("Team Agent tools require the normal runtime profile.");
    const available = new Set(this.host.getInner().getAllTools().map((tool) => tool.name));
    const requested = Array.isArray(rawToolNames)
      ? rawToolNames.filter((name): name is string => typeof name === "string")
      : [];
    const exact = [...new Set([...requested, "piora_room"])];
    if (exact.some((name) => !available.has(name))) throw new Error("Team tool allowlist contains an unavailable tool.");
    // Every Team needs its coordination protocol, including projects whose
    // coding/chat preset does not select it. Keep project restrictions on
    // all actual workspace tools; do not expand the project's saved policy.
    if (this.projectAllowedToolNames && exact.some((name) => name !== "piora_room" && !this.projectAllowedToolNames?.has(name))) {
      throw new Error("Team tool allowlist contains a tool disabled by project settings.");
    }
    const previousCeiling = this.toolNameCeiling;
    this.toolNameCeiling = new Set(exact);
    const nextPolicy = createSessionCapabilityPolicy(
      selectionFromToolNames(exact, this.capabilityCatalog),
      this.capabilityCatalog,
      this.host.runtimeProfile,
      this.capabilityPolicy.revision,
      this.capabilityPolicy,
    );
    this.refreshCapabilityCatalog();
    let resolved: { policy: SessionCapabilityPolicy; toolNames: string[] };
    try {
      resolved = this.resolveCapabilityTools(nextPolicy);
    } catch (error) {
      this.toolNameCeiling = previousCeiling;
      throw error;
    }
    this.capabilityPolicy = resolved.policy;
    this.applySessionCapabilities();
    return null;
  }
}

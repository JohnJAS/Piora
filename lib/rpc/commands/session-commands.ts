import { getAgentDir, SessionManager, type SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import { bindSessionAgentRuntimeProfile, quarantineUnboundSessionFile } from "../../agent-profile-store";
import { createChatCommandCatalog, templateUsesArguments } from "../../chat-command-input";
import { invalidateModelsCache } from "../../models-cache";
import { finishPromptRun } from "../../prompt-run-registry";
import { notifyRunningChange } from "../../rpc-running-status";
import { appendSessionCapabilityPolicy, copySessionCapabilityPolicy } from "../../session-capabilities";
import type { SessionRpcCommand } from "../../session-command-policy";
import { createConversationFork } from "../../session-fork";
import { runSessionFileOperation } from "../../session-mutation";
import { cacheSessionPath, invalidateSessionListCache } from "../../session-reader";
import { summarizeLiveSessionStats } from "../../session-stats";
import {
  appendSessionSystemPromptBinding,
  copySessionSystemPromptBinding,
  createSessionSystemPromptBinding,
} from "../../session-system-prompt";
import { readDefaultToolPermission, writeToolPermission } from "../../tool-permission-store";
import { parseWorkflowAction, parseWorkflowPromptOptions, parseWorkflowRevision } from "../../workflow-input";
import { readWorkflowSnapshot, WorkflowError } from "../../workflow-runtime";
import type { RpcCommandHost } from "./host";

export function handleWorkflowConfigureCommand(host: RpcCommandHost, command: SessionRpcCommand) {
  host.assertWorkflowSession();
  host.assertSessionIdle("change workflow mode");
  const options = parseWorkflowPromptOptions(command.workflow);
  if (!options) throw new WorkflowError("Workflow selection is required", "INVALID_WORKFLOW", 400);
  host.capabilities.reapplySessionCapabilities();
  const snapshot = host.observeWorkflow().configure({ ...options, expectedRevision: parseWorkflowRevision(command.expectedRevision) });
  return { snapshot, promptStarted: false };
}

export async function handleWorkflowActionCommand(host: RpcCommandHost, command: SessionRpcCommand) {
  host.assertWorkflowSession();
  const action = parseWorkflowAction(command.workflowAction);
  if (["approve", "resume"].includes(action.action)) {
    throw new WorkflowError("Execution decisions must use the workflow command queue", "INVALID_WORKFLOW", 400);
  }
  if (!["pause", "cancel", "set_budget", "edit_goal", "replace_goal"].includes(action.action)) host.assertSessionIdle("change workflow state");
  const workflow = host.observeWorkflow();
  workflow.action(action);
  if (["pause", "cancel", "replace_goal"].includes(action.action) && host.isRunning()) await host.send({ type: "abort" });
  return { snapshot: workflow.getSnapshot(), promptStarted: false };
}

export function handleWorkflowSavePlanCommand(host: RpcCommandHost, command: SessionRpcCommand) {
  host.assertWorkflowSession();
  const runId = typeof command.runId === "string" ? command.runId : "";
  const markdown = typeof command.markdown === "string" ? command.markdown : "";
  const expectedRevision = typeof command.expectedRevision === "number"
    ? parseWorkflowRevision(command.expectedRevision)
    : undefined;
  const workflow = host.observeWorkflow();
  const snapshot = workflow.savePlanMarkdown(runId, markdown, expectedRevision);
  return { snapshot };
}

export function handleForkCommand(host: RpcCommandHost, command: SessionRpcCommand) {
  return runSessionFileOperation(host.sessionId, async () => {
    host.assertSessionIdle("fork");
    const entryId = command.entryId as string;
    const sessionManager = host.inner.sessionManager;
    const currentSessionFile = host.inner.sessionFile;

    if (!sessionManager.isPersisted()) return { cancelled: true };
    if (!currentSessionFile) throw new Error("Persisted session is missing a session file");

    const sessionDir = sessionManager.getSessionDir();
    const newSessionFile = createConversationFork(currentSessionFile, sessionDir, entryId, command.includeEntry === true);

    const newSessionId = SessionManager.open(newSessionFile, sessionDir).getSessionId();
    writeToolPermission(newSessionId, readDefaultToolPermission(getAgentDir()), getAgentDir());
    const forkedManager = SessionManager.open(newSessionFile, sessionDir);
    appendSessionCapabilityPolicy(forkedManager, copySessionCapabilityPolicy(host.capabilities.getPolicy()));
    const sourceSystemPromptBinding = host.getSystemPromptBinding()
      ?? createSessionSystemPromptBinding({ mode: "default" });
    appendSessionSystemPromptBinding(
      forkedManager,
      copySessionSystemPromptBinding(sourceSystemPromptBinding),
    );
    invalidateSessionListCache();
    try {
      await bindSessionAgentRuntimeProfile(newSessionId, host.runtimeProfile);
    } catch (profileError) {
      quarantineUnboundSessionFile(newSessionFile);
      invalidateSessionListCache();
      throw profileError;
    }
    cacheSessionPath(newSessionId, newSessionFile);
    invalidateSessionListCache();
    await finishPromptRun(host.activePromptRun, "fork");
    host.activePromptRun = undefined;
    host.destroy();
    return { cancelled: false, newSessionId, runtimeProfile: host.runtimeProfile };
  });
}

export async function handleNavigateTreeCommand(host: RpcCommandHost, command: SessionRpcCommand) {
  host.assertSessionIdle("navigate");
  const result = await host.inner.navigateTree(command.targetId as string, {});
  notifyRunningChange();
  return { cancelled: result.cancelled };
}

export function handleGetSessionStatsCommand(host: RpcCommandHost) {
  return {
    ...summarizeLiveSessionStats(host.inner.sessionManager),
    contextUsage: host.inner.getContextUsage() ?? undefined,
    sessionName: host.cachedSessionTitle ?? undefined,
  };
}

export function handleGetCommandsCommand(host: RpcCommandHost) {
  const commands: SlashCommandInfo[] = [];
  for (const registered of host.inner.extensionRunner.getRegisteredCommands()) {
    commands.push({
      name: registered.invocationName,
      description: registered.description,
      source: "extension",
      sourceInfo: registered.sourceInfo,
    });
  }
  for (const template of host.inner.promptTemplates) {
    commands.push({
      name: template.name,
      description: template.description,
      source: "prompt",
      sourceInfo: template.sourceInfo,
    });
  }
  for (const skill of host.inner.resourceLoader.getSkills().skills) {
    commands.push({
      name: `skill:${skill.name}`,
      description: skill.description,
      source: "skill",
      sourceInfo: skill.sourceInfo,
    });
  }
  const catalog = createChatCommandCatalog(commands.map(item => {
    const template = item.source === "prompt" ? host.inner.promptTemplates.find(candidate => candidate.name === item.name) : undefined;
    return {
      ...item,
      ...(template?.argumentHint ? { argumentHint: template.argumentHint } : {}),
      ...(template?.content !== undefined ? { usesTemplateArguments: templateUsesArguments(template.content) } : {}),
    };
  }));
  return { commands, catalog };
}

export async function handleReloadCommand(host: RpcCommandHost) {
  host.assertSessionIdle("reload");
  await host.waitForExtensionsBound();
  host.uiBridge.clearStatusesAndWidgets();
  await host.inner.reload();
  if (typeof host.inner.bindExtensions !== "function") {
    host.inner.extensionRunner.setUIContext?.(host.uiBridge.createExtensionUiContext(), "rpc");
  }
  host.capabilities.applySessionCapabilities();
  invalidateModelsCache();
  return { success: true };
}

export async function handleBashCommand(host: RpcCommandHost, command: SessionRpcCommand) {
  if (host.promptRunning || host.inner.isStreaming || host.inner.isCompacting || host.inner.isBashRunning) {
    throw new Error("Cannot run a shell command while the session is busy");
  }
  const selection = parseWorkflowPromptOptions(command.workflow);
  const workflow = readWorkflowSnapshot(host.sessionId);
  if ((selection?.mode ?? workflow.mode) !== "agent") {
    throw new WorkflowError("Switch to Agent mode before running a shell command.", "WORKFLOW_SHELL_COMMAND", 409);
  }
  if (selection && workflow.mode !== "agent") {
    host.assertWorkflowSession();
    host.observeWorkflow().configure({ ...selection, expectedRevision: workflow.revision });
  }
  host.beginRun("command", command.command);
  const execution = host.inner.executeBash(
    command.command as string,
    (chunk: string) => host.emit({ type: "bash_output", output: chunk }),
    { excludeFromContext: command.excludeFromContext as boolean | undefined },
  );
  notifyRunningChange();
  try {
    const result = await execution;
    host.persistSessionFile();
    return result;
  } finally {
    invalidateSessionListCache();
    host.capabilities.flushPendingProjectCapabilitySettings();
    notifyRunningChange();
  }
}

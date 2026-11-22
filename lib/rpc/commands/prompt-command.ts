import { randomUUID } from "node:crypto";
import { omitFailedPromptHistory } from "../../failed-prompt-context";
import { validateAgentImages } from "../../image-attachments";
import { applyConfiguredImageInput, modelSupportsImages } from "../../model-capabilities";
import { runPromptWithModelFallback } from "../../model-fallback";
import { readModelFallbackConfig } from "../../model-fallback-config";
import { invalidateModelsCache } from "../../models-cache";
import { beginPromptFileChanges, finishPromptFileChanges } from "../../prompt-file-changes";
import type { PromptMaterialReference } from "../../prompt-material-format";
import { buildPromptWithMaterials, resolvePromptMaterialReferences } from "../../prompt-materials";
import { beginPromptRun, finishPromptRun } from "../../prompt-run-registry";
import { readRemovedProviders } from "../../removed-providers";
import { assertRoomSessionIsolated, getRoom } from "../../room-store";
import { notifyRunningChange } from "../../rpc-running-status";
import { compactTaskActivityText } from "../../rpc-task-activity";
import type { SessionRpcCommand } from "../../session-command-policy";
import type { SessionMessageSourceKind, SessionRoomContext } from "../../session-message-types";
import { clearPendingSessionModel, readPendingSessionModel } from "../../session-model-selection";
import { invalidateSessionListCache } from "../../session-reader";
import { TeamError } from "../../team-errors";
import { bindTeamPromptContext, validateTeamExecutionContext } from "../../team-prompt-context";
import type { TeamExecutionContext } from "../../team-types";
import { parseWorkflowAction, parseWorkflowPromptOptions } from "../../workflow-input";
import { findWorkflowRuntime, getWorkflowRuntime, WorkflowError } from "../../workflow-runtime";
import type { RpcCommandHost } from "./host";

function validatePromptOrQueueImages(
  host: RpcCommandHost,
  type: "prompt" | "steer" | "follow_up",
  command: SessionRpcCommand,
): void {
  const imageError = validateAgentImages(command.images);
  if (imageError) throw new Error(imageError);
  if (Array.isArray(command.images) && command.images.length > 0) {
    // Ordinary prompts apply pending project models and fresh capability
    // settings below. Validate that target, not the previous live model.
    // Steering/follow-ups still belong to the currently running model.
    const isNewTurn = type === "prompt" && !command.streamingBehavior;
    const pending = isNewTurn ? readPendingSessionModel(host.sessionId) : undefined;
    const targetModel = pending
      ? host.inner.modelRuntime.getModel(pending.provider, pending.modelId)
      : isNewTurn && host.inner.model
        ? host.inner.modelRuntime.getModel(host.inner.model.provider, host.inner.model.id) ?? host.inner.model
        : host.inner.model;
    if (!(isNewTurn ? modelSupportsImages(targetModel) : targetModel?.input?.includes("image"))) {
      throw new Error("The selected model does not support image input. Choose an image-capable model.");
    }
  }
}

export function preflightPromptOrQueueCommand(
  host: RpcCommandHost,
  type: "prompt" | "steer" | "follow_up",
  command: SessionRpcCommand,
  abortGeneration: number,
): Promise<void> | void {
  if (host.stopping || abortGeneration !== host.abortGeneration) {
    throw new Error("Cannot send a prompt while the session is busy stopping");
  }
  // Custom model edits update the catalog, while live sessions retain a
  // private runtime and model object. Refresh before image admission too.
  if (type === "prompt" && !command.streamingBehavior) {
    host.assertSessionIdle("send a prompt");
    if (host.inner.model && readRemovedProviders().includes(host.inner.model.provider)) {
      throw new Error("当前渠道已移除，请选择其他模型或在模型设置中恢复该渠道。");
    }
    return (async () => {
      await host.inner.modelRuntime.refresh({ allowNetwork: false });
      host.assertSessionIdle("send a prompt");
      if (!host.isAlive() || abortGeneration !== host.abortGeneration) throw new Error("Prompt cancelled");
      const configError = host.inner.modelRuntime.getError?.();
      if (configError) throw new Error(configError);
      validatePromptOrQueueImages(host, type, command);
    })();
  }
  validatePromptOrQueueImages(host, type, command);
}

export async function handlePromptCommand(
  host: RpcCommandHost,
  command: SessionRpcCommand,
  abortGeneration: number,
): Promise<null> {
  if (host.stopping || abortGeneration !== host.abortGeneration) {
    throw new Error("Cannot send a prompt while the session is busy stopping");
  }
  if (!host.isAlive()) {
    throw new Error("Prompt cancelled");
  }
  if (host.inner.model && readRemovedProviders().includes(host.inner.model.provider)) {
    throw new Error("当前渠道已移除，请选择其他模型或在模型设置中恢复该渠道。");
  }
  // Fire and forget — events come via subscribe
  const promptImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
  const promptMaterials = command.materials as PromptMaterialReference[] | undefined;
  const streamingBehavior = command.streamingBehavior as "steer" | "followUp" | undefined;
  if (!streamingBehavior) {
    host.assertSessionIdle("send a prompt");
    if (host.promptAdmissionBusy) throw new Error("Cannot send a prompt while the session is starting another prompt");
    // A new submission must not revive requests that exhausted retries.
    // Keep raw chat rows while excluding those turns from SDK context.
    if (omitFailedPromptHistory(host.inner.sessionManager)) host.persistSessionFile();
    host.abortedQueuedMessages = undefined;
  }
  const teamExecution = command.teamExecution as TeamExecutionContext | undefined;
  const roomContext = command.roomContext as SessionRoomContext | undefined;
  if (command.source === "room" || teamExecution || roomContext) {
    const roomId = teamExecution?.roomId ?? roomContext?.roomId;
    if (!roomId) throw new TeamError("TEAM_INVALID_CONTEXT", "Room context is required.");
    assertRoomSessionIsolated(roomId, host.sessionId);
  }
  if (teamExecution && streamingBehavior) throw new Error("Team execution context cannot be attached to a follow-up prompt.");
  if (!streamingBehavior && command.source === "room" && !host.inner.getActiveToolNames().includes("piora_room")) {
    if (teamExecution) validateTeamExecutionContext(teamExecution, host.sessionId);
    const roomId = teamExecution?.roomId ?? roomContext?.roomId;
    const member = roomId ? getRoom(roomId).members.find((candidate) => candidate.binding.sessionId === host.sessionId) : undefined;
    if (!member) throw new TeamError("TEAM_INVALID_CONTEXT", "Room prompt requires a current member binding.");
    // Reused ordinary sessions can inherit a coding preset without the
    // collaboration tool. Enable it only for authenticated room admission;
    // set_team_tools still enforces project restrictions and tool budgets.
    await host.send({
      type: "set_team_tools",
      toolNames: member.profile.toolPolicy.mode === "allowlist" ? member.profile.toolPolicy.toolNames : host.inner.getActiveToolNames(),
    });
    if (!host.isAlive() || host.stopping || abortGeneration !== host.abortGeneration) {
      throw new Error("Prompt cancelled");
    }
  }
  if (teamExecution) host.validateTeamRuntimePolicy(teamExecution);
  const commandId = typeof command.commandId === "string" && command.commandId.trim()
    ? command.commandId.trim()
    : `cmd_${randomUUID()}`;
  let originalPromptMessage = String(command.message ?? "");
  const workflowSelection = parseWorkflowPromptOptions(command.workflow);
  host.assertWorkflowExtensionCommand(originalPromptMessage, command.inputMode, workflowSelection?.mode);
  let preparedWorkflow: ReturnType<typeof getWorkflowRuntime> | undefined;
  const prepareWorkflow = () => {
    if (streamingBehavior || !(command.workflow || command.workflowAction || findWorkflowRuntime(host.sessionId))) return;
    const selection = workflowSelection;
    const decision = command.workflowAction === undefined ? undefined : parseWorkflowAction(command.workflowAction);
    const workflow = host.observeWorkflow();
    const current = workflow.getSnapshot();
    if ((selection && selection.mode !== "agent") || decision || current.mode !== "agent") {
      host.assertWorkflowSession();
      if (command.source && command.source !== "ui") throw new WorkflowError("Workflow execution requires an ordinary chat submission.", "WORKFLOW_UNAVAILABLE", 403);
      host.capabilities.reapplySessionCapabilities();
    }
    if (selection && (selection.mode !== current.mode || (selection.turnBudget !== undefined && selection.turnBudget !== current.turnBudget))) workflow.configure(selection);
    if (decision) {
      const result = workflow.action(decision);
      if (!result.prompt) throw new WorkflowError("This workflow decision has already been applied.");
      originalPromptMessage = result.prompt;
      preparedWorkflow = workflow;
    }
    workflow.preparePrompt(originalPromptMessage, selection?.resumePausedGoal ? { resumePausedGoal: true } : undefined);
    preparedWorkflow = workflow;
  };
  const resolvedPromptMaterials = promptMaterials?.length ? resolvePromptMaterialReferences(promptMaterials) : [];
  const promptText = compactTaskActivityText(originalPromptMessage);
  host.fallbackTaskTitle = compactTaskActivityText(originalPromptMessage, 80) || host.fallbackTaskTitle;
  const isSlashCommand = !promptImages?.length && !promptMaterials?.length && originalPromptMessage.trimStart().startsWith("/");
  if (!streamingBehavior || host.getRuntime() === "idle") {
    host.beginRun("prompt", promptText || "Processing request", isSlashCommand ? "running_command" : "waiting_model");
  }
  host.lastPromptFailed = false;
  host.lastPromptErrorSummary = undefined;
  const ownsPromptRun = !streamingBehavior || !host.activePromptRun;
  const promptSource = command.source as SessionMessageSourceKind | undefined;
  const promptRun = ownsPromptRun
    ? beginPromptRun(host.inner.sessionId, {
        ...(promptSource ? { source: promptSource } : {}),
        ...(roomContext ? { roomContext } : {}),
      })
    : host.activePromptRun!;
  // beginPromptRun may refuse admission (for example during an update).
  // Do not latch the busy flag or client receipt before that fence passes.
  if (!streamingBehavior) {
    host.pendingClientPromptId = typeof command.clientPromptId === "string" ? command.clientPromptId : undefined;
    host.promptAdmissionBusy = true;
  }
  const fileChangeCapture = ownsPromptRun ? beginPromptFileChanges(promptRun, host.cwd) : null;
  if (ownsPromptRun) {
    host.activePromptRun = promptRun;
    host.activeCommandId = commandId;
    host.permissions.clearReviewModel();
    host.permissions.reviews().admit({ id: commandId, source: promptSource ?? "unknown", text: originalPromptMessage, timestamp: Date.now() }, true);
    host.emit({
      type: "prompt_started",
      sessionId: host.sessionId,
      commandId,
      runId: promptRun.runId,
      timestamp: Date.now(),
    });
  }
  if (!ownsPromptRun) {
    host.permissions.reviews().admit({
      id: commandId,
      source: streamingBehavior === "followUp" ? "queued" : promptSource ?? "unknown",
      text: originalPromptMessage,
      timestamp: Date.now(),
    }, false);
  }
  if (teamExecution) {
    if (!ownsPromptRun) throw new Error("Team execution requires a new PromptRun.");
    bindTeamPromptContext(promptRun, teamExecution);
  }
  host.promptRunning = true;
  if (!streamingBehavior && !isSlashCommand) {
    host.maybeAutoTitleSideChat?.(originalPromptMessage, Boolean(promptImages?.length));
  }
  notifyRunningChange();
  const assertNotAborted = () => {
    if (!host.isAlive() || abortGeneration !== host.abortGeneration) {
      throw new Error("Prompt cancelled");
    }
  };
  const promptTask = Promise.resolve().then(async () => {
    // All fallible synchronous admission checks run before changing workflow
    // state. From here every error settles the admitted workflow and queue.
    assertNotAborted();
    if (!streamingBehavior) host.capabilities.reapplySessionCapabilities();
    prepareWorkflow();
    if (fileChangeCapture) await fileChangeCapture.initial.catch(() => {});
    if (!streamingBehavior) {
      const pendingModel = readPendingSessionModel(host.sessionId);
      if (pendingModel) {
        assertNotAborted();
        const model = host.inner.modelRuntime.getModel(pendingModel.provider, pendingModel.modelId);
        if (!model) throw new Error(`Model not found: ${pendingModel.provider}/${pendingModel.modelId}`);
        await host.inner.setModel(applyConfiguredImageInput(model));
        host.capabilities.reapplySessionCapabilities();
        host.persistSessionFile();
        clearPendingSessionModel(host.sessionId, pendingModel.revision);
        host.emit({ type: "project_model_changed", provider: model.provider, modelId: model.id });
        assertNotAborted();
      }
      if (host.inner.model) {
        const catalogModel = host.inner.modelRuntime.getModel(host.inner.model.provider, host.inner.model.id) ?? host.inner.model;
        const configuredModel = applyConfiguredImageInput(
          catalogModel.provider === host.inner.model.provider && catalogModel.id === host.inner.model.id
            ? catalogModel : host.inner.model,
        );
        if (configuredModel !== host.inner.model) {
          assertNotAborted();
          await host.inner.setModel(configuredModel);
          host.capabilities.reapplySessionCapabilities();
          assertNotAborted();
        }
      }
      // Settings or the pending model can change during async admission.
      if (promptImages?.length && !host.inner.model?.input?.includes("image")) {
        throw new Error("The selected model does not support image input. Choose an image-capable model.");
      }
    }
    const prompt = (admitted: () => void) => {
      assertNotAborted();
      if (!streamingBehavior) host.permissions.setReviewModelIfUnset(host.inner.model ? { provider: host.inner.model.provider, id: host.inner.model.id } : undefined);
      return host.promptInputEnrichment.run(text => {
        const enriched = typeof command.promptSuffix === "string" && command.promptSuffix ? `${text}\n\n${command.promptSuffix}` : text;
        return resolvedPromptMaterials.length ? buildPromptWithMaterials(enriched, resolvedPromptMaterials) : enriched;
      }, () => host.inner.prompt(originalPromptMessage, {
        ...(command.inputMode === "text" ? { expandPromptTemplates: false } : {}),
        ...(promptImages?.length ? { images: promptImages } : {}),
        ...(streamingBehavior ? { streamingBehavior } : {}),
        source: "rpc",
        // SDK abort() only sees an active model run, not asynchronous auth,
        // input hooks or pre-prompt compaction. Fence that late model start.
        preflightResult: (disposition) => {
          if (!host.isAlive() || abortGeneration !== host.abortGeneration) {
            host.inner.clearQueue();
            // Pi 1.3 calls this callback after setting its active flag but
            // before entering the run's finally. Throw at agent admission
            // instead, where the SDK can unwind that flag and idle waiters.
            if (disposition === "started" && host.inner.agent.prompt) return;
          }
          assertNotAborted();
          // Only a started model request can later need a continuation.
          // Handled input belongs to its extension; queued input belongs
          // to the already-running prompt, not this admission.
          if (disposition === "started") admitted();
        },
      }));
    };
    // Queuing a message does not own the running model's result.
    if (streamingBehavior) return prompt(() => {});
    return runPromptWithModelFallback({
      session: host.inner,
      enabled: () => readModelFallbackConfig().enabled && (!teamExecution || getRoom(teamExecution.roomId).members
        .find((member) => member.memberId === teamExecution.memberId)?.profile.modelPolicy.mode === "session"),
      assertActive: assertNotAborted,
      lastAssistant: () => host.lastAssistantResponse,
      images: Boolean(promptImages?.length),
      onSwitch: (from, to) => {
        host.capabilities.reapplySessionCapabilities();
        invalidateModelsCache();
        invalidateSessionListCache();
        host.setTaskActivity("retry", `Switching model: ${from} → ${to}`);
        host.emit({
          type: "model_fallback",
          sessionId: host.sessionId,
          commandId,
          runId: promptRun.runId,
          from,
          to,
          model: host.inner.model,
          thinkingLevel: host.inner.agent.state?.thinkingLevel,
        });
      },
      prompt,
    });
  }).then(async () => {
    if (!streamingBehavior && abortGeneration === host.abortGeneration && host.isAlive()) preparedWorkflow?.onPromptSettled();
    host.promptRunning = false;
    if (fileChangeCapture) await finishPromptFileChanges(fileChangeCapture, abortGeneration !== host.abortGeneration ? "aborted" : "complete");
    if (ownsPromptRun) {
      await finishPromptRun(promptRun, "idle");
      if (host.activePromptRun?.runId === promptRun.runId) host.activePromptRun = undefined;
      if (host.activeCommandId === commandId) host.activeCommandId = undefined;
    }
    if (!streamingBehavior) {
      host.promptAdmissionBusy = false;
      host.emit({ type: "prompt_done", sessionId: host.sessionId, commandId, runId: promptRun.runId, timestamp: Date.now(), aborted: abortGeneration !== host.abortGeneration });
    }
    host.capabilities.flushPendingProjectCapabilitySettings();
    notifyRunningChange();
  }).catch(async (error) => {
    host.promptRunning = false;
    const cancelled = abortGeneration !== host.abortGeneration || !host.isAlive();
    if (!streamingBehavior && !cancelled) preparedWorkflow?.onPromptError(error instanceof Error ? error.message : String(error));
    if (fileChangeCapture) await finishPromptFileChanges(fileChangeCapture, cancelled ? "aborted" : "error");
    if (ownsPromptRun) {
      await finishPromptRun(promptRun, "error");
      if (host.activePromptRun?.runId === promptRun.runId) host.activePromptRun = undefined;
      if (host.activeCommandId === commandId) host.activeCommandId = undefined;
    }
    if (!streamingBehavior) host.promptAdmissionBusy = false;
    host.lastPromptFailed = !cancelled;
    host.lastPromptErrorSummary = cancelled ? undefined : error instanceof Error ? error.message : String(error);
    invalidateSessionListCache();
    if (!cancelled) {
      host.emit({
        type: "prompt_error",
        sessionId: host.sessionId,
        commandId,
        runId: promptRun.runId,
        timestamp: Date.now(),
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
    if (!streamingBehavior) host.emit({ type: "prompt_done", sessionId: host.sessionId, commandId, runId: promptRun.runId, timestamp: Date.now(), aborted: cancelled });
    host.capabilities.flushPendingProjectCapabilitySettings();
    notifyRunningChange();
  }).finally(() => {
    if (!streamingBehavior && host.pendingClientPromptId === command.clientPromptId) host.pendingClientPromptId = undefined;
    host.promptTasks.delete(promptTask);
  });
  host.promptTasks.add(promptTask);
  return null;
}

export function handleQueueCommand(
  host: RpcCommandHost,
  type: "steer" | "follow_up",
  command: SessionRpcCommand,
  abortGeneration: number,
) {
  if (host.stopping || abortGeneration !== host.abortGeneration) {
    throw new Error("Cannot send a prompt while the session is busy stopping");
  }
  if (!host.isAlive()) {
    throw new Error("Prompt cancelled");
  }
  if (typeof command.expectedRunId === "string" && command.expectedRunId !== host.getActivePromptRunId()) {
    throw new Error("Prompt cancelled");
  }
  const queuedCommandId = typeof command.commandId === "string" ? command.commandId : undefined;
  if (queuedCommandId && typeof command.onQueueConsumed === "function" && typeof command.onQueueCancelled === "function") {
    host.queuedInputReceipts.set(queuedCommandId, {
      consumed: command.onQueueConsumed as () => Promise<void>,
      cancelled: command.onQueueCancelled as () => Promise<void>,
    });
  }
  host.permissions.reviews().admit({
    id: typeof command.commandId === "string" ? command.commandId : randomUUID(),
    source: type === "follow_up" ? "queued" : typeof command.source === "string" ? command.source : "unknown",
    text: String(command.message ?? ""),
    timestamp: Date.now(),
  }, false);
  const images = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
  host.inputAdmissions++;
  notifyRunningChange();
  const admission = host.queueSource.run(typeof command.commandId === "string" ? command.commandId : undefined, () => Promise.resolve().then(async () => {
    const text = String(command.message ?? "").trimStart();
    const invocationName = text.match(/^\/([^\s]+)/)?.[1];
    const extensionCommand = invocationName && host.inner.extensionRunner.getRegisteredCommands().some(item => item.invocationName === invocationName);
    if (extensionCommand && command.inputMode !== "text") {
      await host.executeChatCommand(typeof command.commandId === "string" ? command.commandId : `cmd_${randomUUID()}`, text);
      if (queuedCommandId) host.queuedInputReceipts.delete(queuedCommandId);
      return { disposition: "handled" };
    }
    let literalDisposition: "handled" | "queued" | "started" | undefined;
    const disposition = command.inputMode === "text" ? await host.inner.prompt(command.message as string, {
      source: "rpc",
      expandPromptTemplates: false,
      streamingBehavior: type === "steer" ? "steer" : "followUp",
      ...(images?.length ? { images } : {}),
      preflightResult: result => { literalDisposition = result; },
    }).then(() => literalDisposition) : await (type === "steer"
      ? host.inner.steer(command.message as string, images?.length ? images : undefined)
      : host.inner.followUp(command.message as string, images?.length ? images : undefined));
    // SDK input hooks can finish after abort() has cleared the queue.
    // Stop waits for this writer before allowing the next prompt, so
    // clearing a stale admission cannot discard a newer run's input.
    if (!host.isAlive() || abortGeneration !== host.abortGeneration) {
      host.inner.clearQueue();
      host.emit({ type: "queue_update", steering: [], followUp: [] });
      throw new Error("Prompt cancelled");
    }
    if (disposition === "handled" && queuedCommandId) host.queuedInputReceipts.delete(queuedCommandId);
    return { disposition };
  })).catch(error => {
    if (queuedCommandId && abortGeneration === host.abortGeneration) host.queuedInputReceipts.delete(queuedCommandId);
    throw error;
  }).finally(() => { host.inputAdmissions--; notifyRunningChange(); });
  const writer = admission.then(() => undefined, () => undefined).finally(() => host.promptTasks.delete(writer));
  host.promptTasks.add(writer);
  return admission;
}

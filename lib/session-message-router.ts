import { randomUUID } from "node:crypto";
import { transitionTaskTiming } from "./task-timing";
import { getSessionCommandEventHub, SessionCommandEventHub } from "./session-command-events";
import {
  getSessionInboxRegistry,
  SESSION_MESSAGE_TEXT_MAX_BYTES,
  sessionCommandBytes,
  type SessionInboxState,
} from "./session-inbox";
import { getRpcSession, type AgentSessionWrapper } from "./rpc-manager";
import { resolveSessionPath } from "./session-reader";
import { resolveOrStartRpcSession } from "./session-runtime-resolver";
import { SessionControlStore } from "./session-control-store";
import { executeChatCommandOperation } from "./chat-command-runtime";
import {
  deleteTeamExecutionSecret,
  persistTeamExecutionContext,
  resolveTeamExecutionContext,
} from "./team-execution-secrets";
import type {
  AbortReceipt,
  DispatchReceipt,
  PromptCancellationReceipt,
  SessionCommandEvent,
  SessionCommandRecord,
  SessionCommandStatus,
  SessionControlState,
  SessionMessageInput,
} from "./session-message-types";
import {
  assertPrincipal,
  buildSteeringText,
  resolveRouterErrorCode,
  safeErrorMessage,
  SessionMessageRouterError,
  submissionKey,
  TERMINAL_STATUSES,
  validateSessionMessageInput,
  type SessionMessageRouterErrorCode,
  type SessionRoutePrincipal,
} from "./session-router/errors";
import { ChatOperationRunner, type SessionAdmission } from "./session-router/chat-operation-runner";
import {
  performQueuedInputAction,
  recallSessionQueuedInputs,
  type QueueMutationHost,
} from "./session-router/queue-mutations";

export {
  SessionMessageRouterError,
  type SessionMessageRouterErrorCode,
  type SessionRoutePrincipal,
};

interface RouterOptions {
  store?: SessionControlStore;
  events?: SessionCommandEventHub;
  resolver?: typeof resolveOrStartRpcSession;
  maxMessageBytes?: number;
  maxConcurrency?: number;
  commandExecutor?: typeof executeChatCommandOperation;
}

export class SessionMessageRouter {
  private readonly store: SessionControlStore;
  private readonly events: SessionCommandEventHub;
  private readonly resolver: typeof resolveOrStartRpcSession;
  private readonly maxMessageBytes: number;
  private readonly maxConcurrency: number;
  private readonly commandExecutor: typeof executeChatCommandOperation;
  private readonly queueActions = new Set<string>();
  private readonly knownCommands = new Map<string, SessionCommandRecord>();
  private readonly commandsBySubmission = new Map<string, SessionCommandRecord>();
  private readonly loadingInboxes = new Map<string, Promise<void>>();
  private readonly activeCommands = new Map<string, SessionCommandRecord>();
  private readonly wakeSubscriptions = new Map<string, () => void>();
  private readonly pendingSubmissions = new Map<string, Promise<DispatchReceipt>>();
  // Never expire or evict an acknowledged fence: a delayed POST may still arrive.
  // The pending HTTP request cannot survive this router's process lifetime.
  private readonly cancellationIntents = new Set<string>();
  private readonly commandDurability = new Map<string, Promise<void>>();
  private readonly cancellationWork = new Map<string, Promise<PromptCancellationReceipt>>();
  private readonly admissions = new Map<string, SessionAdmission>();
  private readonly chatOperations: ChatOperationRunner;

  private get operationExecutions() {
    return this.chatOperations.operationExecutions;
  }

  private get clientActions() {
    return this.chatOperations.clientActions;
  }

  constructor(options: RouterOptions = {}) {
    this.store = options.store ?? new SessionControlStore();
    this.events = options.events ?? getSessionCommandEventHub();
    this.resolver = options.resolver ?? resolveOrStartRpcSession;
    this.maxMessageBytes = Math.max(1_024, Math.min(SESSION_MESSAGE_TEXT_MAX_BYTES, options.maxMessageBytes ?? SESSION_MESSAGE_TEXT_MAX_BYTES));
    this.maxConcurrency = Math.max(1, Math.min(32, options.maxConcurrency ?? 4));
    this.commandExecutor = options.commandExecutor ?? executeChatCommandOperation;
    this.chatOperations = new ChatOperationRunner({
      resolver: this.resolver,
      commandExecutor: this.commandExecutor,
      inbox: (sessionId) => this.inbox(sessionId),
      isCancelled: (command) => this.isCancelled(command),
      canonicalCommand: (commandId) => this.canonicalCommand(commandId),
      transition: (command, status, patch, eventType) => this.transition(command, status, patch, eventType),
      waitForTerminal: (session, command) => this.waitForTerminal(session, command),
      setAdmission: (commandId, admission) => { this.admissions.set(commandId, admission); },
      deleteAdmission: (commandId) => { this.admissions.delete(commandId); },
      setActiveCommand: (sessionId, command) => { this.activeCommands.set(sessionId, command); },
      clearActiveCommandIfMatch: (sessionId, commandId) => {
        if (this.activeCommands.get(sessionId)?.commandId === commandId) this.activeCommands.delete(sessionId);
      },
      triggerDrain: (sessionId) => { void this.drain(sessionId); },
    });
  }

  private createQueueMutationHost(): QueueMutationHost {
    return {
      store: this.store,
      resolver: this.resolver,
      maxMessageBytes: this.maxMessageBytes,
      queueActions: this.queueActions,
      inbox: (sessionId) => this.inbox(sessionId),
      ensureLoaded: (sessionId) => this.ensureLoaded(sessionId),
      getLiveSession: (sessionId) => this.getLiveSession(sessionId),
      makeRecord: (input) => this.makeRecord(input),
      rememberCommand: (command) => this.rememberCommand(command),
      canonicalCommand: (commandId) => this.canonicalCommand(commandId),
      isCancelled: (command) => this.isCancelled(command),
      cancelRecord: (command) => this.cancelRecord(command),
      deliverQueuedCommand: (command, session, type) => this.deliverQueuedCommand(command, session, type),
      transition: (command, status, patch, eventType) => this.transition(command, status, patch, eventType),
      drain: (sessionId) => this.drain(sessionId),
    };
  }

  private inbox(sessionId: string): SessionInboxState {
    return getSessionInboxRegistry().get(sessionId);
  }

  private async ensureLoaded(sessionId: string): Promise<SessionInboxState> {
    const inbox = this.inbox(sessionId);
    if (inbox.loaded) return inbox;
    let loading = this.loadingInboxes.get(sessionId);
    if (!loading) {
      loading = this.restoreInbox(sessionId);
      this.loadingInboxes.set(sessionId, loading);
    }
    try {
      await loading;
      inbox.loaded = true;
      return inbox;
    } finally {
      if (this.loadingInboxes.get(sessionId) === loading) this.loadingInboxes.delete(sessionId);
    }
  }

  private async restoreInbox(sessionId: string): Promise<void> {
    for (const command of await this.store.loadActiveCommands(sessionId)) {
      this.rememberCommand(command);
      if (command.workflowAction) {
        const live = getRpcSession(sessionId);
        if (command.runId && live?.isAlive() && live.getActivePromptRunId() === command.runId) {
          this.activeCommands.set(sessionId, command);
          continue;
        }
        // An execution decision belongs to the host process that accepted it.
        // Unlike ordinary queued user text, a prior approval/resume must never
        // acquire new execution authority just because the command journal reloads.
        await this.transition(command, "interrupted", {
          errorCode: "RUN_INTERRUPTED",
          errorMessage: "The process stopped before this workflow decision completed. Review its current state and explicitly continue.",
        });
        continue;
      }
      if (command.operation && ["dispatching", "delivered", "running"].includes(command.status)) {
        command.operation = {
          ...command.operation,
          completedAt: Date.now(),
          steps: command.operation.steps.map(step =>
            step.status === "running"
              ? { ...step, status: "failed", error: "RUN_INTERRUPTED" }
              : step.status === "pending"
                ? { ...step, status: "blocked" }
                : step,
          ),
        };
        await this.transition(command, "interrupted", {
          operation: command.operation,
          errorCode: "RUN_INTERRUPTED",
          errorMessage: "The process stopped before this operation could be proven complete.",
        });
        continue;
      }
      if (command.status === "running") {
        const live = getRpcSession(sessionId);
        if (live?.isAlive() && live.getActivePromptRunId() === command.runId) {
          this.activeCommands.set(sessionId, command);
          continue;
        }
        // After a process restart, an old in-memory run has no authority.
        await this.transition(command, "interrupted", {
          errorCode: "RUN_INTERRUPTED",
          errorMessage: "The process stopped before this run could be proven complete.",
        });
        continue;
      }
      if (command.delivery === "steer") {
        await this.transition(command, "interrupted", {
          errorCode: "RUN_INTERRUPTED",
          errorMessage: "Steering delivery could not be confirmed after restart.",
        });
        continue;
      }
      if (command.status === "dispatching") {
        command.status = "queued";
        command.taskTiming = null;
        await this.store.appendStatus(command, "queued", { queuedAt: Date.now(), taskTiming: null });
      }
      if (command.status === "accepted" || command.status === "queued") {
        try { getSessionInboxRegistry().enqueue(command); } catch { /* a later receipt will report a full inbox */ }
      }
    }
  }

  private async publish(event: Omit<SessionCommandEvent, "cursor">): Promise<void> {
    await this.events.publish(event).catch((error) => {
      console.error("[pi-web] failed to persist session command event:", safeErrorMessage(error));
    });
  }

  private async transition(
    command: SessionCommandRecord,
    status: SessionCommandStatus,
    patch: Partial<SessionCommandRecord> = {},
    eventType?: SessionCommandEvent["type"],
  ): Promise<void> {
    command = this.knownCommands.get(command.commandId) ?? command;
    if (
      (TERMINAL_STATUSES.has(command.status) && command.status !== status)
      || (this.cancellationWork.has(command.commandId) && !TERMINAL_STATUSES.has(status))
    ) {
      return;
    }
    patch = { ...patch, taskTiming: transitionTaskTiming(command, status, Date.now()) ?? null };
    command.status = status;
    Object.assign(command, patch);
    command.revision = (command.revision ?? 0) + 1;
    patch = { ...patch, revision: command.revision };
    this.rememberCommand(command);
    command = { ...command, ...(command.operation ? { operation: structuredClone(command.operation) } : {}) };
    await this.store.appendStatus(command, status, patch);
    const latest = this.knownCommands.get(command.commandId) ?? command;
    if (TERMINAL_STATUSES.has(latest.status) && latest.status !== status) {
      // A delayed persistence operation must not become the journal's last row
      // after cancellation has already settled the canonical record.
      await this.store.appendStatus(latest, latest.status, {
        revision: latest.revision,
        taskTiming: latest.taskTiming,
        ...(latest.operation ? { operation: structuredClone(latest.operation) } : {}),
        errorCode: latest.errorCode,
        errorMessage: latest.errorMessage,
        runId: latest.runId,
        attachedRunId: latest.attachedRunId,
      });
      return;
    }
    await this.publish({
      type: eventType ?? `command_${status}` as SessionCommandEvent["type"],
      sessionId: command.targetSessionId,
      commandId: command.commandId,
      runId: command.runId,
      attachedRunId: command.attachedRunId,
      status,
      revision: command.revision,
      timestamp: Date.now(),
      ...(command.errorCode ? { errorCode: command.errorCode } : {}),
      ...(command.errorMessage ? { errorMessage: command.errorMessage } : {}),
      ...(command.operation ? { operation: command.operation } : {}),
      idempotencyKey: command.idempotencyKey,
      acceptedAt: command.acceptedAt,
      taskTiming: command.taskTiming,
      source: command.source,
      preview: command.content.slice(0, 180),
      queuePaused: command.queuePaused ?? false,
    });
    if (TERMINAL_STATUSES.has(status) && command.teamExecution) {
      try { deleteTeamExecutionSecret(command.teamExecution); }
      catch (error) { console.error("[pi-web] failed to remove Team execution secret:", safeErrorMessage(error)); }
    }
  }

  private makeRecord(input: SessionMessageInput): SessionCommandRecord {
    const now = Date.now();
    return {
      commandId: `cmd_${randomUUID()}`,
      revision: 0,
      ...(input.workflowAction ? { workflowAction: structuredClone(input.workflowAction) } : {}),
      ...(input.workflow ? { workflow: structuredClone(input.workflow) } : {}),
      ...(input.inputMode ? { inputMode: input.inputMode } : {}),
      ...(input.promptSuffix ? { promptSuffix: input.promptSuffix } : {}),
      ...(input.localFiles?.length ? { localFiles: structuredClone(input.localFiles) } : {}),
      ...(input.operation ? { operation: structuredClone(input.operation) } : {}),
      idempotencyKey: input.idempotencyKey,
      targetSessionId: input.targetSessionId,
      content: input.content,
      delivery: input.delivery ?? "next_turn",
      source: input.source,
      ...(input.roomContext ? { roomContext: input.roomContext } : {}),
      acceptedAt: now,
      queuedAt: now,
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
      status: "accepted",
      ...(input.images?.length ? { images: input.images } : {}),
      ...(input.materials?.length ? { materials: input.materials } : {}),
      ...(input.teamExecution ? { teamExecution: persistTeamExecutionContext(input.teamExecution) } : {}),
    };
  }

  async dispatchSessionMessage(input: SessionMessageInput, principal?: SessionRoutePrincipal): Promise<DispatchReceipt> {
    validateSessionMessageInput(input, this.maxMessageBytes);
    assertPrincipal(input, principal);
    if (input.delivery === "steer") {
      return this.steerSession(input, principal);
    }
    const key = submissionKey(input.targetSessionId, input.idempotencyKey);
    const pending = this.pendingSubmissions.get(key);
    if (pending) return { ...await pending, idempotent: true };
    const operation = this.admitSubmission(input);
    this.pendingSubmissions.set(key, operation);
    try { return await operation; }
    finally { if (this.pendingSubmissions.get(key) === operation) this.pendingSubmissions.delete(key); }
  }

  async findSubmissionReceipt(sessionId: string, idempotencyKey: string): Promise<DispatchReceipt | undefined> {
    const pending = this.pendingSubmissions.get(submissionKey(sessionId, idempotencyKey));
    if (pending) return { ...await pending, idempotent: true };
    await this.ensureLoaded(sessionId);
    const command = await this.submissionCommand(sessionId, idempotencyKey);
    if (!command) return undefined;
    await this.commandDurability.get(command.commandId);
    if (!TERMINAL_STATUSES.has(command.status)) void this.drain(sessionId);
    return {
      accepted: true,
      commandId: command.commandId,
      sessionId,
      status: command.status,
      idempotent: true,
      ...(command.runId ? { runId: command.runId } : {}),
      ...(command.attachedRunId ? { attachedRunId: command.attachedRunId } : {}),
    };
  }

  private rememberCommand(command: SessionCommandRecord): void {
    this.knownCommands.set(command.commandId, command);
    const key = submissionKey(command.targetSessionId, command.idempotencyKey);
    const existing = this.commandsBySubmission.get(key);
    if (!existing || existing.commandId === command.commandId) this.commandsBySubmission.set(key, command);
  }

  private async submissionCommand(sessionId: string, idempotencyKey: string): Promise<SessionCommandRecord | undefined> {
    const key = submissionKey(sessionId, idempotencyKey);
    const known = this.commandsBySubmission.get(key);
    if (known) return known;
    const stored = await this.store.queryByIdempotencyKey(sessionId, idempotencyKey);
    const current = this.commandsBySubmission.get(key);
    if (current) return current;
    if (stored) this.rememberCommand(stored);
    return stored;
  }

  private isCancelled(command: SessionCommandRecord): boolean {
    const canonical = this.knownCommands.get(command.commandId) ?? command;
    return (
      canonical.status === "cancelled"
      || this.cancellationWork.has(command.commandId)
      || this.cancellationIntents.has(submissionKey(command.targetSessionId, command.idempotencyKey))
    );
  }

  private async admitSubmission(input: SessionMessageInput): Promise<DispatchReceipt> {
    const key = submissionKey(input.targetSessionId, input.idempotencyKey);
    const existing = await this.submissionCommand(input.targetSessionId, input.idempotencyKey);
    if (existing) {
      if (this.cancellationIntents.has(key)) await this.cancelRecord(existing);
      if (!TERMINAL_STATUSES.has(existing.status)) void this.drain(existing.targetSessionId);
      return {
        accepted: true,
        commandId: existing.commandId,
        sessionId: existing.targetSessionId,
        status: existing.status,
        ...(existing.runId ? { runId: existing.runId } : {}),
        ...(existing.attachedRunId ? { attachedRunId: existing.attachedRunId } : {}),
        idempotent: true,
      };
    }

    try {
      if (input.operation?.command.busyBehavior !== "read") await this.resolver(input.targetSessionId);
      else if (!getRpcSession(input.targetSessionId)?.isAlive() && !await resolveSessionPath(input.targetSessionId)) {
        throw new SessionMessageRouterError("SESSION_NOT_FOUND", "Session not found.");
      }
    } catch (error) {
      const code = resolveRouterErrorCode(error);
      throw new SessionMessageRouterError(code, code === "SESSION_NOT_FOUND" ? "Session not found." : safeErrorMessage(error), { cause: error });
    }
    await this.ensureLoaded(input.targetSessionId);
    const command = this.makeRecord(input);
    if (command.operation) command.operation.anchorEntryId = getRpcSession(input.targetSessionId)?.inner?.sessionManager.getLeafId() ?? undefined;
    this.rememberCommand(command);
    let commandPersisted = false;
    try {
      const durability = this.store.appendCommand(command);
      this.commandDurability.set(command.commandId, durability);
      try { await durability; }
      finally { this.commandDurability.delete(command.commandId); }
      commandPersisted = true;
      await this.publish({ type: "command_accepted", sessionId: command.targetSessionId, commandId: command.commandId, status: "accepted", timestamp: command.acceptedAt });
      if (this.isCancelled(command)) {
        await this.cancelRecord(command);
        return { accepted: true, commandId: command.commandId, sessionId: command.targetSessionId, status: "cancelled" };
      }
      const immediateSession = getRpcSession(input.targetSessionId);
      if (
        command.operation
        && (
          command.operation.command.busyBehavior === "read"
          || (
            (
              (command.operation.command.busyBehavior === "immediate" && command.operation.inputOptions?.delivery !== "next_turn")
              || (["prompt", "skill"].includes(command.operation.command.source) && ["steer", "followUp"].includes(command.operation.inputOptions?.delivery ?? ""))
            )
            && immediateSession?.isRunning()
            && immediateSession.getRuntime() !== "stopping"
          )
        )
      ) {
        void this.chatOperations.run(command, immediateSession);
        return { accepted: true, commandId: command.commandId, sessionId: command.targetSessionId, status: command.status };
      }
      const position = getSessionInboxRegistry().enqueue(command).position;
      await this.transition(command, "queued", { queuedAt: Date.now() }, "command_queued");
      if (this.isCancelled(command)) {
        await this.cancelRecord(command);
        return { accepted: true, commandId: command.commandId, sessionId: command.targetSessionId, status: "cancelled" };
      }
      void this.drain(input.targetSessionId);
      return { accepted: true, commandId: command.commandId, sessionId: command.targetSessionId, status: "queued", queuePosition: position };
    } catch (error) {
      const code = /full|too large/i.test(safeErrorMessage(error))
        ? (safeErrorMessage(error).includes("large") ? "SESSION_MESSAGE_TOO_LARGE" : "SESSION_QUEUE_FULL")
        : "RUNTIME_START_FAILED";
      getSessionInboxRegistry().removeCommand(command.targetSessionId, command.commandId);
      if (!commandPersisted && this.knownCommands.get(command.commandId) === command) {
        this.knownCommands.delete(command.commandId);
        if (this.commandsBySubmission.get(key) === command) this.commandsBySubmission.delete(key);
      }
      if (commandPersisted && !this.isCancelled(command) && !TERMINAL_STATUSES.has(command.status)) {
        // The original must be durable before admission, but a rejected inbox
        // admission must also be terminal so recovery cannot replay it.
        await this.transition(command, "failed", { errorCode: code, errorMessage: safeErrorMessage(error) }, "command_failed");
      }
      throw new SessionMessageRouterError(code, code === "SESSION_QUEUE_FULL" ? "Session inbox is full." : safeErrorMessage(error), { cause: error });
    }
  }

  async dispatchManySessionMessages(
    inputs: SessionMessageInput[],
    options: { maxConcurrency?: number; principal?: SessionRoutePrincipal } = {},
  ): Promise<DispatchReceipt[]> {
    const results: DispatchReceipt[] = [];
    const limit = Math.max(1, Math.min(this.maxConcurrency, Math.floor(options.maxConcurrency ?? this.maxConcurrency)));
    let next = 0;
    const worker = async () => {
      while (next < inputs.length) {
        const index = next++;
        try { results[index] = await this.dispatchSessionMessage(inputs[index], options.principal); }
        catch (error) {
          results[index] = {
            accepted: true,
            commandId: "",
            sessionId: inputs[index].targetSessionId,
            status: "failed",
            ...(error instanceof SessionMessageRouterError ? { errorCode: error.code } : {}),
          } as DispatchReceipt;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, inputs.length) }, () => worker()));
    return results;
  }

  async steerSession(input: Omit<SessionMessageInput, "delivery">, principal?: SessionRoutePrincipal): Promise<DispatchReceipt> {
    const message = { ...input, delivery: "steer" as const };
    validateSessionMessageInput(message, this.maxMessageBytes);
    assertPrincipal(message, principal);
    const existing = await this.store.queryByIdempotencyKey(input.targetSessionId, input.idempotencyKey);
    if (existing) {
      return {
        accepted: true,
        commandId: existing.commandId,
        sessionId: existing.targetSessionId,
        status: existing.status,
        attachedRunId: existing.attachedRunId,
        idempotent: true,
      };
    }
    const session = await this.getLiveSession(input.targetSessionId);
    await this.ensureLoaded(input.targetSessionId);
    if (!session.isRunning() || !session.getActivePromptRunId()) {
      throw new SessionMessageRouterError("STEER_REQUIRES_RUNNING_SESSION", "Steer requires a running Session.");
    }
    const command = this.makeRecord(message);
    command.delivery = "steer";
    command.attachedRunId = session.getActivePromptRunId();
    await this.store.appendCommand(command);
    await this.transition(command, "dispatching", { attachedRunId: command.attachedRunId }, "command_dispatching");
    try {
      await this.deliverQueuedCommand(command, session, "steer");
      return {
        accepted: true,
        commandId: command.commandId,
        sessionId: input.targetSessionId,
        status: command.status,
        attachedRunId: command.attachedRunId,
      };
    } catch (error) {
      command.errorCode = resolveRouterErrorCode(error);
      command.errorMessage = safeErrorMessage(error);
      await this.transition(command, "failed", {}, "command_failed");
      throw new SessionMessageRouterError(command.errorCode as SessionMessageRouterErrorCode, "Steer could not be delivered.", { cause: error });
    }
  }

  private async deliverQueuedCommand(command: SessionCommandRecord, session: AgentSessionWrapper, type: "steer" | "follow_up"): Promise<void> {
    let recovery: Promise<void> | undefined;
    const cancelled = () => recovery ??= (async () => {
      await this.transition(command, "queued", { delivery: "next_turn", queuePaused: true, inputMode: "text" });
      if (command.status === "queued" && !this.inbox(command.targetSessionId).queue.some(item => item.commandId === command.commandId)) {
        try { getSessionInboxRegistry().enqueue(command); }
        catch (error) {
          // Paused recovery is already durable and visible. A full execution
          // inbox must not turn Stop into failure or discard this submission.
          if (!(error instanceof Error) || error.message !== "SESSION_QUEUE_FULL") throw error;
        }
      }
    })();
    try {
      const result = await session.send({
        type,
        source: command.source,
        message: buildSteeringText(command),
        images: command.images,
        commandId: command.commandId,
        expectedRunId: command.attachedRunId,
        onQueueConsumed: () => {
          getSessionInboxRegistry().removeCommand(command.targetSessionId, command.commandId);
          return this.transition(command, "completed", { queuePaused: false });
        },
        onQueueCancelled: cancelled,
        ...(command.inputMode ? { inputMode: command.inputMode } : {}),
      }) as { disposition?: string } | undefined;
      if (recovery) await recovery;
      else if (command.status === "dispatching") {
        await this.transition(command, result?.disposition === "handled" ? "completed" : "delivered");
      }
    } catch (error) {
      if (recovery || /cancelled|stopping/i.test(safeErrorMessage(error))) {
        await cancelled();
        return;
      }
      throw error;
    }
  }

  /** Recall into separate durable, paused queue entries before removing SDK input. */
  async recallQueuedInputs(
    sessionId: string,
    mutation?: { inputId: string; action: "queue" | "delete" },
  ): Promise<SessionCommandRecord[]> {
    return recallSessionQueuedInputs(this.createQueueMutationHost(), sessionId, mutation);
  }

  /** Mutate only waiting UI submissions. Never abort a run that won the dispatch race. */
  async queuedInputAction(
    sessionId: string,
    commandId: string,
    action: "pause" | "resume" | "edit" | "steer" | "cancel",
    text?: string,
    expectedRevision?: number,
  ): Promise<SessionCommandRecord> {
    return performQueuedInputAction(this.createQueueMutationHost(), sessionId, commandId, action, text, expectedRevision);
  }

  async followUpSession(input: Omit<SessionMessageInput, "delivery">, principal?: SessionRoutePrincipal): Promise<DispatchReceipt> {
    const message = { ...input, delivery: "steer" as const };
    validateSessionMessageInput(message, this.maxMessageBytes);
    assertPrincipal(message, principal);
    const session = await this.getLiveSession(input.targetSessionId);
    await this.ensureLoaded(input.targetSessionId);
    if (!session.isRunning() || !session.getActivePromptRunId()) {
      throw new SessionMessageRouterError("SESSION_BUSY", "Follow-up requires a running Session.");
    }
    const command = this.makeRecord(message);
    command.attachedRunId = session.getActivePromptRunId();
    await this.store.appendCommand(command);
    await this.transition(command, "dispatching", { attachedRunId: command.attachedRunId }, "command_dispatching");
    try {
      await this.deliverQueuedCommand(command, session, "follow_up");
      return {
        accepted: true,
        commandId: command.commandId,
        sessionId: input.targetSessionId,
        status: command.status,
        attachedRunId: command.attachedRunId,
      };
    } catch (error) {
      command.errorCode = resolveRouterErrorCode(error);
      command.errorMessage = safeErrorMessage(error);
      await this.transition(command, "failed", {}, "command_failed");
      throw new SessionMessageRouterError(command.errorCode as SessionMessageRouterErrorCode, "Follow-up could not be delivered.", { cause: error });
    }
  }

  private async getLiveSession(sessionId: string): Promise<AgentSessionWrapper> {
    const live = getRpcSession(sessionId);
    if (!live?.isAlive()) {
      const path = await resolveSessionPath(sessionId);
      if (!path) throw new SessionMessageRouterError("SESSION_NOT_FOUND", "Session not found.");
      throw new SessionMessageRouterError("STEER_REQUIRES_RUNNING_SESSION", "The target Session is not running.");
    }
    return live;
  }

  private watchForIdle(sessionId: string, session: AgentSessionWrapper): void {
    if (this.wakeSubscriptions.has(sessionId)) return;
    const unsubscribe = session.onEvent((event) => {
      if (["prompt_done", "prompt_error", "agent_end", "agent_settled", "session_idle"].includes(event.type)) {
        void this.drain(sessionId);
      }
    });
    this.wakeSubscriptions.set(sessionId, () => {
      unsubscribe();
      this.wakeSubscriptions.delete(sessionId);
    });
  }

  private waitForTerminal(session: AgentSessionWrapper, command: SessionCommandRecord): {
    promise: Promise<"completed" | "failed" | "interrupted" | "cancelled">;
    cancel: () => void;
  } {
    let cancel = () => {};
    const promise = new Promise<"completed" | "failed" | "interrupted" | "cancelled">((resolve) => {
      let settled = false;
      const finish = (status: "completed" | "failed" | "interrupted" | "cancelled") => {
        if (settled) return;
        settled = true;
        unsubscribe();
        removeDestroy?.();
        resolve(status);
      };
      cancel = () => finish("interrupted");
      const unsubscribe = session.onEvent((event) => {
        if (event.commandId !== command.commandId && (!command.runId || event.runId !== command.runId)) return;
        if (event.type === "prompt_started" && typeof event.runId === "string") {
          command.runId = event.runId;
          const admission = this.admissions.get(command.commandId);
          if (admission?.session === session) admission.runId = event.runId;
        }
        const cancelled = this.isCancelled(command);
        if (event.type === "prompt_done") finish(cancelled ? "cancelled" : "completed");
        else if (event.type === "prompt_error") {
          if (typeof event.errorMessage === "string") command.errorMessage = safeErrorMessage(event.errorMessage);
          finish(cancelled ? "cancelled" : "failed");
        }
      });
      const removeDestroy = session.onDestroy(() => finish(this.isCancelled(command) ? "cancelled" : "interrupted"));
    });
    return { promise, cancel: () => cancel() };
  }

  private async drain(sessionId: string): Promise<void> {
    const inbox = this.inbox(sessionId);
    if (inbox.draining) return inbox.drainPromise;
    inbox.draining = true;
    const run = (async () => {
      await this.ensureLoaded(sessionId);
      while (inbox.queue.length > 0) {
        const command = inbox.queue[0];
        if (!command) break;
        if (command.queuePaused || this.queueActions.has(command.commandId)) return;
        if (this.isCancelled(command)) {
          getSessionInboxRegistry().removeCommand(sessionId, command.commandId);
          await this.cancelRecord(command);
          continue;
        }
        if (command.expiresAt !== undefined && command.expiresAt <= Date.now()) {
          getSessionInboxRegistry().shift(inbox);
          command.errorCode = "COMMAND_EXPIRED";
          command.errorMessage = "The command expired before delivery.";
          await this.transition(command, "expired", {}, "command_expired");
          continue;
        }
        let session: AgentSessionWrapper;
        try {
          session = (await this.resolver(sessionId)).session;
        } catch (error) {
          if (this.isCancelled(command)) continue;
          if (command.queuePaused || this.queueActions.has(command.commandId)) return;
          if (command.status !== "accepted" && command.status !== "queued") continue;
          const code = resolveRouterErrorCode(error);
          if (code === "SESSION_BUSY") return;
          getSessionInboxRegistry().shift(inbox);
          command.errorCode = code;
          command.errorMessage = safeErrorMessage(error);
          await this.transition(command, "failed", {}, "command_failed");
          continue;
        }
        if (this.isCancelled(command)) continue;
        if (command.queuePaused || this.queueActions.has(command.commandId)) return;
        if (command.status !== "accepted" && command.status !== "queued") continue;
        if (session.isForegroundRunning?.() ?? session.isRunning()) {
          this.watchForIdle(sessionId, session);
          return;
        }
        getSessionInboxRegistry().removeCommand(sessionId, command.commandId);
        if (command.operation) {
          await this.chatOperations.run(command, session);
          continue;
        }
        const admission: SessionAdmission = { session, started: false };
        this.admissions.set(command.commandId, admission);
        await this.transition(command, "dispatching", {}, "command_dispatching");
        if (this.isCancelled(command)) {
          await this.cancelRecord(command);
          this.admissions.delete(command.commandId);
          continue;
        }
        const terminal = this.waitForTerminal(session, command);
        admission.cancelTerminal = terminal.cancel;
        try {
          const teamExecution = command.teamExecution ? resolveTeamExecutionContext(command.teamExecution) : undefined;
          // No await between the canonical fence and the actual wrapper call.
          if (this.isCancelled(command)) { terminal.cancel(); continue; }
          admission.started = true;
          this.activeCommands.set(sessionId, command);
          const started = await session.startTrackedPrompt({
            commandId: command.commandId,
            ...(command.source === "ui" ? { clientPromptId: command.idempotencyKey } : {}),
            source: command.source,
            roomContext: command.roomContext,
            message: command.content,
            ...(command.workflowAction ? { workflowAction: command.workflowAction } : {}),
            ...(command.workflow ? { workflow: command.workflow } : {}),
            ...(command.inputMode ? { inputMode: command.inputMode } : {}),
            ...(command.promptSuffix ? { promptSuffix: command.promptSuffix } : {}),
            images: command.images,
            materials: command.materials,
            teamExecution,
          });
          command.runId = started.runId;
          admission.runId = started.runId;
          if (this.isCancelled(command)) await this.cancelRecord(command);
          else {
            await this.publish({ type: "prompt_started", sessionId, commandId: command.commandId, runId: started.runId, timestamp: Date.now() });
            await this.transition(command, "delivered", { runId: started.runId }, "command_delivered");
            await this.transition(command, "running", { runId: started.runId }, "command_running");
          }
        } catch (error) {
          terminal.cancel();
          this.admissions.delete(command.commandId);
          if (this.activeCommands.get(sessionId)?.commandId === command.commandId) this.activeCommands.delete(sessionId);
          if (this.isCancelled(command)) { await this.cancelRecord(command); continue; }
          const code = resolveRouterErrorCode(error);
          if (code === "SESSION_BUSY") {
            inbox.queue.unshift(command);
            inbox.queuedBytes += sessionCommandBytes(command);
            await this.transition(command, "queued", { queuedAt: Date.now() }, "command_queued");
            this.watchForIdle(sessionId, session);
            return;
          }
          command.errorCode = code;
          command.errorMessage = safeErrorMessage(error);
          await this.transition(command, "failed", {}, "command_failed");
          continue;
        }
        const terminalStatus = await terminal.promise;
        const status = this.isCancelled(command) ? "cancelled" : terminalStatus;
        this.admissions.delete(command.commandId);
        if (this.activeCommands.get(sessionId)?.commandId === command.commandId) this.activeCommands.delete(sessionId);
        if (status === "completed") {
          await this.transition(command, "completed", {}, "command_completed");
          await this.publish({ type: "prompt_done", sessionId, commandId: command.commandId, runId: command.runId, timestamp: Date.now() });
        } else if (status === "cancelled") {
          await this.publish({ type: "prompt_error", sessionId, commandId: command.commandId, runId: command.runId, timestamp: Date.now(), errorCode: "COMMAND_CANCELLED" });
          await this.transition(command, "cancelled", {}, "command_cancelled");
        } else if (status === "interrupted") {
          command.errorCode = "RUN_INTERRUPTED";
          command.errorMessage = "The target runtime stopped before completion.";
          await this.publish({ type: "prompt_error", sessionId, commandId: command.commandId, runId: command.runId, timestamp: Date.now(), errorCode: "RUN_INTERRUPTED" });
          await this.transition(command, "interrupted", {}, "command_interrupted");
        } else {
          command.errorCode = "PROMPT_ERROR";
          await this.publish({ type: "prompt_error", sessionId, commandId: command.commandId, runId: command.runId, timestamp: Date.now(), errorCode: command.errorCode, errorMessage: command.errorMessage });
          await this.transition(command, "failed", {}, "command_failed");
        }
      }
      this.wakeSubscriptions.get(sessionId)?.();
    })();
    inbox.drainPromise = run;
    await run.catch((error) => {
      console.error("[pi-web] session inbox drain failed:", safeErrorMessage(error));
    }).finally(() => {
      inbox.draining = false;
      inbox.drainPromise = undefined;
    });
  }

  async abortSessionRun(input: { targetSessionId: string; idempotencyKey?: string }, principal?: SessionRoutePrincipal): Promise<AbortReceipt> {
    assertPrincipal({ targetSessionId: input.targetSessionId, content: "", source: "system", idempotencyKey: input.idempotencyKey ?? "abort" }, principal);
    const session = getRpcSession(input.targetSessionId);
    const command = this.activeCommands.get(input.targetSessionId);
    if (!session?.isAlive()) {
      if (!await resolveSessionPath(input.targetSessionId)) throw new SessionMessageRouterError("SESSION_NOT_FOUND", "Session not found.");
      return { accepted: true, sessionId: input.targetSessionId, status: "idle" };
    }
    const runId = session.getActivePromptRunId();
    if (!session.isRunning() && !runId) return { accepted: true, sessionId: input.targetSessionId, status: "idle" };
    if (command) {
      command.status = "cancelled";
      await this.transition(command, "cancelled", {}, "command_cancelled");
    }
    await session.send({ type: "abort", commandId: command?.commandId });
    return {
      accepted: true,
      sessionId: input.targetSessionId,
      status: command ? "cancelled" : "interrupted",
      ...(command?.commandId ? { commandId: command.commandId } : {}),
      ...(runId ? { runId } : {}),
    };
  }

  async cancelCommand(commandId: string, principal?: SessionRoutePrincipal): Promise<AbortReceipt> {
    const command = this.canonicalCommand(commandId);
    assertPrincipal({ targetSessionId: command.targetSessionId, content: "", source: "system", idempotencyKey: command.idempotencyKey }, principal);
    const receipt = await this.cancelRecord(command);
    return { ...receipt, status: receipt.status === "cancelled" || receipt.status === "interrupted" ? receipt.status : "idle" };
  }

  getClientAction(sessionId: string, commandId: string, requestId: string): { text: string } {
    return this.chatOperations.getClientAction(sessionId, commandId, requestId);
  }

  confirmClientAction(sessionId: string, commandId: string, requestId: string, success: boolean, error?: string): void {
    this.chatOperations.confirmClientAction(sessionId, commandId, requestId, success, error);
  }

  async cancelPromptSubmission(
    input: { targetSessionId: string; idempotencyKey: string; promptCommandId?: string },
    principal?: SessionRoutePrincipal,
  ): Promise<PromptCancellationReceipt> {
    if (
      typeof input.targetSessionId !== "string"
      || !input.targetSessionId.trim()
      || input.targetSessionId.length > 512
      || typeof input.idempotencyKey !== "string"
      || !input.idempotencyKey.trim()
      || input.idempotencyKey.length > 512
      || (input.promptCommandId !== undefined && !/^cmd_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.promptCommandId))
    ) {
      throw new SessionMessageRouterError("INVALID_SESSION_MESSAGE", "A bounded original submission identity is required.");
    }
    assertPrincipal({ targetSessionId: input.targetSessionId, content: "", source: "ui", idempotencyKey: input.idempotencyKey }, principal);
    let command = await this.submissionCommand(input.targetSessionId, input.idempotencyKey);
    if (input.promptCommandId) {
      command = this.canonicalCommand(input.promptCommandId);
    }
    if (command) {
      if (command.targetSessionId !== input.targetSessionId || command.idempotencyKey !== input.idempotencyKey || command.delivery !== "next_turn") {
        throw new SessionMessageRouterError("INVALID_SESSION_MESSAGE", "The command does not match this prompt submission.");
      }
      return this.cancelRecord(command);
    }
    const key = submissionKey(input.targetSessionId, input.idempotencyKey);
    if (!this.cancellationIntents.has(key) && this.cancellationIntents.size >= 256) {
      throw new SessionMessageRouterError("SESSION_QUEUE_FULL", "Pending prompt cancellation capacity is full.");
    }
    this.cancellationIntents.add(key);
    // A resolver may still be blocked before a real command exists. The fence
    // is already effective; do not make Stop wait for that original POST.
    return { accepted: true, sessionId: input.targetSessionId, status: "cancellation_pending" };
  }

  private cancelRecord(command: SessionCommandRecord): Promise<PromptCancellationReceipt> {
    command = this.knownCommands.get(command.commandId) ?? command;
    const existing = this.cancellationWork.get(command.commandId);
    if (existing) return existing;
    const key = submissionKey(command.targetSessionId, command.idempotencyKey);
    if (TERMINAL_STATUSES.has(command.status)) {
      this.cancellationIntents.delete(key);
      return Promise.resolve({
        accepted: true,
        sessionId: command.targetSessionId,
        status: command.status,
        commandId: command.commandId,
        ...(command.runId ? { runId: command.runId } : {}),
      });
    }
    const priorStatus = command.status;
    if (command.operation && priorStatus === "running" && command.operation.phase !== "waiting_client" && !command.runId) {
      return Promise.reject(new SessionMessageRouterError("SESSION_BUSY", "This command cannot be interrupted while its handler is running."));
    }
    this.chatOperations.rejectClientAction(command.commandId, "Command cancelled");
    getSessionInboxRegistry().removeCommand(command.targetSessionId, command.commandId);
    // Canonical mutation happens synchronously, before journal waits or SDK calls.
    command.status = "cancelled";
    this.rememberCommand(command);
    const admission = this.admissions.get(command.commandId);
    const active = this.activeCommands.get(command.targetSessionId);
    const session = admission?.session ?? getRpcSession(command.targetSessionId);
    const runId = admission?.runId ?? command.runId;
    let abort: Promise<{ value?: unknown; error?: unknown }> | undefined;
    const ownsAdmission = admission?.started === true && active?.commandId === command.commandId;
    const ownsRun = active?.commandId === command.commandId && !!runId && session?.getActivePromptRunId() === runId;
    const pendingAdmission = ownsAdmission && !runId && !session?.getActivePromptRunId() && !session?.isRunning();
    if (session?.isAlive() && (ownsRun || pendingAdmission)) {
      // AgentSessionWrapper.send(abort) signals abortGeneration synchronously.
      // No await can admit a newer run between identity check and this call.
      abort = session.send({ type: "abort", commandId: command.commandId, ...(runId ? { runId } : {}) })
        .then(value => ({ value }), error => ({ error }));
    } else if (priorStatus === "running" || priorStatus === "delivered" || ownsAdmission) {
      command.status = "interrupted";
      // The runtime no longer belongs to this old command. Settle only its
      // router waiter rather than waiting for, or aborting, the newer run.
      admission?.cancelTerminal?.();
    }
    const cancellation = (async (): Promise<PromptCancellationReceipt> => {
      await this.commandDurability.get(command.commandId);
      await this.transition(command, command.status, {}, command.status === "interrupted" ? "command_interrupted" : "command_cancelled");
      const outcome = await abort;
      if (outcome && Object.hasOwn(outcome, "error")) throw outcome.error;
      const result = outcome?.value as { queuedMessages?: { id?: unknown; steering?: unknown; followUp?: unknown } } | undefined;
      const queued = result?.queuedMessages;
      const queuedMessages = queued && typeof queued.id === "string" && Array.isArray(queued.steering) && Array.isArray(queued.followUp)
        && queued.steering.every(item => typeof item === "string") && queued.followUp.every(item => typeof item === "string")
        ? { id: queued.id, steering: queued.steering as string[], followUp: queued.followUp as string[] }
        : undefined;
      this.cancellationIntents.delete(key);
      return {
        accepted: true,
        sessionId: command.targetSessionId,
        status: command.status,
        commandId: command.commandId,
        ...(runId ? { runId } : {}),
        ...(queuedMessages ? { queuedMessages } : {}),
      };
    })();
    // Failed journal/SDK work remains a failed receipt on retry. Clearing this
    // cache would turn an unproven canonical terminal into a false success or
    // issue a second generic abort against a newer run.
    this.cancellationWork.set(command.commandId, cancellation);
    return cancellation;
  }

  async getState(sessionId: string): Promise<SessionControlState> {
    const inbox = await this.ensureLoaded(sessionId);
    const session = getRpcSession(sessionId)?.isAlive() ? getRpcSession(sessionId) : undefined;
    if (!session && !await resolveSessionPath(sessionId)) throw new SessionMessageRouterError("SESSION_NOT_FOUND", "Session not found.");
    const live = this.activeCommands.get(sessionId);
    const snapshot = session?.getTaskRuntimeSnapshot();
    return {
      sessionId,
      runtime: snapshot?.runtime ?? "idle",
      ...(live?.commandId ? { activeCommandId: live.commandId } : {}),
      ...(live?.runId ? { activeRunId: live.runId } : {}),
      queueLength: inbox.queue.length,
      attention: snapshot?.pendingApproval ? "needs_approval" : snapshot?.lastPromptFailed ? "failed" : "none",
      pendingApproval: snapshot?.pendingApproval ?? false,
      ...(snapshot?.errorSummary ? { lastFailureSummary: snapshot.errorSummary } : {}),
    };
  }

  async getCommand(commandId: string, sessionId?: string): Promise<SessionCommandRecord> {
    if (!sessionId) return { ...this.canonicalCommand(commandId) };
    const known = this.knownCommands.get(commandId);
    if (known?.targetSessionId === sessionId) return { ...known };
    const found = await this.store.queryByCommandId(sessionId, commandId);
    if (!found) throw new SessionMessageRouterError("COMMAND_NOT_FOUND", "Command not found.");
    return { ...found };
  }

  async operationWindow(sessionId: string) {
    await this.ensureLoaded(sessionId);
    return this.store.operationWindow(sessionId);
  }

  lastEventCursor(sessionId: string): number {
    return this.events.lastCursor(sessionId);
  }

  private canonicalCommand(commandId: string): SessionCommandRecord {
    const known = this.knownCommands.get(commandId);
    if (known) return known;
    const found = this.store.findByCommandId(commandId);
    if (!found) throw new SessionMessageRouterError("COMMAND_NOT_FOUND", "Command not found.");
    this.rememberCommand(found);
    return found;
  }

  listEvents(sessionId: string, afterCursor = 0): SessionCommandEvent[] {
    return this.events.list(sessionId, afterCursor);
  }

  /** Resume persisted accepted/queued inbox work after process startup. */
  async resumeSession(sessionId: string): Promise<void> {
    await this.ensureLoaded(sessionId);
    await this.drain(sessionId);
  }

  subscribeEvents(sessionId: string, listener: (event: SessionCommandEvent) => void): () => void {
    return this.events.subscribe(sessionId, listener);
  }
}

declare global {
  var __pioraSessionMessageRouter: SessionMessageRouter | undefined;
}

export function getSessionMessageRouter(): SessionMessageRouter {
  return globalThis.__pioraSessionMessageRouter ??= new SessionMessageRouter();
}

export function resetSessionMessageRouterForTests(): void {
  globalThis.__pioraSessionMessageRouter = undefined;
}

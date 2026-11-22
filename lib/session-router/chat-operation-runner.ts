import { randomUUID } from "node:crypto";
import type { ChatCommandExecutionContext, executeChatCommandOperation } from "../chat-command-runtime";
import type { ChatCommandOperation, ChatCommandPhase } from "../chat-command-types";
import type { AgentSessionWrapper } from "../rpc-manager";
import { getSessionInboxRegistry, type SessionInboxState } from "../session-inbox";
import type {
  SessionCommandEvent,
  SessionCommandRecord,
  SessionCommandStatus,
} from "../session-message-types";
import type { resolveOrStartRpcSession } from "../session-runtime-resolver";
import {
  safeErrorMessage,
  SessionMessageRouterError,
  TERMINAL_STATUSES,
} from "./errors";

export interface SessionAdmission {
  session: AgentSessionWrapper;
  started: boolean;
  runId?: string;
  cancelTerminal?: () => void;
}

interface PendingClientAction {
  id: string;
  text: string;
  expiresAt: number;
  resolve: () => void;
  reject: (error: Error) => void;
}

export interface ChatOperationHost {
  resolver: typeof resolveOrStartRpcSession;
  commandExecutor: typeof executeChatCommandOperation;
  inbox: (sessionId: string) => SessionInboxState;
  isCancelled: (command: SessionCommandRecord) => boolean;
  canonicalCommand: (commandId: string) => SessionCommandRecord;
  transition: (
    command: SessionCommandRecord,
    status: SessionCommandStatus,
    patch?: Partial<SessionCommandRecord>,
    eventType?: SessionCommandEvent["type"],
  ) => Promise<void>;
  waitForTerminal: (session: AgentSessionWrapper, command: SessionCommandRecord) => {
    promise: Promise<"completed" | "failed" | "interrupted" | "cancelled">;
    cancel: () => void;
  };
  setAdmission: (commandId: string, admission: SessionAdmission) => void;
  deleteAdmission: (commandId: string) => void;
  setActiveCommand: (sessionId: string, command: SessionCommandRecord) => void;
  clearActiveCommandIfMatch: (sessionId: string, commandId: string) => void;
  triggerDrain: (sessionId: string) => void;
}

export class ChatOperationRunner {
  readonly clientActions = new Map<string, PendingClientAction>();
  readonly operationExecutions = new Map<string, Promise<void>>();

  constructor(private readonly host: ChatOperationHost) {}

  run(command: SessionCommandRecord, session?: AgentSessionWrapper): Promise<void> {
    const existing = this.operationExecutions.get(command.commandId);
    if (existing) return existing;
    const execution = this.execute(command, session).finally(() => {
      this.operationExecutions.delete(command.commandId);
      this.host.triggerDrain(command.targetSessionId);
    });
    this.operationExecutions.set(command.commandId, execution);
    return execution;
  }

  rejectClientAction(commandId: string, reason: string): void {
    this.clientActions.get(commandId)?.reject(new Error(reason));
  }

  getClientAction(sessionId: string, commandId: string, requestId: string): { text: string } {
    const command = this.host.canonicalCommand(commandId);
    const action = this.clientActions.get(commandId);
    if (
      command.targetSessionId !== sessionId
      || !action
      || action.id !== requestId
      || action.expiresAt <= Date.now()
      || this.host.isCancelled(command)
      || TERMINAL_STATUSES.has(command.status)
    ) {
      throw new SessionMessageRouterError("COMMAND_NOT_FOUND", "Client action is no longer active.");
    }
    return { text: action.text };
  }

  confirmClientAction(sessionId: string, commandId: string, requestId: string, success: boolean, error?: string): void {
    this.getClientAction(sessionId, commandId, requestId);
    const action = this.clientActions.get(commandId)!;
    if (success) action.resolve();
    else action.reject(new Error(error?.slice(0, 500) || "Clipboard action failed"));
  }

  private async requestClientCopy(
    command: SessionCommandRecord,
    operation: ChatCommandOperation,
    text: string,
    update: (phase?: ChatCommandPhase) => Promise<void>,
  ): Promise<void> {
    const id = randomUUID();
    const expiresAt = Date.now() + 60_000;
    let timer: ReturnType<typeof setTimeout>;
    const confirmation = new Promise<void>((resolve, reject) => {
      this.clientActions.set(command.commandId, { id, text, expiresAt, resolve, reject });
      timer = setTimeout(
        () => reject(Object.assign(new Error("Client action was not confirmed"), { code: "CLIENT_ACTION_UNCONFIRMED" })),
        60_000,
      );
    });
    void confirmation.catch(() => {});
    operation.result = { title: "chatCommands.copyWaiting", clientAction: { id, kind: "copy", characters: text.length, expiresAt } };
    try {
      await update("waiting_client");
      await confirmation;
    } finally {
      clearTimeout(timer!);
      this.clientActions.delete(command.commandId);
    }
  }

  private async execute(command: SessionCommandRecord, session?: AgentSessionWrapper): Promise<void> {
    const operation = command.operation!;
    const commandStep = operation.steps[0];
    const promptStep = operation.steps[1];
    let progress = Promise.resolve();
    const update = (phase?: ChatCommandPhase) => {
      if (phase) operation.phase = phase;
      const snapshot = structuredClone(operation);
      progress = progress.then(() => this.host.transition(command, command.status, { operation: snapshot }, "command_progress"));
      return progress;
    };
    const assertActive = () => {
      if (this.host.isCancelled(command) || TERMINAL_STATUSES.has(command.status)) throw new Error("Command cancelled");
      if (session && !session.isAlive()) throw new Error("Session runtime stopped");
    };
    const stopCommandTracking = session?.onEvent(event => {
      if (event.type !== "prompt_started" || event.commandId !== command.commandId || typeof event.runId !== "string") return;
      if (session?.getActivePromptRunId() !== event.runId) return;
      command.runId = event.runId;
      commandStep.runId = event.runId;
      this.host.setAdmission(command.commandId, { session, started: true, runId: event.runId });
      this.host.setActiveCommand(command.targetSessionId, command);
      void update("model");
    });
    const prompt = async (message: string) => {
      if (!session) session = (await this.host.resolver(command.targetSessionId)).session;
      assertActive();
      const runtimeCommand = { ...command, commandId: `cmd_${randomUUID()}`, runId: undefined };
      const terminal = this.host.waitForTerminal(session, runtimeCommand);
      const admission: SessionAdmission = { session, started: true, runId: undefined, cancelTerminal: terminal.cancel };
      this.host.setAdmission(command.commandId, admission);
      this.host.setActiveCommand(command.targetSessionId, command);
      const trackRun = session.onEvent(event => {
        if (event.type === "prompt_started" && event.commandId === runtimeCommand.commandId && typeof event.runId === "string") {
          command.runId = event.runId;
          admission.runId = event.runId;
        }
      });
      try {
        const started = await session.startTrackedPrompt({
          commandId: runtimeCommand.commandId,
          source: command.source,
          message,
          ...(command.workflow ? { workflow: command.workflow } : {}),
          ...(!operation.afterPrompt || commandStep.status === "completed"
            ? { images: command.images, materials: command.materials, promptSuffix: command.promptSuffix }
            : {}),
        });
        command.runId = started.runId;
        admission.runId = started.runId;
        const step = commandStep.status === "completed" && promptStep ? promptStep : commandStep;
        step.runId = started.runId;
        await update("model");
        const status = await terminal.promise;
        if (status !== "completed") throw new Error(runtimeCommand.errorMessage ?? `Prompt ${status}`);
        assertActive();
      } finally {
        terminal.cancel();
        trackRun();
        this.host.deleteAdmission(command.commandId);
        this.host.clearActiveCommandIfMatch(command.targetSessionId, command.commandId);
      }
    };
    try {
      assertActive();
      operation.startedAt ??= Date.now();
      await this.host.transition(command, "running", { operation });
      if (commandStep.status !== "completed") {
        commandStep.status = "running";
        commandStep.startedAt = Date.now();
        await update("executing");
        const context: ChatCommandExecutionContext = {
          session,
          assertActive,
          phase: phase => { void update(phase); },
          prompt,
          copy: text => this.requestClientCopy(command, operation, text, update),
        };
        operation.result = await this.host.commandExecutor(command, context);
        assertActive();
        commandStep.status = "completed";
        commandStep.completedAt = Date.now();
        await update("settling");
        if (promptStep) {
          const inbox = this.host.inbox(command.targetSessionId);
          getSessionInboxRegistry().enqueue(command);
          inbox.queue.sort((left, right) => left.acceptedAt - right.acceptedAt);
          operation.phase = "queued";
          await this.host.transition(command, "queued", { operation: structuredClone(operation) });
          return;
        }
      } else if (promptStep?.status === "pending") {
        promptStep.status = "running";
        promptStep.startedAt = Date.now();
        await update("model");
        await prompt(operation.afterPrompt!);
        promptStep.status = "completed";
        promptStep.completedAt = Date.now();
      }
      assertActive();
      operation.completedAt = Date.now();
      await progress;
      await this.host.transition(command, "completed", { operation: structuredClone(operation) });
    } catch (error) {
      const cancelled = this.host.isCancelled(command);
      for (const step of operation.steps) {
        if (step.status === "running") {
          step.status = cancelled ? "cancelled" : "failed";
          step.error = safeErrorMessage(error);
          step.completedAt = Date.now();
        } else if (step.status === "pending") {
          step.status = cancelled ? "cancelled" : "blocked";
        }
      }
      operation.completedAt = Date.now();
      await progress.catch(() => {});
      await this.host.transition(
        command,
        cancelled
          ? command.status
          : (error as { code?: string }).code === "CLIENT_ACTION_UNCONFIRMED"
            ? "interrupted"
            : "failed",
        {
          operation: structuredClone(operation),
          errorMessage: safeErrorMessage(error),
          errorCode: cancelled ? "COMMAND_CANCELLED" : "COMMAND_EXECUTION_FAILED",
        },
      );
    } finally {
      stopCommandTracking?.();
      this.host.deleteAdmission(command.commandId);
      this.host.clearActiveCommandIfMatch(command.targetSessionId, command.commandId);
    }
  }
}

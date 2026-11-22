import { randomUUID } from "node:crypto";
import { createChatCommandOperation, parseChatInput } from "../chat-command-input";
import { resolvePromptMaterialReferences } from "../prompt-materials";
import type { AgentSessionWrapper } from "../rpc-manager";
import type { SessionControlStore } from "../session-control-store";
import {
  getSessionInboxRegistry,
  SESSION_COMMAND_MAX_BYTES,
  SESSION_INBOX_LIMIT,
  SESSION_INBOX_MAX_BYTES,
  sessionCommandBytes,
  type SessionInboxState,
} from "../session-inbox";
import type {
  PromptCancellationReceipt,
  SessionCommandEvent,
  SessionCommandRecord,
  SessionCommandStatus,
  SessionMessageInput,
} from "../session-message-types";
import type { resolveOrStartRpcSession } from "../session-runtime-resolver";
import {
  resolveRouterErrorCode,
  safeErrorMessage,
  SessionMessageRouterError,
  TERMINAL_STATUSES,
  validateSessionMessageInput,
} from "./errors";

export interface QueueMutationHost {
  store: SessionControlStore;
  resolver: typeof resolveOrStartRpcSession;
  maxMessageBytes: number;
  queueActions: Set<string>;
  inbox: (sessionId: string) => SessionInboxState;
  ensureLoaded: (sessionId: string) => Promise<SessionInboxState>;
  getLiveSession: (sessionId: string) => Promise<AgentSessionWrapper>;
  makeRecord: (input: SessionMessageInput) => SessionCommandRecord;
  rememberCommand: (command: SessionCommandRecord) => void;
  canonicalCommand: (commandId: string) => SessionCommandRecord;
  isCancelled: (command: SessionCommandRecord) => boolean;
  cancelRecord: (command: SessionCommandRecord) => Promise<PromptCancellationReceipt>;
  deliverQueuedCommand: (command: SessionCommandRecord, session: AgentSessionWrapper, type: "steer" | "follow_up") => Promise<void>;
  transition: (
    command: SessionCommandRecord,
    status: SessionCommandStatus,
    patch?: Partial<SessionCommandRecord>,
    eventType?: SessionCommandEvent["type"],
  ) => Promise<void>;
  drain: (sessionId: string) => Promise<void>;
}

/** Recall into separate durable, paused queue entries before removing SDK input. */
export async function recallSessionQueuedInputs(
  host: QueueMutationHost,
  sessionId: string,
  mutation?: { inputId: string; action: "queue" | "delete" },
): Promise<SessionCommandRecord[]> {
  const mutationKey = mutation ? "pending-input:" + mutation.inputId : undefined;
  if (mutationKey) {
    const existing = await host.store.queryByIdempotencyKey(sessionId, mutationKey);
    if (existing) return [existing];
  }
  const inbox = await host.ensureLoaded(sessionId);
  const session = await host.getLiveSession(sessionId);
  const batch = session.prepareQueueRecall(mutation?.inputId);
  const commands = batch.messages.map(({ message, commandId }) => {
    const original = commandId ? host.store.findByCommandId(commandId, sessionId) : undefined;
    if (commandId && !original) throw new Error("The original submission is unavailable; nothing was removed.");
    let content: string;
    let images: SessionMessageInput["images"];
    if (original) {
      content = original.content;
      images = original.images;
      // Resolve the complete attachments before committing any removal.
      if (original.materials?.length) resolvePromptMaterialReferences(original.materials);
    } else {
      if (message.role !== "user") throw new Error("Unsupported queued message; nothing was removed.");
      if (typeof message.content === "string") content = message.content;
      else {
        if (message.content.some(block => block.type !== "text" && block.type !== "image")) {
          throw new Error("Unsupported queued attachment; nothing was removed.");
        }
        content = message.content.filter(block => block.type === "text").map(block => block.text).join("\n");
        images = message.content.filter(block => block.type === "image");
      }
    }
    const input: SessionMessageInput = {
      targetSessionId: sessionId,
      source: "ui",
      idempotencyKey: mutationKey ?? randomUUID(),
      delivery: "next_turn",
      inputMode: "text",
      content,
      images,
      ...(original?.materials ? { materials: original.materials } : {}),
      ...(original?.workflow ? { workflow: original.workflow } : {}),
      ...(original?.localFiles ? { localFiles: original.localFiles } : {}),
      ...(original?.promptSuffix ? { promptSuffix: original.promptSuffix } : {}),
    };
    validateSessionMessageInput(input, host.maxMessageBytes);
    return {
      ...host.makeRecord(input),
      status: mutation?.action === "delete" ? "cancelled" as const : "queued" as const,
      queuePaused: !mutation,
    };
  });
  if (!commands.length) return [];
  const persistFn = mutation
    ? host.store.appendQueueMutation.bind(host.store)
    : host.store.appendRecalledCommands.bind(host.store);
  await persistFn(commands, persist => batch.commit(() => {
    if (
      mutation?.action !== "delete"
      && (
        inbox.queue.length + commands.length > SESSION_INBOX_LIMIT
        || inbox.queuedBytes + commands.reduce((sum, command) => sum + sessionCommandBytes(command), 0) > SESSION_INBOX_MAX_BYTES
      )
    ) {
      throw new SessionMessageRouterError("SESSION_QUEUE_FULL", "The queue is full; nothing was removed.");
    }
    persist();
    for (const command of commands) {
      host.rememberCommand(command);
      if (mutation?.action !== "delete") getSessionInboxRegistry().enqueue(command);
    }
  }));
  for (const command of commands) await host.transition(command, command.status);
  if (mutation?.action === "queue") void host.drain(sessionId);
  return commands;
}

/** Mutate only waiting UI submissions. Never abort a run that won the dispatch race. */
export async function performQueuedInputAction(
  host: QueueMutationHost,
  sessionId: string,
  commandId: string,
  action: "pause" | "resume" | "edit" | "steer" | "cancel",
  text?: string,
  expectedRevision?: number,
): Promise<SessionCommandRecord> {
  await host.ensureLoaded(sessionId);
  const command = host.canonicalCommand(commandId);
  if (command.targetSessionId !== sessionId || command.source !== "ui") {
    throw new SessionMessageRouterError("COMMAND_NOT_FOUND", "Queued message not found.");
  }
  if (command.status === "cancelled" && action === "cancel") return { ...command };
  if (command.delivery === "steer" && action === "steer" && ["dispatching", "delivered", "completed"].includes(command.status)) {
    return { ...command };
  }
  if (command.delivery !== "next_turn" || !["accepted", "queued"].includes(command.status) || host.queueActions.has(commandId)) {
    throw new SessionMessageRouterError("SESSION_BUSY", "This message is no longer waiting or is being edited.");
  }
  if (expectedRevision !== undefined && command.revision !== expectedRevision) {
    throw new SessionMessageRouterError("SESSION_BUSY", "The queued message changed. Refresh before editing.");
  }
  host.queueActions.add(commandId);
  try {
    if (action === "cancel") {
      await host.cancelRecord(command);
    } else if (action === "steer") {
      if (command.operation) {
        throw new SessionMessageRouterError("INVALID_SESSION_MESSAGE", "Slash commands must finish through the command queue.");
      }
      const session = (await host.resolver(sessionId)).session;
      if (host.isCancelled(command)) throw new SessionMessageRouterError("SESSION_BUSY", "Message was cancelled.");
      if (!session.isRunning() || !session.getActivePromptRunId()) {
        throw new SessionMessageRouterError("STEER_REQUIRES_RUNNING_SESSION", "Steer requires a running Session.");
      }
      getSessionInboxRegistry().removeCommand(sessionId, commandId);
      try {
        await host.transition(command, "dispatching", {
          delivery: "steer",
          queuePaused: false,
          attachedRunId: session.getActivePromptRunId(),
        });
        if (host.isCancelled(command)) throw new Error("Message cancelled");
        await host.deliverQueuedCommand(command, session, "steer");
      } catch (error) {
        await host.transition(command, "failed", {
          errorCode: resolveRouterErrorCode(error),
          errorMessage: safeErrorMessage(error),
        });
        throw error;
      }
    } else {
      const patch: Partial<SessionCommandRecord> = { queuePaused: action === "pause" };
      if (action === "edit") {
        if (typeof text !== "string") throw new SessionMessageRouterError("INVALID_SESSION_MESSAGE", "Missing text.");
        patch.content = text;
        if (!command.operation) patch.inputMode = "text";
        if (command.operation?.steps[0]?.status === "completed") {
          if (command.operation.steps[1]?.status !== "pending" || (!text.trim() && !command.images?.length && !command.materials?.length)) {
            throw new SessionMessageRouterError("INVALID_SESSION_MESSAGE", "The follow-up query must be pending and nonempty.");
          }
          const invocation = "/" + command.operation.command.name + (command.operation.arguments ? " " + command.operation.arguments : "");
          patch.content = invocation;
          patch.operation = {
            ...structuredClone(command.operation),
            rawText: invocation,
            afterPrompt: text,
            inputOptions: { ...command.operation.inputOptions, afterPrompt: text },
          };
        } else if (command.operation) {
          const catalog = { revision: command.operation.catalogRevision, commands: [command.operation.command], diagnostics: [] };
          const parsed = parseChatInput(text, catalog, {
            ...command.operation.inputOptions,
            hasAttachments: Boolean(command.images?.length || command.materials?.length || command.promptSuffix),
          });
          if (parsed.kind !== "command") {
            throw new SessionMessageRouterError("INVALID_SESSION_MESSAGE", "Edit the pending command without changing its type.");
          }
          patch.operation = createChatCommandOperation(text, catalog, parsed, command.operation.inputOptions);
        }
        validateSessionMessageInput({ ...command, ...patch, teamExecution: undefined }, host.maxMessageBytes);
      }
      const previous = { ...command };
      const inbox = host.inbox(sessionId);
      const present = inbox.queue.some(item => item.commandId === commandId);
      const previousBytes = sessionCommandBytes(command);
      const candidateBytes = sessionCommandBytes({ ...command, ...patch });
      if (
        action !== "pause"
        && (
          candidateBytes > SESSION_COMMAND_MAX_BYTES
          || inbox.queuedBytes - (present ? previousBytes : 0) + candidateBytes > SESSION_INBOX_MAX_BYTES
          || (!present && inbox.queue.length >= SESSION_INBOX_LIMIT)
        )
      ) {
        throw new SessionMessageRouterError("SESSION_QUEUE_FULL", "The queue is full. Free capacity before resuming this message.");
      }
      let admitted = false;
      try {
        // Reserve execution capacity before publishing an unpaused state.
        // Recovery may exist only in the journal when Stop found a full inbox.
        Object.assign(command, patch);
        if (!present && action !== "pause") {
          getSessionInboxRegistry().enqueue(command);
          admitted = true;
        } else if (present) {
          inbox.queuedBytes += candidateBytes - previousBytes;
        }
        await host.transition(command, "queued", patch);
      } catch (error) {
        if (admitted) getSessionInboxRegistry().removeCommand(sessionId, commandId);
        if (!TERMINAL_STATUSES.has(command.status)) Object.assign(command, previous);
        throw error;
      } finally {
        inbox.queuedBytes = inbox.queue.reduce((total, item) => total + sessionCommandBytes(item), 0);
      }
    }
    return { ...command };
  } finally {
    host.queueActions.delete(commandId);
    const previousDrain = host.inbox(sessionId).drainPromise;
    void Promise.resolve(previousDrain)
      .then(() => host.drain(sessionId))
      .catch(error => console.error("[pi-web] queued input wake failed:", safeErrorMessage(error)));
  }
}

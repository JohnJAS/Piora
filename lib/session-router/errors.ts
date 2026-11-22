import { buildPromptWithMaterials, resolvePromptMaterialReferences } from "../prompt-materials";
import { validateAgentImages } from "../image-attachments";
import { SessionRuntimeResolverError } from "../session-runtime-resolver";
import { parseWorkflowAction, parseWorkflowPromptOptions } from "../workflow-input";
import type {
  SessionCommandStatus,
  SessionMessageInput,
  SessionMessageSourceKind,
} from "../session-message-types";

export interface SessionRoutePrincipal {
  kind?: SessionMessageSourceKind;
  allowedSessionIds?: ReadonlySet<string>;
  scopes?: ReadonlySet<string>;
}

export type SessionMessageRouterErrorCode =
  | "SESSION_NOT_FOUND"
  | "SESSION_NOT_ALLOWED"
  | "SESSION_PROFILE_MISMATCH"
  | "SESSION_FILE_INVALID"
  | "INVALID_SESSION_ID"
  | "SESSION_BUSY"
  | "SESSION_QUEUE_FULL"
  | "COMMAND_NOT_FOUND"
  | "COMMAND_DUPLICATE"
  | "COMMAND_EXPIRED"
  | "STEER_REQUIRES_RUNNING_SESSION"
  | "SESSION_MESSAGE_TOO_LARGE"
  | "INVALID_SESSION_MESSAGE"
  | "RUNTIME_START_FAILED"
  | "RUN_INTERRUPTED"
  | "TEAM_INVALID_CONTEXT"
  | "TEAM_LEASE_INVALID";

export class SessionMessageRouterError extends Error {
  constructor(readonly code: SessionMessageRouterErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SessionMessageRouterError";
  }
}

export const TERMINAL_STATUSES = new Set<SessionCommandStatus>([
  "completed",
  "failed",
  "cancelled",
  "expired",
  "interrupted",
]);

export function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
}

export function resolveRouterErrorCode(error: unknown): SessionMessageRouterErrorCode {
  if (error instanceof SessionMessageRouterError) return error.code;
  if (error instanceof SessionRuntimeResolverError) {
    return error.code === "RUNTIME_START_FAILED" ? "RUNTIME_START_FAILED" : error.code;
  }
  const stableCode = (error as { code?: unknown } | null)?.code;
  if (stableCode === "TEAM_INVALID_CONTEXT" || stableCode === "TEAM_LEASE_INVALID") return stableCode;
  const message = safeErrorMessage(error);
  if (/busy|starting another prompt/i.test(message)) return "SESSION_BUSY";
  if (/queue full/i.test(message)) return "SESSION_QUEUE_FULL";
  return "RUNTIME_START_FAILED";
}

export function submissionKey(sessionId: string, idempotencyKey: string): string {
  return JSON.stringify([sessionId, idempotencyKey]);
}

export function buildSteeringText(
  input: Pick<SessionMessageInput, "content" | "promptSuffix" | "materials">,
): string {
  const message = input.promptSuffix ? `${input.content}\n\n${input.promptSuffix}` : input.content;
  return input.materials?.length
    ? buildPromptWithMaterials(message, resolvePromptMaterialReferences(input.materials))
    : message;
}

export function validateSessionMessageInput(input: SessionMessageInput, maxMessageBytes: number): void {
  if (input.workflowAction !== undefined) {
    parseWorkflowAction(input.workflowAction);
    if (
      input.source !== "ui"
      || input.delivery === "steer"
      || input.workflow
      || input.operation
      || input.roomContext
      || input.teamExecution
      || !["approve", "resume"].includes(input.workflowAction.action)
    ) {
      throw new SessionMessageRouterError("INVALID_SESSION_MESSAGE", "Invalid workflow execution request.");
    }
  }
  if (input.workflow !== undefined) {
    parseWorkflowPromptOptions(input.workflow);
    if (input.source !== "ui" || input.teamExecution || input.roomContext) {
      throw new SessionMessageRouterError("INVALID_SESSION_MESSAGE", "Workflow selection is available for ordinary chat submissions.");
    }
  }
  if (!input.targetSessionId || typeof input.targetSessionId !== "string") {
    throw new SessionMessageRouterError("INVALID_SESSION_MESSAGE", "targetSessionId is required.");
  }
  if (!input.idempotencyKey || typeof input.idempotencyKey !== "string" || input.idempotencyKey.length > 512) {
    throw new SessionMessageRouterError("INVALID_SESSION_MESSAGE", "A bounded idempotency key is required.");
  }
  if (typeof input.content !== "string" || (!input.content.trim() && !input.materials?.length && !input.images?.length)) {
    throw new SessionMessageRouterError("INVALID_SESSION_MESSAGE", "Message content cannot be empty without prompt materials or images.");
  }
  if (input.promptSuffix !== undefined && typeof input.promptSuffix !== "string") {
    throw new SessionMessageRouterError("INVALID_SESSION_MESSAGE", "Prompt suffix must be text.");
  }
  if (
    Buffer.byteLength(input.content, "utf8")
    + Buffer.byteLength(input.promptSuffix ?? "", "utf8")
    + Buffer.byteLength(input.operation?.inputOptions?.afterPrompt ?? "", "utf8")
    > maxMessageBytes
  ) {
    throw new SessionMessageRouterError(
      "SESSION_MESSAGE_TOO_LARGE",
      `Message content exceeds the ${Math.floor(maxMessageBytes / 1024)} KiB limit.`,
    );
  }
  if (input.expiresAt !== undefined && (!Number.isFinite(input.expiresAt) || input.expiresAt <= Date.now())) {
    throw new SessionMessageRouterError("COMMAND_EXPIRED", "The message expiry is in the past.");
  }
  if (input.teamExecution && input.source !== "room" && input.source !== "system") {
    throw new SessionMessageRouterError("TEAM_INVALID_CONTEXT", "Only the Team runtime may dispatch a Team execution context.");
  }
  if (
    (input.source === "room" && !input.roomContext)
    || (input.roomContext && (
      input.source !== "room"
      || !input.roomContext.roomId?.trim()
      || !input.roomContext.messageId?.trim()
      || input.roomContext.roomId.length > 512
      || input.roomContext.messageId.length > 512
    ))
  ) {
    throw new SessionMessageRouterError("INVALID_SESSION_MESSAGE", "Room context is valid only for bounded Room messages.");
  }
  const imageError = validateAgentImages(input.images);
  if (imageError) throw new SessionMessageRouterError("SESSION_MESSAGE_TOO_LARGE", imageError);
  if (
    input.materials !== undefined && (
      !Array.isArray(input.materials)
      || input.materials.length === 0
      || input.materials.length > 8
      || input.materials.some((material) => !material || typeof material.id !== "string" || !/^[0-9a-f-]{36}$/i.test(material.id))
    )
  ) {
    throw new SessionMessageRouterError("INVALID_SESSION_MESSAGE", "Prompt material references are invalid.");
  }
}

export function assertPrincipal(input: SessionMessageInput, principal?: SessionRoutePrincipal): void {
  if (principal?.allowedSessionIds && !principal.allowedSessionIds.has(input.targetSessionId)) {
    throw new SessionMessageRouterError("SESSION_NOT_ALLOWED", "The caller is not allowed to control this Session.");
  }
}

export type SessionMessageSourceKind = "ui" | "room" | "remote" | "extension" | "system";
export type SessionDeliveryMode = "next_turn" | "steer";
export type SessionCommandStatus =
  | "accepted"
  | "queued"
  | "dispatching"
  | "running"
  | "delivered"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired"
  | "interrupted";

export interface SessionMessageImage {
  type: "image";
  data: string;
  mimeType: string;
}
export interface SessionMessageInput {
  targetSessionId: string;
  content: string;
  delivery?: SessionDeliveryMode;
  source: SessionMessageSourceKind;
  idempotencyKey: string;
  images?: SessionMessageImage[];
  expiresAt?: number;
  goalMode?: boolean;
  planMode?: boolean;
  planExecution?: { planId: string; expectedRevision: number };
}

export interface SessionCommandRecord {
  commandId: string;
  idempotencyKey: string;
  targetSessionId: string;
  content: string;
  delivery: SessionDeliveryMode;
  source: SessionMessageSourceKind;
  acceptedAt: number;
  queuedAt?: number;
  expiresAt?: number;
  status: SessionCommandStatus;
  runId?: string;
  attachedRunId?: string;
  errorCode?: string;
  errorMessage?: string;
  images?: SessionMessageImage[];
  goalMode?: boolean;
  planMode?: boolean;
  planExecution?: { planId: string; expectedRevision: number };
}

export interface DispatchReceipt {
  accepted: true;
  commandId: string;
  sessionId: string;
  status: SessionCommandStatus;
  queuePosition?: number;
  runId?: string;
  attachedRunId?: string;
  idempotent?: boolean;
}

export interface AbortReceipt {
  accepted: true;
  sessionId: string;
  status: "cancelled" | "interrupted" | "idle";
  commandId?: string;
  runId?: string;
}

export interface SessionControlState {
  sessionId: string;
  runtime: "idle" | "running" | "compacting" | "stopping";
  activeCommandId?: string;
  activeRunId?: string;
  queueLength: number;
  attention: "none" | "needs_approval" | "needs_input" | "failed";
  pendingApproval: boolean;
  lastFailureSummary?: string;
}

export interface SessionCommandEvent {
  cursor: number;
  type:
    | "prompt_started"
    | "prompt_done"
    | "prompt_error"
    | "command_accepted"
    | "command_queued"
    | "command_dispatching"
    | "command_running"
    | "command_delivered"
    | "command_completed"
    | "command_failed"
    | "command_cancelled"
    | "command_expired"
    | "command_interrupted"
    | "session_state";
  sessionId: string;
  commandId?: string;
  runId?: string;
  attachedRunId?: string;
  status?: SessionCommandStatus;
  timestamp: number;
  errorCode?: string;
  errorMessage?: string;
  state?: SessionControlState;
}

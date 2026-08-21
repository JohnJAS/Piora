export type RoomMemberRole = "coordinator" | "planner" | "worker" | "reviewer" | "participant";
export type RoomMessageAuthorKind = "user" | "session" | "system";

export interface RoomMember {
  memberId: string;
  sessionId: string;
  name?: string;
  instructions?: string;
  cwd?: string;
  projectRoot?: string;
  worktreeBranch?: string;
  role: RoomMemberRole;
  joinedAt: number;
}

export interface CollaborationRoom {
  schemaVersion: 2;
  id: string;
  name: string;
  description?: string;
  projectRoot?: string;
  createdAt: number;
  updatedAt: number;
  nextSeq: number;
  members: RoomMember[];
  coordination: {
    mode: "manual" | "coordinator";
    coordinatorSessionId?: string;
    maxConcurrency: number;
    leaseDurationMs: number;
  };
  workspace: {
    mode: "managed" | "custom";
    path: string;
    label: string;
    instructions?: string;
  };
  paths: {
    root: string;
    shared: string;
    privateRoot: string;
  };
}

export type RoomTaskStatus = "pending" | "leased" | "running" | "completed" | "failed" | "blocked" | "cancelled";

export interface RoomTaskLease {
  holderSessionId: string;
  token: string;
  acquiredAt: number;
  heartbeatAt: number;
  expiresAt: number;
}

export interface RoomTask {
  schemaVersion: 1;
  id: string;
  roomId: string;
  title: string;
  description: string;
  status: RoomTaskStatus;
  priority: number;
  createdBy: string;
  assignedTo?: string;
  dedupeKey?: string;
  dependsOn: string[];
  lease?: RoomTaskLease;
  attempt: number;
  maxAttempts: number;
  createdAt: number;
  updatedAt: number;
  result?: string;
  error?: string;
  finalizedLeaseToken?: string;
  workspace?: {
    cwd: string;
    projectRoot?: string;
    worktreeBranch?: string;
  };
}

export type RoomArtifactKind = "patch" | "commit" | "report" | "file";

export interface RoomArtifact {
  schemaVersion: 1;
  id: string;
  roomId: string;
  sessionId: string;
  taskId?: string;
  kind: RoomArtifactKind;
  name: string;
  summary: string;
  sourcePath?: string;
  storedPath?: string;
  worktree?: {
    cwd?: string;
    projectRoot?: string;
    branch?: string;
  };
  createdAt: number;
}

export type RoomEvent =
  | { type: "message"; roomId: string; message: RoomMessage }
  | { type: "presence"; roomId: string; presence: RoomPresence }
  | { type: "task"; roomId: string; task: RoomTask }
  | { type: "room"; roomId: string; room: CollaborationRoom }
  | { type: "artifact"; roomId: string; artifact: RoomArtifact }
  | { type: "audit"; roomId: string; audit: RoomAuditEntry };

export interface RoomAuditEntry {
  id: string;
  roomId: string;
  actorSessionId: string;
  action: "room.created" | "room.updated" | "member.added" | "member.updated" | "member.removed" | "workspace.updated" | "coordination.updated";
  summary: string;
  createdAt: number;
}

export interface RoomMessage {
  id: string;
  roomId: string;
  seq: number;
  author: {
    kind: RoomMessageAuthorKind;
    id: string;
    name?: string;
  };
  content: string;
  createdAt: number;
  replyTo?: string;
  correlationId?: string;
  /** Bounded automatic-routing metadata used to prevent reply storms. */
  forwardDepth?: number;
  autoRound?: number;
  maxAutoRounds?: number;
}

export interface RoomPresence {
  sessionId: string;
  messageId: string;
  status: "processing" | "completed" | "error";
  detail?: string;
  updatedAt: number;
}

export interface PrivateRoomNote {
  id: string;
  roomId: string;
  sessionId: string;
  content: string;
  createdAt: number;
}

export interface RoomSnapshot {
  room: CollaborationRoom;
  messages: RoomMessage[];
}

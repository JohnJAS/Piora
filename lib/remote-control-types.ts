export const REMOTE_CONTROL_SCOPES = [
  "session.state.read",
  "session.message.send",
  "session.steer",
  "session.abort",
  "session.events.read",
  "session.messages.read",
] as const;

export type RemoteControlScope = (typeof REMOTE_CONTROL_SCOPES)[number];

export interface RemoteCapabilityTokenRecord {
  id: string;
  tokenHash: string;
  name: string;
  scopes: RemoteControlScope[];
  allowedSessionIds: string[];
  allowedRoomIds: string[];
  createdAt: number;
  expiresAt?: number;
  revokedAt?: number;
  lastUsedAt?: number;
}
export interface PublicRemoteCapabilityToken extends Omit<RemoteCapabilityTokenRecord, "tokenHash"> {
  active: boolean;
}

export interface RemoteCapabilityPrincipal {
  tokenId: string;
  scopes: ReadonlySet<RemoteControlScope>;
  allowedSessionIds: ReadonlySet<string>;
  allowedRoomIds: ReadonlySet<string>;
}

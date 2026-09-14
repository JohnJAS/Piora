export type SSHAuth =
  | { type: "password"; password: string }
  | { type: "privateKey"; privateKey: string; passphrase?: string };

export interface SSHConnectionOptions {
  host: string;
  port?: number;
  username: string;
  auth: SSHAuth;
  cols?: number;
  rows?: number;
}

export interface SSHSessionSnapshot {
  id: string;
  host: string;
  port: number;
  username: string;
  cwd: string;
  connected: boolean;
  output: string;
  mode: "independent" | "agent-controlled";
  agentSessionId?: string;
}

export type SSHSessionEvent =
  | { type: "snapshot"; snapshot: SSHSessionSnapshot }
  | { type: "output"; data: string }
  | { type: "status"; connected: boolean; error?: string }
  | { type: "cwd"; cwd: string };

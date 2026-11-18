import type { AgentRuntimeProfile } from "./agent-runtime-profile";
import type { RemoteSessionPolicy } from "./remote-session-policy";
import { assertRemotePolicyCommand } from "./remote-session-policy";
import { assertSessionNotMutating } from "./session-mutation";

export type SessionRpcCommand = { type?: unknown } & Record<string, unknown>;

export function commandRequiresSession(type: string): boolean {
  return type !== "abort" && type !== "get_state";
}

export function authorizeSessionCommand(
  sessionId: string,
  policy: RemoteSessionPolicy,
  command: SessionRpcCommand,
): string {
  assertRemotePolicyCommand(policy, command);
  const type = typeof command.type === "string" ? command.type : "";
  if (commandRequiresSession(type)) assertSessionNotMutating(sessionId);
  return type;
}

export function enforceCommandProfile(type: string, profile: AgentRuntimeProfile, denied: ReadonlySet<string>): void {
  if (profile === "device-control" && denied.has(type)) throw new Error("RPC command " + type + " is disabled by the device-control runtime profile.");
}

export function recheckCommandSession(type: string, sessionId: string, alive: boolean): void {
  if (!commandRequiresSession(type)) return;
  assertSessionNotMutating(sessionId);
  if (!alive) throw new Error("Session has been closed");
}

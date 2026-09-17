import { getSSHSessionForAgent, type SSHSession } from "./session-manager";

export class SSHBindingError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}

/** Check and invalidate both runtimes before changing where their Bash tool runs. */
export async function changeSSHBinding(session: SSHSession, agentSessionId?: string): Promise<void> {
  const { getRpcSession } = await import("../rpc-manager");
  const snapshot = session.snapshot();
  if (snapshot.agentSessionId === agentSessionId) return;
  if (agentSessionId && !snapshot.connected) throw new SSHBindingError("SSH is disconnected", "connection");
  const other = agentSessionId ? getSSHSessionForAgent(agentSessionId) : undefined;
  if (other && other !== session) throw new SSHBindingError("Task is already linked to another SSH terminal", "alreadyBound");
  const ids = new Set([snapshot.agentSessionId, agentSessionId].filter((id): id is string => !!id));
  const wrappers = [...ids].map(id => getRpcSession(id)).filter(wrapper => !!wrapper);
  if (snapshot.busy || [...ids].some(id => globalThis.__piStartLocks?.has(id)) || wrappers.some(wrapper => wrapper.getRuntime() !== "idle")) {
    throw new SSHBindingError("Wait for the task to become idle before changing its SSH terminal", "busy");
  }
  // No await here: admission and runtime replacement cannot interleave.
  for (const wrapper of wrappers) wrapper.destroy();
  if (agentSessionId) session.bindAgent(agentSessionId);
  else session.unbindAgent();
}

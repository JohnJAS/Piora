import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AgentSessionLike } from "./pi-types";

/** Snapshot both SDK queues using public APIs, without yielding to the agent loop. */
export function snapshotQueuedInputs(inner: AgentSessionLike): AgentMessage[] {
  const agent = inner.agent;
  if (!agent.peekQueuedMessages || !agent.clearSteeringQueue || !agent.steer) throw new Error("Queue recovery is unavailable for this runtime.");
  const steeringMode = agent.steeringMode;
  const followUpMode = agent.followUpMode;
  const steeringCount = inner.getSteeringMessages().length;
  const followUpCount = inner.getFollowUpMessages().length;
  let steering: AgentMessage[] = [];
  let removed = false;
  try {
    agent.steeringMode = "all";
    agent.followUpMode = "all";
    if (steeringCount) {
      steering = agent.peekQueuedMessages();
      if (steering.length !== steeringCount || steering.some(message => message.role !== "user")) throw new Error("The pending queue contains unsupported messages; nothing was removed.");
      agent.clearSteeringQueue();
      removed = true;
    }
    const followUp = agent.peekQueuedMessages();
    if (followUp.length !== followUpCount || followUp.some(message => message.role !== "user")) throw new Error("The pending queue changed; nothing was removed.");
    return [...steering, ...followUp];
  } finally {
    // Synchronous restoration cannot race with an SDK queue drain.
    if (removed) for (const message of steering) agent.steer(message);
    agent.steeringMode = steeringMode;
    agent.followUpMode = followUpMode;
  }
}

export function sameQueuedInputs(left: AgentMessage[], right: AgentMessage[]): boolean {
  return left.length === right.length && left.every((message, index) => message === right[index]);
}

/** Prepare a synchronous SDK adapter mutation. Reject incompatible queue views before persistence. */
export function prepareQueuedInputRemoval(inner: AgentSessionLike, selected: AgentMessage) {
  const snapshot = snapshotQueuedInputs(inner);
  const index = snapshot.indexOf(selected);
  if (index < 0) throw new Error("This message is no longer waiting.");
  const steering = inner.getSteeringMessages();
  const followUp = inner.getFollowUpMessages();
  const isSteering = index < steering.length;
  const labels = (isSteering ? steering : followUp) as string[];
  const offset = isSteering ? index : index - steering.length;
  const remaining = isSteering ? snapshot.slice(0, steering.length) : snapshot.slice(steering.length);
  remaining.splice(offset, 1);
  const clear = isSteering ? inner.agent.clearSteeringQueue : inner.agent.clearFollowUpQueue;
  const enqueue = isSteering ? inner.agent.steer : inner.agent.followUp;
  // The pinned SDK exposes live label arrays but has no per-message removal API.
  // Keep this compatibility boundary isolated; never replay input hooks or attachments.
  if (!clear || !enqueue || Object.isFrozen(labels) || Object.isSealed(labels)
    || labels !== (isSteering ? inner.getSteeringMessages() : inner.getFollowUpMessages())) throw new Error("Individual queue editing is unavailable for this runtime.");
  return (persist: () => void) => {
    if (!sameQueuedInputs(snapshot, snapshotQueuedInputs(inner))) throw new Error("The pending queue changed; nothing was removed.");
    persist();
    clear.call(inner.agent);
    for (const message of remaining) enqueue.call(inner.agent, message);
    labels.splice(offset, 1);
  };
}

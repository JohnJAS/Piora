/**
 * Lightweight per-session bus allowing `useChatCommandOperations` to consume
 * command snapshots and live command events multiplexed onto the active agent
 * SSE stream, keeping per-chat SSE sockets to at most 1.
 */
export interface SharedCommandStreamChannel {
  getActiveSessionId(): string | null;
  subscribeState(listener: () => void): () => void;
  activate(sessionId: string, token: object): void;
  deactivate(sessionId: string, token?: object): void;
  emit(sessionId: string, payload: unknown, token?: object): void;
  emitError(sessionId: string, token?: object): void;
  subscribe(
    sessionId: string,
    onMessage: (payload: unknown) => void,
    onError: () => void,
  ): () => void;
}

interface CommandStreamSubscriber {
  onMessage: (payload: unknown) => void;
  onError: () => void;
}

const MAX_BUFFERED_PAYLOADS = 64;

export function createSharedCommandStreamChannel(): SharedCommandStreamChannel {
  let activeSessionId: string | null = null;
  let activeToken: object | null = null;
  const stateListeners = new Set<() => void>();
  const subscribers = new Map<string, Set<CommandStreamSubscriber>>();
  let buffered: { sessionId: string; payloads: unknown[] } | null = null;

  const notifyState = () => {
    for (const listener of stateListeners) listener();
  };

  const isStale = (sessionId: string, token?: object) =>
    activeSessionId !== sessionId || (token !== undefined && activeToken !== token);

  return {
    getActiveSessionId() {
      return activeSessionId;
    },

    subscribeState(listener) {
      stateListeners.add(listener);
      return () => {
        stateListeners.delete(listener);
      };
    },

    activate(sessionId, token) {
      const changed = activeSessionId !== sessionId;
      activeSessionId = sessionId;
      activeToken = token;
      buffered = { sessionId, payloads: [] };
      if (changed) notifyState();
    },

    deactivate(sessionId, token) {
      if (isStale(sessionId, token)) return;
      activeSessionId = null;
      activeToken = null;
      buffered = null;
      notifyState();
    },

    emit(sessionId, payload, token) {
      if (isStale(sessionId, token)) return;
      const listeners = subscribers.get(sessionId);
      if (listeners && listeners.size > 0) {
        for (const listener of listeners) listener.onMessage(payload);
        return;
      }
      if (!buffered || buffered.sessionId !== sessionId) buffered = { sessionId, payloads: [] };
      if (typeof payload === "object" && payload !== null && (payload as { type?: unknown }).type === "command_snapshot") {
        buffered.payloads = [payload];
        return;
      }
      if (buffered.payloads.length < MAX_BUFFERED_PAYLOADS) buffered.payloads.push(payload);
    },

    emitError(sessionId, token) {
      if (isStale(sessionId, token)) return;
      const listeners = subscribers.get(sessionId);
      if (!listeners) return;
      for (const listener of listeners) listener.onError();
    },

    subscribe(sessionId, onMessage, onError) {
      let group = subscribers.get(sessionId);
      if (!group) {
        group = new Set();
        subscribers.set(sessionId, group);
      }
      const entry: CommandStreamSubscriber = { onMessage, onError };
      group.add(entry);
      if (buffered && buffered.sessionId === sessionId && buffered.payloads.length > 0) {
        const pending = buffered.payloads.splice(0);
        for (const payload of pending) onMessage(payload);
      }
      return () => {
        group?.delete(entry);
        if (group && group.size === 0) subscribers.delete(sessionId);
      };
    },
  };
}

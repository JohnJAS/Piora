import type { AgentMessage } from "./types";

export interface ChatMessages {
  readonly length: number;
  readonly [index: number]: AgentMessage;
}

export function appendHistoryMessage(history: ChatMessages, live: AgentMessage | null | undefined): ChatMessages {
  if (!live) return history;
  const length = history.length;
  return new Proxy({ length: length + 1 } as ChatMessages, {
    get(target, key, receiver) {
      if (typeof key !== "string" || key === "length") return Reflect.get(target, key, receiver);
      const index = Number(key);
      return index === length ? live : history[index];
    },
  });
}

export function joinedRows<Row>(prefix: readonly Row[], tail: readonly Row[]) {
  return {
    length: prefix.length + tail.length,
    get(index: number): Row | undefined { return index < prefix.length ? prefix[index] : tail[index - prefix.length]; },
    [Symbol.iterator]: function* (): IterableIterator<Row> { yield* prefix; yield* tail; },
  };
}

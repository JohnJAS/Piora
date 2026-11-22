import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { AgentSessionLike } from "../pi-types";
import type { PromptInputEnrichment } from "../prompt-input-enrichment";
import { prepareQueuedInputRemoval, sameQueuedInputs, snapshotQueuedInputs } from "../queued-input-recall";
import type { AgentEvent } from "./types";

export interface QueuedInputReceipt {
  consumed: () => Promise<void>;
  cancelled: () => Promise<void>;
}

export class SessionQueueTracker {
  readonly queueSource = new AsyncLocalStorage<string | undefined>();
  readonly queuedInputReceipts = new Map<string, QueuedInputReceipt>();
  private readonly queueSources = new WeakMap<object, string>();
  private readonly seenQueuedInputs = new WeakSet<object>();
  private readonly pendingInputIds = new WeakMap<object, string>();

  constructor(
    private readonly inner: AgentSessionLike,
    private readonly isAlive: () => boolean,
    private readonly emit: (event: AgentEvent) => void,
    private readonly promptInputEnrichment: PromptInputEnrichment,
  ) {}

  installQueueHooks(): void {
    for (const delivery of ["steer", "followUp"] as const) {
      const enqueue = this.inner.agent[delivery]?.bind(this.inner.agent);
      if (enqueue) {
        this.inner.agent[delivery] = message => {
          if (message.role === "user") this.promptInputEnrichment.apply(message as { content?: unknown });
          const source = this.queueSource.getStore();
          if (!this.seenQueuedInputs.has(message)) {
            if (source) this.queueSources.set(message, source);
            this.seenQueuedInputs.add(message);
          }
          enqueue(message);
        };
      }
    }
  }

  private pendingInputId(message: object): string {
    let id = this.pendingInputIds.get(message);
    if (!id) {
      id = randomUUID();
      this.pendingInputIds.set(message, id);
    }
    return id;
  }

  consumeReceiptForMessage(message: object): void {
    const source = this.queueSources.get(message);
    const receipt = source ? this.queuedInputReceipts.get(source) : undefined;
    if (source && receipt) {
      this.queuedInputReceipts.delete(source);
      void receipt.consumed().catch(error => console.error("[pi-web] queue consumption receipt failed", error));
    }
  }

  getPendingInputs() {
    try {
      const labels = [...this.inner.getSteeringMessages(), ...this.inner.getFollowUpMessages()];
      const count = this.inner.getSteeringMessages().length;
      return snapshotQueuedInputs(this.inner).map((message, index) => ({
        id: this.pendingInputId(message),
        commandId: this.queueSources.get(message),
        text: labels[index],
        kind: index < count ? "steer" as const : "followUp" as const,
      }));
    } catch {
      return [];
    }
  }

  prepareQueueRecall(inputId?: string) {
    const snapshot = snapshotQueuedInputs(this.inner);
    const selected = inputId ? snapshot.filter(message => this.pendingInputId(message) === inputId) : snapshot;
    if (inputId && selected.length !== 1) throw new Error("This message is no longer waiting.");
    const remove = inputId ? prepareQueuedInputRemoval(this.inner, selected[0]) : undefined;
    return {
      messages: selected.map(message => ({ message, commandId: this.queueSources.get(message) })),
      commit: (persist: () => void) => {
        if (!this.isAlive() || !sameQueuedInputs(snapshot, snapshotQueuedInputs(this.inner))) {
          throw new Error("The pending queue changed. Retry recalling the remaining messages.");
        }
        // No await between identity check, durable archive, and SDK dequeue.
        if (remove) remove(persist); else persist();
        for (const message of selected) {
          const source = this.queueSources.get(message);
          const receipt = source ? this.queuedInputReceipts.get(source) : undefined;
          if (source && receipt) {
            this.queuedInputReceipts.delete(source);
            void receipt.consumed().catch(error => console.error("[pi-web] recalled input receipt failed", error));
          }
        }
        if (!remove) this.inner.clearQueue();
        else this.emit({ type: "queue_update", steering: [...this.inner.getSteeringMessages()], followUp: [...this.inner.getFollowUpMessages()] });
      },
    };
  }
}

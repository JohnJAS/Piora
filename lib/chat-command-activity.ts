import { AsyncLocalStorage } from "node:async_hooks";
import type { ChatCommandPhase } from "./chat-command-types";

interface CommandActivity {
  commandId: string;
  open: boolean;
  pending: Set<Promise<unknown>>;
  errors: unknown[];
  modelWork: boolean;
  onPhase: (phase: ChatCommandPhase) => void;
}

export class ChatCommandActivityTracker {
  private readonly context = new AsyncLocalStorage<CommandActivity>();

  get commandId(): string | undefined {
    const activity = this.context.getStore();
    return activity?.open ? activity.commandId : undefined;
  }

  phase(phase: ChatCommandPhase): void {
    const activity = this.context.getStore();
    if (activity?.open) {
      if (phase === "model") activity.modelWork = true;
      activity.onPhase(phase);
    }
  }

  get hasModelWork(): boolean {
    return this.context.getStore()?.modelWork === true;
  }

  fail(error: unknown): void {
    const activity = this.context.getStore();
    if (activity?.open) activity.errors.push(error);
  }

  track<Result>(promise: Promise<Result>): Promise<Result> {
    const activity = this.context.getStore();
    if (!activity?.open) return promise;
    activity.pending.add(promise);
    void promise.then(
      () => activity.pending.delete(promise),
      error => { activity.errors.push(error); activity.pending.delete(promise); },
    );
    return promise;
  }

  async run<Result>(commandId: string, execute: () => Promise<Result>, options: { onPhase?: (phase: ChatCommandPhase) => void; waitForIdle?: () => Promise<void>; assertActive?: () => void } = {}): Promise<Result> {
    const activity: CommandActivity = { commandId, open: true, pending: new Set(), errors: [], modelWork: false, onPhase: options.onPhase ?? (() => {}) };
    return this.context.run(activity, async () => {
      let result: Result | undefined;
      try {
        try { result = await execute(); }
        catch (error) { activity.errors.push(error); }
        do {
          while (activity.pending.size) await Promise.allSettled([...activity.pending]);
          options.assertActive?.();
          await options.waitForIdle?.();
        } while (activity.pending.size);
        options.assertActive?.();
        if (activity.errors.length) throw activity.errors[0];
        return result as Result;
      } finally {
        activity.open = false;
      }
    });
  }
}

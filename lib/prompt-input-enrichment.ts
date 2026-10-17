import { AsyncLocalStorage } from "node:async_hooks";

interface Enrichment {
  apply(text: string): string;
  consumed: boolean;
}

export class PromptInputEnrichment {
  private readonly context = new AsyncLocalStorage<Enrichment | undefined>();

  run<Result>(apply: (text: string) => string, execute: () => Result): Result {
    return this.context.run({ apply, consumed: false }, execute);
  }

  isolate<Result>(inherit: boolean, execute: () => Result): Result {
    return this.context.run(inherit ? this.context.getStore() : undefined, execute);
  }

  apply(message: { content?: unknown }): void {
    const enrichment = this.context.getStore();
    if (!enrichment || enrichment.consumed) return;
    enrichment.consumed = true;
    if (typeof message.content === "string") message.content = enrichment.apply(message.content);
    else if (Array.isArray(message.content)) {
      const text = message.content.filter(block => block.type === "text").map(block => block.text).join("\n");
      message.content = [{ type: "text", text: enrichment.apply(text) }, ...message.content.filter(block => block.type !== "text")];
    }
  }
}

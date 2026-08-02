import type { AgentMessage, AssistantMessage, AssistantContentBlock, TextContent, ImageContent } from "./types";
import type { ContextUsage } from "./pi-types";

const ESTIMATED_IMAGE_CHARS = 4_800;

function estimateBasicContentChars(content: string | (TextContent | ImageContent)[]): number {
  if (typeof content === "string") return content.length;
  return content.reduce((chars, block) => {
    if (block.type === "text") return chars + block.text.length;
    if (block.type === "image") return chars + ESTIMATED_IMAGE_CHARS;
    return chars;
  }, 0);
}

function estimateAssistantContentChars(content: AssistantContentBlock[]): number {
  return content.reduce((chars, block) => {
    if (block.type === "text") return chars + block.text.length;
    if (block.type === "thinking") return chars + block.thinking.length;
    if (block.type === "image") return chars + ESTIMATED_IMAGE_CHARS;
    if (block.type === "toolCall") {
      return chars + block.toolName.length + JSON.stringify(block.input).length;
    }
    return chars;
  }, 0);
}

export function estimateMessageTokens(message: AgentMessage): number {
  let chars = 0;
  switch (message.role) {
    case "user":
      chars = estimateBasicContentChars(message.content);
      break;
    case "assistant":
      chars = estimateAssistantContentChars(message.content);
      break;
    case "toolResult":
      chars = estimateBasicContentChars(message.content);
      break;
    case "custom":
      chars = estimateBasicContentChars(message.content);
      break;
    case "bashExecution":
      chars = message.command.length + message.output.length;
      break;
  }
  return Math.ceil(chars / 4);
}

function contextTokensFromUsage(message: AssistantMessage): number | null {
  if (message.stopReason === "aborted" || message.stopReason === "error" || !message.usage) return null;
  const { input, output, cacheRead, cacheWrite } = message.usage;
  const tokens = input + output + cacheRead + cacheWrite;
  return tokens > 0 ? tokens : null;
}

export function estimateSessionContextUsage(messages: AgentMessage[], contextWindow: number): ContextUsage | null {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) return null;

  let tokens = 0;
  let trailingStart = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const usageTokens = contextTokensFromUsage(message);
    if (usageTokens === null) continue;
    tokens = usageTokens;
    trailingStart = index + 1;
    break;
  }

  for (let index = trailingStart; index < messages.length; index += 1) {
    tokens += estimateMessageTokens(messages[index]);
  }

  return {
    tokens,
    contextWindow,
    percent: (tokens / contextWindow) * 100,
  };
}

import type { AssistantContentBlock, ToolResultMessage } from "./types";

export interface ProcessTimeRange { start: number; end: number }

/** Include model generation and waiting, then end at the latest tool result. */
export function processTimeRange(blocks: AssistantContentBlock[], timestamp: number | undefined,
  previousTimestamp: number | undefined, results?: Map<string, ToolResultMessage>): ProcessTimeRange | undefined {
  if (previousTimestamp === undefined || timestamp === undefined || !Number.isFinite(previousTimestamp)
    || !Number.isFinite(timestamp) || timestamp < previousTimestamp) return undefined;
  let end = timestamp;
  for (const block of blocks) {
    if (block.type !== "toolCall") continue;
    const result = results?.get(block.toolCallId);
    if (!result || result.isStreaming || result.timestamp === undefined || !Number.isFinite(result.timestamp)
      || result.timestamp < timestamp) return undefined;
    end = Math.max(end, result.timestamp);
  }
  return { start: previousTimestamp, end };
}

export function processElapsedSeconds(ranges: Array<ProcessTimeRange | undefined>): number | undefined {
  if (!ranges.length || ranges.some(range => !range || !Number.isFinite(range.start) || !Number.isFinite(range.end) || range.end < range.start)) return undefined;
  const known = ranges as ProcessTimeRange[];
  return Math.round((Math.max(...known.map(range => range.end)) - Math.min(...known.map(range => range.start))) / 1000);
}

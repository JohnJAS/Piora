import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  modelSupportsImages,
  readVisionAgentConfig,
  restoreVisionObservationCache,
  transformContextForTextOnlyModel,
  VISION_OBSERVATION_ENTRY_TYPE,
} from "../lib/vision-agent.ts";

export default function registerVisionAgent(api: ExtensionAPI): void {
  api.on("context", async (event, ctx) => {
    const config = readVisionAgentConfig();
    // Routing is capability based. Multimodal primary models keep receiving the
    // original image blocks and never invoke the configured sidecar.
    if (!config.enabled || modelSupportsImages(ctx.model)) return;

    const cache = restoreVisionObservationCache(ctx.sessionManager.getBranch());
    const newEntries: Parameters<typeof api.appendEntry>[1][] = [];
    ctx.ui.setStatus("piora-vision-agent", "Understanding images…");
    try {
      const messages = await transformContextForTextOnlyModel({
        messages: event.messages,
        config,
        cache,
        signal: ctx.signal,
        onCacheEntry(entry) {
          cache.set(entry.key, entry);
          newEntries.push(entry);
        },
      });
      for (const entry of newEntries) api.appendEntry(VISION_OBSERVATION_ENTRY_TYPE, entry);
      return { messages };
    } finally {
      ctx.ui.setStatus("piora-vision-agent", undefined);
    }
  });
}

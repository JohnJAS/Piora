import { Type } from "typebox";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readParentSessionSummary } from "../lib/side-chat/parent-reader.ts";
import { readSideChatSettings } from "../lib/side-chat/settings.ts";
import { readSideChatMetaFromEntries } from "../lib/side-chat/store.ts";

/** Side chat helper extension registering read-only parent inspection. */
export default function sideChatExtension(api: ExtensionAPI) {
  api.registerTool(defineTool({
    name: "piora_read_parent_session",
    label: "Read parent conversation",
    defaultActive: false,
    executionMode: "parallel",
    description:
      "Inspect recent turns and live execution status of the parent main conversation from inside a side chat. Strictly read-only.",
    parameters: Type.Object({
      maxTurns: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
      includeToolSummaries: Type.Optional(Type.Boolean()),
    }),
    async execute(_id, input, _signal, _update, ctx) {
      if (!readSideChatSettings().enabled) {
        throw new Error("Side Chat is disabled in Settings → Laboratory.");
      }
      const meta = readSideChatMetaFromEntries(ctx.sessionManager.getEntries());
      if (!meta) {
        throw new Error("piora_read_parent_session is only available inside a side conversation.");
      }
      const summary = await readParentSessionSummary(meta.parentSessionId, {
        maxTurns: typeof input.maxTurns === "number" ? input.maxTurns : undefined,
        includeToolSummaries: input.includeToolSummaries,
      });
      return {
        content: [{ type: "text" as const, text: summary }],
        details: { parentSessionId: meta.parentSessionId },
      };
    },
  }));
}

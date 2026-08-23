import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { AgentCommandError, sendAgentCommand } = await jiti.import("./agent-client.ts");

test("preserves HTTP status and server error code for definitive command rejections", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: "Message content exceeds the 256 KiB limit.",
    code: "SESSION_MESSAGE_TOO_LARGE",
  }), { status: 413, headers: { "Content-Type": "application/json" } });

  try {
    await assert.rejects(
      sendAgentCommand("session-id", { type: "prompt", message: "oversized" }),
      (error) => error instanceof AgentCommandError
        && error.status === 413
        && error.code === "SESSION_MESSAGE_TOO_LARGE",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

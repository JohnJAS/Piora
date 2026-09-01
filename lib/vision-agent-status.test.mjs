import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const status = await jiti.import("./vision-agent-status.ts");

test("visual agent status text round-trips through the extension text channel", () => {
  const values = [
    { phase: "analyzing", imageCount: 1 },
    { phase: "analyzing", imageCount: 3 },
    { phase: "ready", imageCount: 1 },
    { phase: "ready", imageCount: 4 },
    { phase: "failed", reason: "provider unavailable" },
  ];

  for (const value of values) {
    assert.deepEqual(status.parseVisionAgentStatus(status.formatVisionAgentStatus(value)), value);
  }
});

test("visual agent status parser accepts the legacy loading copy and rejects unrelated extension text", () => {
  assert.deepEqual(status.parseVisionAgentStatus("Understanding images…"), {
    phase: "analyzing",
    imageCount: 1,
  });
  assert.equal(status.parseVisionAgentStatus("memory index ready"), null);
  assert.equal(status.parseVisionAgentStatus(undefined), null);
});

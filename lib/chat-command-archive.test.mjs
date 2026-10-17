import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": resolve(import.meta.dirname, "..") } });
const { SessionControlStore } = await jiti.import("./session-control-store.ts");
const { createChatCommandCatalog, parseChatInput, createChatCommandOperation } = await jiti.import("./chat-command-input.ts");
const { GET } = await jiti.import("../app/api/sessions/[id]/submissions/route.ts");

test("disk archive restores explicit follow-up, native file references and original command text", async () => {
  const root = await mkdtemp(join(tmpdir(), "piora-command-archive-"));
  const previous = process.env.PIORA_SESSION_CONTROL_ROOT;
  process.env.PIORA_SESSION_CONTROL_ROOT = root;
  try {
    const store = new SessionControlStore();
    const catalog = createChatCommandCatalog([]);
    const commandInput = { afterPrompt: "检查新名称", delivery: "next_turn" };
    const rawText = "/name 中文名称";
    const localFiles = [{ name: "原始附件.pdf", path: "F:\\workspace\\原始附件.pdf", size: 123 }];
    const operation = createChatCommandOperation(rawText, catalog, parseChatInput(rawText, catalog, commandInput), commandInput);
    await store.appendCommand({ commandId: "archive-command", idempotencyKey: "archive-submission", targetSessionId: "archive-session", acceptedAt: 1,
      status: "completed", content: rawText, source: "ui", delivery: "next_turn", operation, localFiles,
      images: [{ type: "image", data: "image-data", mimeType: "image/png" }],
    });
    const response = await GET(new Request("http://localhost/api/sessions/archive-session/submissions?commandId=archive-command"), { params: Promise.resolve({ id: "archive-session" }) });
    assert.equal(response.status, 200);
    const draft = await response.json();
    assert.equal(draft.value, rawText);
    assert.deepEqual(draft.commandInput, commandInput);
    assert.deepEqual(draft.files, localFiles.map(file => ({ ...file, text: null })));
    assert.deepEqual(draft.images, [{ data: "image-data", mimeType: "image/png" }]);
  } finally {
    if (previous === undefined) delete process.env.PIORA_SESSION_CONTROL_ROOT; else process.env.PIORA_SESSION_CONTROL_ROOT = previous;
    assert.equal(dirname(root), resolve(tmpdir()));
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { omitHistoricalImages, installImageContextPolicy, HISTORICAL_IMAGE_PLACEHOLDER } = await jiti.import("./image-context.ts");
const image = (data) => ({ type: "image", data, mimeType: "image/png" });
const user = (content) => ({ role: "user", content, timestamp: 1 });
const tool = (content) => ({ role: "toolResult", content, toolCallId: "read-1", toolName: "read", isError: false, timestamp: 2 });
const imageCount = (messages) => messages.flatMap((m) => Array.isArray(m.content) ? m.content : []).filter((b) => b.type === "image").length;

test("new image turn sends only its images, retaining original history and tool metadata", () => {
  const messages = [user([{ type: "text", text: "old question" }, image("old")]), tool([image("old-tool")]), user([image("current")]), tool([image("current-tool")])];
  const snapshot = structuredClone(messages);
  const outgoing = omitHistoricalImages(messages);
  assert.equal(imageCount(outgoing), 2);
  assert.deepEqual(outgoing[0].content, [{ type: "text", text: "old question" }, { type: "text", text: HISTORICAL_IMAGE_PLACEHOLDER }]);
  assert.equal(outgoing[1].toolCallId, "read-1");
  assert.equal(outgoing[2], messages[2]);
  assert.equal(outgoing[3], messages[3]);
  assert.deepEqual(messages, snapshot);
});

test("text follow-up sends no old images; same-turn continuations preserve images", () => {
  const messages = [user([image("current")]), tool([image("screenshot")]), { role: "custom", content: "Retry with another model" }];
  assert.equal(imageCount(omitHistoricalImages(messages)), 2);
  assert.equal(imageCount(omitHistoricalImages([...messages, user("Next question")])), 0);
  assert.equal(imageCount(omitHistoricalImages([tool([image("orphan-history")])])), 0);
});

test("composes extension hooks and forwards abort signal without mutating hook input", async () => {
  const messages = [user([image("old")]), user("Next")];
  const controller = new AbortController();
  let receivedSignal;
  const agent = { transformContext: async (context, signal) => { receivedSignal = signal; return [...context, { role: "custom", content: "Extension instructions" }]; } };
  installImageContextPolicy(agent);
  const outgoing = await agent.transformContext(messages, controller.signal);
  assert.equal(receivedSignal, controller.signal);
  assert.equal(outgoing.at(-1).content, "Extension instructions");
  assert.equal(imageCount(outgoing), 0);
  assert.equal(imageCount(messages), 1);
});

test("installed SDK agent projects successive requests while retaining transcript images", async () => {
  const { default: sharp } = await import("sharp");
  const png = (await sharp({ create: { width: 2, height: 2, channels: 3, background: "#123456" } }).png().toBuffer()).toString("base64");
  const { Agent } = await import("@earendil-works/pi-agent-core");
  const requests = [];
  const model = { id: "test", provider: "test", api: "openai-completions", input: ["text", "image"], contextWindow: 100000, maxTokens: 1000 };
  const agent = new Agent({
    initialState: { model },
    streamFn: async (_model, context) => {
      requests.push(structuredClone(context.messages));
      return (async function* () {
        yield { type: "done", reason: "stop", message: { role: "assistant", content: [{ type: "text", text: "Done" }], ...model, model: model.id, stopReason: "stop", timestamp: Date.now(), usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } };
      })();
    },
  });
  installImageContextPolicy(agent);
  await agent.prompt(user([image(png)]));
  await agent.prompt(user([image(png)]));
  await agent.prompt(user("A text follow-up"));
  assert.deepEqual(requests.map(imageCount), [1, 1, 0]);
  assert.equal(imageCount(agent.state.messages), 2);
});

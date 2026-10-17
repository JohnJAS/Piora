import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { PromptInputEnrichment } = await createJiti(import.meta.url).import("./prompt-input-enrichment.ts");

test("enrichment runs once on expanded user content and retains image blocks", () => {
  const enrichment = new PromptInputEnrichment();
  enrichment.run(text => `material:${text}`, () => {
    const image = { type: "image", data: "data", mimeType: "image/png" };
    const message = { content: [{ type: "text", text: "expanded template" }, image] };
    enrichment.apply(message);
    assert.deepEqual(message.content, [{ type: "text", text: "material:expanded template" }, image]);
    enrichment.apply(message);
    assert.equal(message.content[0].text, "material:expanded template");
  });
});

test("nested extension prompts cannot consume or inherit the initiating prompt's attachments", async () => {
  const enrichment = new PromptInputEnrichment();
  await enrichment.run(text => `${text}:original-attachment`, async () => {
    await enrichment.isolate(false, async () => {
      await Promise.resolve();
      const nested = { content: "child" };
      enrichment.apply(nested);
      assert.equal(nested.content, "child");
    });
    const original = { content: "expanded original" };
    enrichment.apply(original);
    assert.equal(original.content, "expanded original:original-attachment");
  });
});

test("concurrent admissions enrich only their own user messages", async () => {
  const enrichment = new PromptInputEnrichment();
  const outputs = await Promise.all(["first", "second"].map(label => enrichment.run(text => `${label}:${text}`, async () => {
    await new Promise(resolve => setImmediate(resolve));
    const message = { content: "expanded" };
    enrichment.apply(message);
    return message.content;
  })));
  assert.deepEqual(outputs, ["first:expanded", "second:expanded"]);
});

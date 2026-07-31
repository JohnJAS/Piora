import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  InvalidJsonBodyError,
  JsonBodyTooLargeError,
  parseJsonWithinLimit,
} = await jiti.import("./bounded-json.ts");

test("parses a JSON body within the byte limit", async () => {
  const request = new Request("http://localhost/api/test", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: "hello" }),
  });
  assert.deepEqual(await parseJsonWithinLimit(request, 128), { content: "hello" });
});

test("rejects declared and streamed JSON bodies above the limit", async () => {
  const declared = new Request("http://localhost/api/test", {
    method: "PUT",
    headers: { "content-length": "1000" },
    body: "{}",
  });
  await assert.rejects(() => parseJsonWithinLimit(declared, 16), JsonBodyTooLargeError);

  const streamed = new Request("http://localhost/api/test", {
    method: "PUT",
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"content":"'));
        controller.enqueue(new TextEncoder().encode("too long"));
        controller.enqueue(new TextEncoder().encode('"}'));
        controller.close();
      },
    }),
    duplex: "half",
  });
  await assert.rejects(() => parseJsonWithinLimit(streamed, 12), JsonBodyTooLargeError);
});

test("normalizes malformed JSON and invalid UTF-8 errors", async () => {
  const malformed = new Request("http://localhost/api/test", {
    method: "PUT",
    body: "{",
  });
  await assert.rejects(() => parseJsonWithinLimit(malformed, 16), InvalidJsonBodyError);

  const invalidUtf8 = new Request("http://localhost/api/test", {
    method: "PUT",
    body: new Uint8Array([0xff]),
  });
  await assert.rejects(() => parseJsonWithinLimit(invalidUtf8, 16), InvalidJsonBodyError);
});

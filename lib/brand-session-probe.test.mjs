import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { createJiti } from "jiti";

const { createSmokeSessionProbe } = await createJiti(import.meta.url).import("../desktop/src/smoke-session-probe.ts");
const id = "12345678-1234-1234-1234-123456789abc";
const text = 'old session "text"; globalThis.compromised = true; //';

async function execute({ listed = true, found = true, status = 200 } = {}) {
  const calls = [];
  const context = {
    AbortSignal,
    fetch: async (url, options) => {
      calls.push([url, options]);
      return { ok: status === 200, json: async () => url === "/api/sessions"
        ? { sessions: listed ? [{ id }] : [] }
        : { sessionId: id, context: { messages: [{ role: "user", content: [{ type: "text", text: found ? text : "wrong message" }] }] } } };
    },
  };
  const result = await runInNewContext(createSmokeSessionProbe(id, text), context);
  assert.equal(context.compromised, undefined);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(([, options]) => !options.method || options.method === "GET"));
  return result;
}

test("upgrade session probe loads listed session content through read-only renderer APIs", async () => {
  const result = await execute();
  assert.equal(result.sessionId, id);
  assert.equal(result.messageLoaded, true);
});

test("a surviving file is insufficient if the application cannot list or load its content", async () => {
  await assert.rejects(execute({ listed: false }), /not discoverable/);
  await assert.rejects(execute({ found: false }), /did not load/);
  await assert.rejects(execute({ status: 500 }), /Cannot list/);
  assert.throws(() => createSmokeSessionProbe("../../bad", text), /Invalid/);
});

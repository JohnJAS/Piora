import assert from "node:assert/strict";
import { once } from "node:events";
import { createRequire } from "node:module";
import test from "node:test";
import { Type } from "typebox";
import { Check, Diff, Patch } from "typebox/value";
import { WebSocket, WebSocketServer } from "ws";

const require = createRequire(import.meta.url);
const piRequire = createRequire(import.meta.resolve("@earendil-works/pi-coding-agent"));

for (const [name, load] of [["application", require], ["Pi runtime", piRequire]]) {
  test(`${name} brace expansion bounds work and preserves ordinary globs`, () => {
    const { expand } = load("brace-expansion");
    assert.deepEqual(expand("{src,lib}/**/*.{ts,tsx}"), ["src/**/*.ts", "src/**/*.tsx", "lib/**/*.ts", "lib/**/*.tsx"]);
    const adversarial = "{".repeat(200) + "{a,b,c}".repeat(12) + "}".repeat(200);
    assert.deepEqual(expand(adversarial), [adversarial]);
    assert.deepEqual(expand(adversarial, { maxSteps: NaN }), [adversarial]);
    assert.deepEqual(expand("{a,b}", { maxSteps: 61 }), ["{a,b}"]);
    assert.deepEqual(expand("{a,b}", { maxSteps: 62 }), ["a", "b"]);
    assert.deepEqual(load("minimatch").braceExpand("{src,lib}/*.ts"), ["src/*.ts", "lib/*.ts"]);
  });
}

test("TypeBox keeps tool schemas and escaped JSON-pointer patches compatible", () => {
  const schema = Type.Object({ operation: Type.Literal("inspect"), depth: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })) }, { additionalProperties: false });
  assert.equal(Check(schema, { operation: "inspect", depth: 3 }), true);
  assert.equal(Check(schema, { operation: "inspect", depth: 11 }), false);
  assert.equal(Check(schema, { operation: "inspect", shell: "unexpected" }), false);
  const before = { "a/b": { "~key": 1 } }, after = { "a/b": { "~key": 2 } };
  assert.deepEqual(Patch(before, Diff(before, after)), after);
  assert.deepEqual(Patch(new Uint8Array([1]), Diff(new Uint8Array([1]), null)), null);
});

test("ws decodes URL credentials without mutating the caller URL", { timeout: 5_000 }, async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  let client;
  try {
    const incoming = once(server, "connection");
    const url = new URL(`http://user%40example:p%3Ass@127.0.0.1:${server.address().port}/`);
    const original = url.href;
    client = new WebSocket(url);
    const [peer, request] = await incoming;
    assert.equal(url.href, original);
    assert.equal(request.headers.authorization, `Basic ${Buffer.from("user@example:p:ss").toString("base64")}`);
    const received = once(client, "message");
    peer.send("stream remains connected");
    assert.equal((await received)[0].toString(), "stream remains connected");
  } finally {
    client?.terminate();
    for (const peer of server.clients) peer.terminate();
    await new Promise(resolve => server.close(resolve));
  }
});

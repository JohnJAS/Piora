import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile, readdir } from "node:fs/promises";
import { createServer, get } from "node:http";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const compression = require("next/dist/compiled/compression");
const { NodeNextRequest, NodeNextResponse } = require("next/dist/server/base-http/node");
const { sendResponse } = require("next/dist/server/send-response");
const root = new URL("../", import.meta.url);

async function sources(directory) {
  const files = [];
  for (const entry of await readdir(new URL(directory, root), { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sources(path));
    else if (entry.name.endsWith(".ts")) files.push(path);
  }
  return files;
}

// Exercise the actual Next route-response bridge and its bundled compression
// middleware over HTTP. Reading Response.body alone cannot detect gzip buffering.
test("every SSE response delivers events before close with gzip accepted", { timeout: 30_000 }, async t => {
  const policies = new Set();
  for (const file of [...await sources("app"), ...await sources("lib")]) {
    const source = await readFile(new URL(file, root), "utf8");
    for (const match of source.matchAll(/\{[^{}]*["']Content-Type["']:\s*["']text\/event-stream[^{}]*\}/g)) {
      const policy = /["']Cache-Control["']:\s*["']([^"']+)["']/.exec(match[0])?.[1];
      assert.match(policy ?? "", /\bno-transform\b/, `${file} must prevent compression buffering`);
      policies.add(policy);
    }
  }
  assert.ok(policies.size >= 3, "cover public, private, and no-store event streams");
  for (const policy of policies) await t.test(policy, async () => {
    const first = "data: {\"event\":\"ready\"}\n\n";
    const second = "data: {\"event\":\"delta\"}\n\n";
    let controller;
    let complete;
    const finished = new Promise(resolve => { complete = resolve; });
    const server = createServer((req, res) => {
      compression()(req, res, () => {
        const body = new ReadableStream({ start(value) { controller = value; controller.enqueue(new TextEncoder().encode(first)); } });
        sendResponse(new NodeNextRequest(req), new NodeNextResponse(res), new Response(body, {
          headers: { "Content-Type": "text/event-stream", "Cache-Control": policy },
        })).then(complete, error => { res.destroy(error); complete(); });
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    let request;
    try {
      await new Promise((resolve, reject) => {
        request = get(`http://127.0.0.1:${server.address().port}/events`, { headers: { "Accept-Encoding": "gzip" } }, res => {
          try { assert.equal(res.headers["content-encoding"], undefined); } catch (error) { reject(error); return; }
          let text = "", released = false;
          res.setEncoding("utf8");
          res.on("data", chunk => {
            text += chunk;
            if (!released && text.includes(first)) {
              released = true;
              controller.enqueue(new TextEncoder().encode(second));
              controller.close();
            }
          });
          res.on("error", reject);
          res.on("end", () => { try { assert.equal(text, first + second); resolve(); } catch (error) { reject(error); } });
        });
        request.setTimeout(2_000, () => request.destroy(new Error("SSE buffered until close")));
        request.on("error", reject);
      });
      await finished;
    } finally {
      request?.destroy();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { NextRequest } from "next/server.js";

const jiti = createJiti(import.meta.url, {
  alias: { "@": path.resolve(".") },
});
const { GET, PUT } = await jiti.import("../app/api/files/[...path]/route.ts");

function createFixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-file-route-"));
  const allowed = path.join(base, "allowed");
  const outside = path.join(base, "outside");
  fs.mkdirSync(allowed);
  fs.mkdirSync(outside);
  t.after(() => {
    globalThis.__piAllowedRootsCache = undefined;
    fs.rmSync(base, { recursive: true, force: true });
  });
  globalThis.__piAllowedRootsCache = {
    roots: new Set([allowed.replace(/\\/g, "/")]),
    expiresAt: Date.now() + 60_000,
  };
  return { allowed, outside };
}

function pathSegments(filePath) {
  return filePath.replace(/\\/g, "/").replace(/^\/+/, "").split("/");
}

function requestFor(filePath, options = {}) {
  const url = new URL("http://localhost:30141/api/files/test");
  if (options.type) url.searchParams.set("type", options.type);
  if (options.sessionId) url.searchParams.set("sessionId", options.sessionId);
  return new NextRequest(url, {
    method: options.method ?? "GET",
    headers: {
      host: "localhost:30141",
      ...(options.headers ?? {}),
    },
    body: options.body,
  });
}

function contextFor(filePath) {
  return { params: Promise.resolve({ path: pathSegments(filePath) }) };
}

test("file route reads versioned text and performs save/conflict/force flow", async (t) => {
  const { allowed } = createFixture(t);
  const filePath = path.join(allowed, "route.txt");
  fs.writeFileSync(filePath, "disk v1");

  const readResponse = await GET(
    requestFor(filePath, { type: "read" }),
    contextFor(filePath),
  );
  assert.equal(readResponse.status, 200);
  const initial = await readResponse.json();
  assert.equal(initial.content, "disk v1");
  assert.match(initial.version, /^[a-f0-9]{64}$/);
  assert.equal(Number.isNaN(Date.parse(initial.mtime)), false);

  const saveResponse = await PUT(
    requestFor(filePath, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "saved v2", expectedVersion: initial.version }),
    }),
    contextFor(filePath),
  );
  assert.equal(saveResponse.status, 200);
  const saved = await saveResponse.json();
  assert.equal(saved.content, "saved v2");
  assert.notEqual(saved.version, initial.version);

  fs.writeFileSync(filePath, "external v3");
  const conflictResponse = await PUT(
    requestFor(filePath, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "stale local", expectedVersion: saved.version }),
    }),
    contextFor(filePath),
  );
  assert.equal(conflictResponse.status, 409);
  const conflict = await conflictResponse.json();
  assert.equal(conflict.code, "FILE_CONFLICT");
  assert.match(conflict.currentVersion, /^[a-f0-9]{64}$/);
  assert.equal(fs.readFileSync(filePath, "utf8"), "external v3");

  const forceResponse = await PUT(
    requestFor(filePath, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "forced local",
        expectedVersion: saved.version,
        force: true,
      }),
    }),
    contextFor(filePath),
  );
  assert.equal(forceResponse.status, 200);
  assert.equal(fs.readFileSync(filePath, "utf8"), "forced local");
});

test("file PUT never grants write access from a sessionId reference", async (t) => {
  const { outside } = createFixture(t);
  const filePath = path.join(outside, "referenced.txt");
  fs.writeFileSync(filePath, "read only");
  const expectedVersion = "0".repeat(64);

  const response = await PUT(
    requestFor(filePath, {
      method: "PUT",
      sessionId: "pretend-session-reference",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "should fail", expectedVersion }),
    }),
    contextFor(filePath),
  );

  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "FILE_ACCESS_DENIED");
  assert.equal(fs.readFileSync(filePath, "utf8"), "read only");
});

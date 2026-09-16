import assert from "node:assert/strict";
import test from "node:test";
import { createToolInstallResponse } from "./tool-install-stream.ts";
import { readToolInstallProgress } from "./tool-install-progress.ts";

const runtime = [{ id: "fd", label: "fd", status: "available", source: "managed", path: "/bin/fd", version: "10.3.0", offline: false }];

test("installation progress arrives before the download finishes and verifies before completion", async () => {
  let finish;
  const waiting = new Promise((resolve) => { finish = resolve; });
  const response = createToolInstallResponse("fd", async (status) => {
    status({ type: "info", message: "fd not found. Downloading..." });
    await waiting;
    return { status: "installed", path: "/bin/fd" };
  }, () => runtime);
  const reader = response.body.getReader();
  const decode = async () => JSON.parse(new TextDecoder().decode((await reader.read()).value));
  assert.deepEqual(await decode(), { type: "progress", phase: "checking" });
  assert.deepEqual(await decode(), { type: "progress", phase: "downloading" });
  finish();
  assert.deepEqual(await decode(), { type: "progress", phase: "verifying" });
  assert.deepEqual(await decode(), { type: "done", runtime });
  assert.equal((await reader.read()).done, true);
});

test("SDK download warnings remain visible as failure reasons", async () => {
  const events = [];
  const response = createToolInstallResponse("fd", async (status) => {
    status({ type: "warning", message: "Failed to download fd: GitHub API error: 403" });
    return { status: "unavailable", path: null };
  }, () => runtime);
  await assert.rejects(readToolInstallProgress(response, (event) => events.push(event)), /GitHub API error: 403/);
  assert.equal(events.at(-1).type, "error");
  assert.equal(events.some((event) => event.type === "done"), false);
});

test("stream decoding preserves split UTF-8 and refuses an incomplete success", async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ type: "error", error: "下载失败" }) + "\n");
  const response = new Response(new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
    controller.close();
  } }));
  await assert.rejects(readToolInstallProgress(response, () => {}), /下载失败/);
  await assert.rejects(readToolInstallProgress(new Response('{"type":"progress","phase":"checking"}\n'), () => {}), /before completion/);
});

test("disconnecting a progress reader does not break the SDK installation", async () => {
  let finish;
  const waiting = new Promise((resolve) => { finish = resolve; });
  let installed = false;
  const response = createToolInstallResponse("fd", async (status) => {
    await waiting;
    status({ type: "info", message: "fd installed" });
    installed = true;
    return { status: "installed", path: "/bin/fd" };
  }, () => runtime);
  await response.body.cancel();
  finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(installed, true);
});

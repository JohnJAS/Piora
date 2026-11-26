import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { Agent } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": resolve(import.meta.dirname, "../../..") } });
const { POST } = await jiti.import("./[id]/auto-name/route.ts");
const { PATCH } = await jiti.import("./[id]/route.ts");
const { persistLazySessionManager } = await jiti.import("../../../lib/session-persistence.ts");
const { cacheSessionPath, invalidateSessionPathCache } = await jiti.import("../../../lib/session-reader.ts");

const chatModel = { api: "openai-completions", provider: "chat-fixture", id: "chat-model" };
const titleModel = { api: "openai-completions", provider: "title-fixture", id: "title-model" };
const generatedTitle = "Prepare the Project Release";
const usage = { input: 10, output: 3, cacheRead: 2, cacheWrite: 0, total: 15 };

async function createNamingFixture(t) {
  const tempRoot = await realpath(tmpdir());
  const directory = await mkdtemp(join(tempRoot, "piora-auto-name-"));
  const previousSessions = globalThis.__piSessions;
  const generationStarted = Promise.withResolvers();
  const releaseTitle = Promise.withResolvers();
  let sessionId;
  let pending;
  t.after(async () => {
    releaseTitle.resolve();
    await pending?.catch(() => {});
    globalThis.__piSessions = previousSessions;
    if (sessionId) invalidateSessionPathCache(sessionId);
    const resolvedDirectory = await realpath(directory);
    assert.equal(resolvedDirectory, directory);
    assert.equal(dirname(resolvedDirectory), tempRoot);
    await rm(directory, { recursive: true, force: true });
  });

  const manager = SessionManager.create(directory, join(directory, "sessions"));
  const message = { role: "user", content: "Help me prepare the release", timestamp: Date.now() };
  manager.appendMessage(message);
  sessionId = manager.getSessionId();
  const file = persistLazySessionManager(manager);
  assert.ok(file);
  cacheSessionPath(sessionId, file);

  const streamTitle = t.mock.fn(async (model, _context, { signal }) => {
    const stream = createAssistantMessageEventStream();
    const abort = () => releaseTitle.resolve();
    signal.addEventListener("abort", abort, { once: true });
    generationStarted.resolve({ model, signal });
    await releaseTitle.promise;
    signal.removeEventListener("abort", abort);

    const { total, ...tokens } = usage;
    stream.end({
      role: "assistant",
      content: [{ type: "text", text: generatedTitle }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      stopReason: signal.aborted ? "aborted" : "stop",
      timestamp: Date.now(),
      usage: { ...tokens, totalTokens: total, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    });
    return stream;
  });
  const agent = new Agent({ initialState: { model: chatModel, messages: [message] }, streamFn: streamTitle });
  globalThis.__piSessions = new Map([[sessionId, {
    isAlive: () => true,
    inner: {
      agent,
      modelRuntime: {
        getModel: (provider, id) => provider === titleModel.provider && id === titleModel.id ? titleModel : undefined,
      },
    },
    setSessionName: (name) => manager.appendSessionInfo(name),
  }]]);

  const url = `http://localhost/api/sessions/${sessionId}`;
  const context = { params: Promise.resolve({ id: sessionId }) };
  const jsonHeaders = { "Content-Type": "application/json" };
  return {
    readTitle: () => SessionManager.open(file).getSessionName(),
    rename: (name) => PATCH(new Request(url, {
      method: "PATCH", headers: jsonHeaders, body: JSON.stringify({ name }),
    }), context),
    autoName(options = {}, signal) {
      pending = POST(new Request(`${url}/auto-name`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ onlyIfUnnamed: true, apply: true, ...options }),
        signal,
      }), context);
      return pending;
    },
    waitForGeneration() {
      return Promise.race([
        generationStarted.promise,
        pending.then((response) => assert.fail(`Title request returned HTTP ${response.status} before generation started`)),
      ]);
    },
    finishGeneration: releaseTitle.resolve,
    streamTitle,
  };
}

test("automatic session naming preserves a manual title saved during generation", { timeout: 10_000 }, async (t) => {
  const session = await createNamingFixture(t);
  assert.equal(session.readTitle(), undefined);
  const pending = session.autoName();
  await session.waitForGeneration();

  const manualTitle = "Release Notes for Windows";
  const renamed = await session.rename(manualTitle);
  assert.equal(renamed.status, 200);
  assert.equal(session.readTitle(), manualTitle);

  session.finishGeneration();
  const response = await pending;
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { title: manualTitle, applied: false, skipped: true, usage });
  assert.equal(session.readTitle(), manualTitle);
});

test("automatic session naming skips an existing manual title without requesting generation", { timeout: 10_000 }, async (t) => {
  const session = await createNamingFixture(t);
  const manualTitle = "Existing manual title";
  assert.equal((await session.rename(manualTitle)).status, 200);
  session.finishGeneration();

  const response = await session.autoName();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { title: manualTitle, applied: false, skipped: true, usage: null });
  assert.equal(session.streamTitle.mock.callCount(), 0);
  assert.equal(session.readTitle(), manualTitle);
});

test("automatic session naming uses the selected model and saves its title for an unnamed session", { timeout: 10_000 }, async (t) => {
  const session = await createNamingFixture(t);
  const pending = session.autoName({ provider: titleModel.provider, modelId: titleModel.id });
  const { model } = await session.waitForGeneration();
  assert.equal(model.provider, titleModel.provider);
  assert.equal(model.id, titleModel.id);

  session.finishGeneration();
  const response = await pending;
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { title: generatedTitle, applied: true, skipped: false, usage });
  assert.equal(session.readTitle(), generatedTitle);
});

test("cancelling the title request aborts generation and leaves the session unnamed", { timeout: 10_000 }, async (t) => {
  const session = await createNamingFixture(t);
  const controller = new AbortController();
  const pending = session.autoName({}, controller.signal);
  const { signal } = await session.waitForGeneration();

  controller.abort();
  const response = await pending;
  assert.equal(response.status, 499);
  assert.deepEqual(await response.json(), { error: "Session title generation was cancelled" });
  assert.equal(signal.aborted, true);
  assert.equal(session.readTitle(), undefined);
});

test("automatic session naming names a live unpersisted session immediately from seedQuery without waiting for idle", { timeout: 10_000 }, async (t) => {
  const tempRoot = await realpath(tmpdir());
  const directory = await mkdtemp(join(tempRoot, "piora-auto-name-live-"));
  const previousSessions = globalThis.__piSessions;
  const sessionId = "live-unpersisted-session";
  const releaseTitle = Promise.withResolvers();
  const generationStarted = Promise.withResolvers();
  let pending;

  t.after(async () => {
    releaseTitle.resolve();
    await pending?.catch(() => {});
    globalThis.__piSessions = previousSessions;
    invalidateSessionPathCache(sessionId);
    await rm(directory, { recursive: true, force: true });
  });

  const manager = SessionManager.create(directory, join(directory, "sessions"));
  const streamTitle = t.mock.fn(async (model) => {
    const stream = createAssistantMessageEventStream();
    generationStarted.resolve();
    await releaseTitle.promise;
    const { total, ...tokens } = usage;
    stream.end({
      role: "assistant",
      content: [{ type: "text", text: generatedTitle }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      stopReason: "stop",
      timestamp: Date.now(),
      usage: { ...tokens, totalTokens: total, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    });
    return stream;
  });

  const agent = new Agent({ initialState: { model: chatModel, messages: [] }, streamFn: streamTitle });
  agent.waitForIdle = () => new Promise(() => {});
  globalThis.__piSessions = new Map([[sessionId, {
    cwd: directory,
    isAlive: () => true,
    inner: {
      agent,
      sessionManager: manager,
      modelRuntime: { getModel: () => undefined },
    },
    setSessionName: (name) => manager.appendSessionInfo(name),
  }]]);

  const url = `http://localhost/api/sessions/${sessionId}/auto-name`;
  const context = { params: Promise.resolve({ id: sessionId }) };
  const headers = { "Content-Type": "application/json" };

  const invalidSeed = await POST(new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ seedQuery: 123 }),
  }), context);
  assert.equal(invalidSeed.status, 400);

  pending = POST(new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ onlyIfUnnamed: true, apply: true, seedQuery: "修复鸿蒙投屏断联问题" }),
  }), context);
  await generationStarted.promise;

  // Live unpersisted session completes without waiting for idle or disk file.
  releaseTitle.resolve();
  const response = await pending;
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { title: generatedTitle, applied: true, skipped: false, usage });
  assert.equal(manager.getSessionName(), generatedTitle);

  // Manual live rename while a subsequent generation is in flight is preserved.
  const renameRace = Promise.withResolvers();
  const streamRace = t.mock.fn(async (model) => {
    const stream = createAssistantMessageEventStream();
    await renameRace.promise;
    const { total, ...tokens } = usage;
    stream.end({
      role: "assistant",
      content: [{ type: "text", text: "Should Not Overwrite" }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      stopReason: "stop",
      timestamp: Date.now(),
      usage: { ...tokens, totalTokens: total, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    });
    return stream;
  });
  agent.streamFunction = streamRace;
  manager.appendSessionInfo("");
  const racePending = POST(new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ onlyIfUnnamed: true, apply: true, seedQuery: "另一条查询" }),
  }), context);
  await new Promise((resolve) => setTimeout(resolve, 20));
  manager.appendSessionInfo("用户手动命名");
  renameRace.resolve();
  const raceResponse = await racePending;
  assert.equal(raceResponse.status, 200);
  assert.deepEqual(await raceResponse.json(), { title: "用户手动命名", applied: false, skipped: true, usage });
  assert.equal(manager.getSessionName(), "用户手动命名");
});

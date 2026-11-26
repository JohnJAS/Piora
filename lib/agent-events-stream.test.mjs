import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });

test("agent SSE stream emits retry: 500, monotonic event ids, and connected runtime snapshot", async () => {
  const { getRegistry } = await jiti.import("./rpc/registry.ts");
  const { GET } = await jiti.import("../app/api/agent/[id]/events/route.ts");

  const sessionId = "sse-test-session";
  const listeners = new Set();
  const fakeWrapper = {
    runtimeProfile: "normal",
    isAlive: () => true,
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getStreamingMessage: () => null,
    getStreamingMetrics: () => null,
    getStreamConnectState: () => ({
      sessionId,
      runtime: "running",
      isStreaming: true,
      isPromptRunning: true,
      isBashRunning: false,
      runStartedAt: 1000,
      statusPhaseKind: "waiting_model",
      statusPhaseStartedAt: 1000,
      lastProgressAt: 1000,
      isCompacting: false,
      compactionStartedAt: null,
      activeTools: [{ id: "t1", name: "read" }],
      pendingApproval: false,
      queuedMessages: { pendingInputs: [], steering: [], followUp: [] },
    }),
  };

  getRegistry().set(sessionId, fakeWrapper);
  const controller = new AbortController();
  try {
    const response = await GET(
      new Request(`http://127.0.0.1/api/agent/${sessionId}/events?transport=delta`, { signal: controller.signal }),
      { params: Promise.resolve({ id: sessionId }) },
    );
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let collected = "";
    for (let i = 0; i < 6; i += 1) {
      const { value, done } = await reader.read();
      if (done) break;
      collected += decoder.decode(value, { stream: true });
      if (collected.includes('"type":"connected"')) break;
    }
    assert.match(collected, /^retry: 500\n\n/);
    assert.match(collected, /id: 1\ndata: \{.*"type":"connected".*"runtime":"running".*"activeTools":\[\{"id":"t1","name":"read"\}\]/);

    for (const listener of listeners) {
      listener({ type: "agent_end" });
    }
    const nextChunk = await reader.read();
    const secondText = decoder.decode(nextChunk.value, { stream: true });
    assert.match(secondText, /id: 2\ndata: \{"type":"agent_end"\}/);
  } finally {
    controller.abort();
    getRegistry().delete(sessionId);
  }
});

test("agent SSE stream multiplexes command snapshot and live command events when include=commands", async () => {
  const { getRegistry } = await jiti.import("./rpc/registry.ts");
  const { GET } = await jiti.import("../app/api/agent/[id]/events/route.ts");

  const sessionId = "sse-multiplex-test-session";
  const agentListeners = new Set();
  const commandListeners = new Set();
  const previousRouter = globalThis.__pioraSessionMessageRouter;
  let commandUnsubscribed = false;

  globalThis.__pioraSessionMessageRouter = {
    subscribeEvents(_sid, listener) {
      commandListeners.add(listener);
      return () => {
        commandUnsubscribed = true;
        commandListeners.delete(listener);
      };
    },
    lastEventCursor() {
      return 7;
    },
    async operationWindow() {
      return {
        commands: [
          {
            commandId: "cmd-1",
            idempotencyKey: "key-1",
            targetSessionId: sessionId,
            status: "running",
            revision: 1,
            acceptedAt: 100,
            content: "/reload",
          },
        ],
        hasMore: false,
      };
    },
  };

  const fakeWrapper = {
    runtimeProfile: "normal",
    isAlive: () => true,
    onEvent(listener) {
      agentListeners.add(listener);
      return () => agentListeners.delete(listener);
    },
    getStreamingMessage: () => null,
    getStreamingMetrics: () => null,
    getStreamConnectState: () => ({
      sessionId,
      runtime: "running",
      isStreaming: true,
      isPromptRunning: true,
      isBashRunning: false,
      runStartedAt: 1000,
      statusPhaseKind: "waiting_model",
      statusPhaseStartedAt: 1000,
      lastProgressAt: 1000,
      isCompacting: false,
      compactionStartedAt: null,
      activeTools: [],
      pendingApproval: false,
      queuedMessages: { pendingInputs: [], steering: [], followUp: [] },
    }),
  };

  getRegistry().set(sessionId, fakeWrapper);
  const controller = new AbortController();
  try {
    const response = await GET(
      new Request(`http://127.0.0.1/api/agent/${sessionId}/events?transport=delta&include=commands`, {
        signal: controller.signal,
      }),
      { params: Promise.resolve({ id: sessionId }) },
    );
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let collected = "";
    for (let i = 0; i < 8; i += 1) {
      const { value, done } = await reader.read();
      if (done) break;
      collected += decoder.decode(value, { stream: true });
      if (collected.includes('"type":"command_snapshot"')) break;
    }
    assert.match(collected, /"type":"connected"/);
    assert.match(collected, /"type":"command_stream","payload":\{"type":"command_snapshot"/);
    assert.match(collected, /"commandId":"cmd-1"/);

    for (const listener of commandListeners) {
      listener({
        cursor: 8,
        type: "command_completed",
        sessionId,
        commandId: "cmd-1",
        status: "completed",
        source: "ui",
        timestamp: 200,
      });
    }
    const next = await reader.read();
    const liveChunk = decoder.decode(next.value, { stream: true });
    const liveEvent = JSON.parse(liveChunk.match(/data: (.+)/)[1]);
    assert.equal(liveEvent.type, "command_stream");
    assert.equal(liveEvent.payload.type, "command_completed");
    assert.equal(liveEvent.payload.cursor, 8);

    controller.abort();
    assert.equal(commandUnsubscribed, true);
    assert.equal(agentListeners.size, 0);
  } finally {
    controller.abort();
    getRegistry().delete(sessionId);
    globalThis.__pioraSessionMessageRouter = previousRouter;
  }
});

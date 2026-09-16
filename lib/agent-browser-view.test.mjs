import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const runtime = {
  contextPromise: null,
  sessions: new Map(),
  revision: 7,
  persistTimer: null,
  persistChain: Promise.resolve(),
  watchedPages: new WeakSet(),
};
globalThis.__pioraBrowserRuntime = runtime;
const { getAgentBrowserViewState, getAgentBrowserViewScreenshot } = await createJiti(import.meta.url).import("../extensions/piora-browser.ts");

test("watching an Agent without an open browser does not start or create one", async () => {
  assert.equal(await getAgentBrowserViewState("current-task"), null);
  assert.equal(await getAgentBrowserViewScreenshot("current-task"), null);
  assert.equal(await getAgentBrowserViewState("__piora_browser_ui__"), null);
  assert.equal(runtime.contextPromise, null);
  assert.equal(runtime.sessions.size, 0);
});

test("Agent view reads only the selected task's active tab and screenshot", async () => {
  const otherPage = {
    isClosed: () => false,
    title: async () => "Other task",
    url: () => "https://other.test/",
    viewportSize: () => ({ width: 800, height: 600 }),
    evaluate: async () => "default",
    screenshot: async () => Buffer.from("other-frame"),
  };
  const currentPage = {
    ...otherPage,
    title: async () => "Agent research",
    url: () => "https://agent.test/research",
    screenshot: async () => Buffer.from("current-frame"),
  };
  runtime.sessions.set("other-task", { context: {}, page: otherPage, pages: [otherPage] });
  runtime.sessions.set("current-task", { context: {}, page: currentPage, pages: [currentPage] });

  const state = await getAgentBrowserViewState("current-task");
  assert.equal(state.title, "Agent research");
  assert.equal(state.url, "https://agent.test/research");
  assert.deepEqual(state.tabs, [{ index: 0, title: "Agent research", url: "https://agent.test/research" }]);
  assert.equal((await getAgentBrowserViewScreenshot("current-task")).toString(), "current-frame");
  assert.equal(runtime.sessions.has("__piora_browser_ui__"), false);
  assert.equal(runtime.contextPromise, null);

  currentPage.isClosed = () => true;
  assert.equal(await getAgentBrowserViewState("current-task"), null);
  assert.equal(await getAgentBrowserViewScreenshot("current-task"), null);
});

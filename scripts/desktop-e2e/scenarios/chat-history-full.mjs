import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";

const fixtures = new Map();
const provider = "desktop-transcript-fixture";
const model = "held-reply";
const liveStart = "The live fixture reply has started.";
const liveEnd = "The live fixture reply has finished.";
const livePrompt = "Keep generating while I read the oldest messages.";
const fixtureUsage = {
  input: 100, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 120,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const longAnswerEnd = "The complete answer ends here.";
const longAnswer = [
  "# Archived Markdown answer",
  "- **Archived list item**",
  "```text\narchived code sample\n```",
  "Additional fixture content. ".repeat(12_000),
  longAnswerEnd,
].join("\n\n");

async function prepareHeldReply(paths, registerCleanup) {
  const reply = { pending: null, requests: [] };
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    reply.requests.push({
      hasNewPrompt: body.includes(JSON.stringify(livePrompt)),
      hasArchivedPrompt: body.includes('"Fixture question 1"'),
    });
    response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    const emit = (delta, finish_reason = null) => response.write(`data: ${JSON.stringify({
      id: "full-history-fixture", object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model,
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`);
    reply.pending = {
      write: content => emit({ content }),
      finish: () => { emit({ content: " " + liveEnd }); emit({}, "stop"); response.end("data: [DONE]\n\n"); },
    };
    response.once("close", () => { reply.pending = null; });
    emit({ role: "assistant", content: liveStart });
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  registerCleanup(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  await writeFile(join(paths.agent, "models.json"), JSON.stringify({ providers: { [provider]: {
    api: "openai-completions", baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: "local-test-only",
    models: [{ id: model, name: "Transcript Fixture", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 4096 }],
  } } }));
  const settingsPath = join(paths.agent, "settings.json");
  const settings = JSON.parse(await readFile(settingsPath, "utf8"));
  await writeFile(settingsPath, JSON.stringify({ ...settings, enabledModels: [`${provider}/${model}`] }));
  return reply;
}

export const chatHistoryFull = {
  id: "chat-history-full",
  mode: "local-model-fixture",
  scope: "Windows Electron, the local Next.js service, synthetic SDK history and a held loopback model stream",
  coverage: ["direct scrolling to the earliest message, across a compaction", "render a complete long Markdown reply in chat", "switch immediately to another chat while history is held", "locate an older entry and return to latest", "open and read old messages while a response streams", "restart with the same profile"],
  limits: ["real model providers", "non-Windows platforms", "release packages"],
  async prepare({ paths, directory, report, registerCleanup }) {
    const id = randomUUID();
    const otherId = randomUUID();
    const workspace = join(directory, "history-workspace");
    const folder = join(paths.agent, "sessions", "--chat-history-full-fixture--");
    await mkdir(workspace, { recursive: true });
    await mkdir(folder, { recursive: true });
    const timestamp = new Date().toISOString();
    const entryId = index => index.toString(16).padStart(8, "0");
    const entries = [{ type: "session", version: 3, id, cwd: workspace, timestamp }];
    const total = 240;
    const checkpoint = entryId(total + 1);
    for (let index = 1; index <= total; index++) {
      const number = Math.ceil(index / 2);
      const message = index % 2
        ? { role: "user", content: "Fixture question " + number, timestamp: Date.parse(timestamp) + index }
        : { role: "assistant", content: [{ type: "text", text: number === 1 ? longAnswer : number === 4 ? "First milestone only" : "Fixture answer " + number }], provider, model,
          api: "openai-completions", stopReason: "stop", usage: fixtureUsage, timestamp: Date.parse(timestamp) + index };
      if (index === 41) entries.push({ type: "compaction", id: checkpoint, parentId: entryId(40), timestamp,
        summary: "Fixture context checkpoint", firstKeptEntryId: entryId(39), tokensBefore: 90_000 });
      const parentId = index === 1 ? null : index === 41 ? checkpoint : entryId(index - 1);
      entries.push({ type: "message", id: entryId(index), parentId, timestamp, message });
    }
    entries.push({ type: "session_info", id: entryId(total + 2), parentId: entryId(total), timestamp, name: "Full history fixture" });
    await writeFile(join(folder, id + ".jsonl"), entries.map(entry => JSON.stringify(entry)).join("\n") + "\n");
    const otherEntries = [
      { type: "session", version: 3, id: otherId, cwd: workspace, timestamp },
      { type: "message", id: entryId(1), parentId: null, timestamp, message: { role: "user", content: "Target conversation question", timestamp: Date.parse(timestamp) } },
      { type: "session_info", id: entryId(2), parentId: entryId(1), timestamp, name: "Immediate switch target" },
    ];
    await writeFile(join(folder, otherId + ".jsonl"), otherEntries.map(entry => JSON.stringify(entry)).join("\n") + "\n");
    const reply = await prepareHeldReply(paths, registerCleanup);
    fixtures.set(directory, { id, otherId, total, checkpoint, lastId: entryId(total), reply });
    report.fixture = { sessionId: id, switchTargetId: otherId, messages: total, checkpoint, dataset: "synthetic text-only history" };
  },
  async run({ page, restart, step, directory, waitUntil, screenshot }) {
    const fixture = fixtures.get(directory);
    fixtures.delete(directory);
    assert.ok(fixture);
    const catalogURL = "/api/sessions/" + fixture.id;
    const evidence = {};
    const scroll = () => page.locator(".chat-scroll-container");
    const sessionRow = id => page.locator('[data-session-drag-id="' + id + '"]');
    const jumpToLatest = () => page.getByRole("button", {
      name: /^(滚动到最新消息|滚动到最新内容并恢复自动跟随|Scroll to latest message|Scroll to latest and resume automatic follow)$/,
    }).click();
    const stop = () => page.getByRole("button", { name: /^(Stop agent|停止智能体)$/ });
    const assertNoPagination = async () => assert.equal(await page.getByRole("button", { name: /^(加载更早消息|Load earlier messages)$/ }).count(), 0);
    const paginationRequests = [];
    page.on("request", request => {
      const url = new URL(request.url());
      if (url.pathname === catalogURL && (url.searchParams.has("older") || url.searchParams.has("around"))) {
        paginationRequests.push(url.search);
      }
    });
    const scrollToOldest = async () => {
      await scroll().hover();
      await waitUntil(async () => {
        const visible = await scroll().evaluate(viewport => {
          const oldest = viewport.querySelector('[data-chat-entry-id="00000001"]');
          const heading = viewport.querySelector('[data-chat-entry-id="00000002"] h1');
          if (!oldest || !heading || viewport.scrollTop > 1) return false;
          const bounds = viewport.getBoundingClientRect();
          const row = oldest.getBoundingClientRect();
          return row.top < bounds.bottom && row.bottom > bounds.top;
        });
        if (!visible) await page.mouse.wheel(0, -1_000_000);
        return visible;
      }, "the oldest question and its Markdown reply to render");
      await assertNoPagination();
    };
    await step("prepare-history-endpoints", async () => {
      // Prime the dev route compiler independently of the measured click.
      const [history, state] = await page.evaluate(async path => {
        const urls = [path + "?deferThinking=1&deferMedia=1&view=transcript", path + "/state?view=chat"];
        return Promise.all(urls.map(async url => {
          const response = await fetch(url, { cache: "no-store" });
          return { status: response.status, text: await response.text() };
        }));
      }, catalogURL);
      assert.deepEqual([history.status, state.status], [200, 200]);
      const body = JSON.parse(history.text);
      evidence.transcriptBytes = Buffer.byteLength(history.text);
      evidence.transcriptEntries = body.context.entryIds.length;
      assert.equal(evidence.transcriptEntries, fixture.total + 1);
      assert.equal(body.context.entryIds[0], "00000001");
      assert.equal(body.context.entryIds.at(-1), fixture.lastId);
      assert.equal(body.context.entryIds[40], fixture.checkpoint);
      assert.equal(body.context.messages[1].content[0].text, longAnswer);
      assert.equal(body.historyPage, undefined);
    });
    await step("open-complete-chat", async () => {
      await sessionRow(fixture.id).click();
      await page.locator('[data-chat-surface][data-session-id="' + fixture.id + '"] textarea').waitFor();
      await page.getByText("Fixture answer 120", { exact: true }).waitFor();
    });
    await step("scroll-to-oldest-without-paging", async () => {
      await scrollToOldest();
      await page.getByText("Fixture question 1", { exact: true }).waitFor();
      const answer = page.locator('[data-chat-entry-id="00000002"]');
      await answer.getByRole("heading", { name: "Archived Markdown answer", exact: true }).waitFor();
      await answer.getByRole("listitem").getByText("Archived list item", { exact: true }).waitFor();
      await answer.locator("pre code").getByText("archived code sample", { exact: true }).waitFor();
      await answer.getByText(longAnswerEnd, { exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: /^(在完整历史中查看原文|Open original in history)$/ }).count(), 0);
      evidence.fullMarkdownInChat = true;
    });
    await step("switch-from-long-chat", async () => {
      const query = /^(搜索聊天或设置…|Search chats or settings…)$/;
      await page.getByRole("button", { name: /^(搜索|Search)$/ }).click();
      await page.getByPlaceholder(query).fill("First milestone only");
      await page.getByPlaceholder(query).press("Escape");
      await page.getByPlaceholder(query).waitFor({ state: "hidden" });
      const url = candidate => candidate.pathname === "/api/sessions/" + fixture.otherId && candidate.searchParams.get("view") === "transcript";
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      const pauseHistory = async route => { await gate; await route.continue(); };
      await page.route(url, pauseHistory);
      try {
        await page.evaluate(id => {
          document.addEventListener("click", event => {
            if (!event.target.closest('[data-session-drag-id="' + id + '"]')) return;
            const start = performance.now();
            requestAnimationFrame(() => {
              const surface = document.querySelector("[data-chat-surface]");
              window.pioraFirstTargetFrame = {
                elapsedMs: performance.now() - start,
                sessionId: surface?.dataset.sessionId,
                hasComposer: Boolean(surface?.querySelector("textarea")),
              };
            });
          }, { capture: true, once: true });
        }, fixture.otherId);
        await sessionRow(fixture.otherId).click();
        const surface = page.locator('[data-chat-surface][data-session-id="' + fixture.otherId + '"]');
        const composer = surface.locator("textarea");
        await composer.waitFor();
        await page.waitForFunction(() => Boolean(window.pioraFirstTargetFrame));
        const firstFrame = await page.evaluate(() => window.pioraFirstTargetFrame);
        assert.equal(firstFrame.sessionId, fixture.otherId);
        assert.equal(firstFrame.hasComposer, true);
        assert.equal(await page.getByRole("heading", { name: "Archived Markdown answer", exact: true }).count(), 0);
        await composer.fill("Draft typed before the history arrives");
        const originalComposer = await composer.elementHandle();
        release();
        await page.getByText("Target conversation question", { exact: true }).waitFor();
        assert.equal(await composer.inputValue(), "Draft typed before the history arrives");
        assert.equal(await composer.evaluate((node, previous) => node === previous, originalComposer), true);
        await originalComposer.dispose();
        evidence.firstTargetFrame = firstFrame;
        evidence.draftRetainedAcrossLoad = true;
      } finally {
        release();
        await page.unroute(url, pauseHistory);
      }
      await sessionRow(fixture.id).click();
      await page.getByText("Fixture answer 120", { exact: true }).waitFor();
    });
    await step("locate-old-search-result", async () => {
      await page.reload();
      await page.getByText("Fixture answer 120", { exact: true }).waitFor();
      await page.getByRole("button", { name: /^(搜索|Search)$/ }).click();
      const search = page.getByPlaceholder(/^(搜索聊天或设置…|Search chats or settings…)$/);
      await search.fill("First milestone only");
      await page.locator("#unified-search-results").getByRole("button").filter({ hasText: "First milestone only" }).click();
      await page.waitForFunction(() => {
        const viewport = document.querySelector(".chat-scroll-container")?.getBoundingClientRect();
        const match = document.querySelector('[data-chat-entry-id="00000008"]')?.getBoundingClientRect();
        return viewport && match && match.top < viewport.bottom && match.bottom > viewport.top;
      });
      await page.locator('[data-chat-entry-id="00000008"]').getByText("First milestone only", { exact: true }).waitFor();
      await jumpToLatest();
      await page.getByText("Fixture answer 120", { exact: true }).waitFor();
    });
    await step("read-oldest-during-live-reply", async () => {
      const composer = page.locator('[data-chat-surface][data-session-id="' + fixture.id + '"] textarea');
      await composer.fill(livePrompt);
      await page.getByRole("button", { name: /^(Send|发送)$/ }).click();
      await page.getByText(liveStart, { exact: true }).waitFor();
      await stop().waitFor();

      await sessionRow(fixture.otherId).click();
      await page.getByText("Target conversation question", { exact: true }).waitFor();
      await sessionRow(fixture.id).click();
      await stop().waitFor();
      await page.getByText(livePrompt, { exact: true }).waitFor();
      await scrollToOldest();
      assert.equal(await stop().isVisible(), true);
      assert.ok(fixture.reply.pending, "the SDK provider connection must still be open at the oldest message");
      await screenshot("oldest-while-running.png");
      const addedText = " A new token arrived while I was reading history.";
      fixture.reply.pending.write(addedText);
      assert.ok(await scroll().evaluate(element => element.scrollTop <= 1));
      await jumpToLatest();
      await page.getByText(liveStart + addedText, { exact: true }).waitFor();
      fixture.reply.pending.finish();
      await page.getByText(liveEnd).waitFor();
      await waitUntil(async () => !await stop().isVisible(), "assistant run to settle");
      assert.deepEqual(fixture.reply.requests, [{ hasNewPrompt: true, hasArchivedPrompt: false }]);
      evidence.modelInputExcludedArchived = true;
      evidence.readOldestWhileRunning = true;
    });
    await step("restart-and-reopen", async () => {
      page = await restart();
      await sessionRow(fixture.id).click();
      await page.getByText(liveEnd).waitFor();
      await scrollToOldest();
      evidence.sameProfileRestart = true;
    });
    assert.deepEqual(paginationRequests, []);
    await writeFile(join(directory, "history-evidence.json"), JSON.stringify(evidence, null, 2));
  },
};

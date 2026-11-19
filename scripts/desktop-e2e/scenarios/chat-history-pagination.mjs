import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const fixtures = new Map();
const longAnswerEnd = "The complete answer ends here.";
const longAnswer = [
  "# Archived Markdown answer",
  "- **Archived list item**",
  "```text\narchived code sample\n```",
  "Additional fixture content. ".repeat(12_000),
  longAnswerEnd,
].join("\n\n");

export const chatHistoryPagination = {
  id: "chat-history-pagination",
  scope: "Windows Electron and the local Next.js service with on-disk synthetic SDK history",
  coverage: ["bounded initial history and first paint", "load older while preserving the scroll anchor", "render a complete long Markdown reply in chat", "switch immediately to another chat while history is held", "locate an older entry", "return to latest", "restart with the same profile"],
  limits: ["no model provider", "no physical Harmony device", "no release packaging"],
  async prepare({ paths, directory, report }) {
    const id = randomUUID();
    const otherId = randomUUID();
    const workspace = join(directory, "history-workspace");
    const folder = join(paths.agent, "sessions", "--chat-history-pagination-fixture--");
    await mkdir(workspace, { recursive: true });
    await mkdir(folder, { recursive: true });
    const timestamp = new Date().toISOString();
    const entryId = index => index.toString(16).padStart(8, "0");
    const entries = [{ type: "session", version: 3, id, cwd: workspace, timestamp }];
    const total = 240;
    for (let index = 1; index <= total; index++) {
      const number = Math.ceil(index / 2);
      const message = index % 2
        ? { role: "user", content: "Fixture question " + number, timestamp: Date.parse(timestamp) + index }
        : { role: "assistant", content: [{ type: "text", text: number === 1 ? longAnswer : number === 4 ? "First milestone only" : "Fixture answer " + number }], provider: "fixture", model: "local",
          api: "openai-completions", stopReason: "stop", timestamp: Date.parse(timestamp) + index };
      entries.push({ type: "message", id: entryId(index), parentId: index === 1 ? null : entryId(index - 1), timestamp, message });
    }
    entries.push({ type: "session_info", id: entryId(total + 1), parentId: entryId(total), timestamp, name: "History pagination fixture" });
    await writeFile(join(folder, id + ".jsonl"), entries.map(entry => JSON.stringify(entry)).join("\n") + "\n");
    const otherEntries = [
      { type: "session", version: 3, id: otherId, cwd: workspace, timestamp },
      { type: "message", id: entryId(1), parentId: null, timestamp, message: { role: "user", content: "Target conversation question", timestamp: Date.parse(timestamp) } },
      { type: "session_info", id: entryId(2), parentId: entryId(1), timestamp, name: "Immediate switch target" },
    ];
    await writeFile(join(folder, otherId + ".jsonl"), otherEntries.map(entry => JSON.stringify(entry)).join("\n") + "\n");
    fixtures.set(directory, { id, otherId, total, lastId: entryId(total) });
    report.fixture = { sessionId: id, switchTargetId: otherId, messages: total, dataset: "synthetic text-only history" };
  },
  async run({ page, restart, step, directory }) {
    const fixture = fixtures.get(directory);
    fixtures.delete(directory);
    assert.ok(fixture);
    const catalogURL = "/api/sessions/" + fixture.id;
    const evidence = {};
    const earlierLabel = /^(加载更早消息|Load earlier messages)$/;
    const readEarlier = () => page.getByRole("button", { name: earlierLabel });
    const olderResponse = () => page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === catalogURL && url.searchParams.has("older");
    });
    const scroll = page.locator(".chat-scroll-container");
    const scrollToOldest = async () => {
      await scroll.hover();
      await page.mouse.wheel(0, -100000);
      await page.waitForFunction(() => document.querySelector(".chat-scroll-container")?.scrollTop === 0);
    };
    await step("initial-chat-page", async () => {
      const [response] = await Promise.all([
        page.waitForResponse(response => {
          const url = new URL(response.url());
          return url.pathname === catalogURL && url.searchParams.get("view") === "chat";
        }),
        page.locator('[data-session-drag-id="' + fixture.id + '"]').click(),
      ]);
      await page.locator('[data-chat-surface][data-session-id="' + fixture.id + '"] textarea').waitFor();
      const text = await response.text();
      assert.equal(response.status(), 200, text);
      const body = JSON.parse(text);
      evidence.firstPageBytes = Buffer.byteLength(text);
      evidence.firstPageMessages = body.context.entryIds.length;
      assert.equal(evidence.firstPageMessages, 80);
      assert.equal(body.context.entryIds.at(-1), fixture.lastId);
      assert.ok(evidence.firstPageBytes < 100_000);
      assert.ok(body.historyPage.older);
      await page.getByText("Fixture answer 120", { exact: true }).waitFor();
    });
    await step("load-older-over-the-ui", async () => {
      await scrollToOldest();
      const originalAnchor = page.locator('[data-chat-entry-id="000000a1"]');
      await originalAnchor.waitFor();
      const before = await originalAnchor.boundingBox();
      assert.ok(before);
      const received = olderResponse();
      await readEarlier().click();
      const response = await received;
      const text = await response.text();
      assert.equal(response.status(), 200, text);
      const body = JSON.parse(text);
      evidence.olderPageMessages = body.context.entryIds.length;
      assert.equal(evidence.olderPageMessages, 80);
      assert.equal(body.context.entryIds.at(-1), "000000a0");
      try {
        await page.waitForFunction(top => {
          const anchor = document.querySelector('[data-chat-entry-id="000000a1"]');
          return anchor && Math.abs(anchor.getBoundingClientRect().top - top) <= 2;
        }, before.y, { timeout: 8_000 });
      } catch {
        const after = await originalAnchor.count() ? await originalAnchor.boundingBox() : null;
        const scrollTop = await scroll.evaluate(element => element.scrollTop);
        assert.fail(JSON.stringify({ anchorTopBefore: before.y, anchorTopAfter: after?.y ?? null, scrollTop }));
      }
      evidence.preservedScrollAnchor = true;
      await scrollToOldest();
      await page.getByText("Fixture question 41", { exact: true }).waitFor();
      const shortHistory = olderResponse();
      await readEarlier().click();
      const shortResponse = await shortHistory;
      assert.equal(shortResponse.status(), 200);
      const shortPage = await shortResponse.json();
      assert.equal(shortPage.context.entryIds[0], "00000003");
      assert.ok(shortPage.historyPage.older);
      await page.getByRole("button", { name: earlierLabel, disabled: false }).waitFor();
      await scrollToOldest();
      await page.getByText("Fixture question 2", { exact: true }).waitFor();

      const fullHistory = olderResponse();
      await readEarlier().click();
      const fullResponse = await fullHistory;
      assert.equal(fullResponse.status(), 200);
      const fullPage = await fullResponse.json();
      assert.deepEqual(fullPage.context.entryIds, ["00000001", "00000002"]);
      assert.equal(fullPage.context.messages[1].content[0].text, longAnswer);
      await readEarlier().waitFor({ state: "hidden" });
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
      const url = candidate => candidate.pathname === "/api/sessions/" + fixture.otherId && candidate.searchParams.get("view") === "chat";
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
        await page.locator('[data-session-drag-id="' + fixture.otherId + '"]').click();
        const surface = page.locator('[data-chat-surface][data-session-id="' + fixture.otherId + '"]');
        const composer = surface.locator("textarea");
        await composer.waitFor();
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
      await page.locator('[data-session-drag-id="' + fixture.id + '"]').click();
      await page.getByText("Fixture answer 120", { exact: true }).waitFor();
    });
    await step("locate-old-search-result", async () => {
      await page.reload();
      await page.getByText("Fixture answer 120", { exact: true }).waitFor();
      await page.getByRole("button", { name: /^(搜索|Search)$/ }).click();
      const search = page.getByPlaceholder(/^(搜索聊天或设置…|Search chats or settings…)$/);
      await search.fill("First milestone only");
      await page.locator("#unified-search-results").getByRole("button").filter({ hasText: "First milestone only" }).click();
      await page.getByText("Fixture question 4", { exact: true }).waitFor();
      await page.getByRole("button", { name: /^(返回最新消息|Return to latest messages)$/ }).click();
      await page.getByText("Fixture answer 120", { exact: true }).waitFor();
    });
    await step("restart-and-reopen", async () => {
      page = await restart();
      await page.locator('[data-session-drag-id="' + fixture.id + '"]').click();
      await page.getByText("Fixture answer 120", { exact: true }).waitFor();
      assert.equal(await readEarlier().isVisible(), true);
      evidence.sameProfileRestart = true;
    });
    await writeFile(join(directory, "history-pagination-evidence.json"), JSON.stringify(evidence, null, 2));
  },
};

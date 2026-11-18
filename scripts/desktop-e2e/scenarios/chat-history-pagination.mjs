import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const fixtures = new Map();

export const chatHistoryPagination = {
  id: "chat-history-pagination",
  scope: "Windows Electron and the local Next.js service with on-disk synthetic SDK history",
  coverage: ["bounded initial history and first paint", "load older while preserving the scroll anchor", "locate an older entry", "return to latest", "restart with the same profile"],
  limits: ["no model provider", "no physical Harmony device", "no release packaging"],
  async prepare({ paths, directory, report }) {
    const id = randomUUID();
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
        : { role: "assistant", content: [{ type: "text", text: number === 4 ? "First milestone only" : "Fixture answer " + number }], provider: "fixture", model: "local",
          api: "openai-completions", stopReason: "stop", timestamp: Date.parse(timestamp) + index };
      entries.push({ type: "message", id: entryId(index), parentId: index === 1 ? null : entryId(index - 1), timestamp, message });
    }
    entries.push({ type: "session_info", id: entryId(total + 1), parentId: entryId(total), timestamp, name: "History pagination fixture" });
    await writeFile(join(folder, id + ".jsonl"), entries.map(entry => JSON.stringify(entry)).join("\n") + "\n");
    fixtures.set(directory, { id, total, lastId: entryId(total) });
    report.fixture = { sessionId: id, messages: total, dataset: "synthetic text-only history" };
  },
  async run({ page, restart, step, directory }) {
    const fixture = fixtures.get(directory);
    fixtures.delete(directory);
    assert.ok(fixture);
    const catalogURL = "/api/sessions/" + fixture.id;
    const evidence = {};
    const readEarlier = () => page.getByRole("button", { name: /^(加载更早消息|Load earlier messages)$/ });
    const scroll = page.locator(".chat-scroll-container");
    const scrollToOldest = async () => {
      await scroll.hover();
      await page.mouse.wheel(0, -100000);
      await page.waitForFunction(() => document.querySelector(".chat-scroll-container")?.scrollTop === 0);
    };
    await step("initial-chat-page", async () => {
      await page.evaluate(() => {
        window.pioraHistoryLoadingFlash = false;
        const observer = new MutationObserver(() => {
          if (document.querySelector(".session-loading-indicator")) window.pioraHistoryLoadingFlash = true;
        });
        observer.observe(document.body, { subtree: true, childList: true });
        window.pioraFinishHistoryPaintProbe = () => { observer.disconnect(); return window.pioraHistoryLoadingFlash; };
      });
      const received = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname === catalogURL && url.searchParams.get("view") === "chat";
      });
      await page.locator('[data-session-drag-id="' + fixture.id + '"]').click();
      const response = await received;
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
      evidence.loadingFlash = await page.evaluate(() => window.pioraFinishHistoryPaintProbe());
      assert.equal(evidence.loadingFlash, false);
    });
    await step("load-older-over-the-ui", async () => {
      await scrollToOldest();
      const originalAnchor = page.locator('[data-chat-entry-id="000000a1"]');
      await originalAnchor.waitFor();
      const before = await originalAnchor.boundingBox();
      assert.ok(before);
      const received = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname === catalogURL && url.searchParams.has("older");
      });
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
      await readEarlier().click();
      await readEarlier().waitFor({ state: "hidden" });
      await scrollToOldest();
      await page.getByText("Fixture question 1", { exact: true }).waitFor();
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

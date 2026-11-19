import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { prepareWorkflowModel } from "../workflow-model-fixture.mjs";

export const worktreeChatLayout = {
  id: "worktree-chat-layout",
  mode: "scripted-model",
  scope: "Windows Electron, real Git checkouts and session files, isolated profile and loopback model",
  coverage: ["file panel close across projects and restart", "Markdown row edges", "new conversation in a linked checkout", "open Pocket from the main window and switch its header tabs"],
  limits: ["live provider", "release packaging"],
  async prepare(context) {
    const { paths, directory, report } = context;
    await prepareWorkflowModel(context);
    const repo = join(directory, "project");
    const checkout = join(directory, "feature-worktree");
    const other = join(directory, "unrelated");
    const git = (...args) => execFileSync("git", args, { windowsHide: true, stdio: "pipe" });
    git("init", "-b", "main", repo);
    await writeFile(join(repo, "note.md"), "Stored file tab");
    git("-C", repo, "add", "note.md");
    git("-C", repo, "-c", "user.name=Desktop Test", "-c", "user.email=test@example.invalid", "commit", "-m", "fixture");
    git("-C", repo, "worktree", "add", "-b", "feature", checkout);
    await mkdir(other);
    const folder = join(paths.agent, "sessions", "--workspace-layout--");
    await mkdir(folder, { recursive: true });
    const ids = [];
    for (const [cwd, name] of [[repo, "Main fixture"], [checkout, "Linked checkout"], [other, "Other project"]]) {
      const id = randomUUID(), timestamp = new Date().toISOString();
      const text = "[note.md](./note.md)\n\n| 端 | 入口 |\n| --- | --- |\n| PC | A |\n| 手机 | B |";
      const message = { role: "assistant", content: [{ type: "text", text }], timestamp: Date.now(), provider: "desktop-workflow-fixture", model: "plan-goal", api: "openai-completions", stopReason: "stop" };
      const entries = [{ type: "session", version: 3, id, cwd, timestamp },
        { type: "message", id: "a1000001", parentId: null, timestamp, message: { role: "user", content: name, timestamp: Date.now() } },
        { type: "message", id: "a1000002", parentId: "a1000001", timestamp, message },
        { type: "session_info", id: "a1000003", parentId: "a1000002", timestamp, name }];
      await writeFile(join(folder, id + ".jsonl"), entries.map(row => JSON.stringify(row)).join("\n") + "\n");
      ids.push(id);
    }
    Object.assign(report.fixture, { repo, checkout, ids });
    fixtures.set(directory, { repo, checkout, ids });
  },
  async run({ page, directory, step, restart, waitUntil, getBrowser }) {
    const { repo, checkout, ids: [main, linked, other] } = fixtures.get(directory);
    fixtures.delete(directory);
    const row = id => page.locator('[data-session-drag-id="' + id + '"]');
    const project = () => row(main).locator("xpath=ancestor::section[@data-project-drag-root][1]");
    const open = id => row(id).click();
    const toggle = () => page.locator(".right-panel-toggle");
    const closed = () => page.locator('.right-panel-toggle[aria-expanded="false"]').waitFor();
    await step("prepare-history-routes", async () => {
      // Compile cold development routes before measuring the actual UI flow.
      const statuses = await page.evaluate(async id => Promise.all([
        "/api/sessions/" + id + "?deferThinking=1&deferMedia=1&view=chat", "/api/sessions/" + id + "/state?view=chat",
      ].map(async url => {
        const response = await fetch(url, { cache: "no-store" });
        await response.text();
        return response.status;
      })), linked);
      assert.deepEqual(statuses, [200, 200]);
    });
    await step("project-and-table", async () => {
      await open(linked);
      await project().locator('[data-session-drag-id="' + linked + '"]').waitFor();
      const table = page.locator(".markdown-table-wrap");
      await table.waitFor();
      const edges = await table.evaluate(wrap => {
        const rect = wrap.getBoundingClientRect(), css = getComputedStyle(wrap);
        return { left: rect.left + parseFloat(css.borderLeftWidth), right: rect.right - parseFloat(css.borderRightWidth),
          background: css.backgroundColor, rows: Array.from(wrap.querySelectorAll("tr"), row => [row.cells[0].getBoundingClientRect().left, row.cells[row.cells.length - 1].getBoundingClientRect().right]) };
      });
      assert.equal(edges.rows.length, 3);
      assert.notEqual(edges.background, "rgba(0, 0, 0, 0)");
      for (const [start, end] of edges.rows) assert.ok(Math.abs(edges.left - start) <= 1 && Math.abs(edges.right - end) <= 1, JSON.stringify(edges));
      await page.screenshot({ path: join(directory, "table-edges.png") });
    });
    await step("closed-panel-and-restored-files", async () => {
      await page.getByRole("link", { name: "note.md" }).click();
      await page.locator('.right-panel-toggle[aria-expanded="true"]').waitFor();
      await toggle().click();
      await closed();
      await open(other);
      await page.locator('[data-chat-surface][data-session-id="' + other + '"] table').waitFor();
      await closed();
      await open(linked);
      await page.getByRole("link", { name: "note.md" }).waitFor();
      await closed();
      page = await restart();
      await open(linked);
      await page.getByRole("link", { name: "note.md" }).waitFor();
      await closed();
      await toggle().click();
      await page.locator('.right-panel-toggle[aria-expanded="true"]').waitFor();
      await toggle().click();
    });
    let createdId;
    await step("create-send-and-reload-linked-session", async () => {
      const add = project().getByRole("button", { name: new RegExp("feature-worktree.*(新建会话|$)") });
      await add.click();
      const composer = page.locator(".chat-composer-textarea");
      await composer.fill("Linked worktree first message");
      // The new checkout resolves its own model list after the draft is already editable.
      const send = page.getByRole("button", { name: /^(Send|发送)$/ }).and(page.locator(":enabled"));
      await send.waitFor();
      assert.equal(await composer.inputValue(), "Linked worktree first message");
      await composer.press("Enter");
      await page.getByText("Plan / Goal fixture", { exact: true }).waitFor({ timeout: 120_000 });
      createdId = new URL(page.url()).searchParams.get("session");
      assert.ok(createdId && ![main, linked, other].includes(createdId));
      const item = project().locator('[data-session-drag-id="' + createdId + '"]');
      await item.waitFor();
      await page.reload();
      await item.waitFor();
      await item.click();
      await page.getByText("Linked worktree first message", { exact: true }).waitFor();
      const info = await page.evaluate(async id => (await (await fetch("/api/sessions?view=metadata&sessionId=" + id)).json()).sessions[0], createdId);
      assert.equal(info.cwd, checkout);
      assert.equal(info.projectRoot, repo);
      assert.equal(info.worktreeBranch, "feature");
    });
    await step("open-pocket-from-window-header", async () => {
      await page.getByRole("button", { name: /^(打开随身舱|Open Pocket)$/ }).click();
      const panel = await waitUntil(() => getBrowser().contexts().flatMap(context => context.pages()).find(p => p.url().includes("/desktop-companion-panel")), "Pocket window");
      const tabs = panel.locator('header [role="tablist"][aria-orientation="horizontal"]');
      await tabs.waitFor({ timeout: 120_000 });
      const active = tabs.locator('[aria-selected="true"]');
      await active.focus();
      await active.press("End");
      await tabs.locator('#cabin-tab-mind[aria-selected="true"]').waitFor();
      await active.press("Home");
      await active.press("ArrowRight");
      await tabs.locator('#cabin-tab-quick-access[aria-selected="true"]').waitFor();
      await tabs.locator("#cabin-tab-tasks").click();
      await panel.locator('[role="tabpanel"][data-tool="tasks"]').waitFor();
      const geometry = await tabs.evaluate(nav => {
        const bar = nav.closest("header").getBoundingClientRect(), rect = nav.getBoundingClientRect();
        return { top: rect.top, rightGap: bar.right - rect.right, bottom: rect.bottom, headerBottom: bar.bottom };
      });
      assert.ok(geometry.top >= 0 && geometry.rightGap <= 20 && geometry.bottom <= geometry.headerBottom);
      await panel.screenshot({ path: join(directory, "pocket-header.png") });
      await panel.setViewportSize({ width: 380, height: 720 });
      await active.press("End");
      const lastTab = tabs.locator('#cabin-tab-mind[aria-selected="true"]');
      await lastTab.waitFor();
      await panel.waitForFunction(() => {
        const nav = document.querySelector('header [role="tablist"]');
        const box = nav.getBoundingClientRect(), last = nav.querySelector('[aria-selected="true"]').getBoundingClientRect();
        return last.left >= box.left && last.right <= box.right + 1 && box.right <= innerWidth;
      });
      await panel.screenshot({ path: join(directory, "pocket-header-narrow.png") });
    });
  },
};

const fixtures = new Map();

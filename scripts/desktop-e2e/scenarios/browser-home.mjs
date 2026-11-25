import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { openChatBrowser } from "../open-chat-browser.mjs";

let fixture;

export const browserHome = {
  id: "browser-home",
  scope: "real Windows Electron browser home, project files, local web fixture and intercepted keyword navigation",
  coverage: ["first-run search and shortcuts", "keyboard selection of a local file and browsing history", "URL and keyword navigation", "new-tab focus and isolation", "dark and narrow layout"],
  limits: ["external search service responses", "browser mode without the desktop bridge", "packaged application"],
  async prepare({ paths, directory, env, registerCleanup }) {
    const project = join(directory, "project");
    const sessions = join(paths.agent, "sessions", "--browser-home-fixture--");
    const externalProfiles = join(directory, "external-profiles");
    await mkdir(externalProfiles);
    if (process.platform === "win32") env.LOCALAPPDATA = externalProfiles;
    if (process.platform === "linux") env.XDG_CONFIG_HOME = externalProfiles;
    await mkdir(join(project, "notes"), { recursive: true });
    await mkdir(sessions, { recursive: true });
    await writeFile(join(project, "notes", "现场记录.md"), "# Local browser home file\n");
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    await writeFile(join(sessions, `${timestamp.replaceAll(":", "-")}_${id}.jsonl`), [
      { type: "session", version: 3, id, timestamp, cwd: project },
      { type: "message", id: "user1", parentId: null, message: { role: "user", content: "Local browser home fixture", timestamp: Date.now() } },
      { type: "session_info", id: "info1", parentId: "user1", name: "Browser Home QA", timestamp },
    ].map(row => JSON.stringify(row)).join("\n") + "\n");
    const server = createServer((_request, response) => {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end("<!doctype html><title>Browser Home Test Site</title><h1>Local browser page</h1>");
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    registerCleanup(() => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    }));
    fixture = { id, url: `http://127.0.0.1:${server.address().port}/homepage-fixture` };
  },
  async run({ page, getBrowser, screenshot, step, waitUntil }) {
    const home = page.locator("[data-browser-home]");
    const search = home.getByRole("combobox", { name: /^(Address|地址)$/ });
    const address = page.getByRole("combobox", { name: /^(Address|地址)$/ });
    const browserTab = page.locator("#workspace-browser-tab");
    const state = () => page.evaluate(() => window.piDesktop.browser.getState());
    const findSite = url => getBrowser().contexts().flatMap(context => context.pages()).find(candidate => candidate.url() === url);
    const focusSearch = () => waitUntil(() => search.evaluate(input => document.activeElement === input), "home search receives focus");
    const newTab = () => page.locator("[data-native-browser=true]").getByRole("button", { name: /^(新建标签页|新标签页|New tab)$/i, exact: true }).click();

    await step("directly-usable-first-run-home", async () => {
      await openChatBrowser(page, fixture.id, waitUntil);
      await home.waitFor();
      await focusSearch();
      assert.equal(await address.count(), 1);
      assert.ok(await page.locator("[data-browser-menu-trigger]").isVisible());
      assert.match(await search.getAttribute("placeholder"), /Find project files|搜索项目文件/);
      await screenshot("browser-home.png");
      await home.getByRole("button", { name: /^(Not now|暂不导入)$/ }).click();
      assert.equal(await home.getByRole("button", { name: /^(Not now|暂不导入)$/ }).count(), 0);
    });

    await step("search-and-open-project-file-locally", async () => {
      await search.fill("notes\\现场");
      const file = home.getByRole("option", { name: /现场记录\.md/ });
      await file.waitFor();
      await search.press("ArrowDown");
      assert.equal(await file.getAttribute("aria-selected"), "true");
      await screenshot("browser-home-file-search.png");
      await search.press("Enter");
      await page.locator("#workspace-files").getByText("Local browser home file", { exact: true }).waitFor();
      await browserTab.click();
      await home.waitFor();
      assert.equal((await state()).url, "about:blank");
      assert.equal(await search.inputValue(), "");
    });

    await step("use-project-and-terminal-shortcuts", async () => {
      await home.getByRole("button", { name: /^(Project files|项目文件)$/ }).click();
      await page.locator("#workspace-files").waitFor();
      await browserTab.click();
      await home.getByRole("button", { name: /^(Terminal|终端)$/ }).click();
      await page.locator("#workspace-commands").waitFor();
      await browserTab.click();
    });

    await step("open-a-website-in-the-current-tab", async () => {
      const id = (await state()).activeTabId;
      await search.fill(fixture.url);
      await home.getByRole("button", { name: /^(Go or search the web|打开网址或搜索网页)$/ }).click();
      const site = await waitUntil(() => findSite(fixture.url), "local browser target");
      await site.getByRole("heading", { name: "Local browser page" }).waitFor();
      await home.waitFor({ state: "hidden" });
      assert.equal((await state()).activeTabId, id);
      assert.equal(await address.inputValue(), fixture.url);
    });

    await step("new-tab-focus-and-history-lookup", async () => {
      const original = await state();
      await newTab();
      await home.waitFor();
      await focusSearch();
      assert.equal(await search.inputValue(), "");
      const fresh = await state();
      assert.notEqual(fresh.activeTabId, original.activeTabId);
      assert.ok(fresh.tabs.some(tab => tab.id === original.activeTabId && tab.url === fixture.url));
      await search.fill("homepage-fixture");
      const entry = home.getByRole("option", { name: /Browser Home Test Site/ });
      await entry.waitFor();
      await search.press("ArrowDown");
      await search.press("Escape");
      await entry.waitFor({ state: "hidden" });
      await search.fill("Browser Home Test");
      await entry.click();
      await home.waitFor({ state: "hidden" });
      assert.equal((await state()).activeTabId, fresh.activeTabId);
      assert.equal((await state()).url, fixture.url);
    });

    await step("search-the-web-using-a-keyword", async () => {
      await newTab();
      await home.waitFor();
      const query = "Piora browser home acceptance";
      const expected = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      await Promise.all(getBrowser().contexts().map(context => context.route(expected, route => route.fulfill({
        contentType: "text/html", body: "<title>Search fixture</title><h1>Intercepted search</h1>",
      }))));
      await search.fill(query);
      await search.press("Enter");
      const tab = await waitUntil(() => findSite(expected), "intercepted native search target");
      await tab.getByRole("heading", { name: "Intercepted search" }).waitFor();
      assert.equal((await state()).url, expected);
    });

    await step("dark-theme-and-compact-width", async () => {
      await newTab();
      await home.waitFor();
      const light = await home.evaluate(element => getComputedStyle(element).backgroundColor);
      await page.getByRole("button", { name: /^(Settings|设置)$/ }).click();
      const settings = page.getByRole("dialog", { name: /^(Settings|设置)$/ });
      await settings.getByRole("button", { name: /^(Appearance & Language|外观与界面)$/ }).click();
      await settings.locator('[role="radio"][data-theme-id="dark"]').click();
      await page.locator('html[data-theme="dark"]').waitFor();
      await settings.getByRole("button", { name: /^(Back to Piora|返回 Piora)$/ }).click();
      await settings.waitFor({ state: "hidden" });
      await page.setViewportSize({ width: 1400, height: 760 });
      const resizer = page.locator('[data-resize-handle="right-panel"]');
      await resizer.press("Home");
      await waitUntil(() => home.evaluate(element => element.clientWidth <= 400), "browser home at compact panel width");
      assert.notEqual(await home.evaluate(element => getComputedStyle(element).backgroundColor), light);
      assert.ok(await home.evaluate(element => element.scrollWidth <= element.clientWidth));
      await screenshot("browser-home-dark-compact.png");
      await home.getByRole("button", { name: /^(Browsing history|浏览记录)$/ }).click();
      await page.locator('[role="dialog"]').getByText(/^(History|历史记录)$/).first().waitFor();
    });
  },
};

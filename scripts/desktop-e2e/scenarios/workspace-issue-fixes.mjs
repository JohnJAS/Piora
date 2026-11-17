import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chatContextMenu } from "./chat-context-menu.mjs";

const fixture = {};

export const workspaceIssueFixes = {
  id: "workspace-issue-fixes",
  scope: "real Electron UI, file API, native browser, clipboard, filesystem downloads and restart; synthetic histories and loopback websites, no model",
  coverage: [...chatContextMenu.coverage, "unique filename recovery and ambiguous candidate selection", "download settings via UI and real download bytes", "immediate directory changes and duplicate filename avoidance", "native monospace font and site-specific zoom", "resize gesture and restored browser viewport", "preferences and zoom after process restart"],
  limits: [...chatContextMenu.limits, "the reporter's JupyterLab/CodeHub deployments", "native keyboard delivery; CDP input does not establish before-input-event coverage, which is tested in the desktop event fixture", "manual interaction with the native Save As dialog; its selection policy is covered by a desktop fixture", "physical monitor DPI changes"],
  async prepare(context) {
    await chatContextMenu.prepare(context);
    const { report, paths, registerCleanup } = context;
    Object.assign(fixture, report.fixture);
    fixture.downloadA = join(fixture.cwd, "下载 A"); fixture.downloadB = join(fixture.cwd, "下载 B");
    for (const [relative, text] of [["openspec/one/proposal.md", "# Proposal\nUNIQUE_PROPOSAL"], ["openspec/one/design.md", "# Design one\nDESIGN_ONE"], ["openspec/two/design.md", "# Design two\nDESIGN_TWO"]]) {
      const path = join(fixture.cwd, relative); await mkdir(join(path, ".."), { recursive: true }); await writeFile(path, text);
    }
    const sessions = join(paths.agent, "sessions", "--chat-context-menu-fixture--");
    const sessionFile = join(sessions, (await readdir(sessions)).find(file => file.endsWith(`_${fixture.id}.jsonl`)));
    const rows = (await readFile(sessionFile, "utf8")).trim().split("\n").map(JSON.parse);
    rows.find(row => row.message?.role === "assistant").message.content[0].text += "\n\n`proposal.md:2`\n\n`design.md:2`";
    await writeFile(sessionFile, rows.map(JSON.stringify).join("\n") + "\n");
    fixture.origins = [];
    for (let index = 0; index < 2; index++) {
      const server = createServer((request, response) => {
        if (request.url === "/download") { response.writeHead(200, { "content-type": "text/plain", "content-disposition": 'attachment; filename="download.txt"' }); response.end("browser-download-fixture\n"); return; }
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end('<!doctype html><title>Browser fixture</title><style>body{margin:20px;background:#dcecff}#terminal{font-family:monospace;font-size:13px}</style><p id="terminal">Terminal sample ABC 0123456789</p><a href="/download">Download fixture</a>');
      });
      await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
      registerCleanup(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
      fixture.origins.push(`http://127.0.0.1:${server.address().port}`);
    }
    report.fixture = { ...report.fixture, downloadA: fixture.downloadA, downloadB: fixture.downloadB, origins: fixture.origins };
  },
  async run(context) {
    await chatContextMenu.run(context);
    let { page } = context;
    const { step, waitUntil, getBrowser, restart, directory } = context;
    const screenshot = name => page.screenshot({ path: join(directory, name), animations: "disabled", timeout: 30000 });
    const evidence = {};
    const state = () => page.evaluate(() => window.piDesktop.browser.getState());
    const settings = async () => {
      await page.getByRole("button", { name: /^(Settings|设置)$/ }).click();
      const dialog = page.getByRole("dialog", { name: /^(Settings|设置)$/ });
      await dialog.getByRole("button", { name: /^(Browser|浏览器)$/ }).click();
      await dialog.getByLabel(/^(Download location|下载位置)$/).waitFor();
      return dialog;
    };
    const saveDirectory = async path => {
      const dialog = await settings();
      await dialog.getByLabel(/^(Download location|下载位置)$/).fill(path);
      await dialog.getByRole("button", { name: /^(Save download settings|保存下载设置)$/ }).click();
      await dialog.getByText(/^(Download settings saved\.|下载设置已保存。)$/).waitFor();
      await page.keyboard.press("Escape");
    };
    const navigate = async origin => {
      const address = page.getByRole("textbox", { name: /^(Address|地址)$/ });
      if (!await address.isVisible()) await page.keyboard.press(process.platform === "darwin" ? "Meta+t" : "Control+t");
      await address.waitFor();
      await waitUntil(async () => (await state()).sessionId === fixture.id, "browser bound to the selected fixture chat");
      await address.fill(origin + "/"); await address.press("Enter");
      await waitUntil(async () => (await state()).url === origin + "/", "native browser reached fixture origin");
      return waitUntil(() => getBrowser().contexts().flatMap(context => context.pages()).find(site => site.url() === origin + "/"), "native browser page");
    };
    const assertDownloaded = async path => waitUntil(async () => { try { return await readFile(path, "utf8") === "browser-download-fixture\n"; } catch { return false; } }, "actual downloaded bytes at selected location");
    try {
      await step("filename-only-unique-file-and-row", async () => {
        await page.getByRole("link", { name: "proposal.md:2", exact: true }).click();
        await page.locator('.file-source-line[data-line-number="2"]').filter({ hasText: "UNIQUE_PROPOSAL" }).waitFor();
      });
      await step("ambiguous-filename-explicit-selection", async () => {
        await page.getByRole("link", { name: "design.md:2", exact: true }).click();
        const candidates = page.getByRole("group", { name: /^(Choose a file to open|选择要打开的文件)$/ });
        await candidates.waitFor(); assert.equal(await candidates.getByRole("button").count(), 2);
        await context.reload();
        await candidates.waitFor(); assert.equal(await candidates.getByRole("button").count(), 2);
        await candidates.getByRole("button", { name: "openspec/two/design.md", exact: true }).click();
        await page.locator('.file-source-line[data-line-number="2"]').filter({ hasText: "DESIGN_TWO" }).waitFor();
      });
      await step("save-download-directory-in-settings", async () => { await saveDirectory(fixture.downloadA); });
      let site;
      await step("download-to-custom-directory-without-overwrite", async () => {
        site = await navigate(fixture.origins[0]);
        await site.getByRole("link", { name: "Download fixture" }).click();
        await assertDownloaded(join(fixture.downloadA, "download.txt"));
        await site.getByRole("link", { name: "Download fixture" }).click();
        await assertDownloaded(join(fixture.downloadA, "download (1).txt"));
        evidence.downloadA = [join(fixture.downloadA, "download.txt"), join(fixture.downloadA, "download (1).txt")];
      });
      await step("download-directory-change-applies-immediately", async () => {
        await saveDirectory(fixture.downloadB);
        await site.getByRole("link", { name: "Download fixture" }).click();
        await assertDownloaded(join(fixture.downloadB, "download.txt"));
        evidence.downloadB = join(fixture.downloadB, "download.txt");
      });
      await step("monospace-font-and-site-zoom-controls", async () => {
        const cdp = await site.context().newCDPSession(site);
        await cdp.send("DOM.enable"); await cdp.send("CSS.enable");
        const document = await cdp.send("DOM.getDocument");
        const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: document.root.nodeId, selector: "#terminal" });
        evidence.fonts = (await cdp.send("CSS.getPlatformFontsForNode", { nodeId })).fonts;
        if (process.platform === "win32") assert.ok(evidence.fonts.some(font => font.familyName === "Consolas"));
        await cdp.detach();
        // CDP keyboard input does not establish native before-input-event delivery.
        // The desktop event fixture checks those shortcuts; exercise real native
        // zoom here through the production UI, retaining all zoom assertions.
        await page.getByRole("button", { name: /^(Zoom in|放大页面)$/ }).click();
        await waitUntil(async () => (await state()).zoomFactor > 1, "zoom control updates actual native page");
        evidence.zoom = (await state()).zoomFactor;
        await page.getByRole("button", { name: /^(Zoom out|缩小页面)$/ }).click();
        assert.equal((await state()).zoomFactor, 1);
        await page.getByRole("button", { name: /^(Zoom in|放大页面)$/ }).click();
        await page.getByRole("button", { name: /^(Zoom in|放大页面)$/ }).click();
        assert.ok((await state()).zoomFactor > evidence.zoom);
        await page.getByRole("button", { name: /^(Reset page zoom|重置页面缩放)$/ }).click();
        assert.equal((await state()).zoomFactor, 1);
        await page.getByRole("button", { name: /^(Zoom in|放大页面)$/ }).click();
        evidence.zoom = (await state()).zoomFactor;
        await navigate(fixture.origins[1]); assert.equal((await state()).zoomFactor, 1);
        site = await navigate(fixture.origins[0]); assert.ok(Math.abs((await state()).zoomFactor - evidence.zoom) < 0.001);
      });
      await step("resize-real-browser-panel", async () => {
        await page.evaluate(() => { window.observedPanelResizes = []; window.addEventListener("piora:panel-resize", event => window.observedPanelResizes.push(event.detail.resizing)); });
        const handle = page.locator('[data-resize-handle="right-panel"]');
        const bounds = await handle.boundingBox(); assert.ok(bounds);
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 80); await page.mouse.down();
        await page.mouse.move(bounds.x + 100, bounds.y + 80, { steps: 5 });
        await screenshot("browser-resizing.png");
        await page.mouse.up();
        await waitUntil(async () => JSON.stringify(await page.evaluate(() => window.observedPanelResizes)) === "[true,false]", "panel receives resize release");
        assert.deepEqual(await page.evaluate(() => window.observedPanelResizes), [true, false]);
        await waitUntil(async () => {
          const width = await page.locator('[data-native-browser="true"] [data-browser-viewport]').evaluate(element => Math.floor(element.getBoundingClientRect().width));
          const nativeWidth = await site.evaluate(() => innerWidth);
          return Math.abs(nativeWidth * (await state()).zoomFactor - width) < 4;
        }, "native viewport matches the shrunken panel after release");
        await screenshot("browser-resize-restored.png");
      });
      await step("ask-before-download-setting", async () => {
        const dialog = await settings();
        await dialog.getByLabel(/^(Ask where to save each file before downloading|每次下载前询问保存位置)$/).check();
        await dialog.getByRole("button", { name: /^(Save download settings|保存下载设置)$/ }).click();
        await dialog.getByText(/^(Download settings saved\.|下载设置已保存。)$/).waitFor();
        await page.keyboard.press("Escape");
      });
      await step("restart-persists-download-preferences-and-site-zoom", async () => {
        page = await restart();
        evidence.restored = await page.evaluate(() => window.piDesktop.browser.getPreferences());
        assert.equal(evidence.restored.directory, fixture.downloadB); assert.equal(evidence.restored.askEachTime, true);
        // Restart opens a fresh chat. Re-select the fixture through the sidebar
        // before asking its browser to navigate; preferences remain global.
        await page.locator(`[data-session-drag-id="${fixture.id}"]`).click();
        await navigate(fixture.origins[0]); assert.ok(Math.abs((await state()).zoomFactor - evidence.zoom) < 0.001);
        await screenshot("browser-preferences-restored.png");
      });
    } finally { await writeFile(join(directory, "workspace-issues-evidence.json"), JSON.stringify(evidence, null, 2)); }
  },
};

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
const fixture = {};
const normalize = value => value.replaceAll("\\", "/");

async function explorerWindows() {
  const script = `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $shell=New-Object -ComObject Shell.Application; $items=@($shell.Windows() | ForEach-Object { try { [pscustomobject]@{handle=[string]$_.HWND; path=[string]$_.Document.Folder.Self.Path; selected=@($_.Document.SelectedItems() | ForEach-Object { [string]$_.Path })} } catch {} }); ConvertTo-Json -InputObject $items -Compress -Depth 4`;
  const { stdout } = await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 30000, encoding: "utf8" });
  return JSON.parse(stdout.trim() || "[]");
}

export const chatContextMenu = {
  id: "chat-context-menu",
  scope: "real Electron chat UI, clipboard IPC and file reveal IPC; synthetic session and local files, no model",
  coverage: ["right-click file/link copy with real clipboard readback", "line/column suffix removal for native reveal", "missing file feedback", "keyboard menu and reload", "Windows Explorer folder and selected file observation"],
  limits: ["real model generation", "published installer", "other operating systems", "arbitrary network shares and inaccessible system directories"],
  async prepare({ paths, directory, report }) {
    fixture.cwd = join(directory, "project");
    fixture.folder = join(fixture.cwd, "中文 Files");
    fixture.file = join(fixture.folder, "报告.md");
    fixture.missing = join(fixture.folder, "missing.md");
    fixture.id = randomUUID();
    await mkdir(fixture.folder, { recursive: true });
    await writeFile(fixture.file, Array.from({ length: 20 }, (_, i) => `报告第 ${i + 1} 行`).join("\n"));
    const sessions = join(paths.agent, "sessions", "--chat-context-menu-fixture--");
    await mkdir(sessions, { recursive: true });
    const timestamp = new Date().toISOString();
    const text = `[测试报告](<${normalize(fixture.file)}:12:2>)\n\n[测试网页](https://example.com/docs?source=chat-menu#example)\n\n[失效报告](<${normalize(fixture.missing)}:9>)\n\n\`${fixture.folder}\``;
    await writeFile(join(sessions, `${timestamp.replaceAll(":", "-")}_${fixture.id}.jsonl`), [
      { type: "session", version: 3, id: fixture.id, cwd: fixture.cwd, timestamp },
      { type: "message", id: "10000001", parentId: null, timestamp, message: { role: "user", content: "对话右键菜单测试", timestamp: Date.parse(timestamp) } },
      { type: "message", id: "10000002", parentId: "10000001", timestamp, message: { role: "assistant", content: [{ type: "text", text }], timestamp: Date.parse(timestamp), provider: "fixture", model: "no-model", api: "openai-completions", stopReason: "stop", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } },
      { type: "session_info", id: "10000003", parentId: "10000002", timestamp, name: "对话右键菜单测试" },
    ].map(JSON.stringify).join("\n") + "\n");
    report.fixture = { ...fixture, source: "synthetic on-disk history; production rendering and desktop bridges" };
  },
  async run({ page, step, reload, waitUntil, directory }) {
    const screenshot = name => page.screenshot({ path: join(directory, name), animations: "disabled", timeout: 30000 });
    const menu = page.getByRole("menu", { name: /^(Chat content menu|对话内容菜单)$/ });
    const file = () => page.getByRole("link", { name: "测试报告", exact: true });
    const reveal = () => menu.getByRole("menuitem", { name: /^(Show in File Explorer|在文件资源管理器中打开)$/ });
    const copyPath = () => menu.getByRole("menuitem", { name: /^(Copy path|复制路径)$/ });
    const previousClipboard = await page.evaluate(() => window.piDesktop.clipboard.readText());
    const previousExplorerHandles = process.platform === "win32" ? (await explorerWindows()).map(window => window.handle) : [];
    const evidence = { nativeExplorer: "not-run" };
    try {
      await step("open-synthetic-chat", async () => {
        // Warm the read-only history route before selection: its first dev compile
        // can exceed the UI's 30s loading deadline. Menu actions remain UI-only.
        evidence.historyPrepared = await page.evaluate(async id => {
          const response = await fetch(`/api/sessions/${encodeURIComponent(id)}?deferThinking=1&deferMedia=1`);
          if (!response.ok) throw new Error(`Fixture history preparation failed: ${response.status}`);
          await response.json();
          return true;
        }, fixture.id);
        await page.locator(`[data-session-drag-id="${fixture.id}"]`).click();
        await page.locator(".message-row-assistant").waitFor();
        // A fresh dev graph can invalidate the lazy Markdown proxy while the
        // first history mounts. Reload the prepared chat before testing menus.
        await reload();
        await file().waitFor();
      });
      await step("copy-path-through-desktop-clipboard", async () => {
        await file().click({ button: "right" });
        await screenshot("file-context-menu.png");
        await copyPath().click();
        await menu.waitFor({ state: "hidden" });
        evidence.copiedPath = await page.evaluate(() => window.piDesktop.clipboard.readText());
        assert.equal(evidence.copiedPath, `${normalize(fixture.file)}:12:2`);
      });
      await step("copy-web-address", async () => {
        await page.getByRole("link", { name: "测试网页", exact: true }).click({ button: "right" });
        assert.equal(await reveal().count(), 0);
        await menu.getByRole("menuitem", { name: /^(Copy link address|复制链接地址)$/ }).click();
        await menu.waitFor({ state: "hidden" });
        assert.equal(await page.evaluate(() => window.piDesktop.clipboard.readText()), "https://example.com/docs?source=chat-menu#example");
      });
      await step("missing-file-feedback", async () => {
        await page.getByRole("link", { name: "失效报告", exact: true }).click({ button: "right" });
        await reveal().click();
        await menu.getByRole("alert").waitFor();
        await screenshot("missing-file-feedback.png");
        await page.keyboard.press("Escape");
        await menu.waitFor({ state: "hidden" });
      });
      await step("keyboard-and-reload", async () => {
        await file().focus();
        await page.keyboard.press("Shift+F10");
        await menu.waitFor();
        await page.keyboard.press("Escape");
        assert.equal(await file().evaluate(element => element === document.activeElement), true);
        await reload();
        await file().click({ button: "right" });
        await copyPath().click();
        await menu.waitFor({ state: "hidden" });
        assert.equal(await page.evaluate(() => window.piDesktop.clipboard.readText()), `${normalize(fixture.file)}:12:2`);
      });
      if (process.platform === "win32") {
        await step("reveal-real-file-in-windows-explorer", async () => {
          await file().click({ button: "right" });
          await reveal().click();
          await waitUntil(async () => {
            let windows;
            try { windows = await explorerWindows(); }
            catch (error) { evidence.explorerObservationError = error.message; return false; }
            const match = windows.find(window => normalize(window.path).toLowerCase() === normalize(fixture.folder).toLowerCase()
              && window.selected.some(path => normalize(path).toLowerCase() === normalize(fixture.file).toLowerCase()));
            if (match) evidence.nativeExplorer = match;
            return Boolean(match);
          }, "Explorer showing the real fixture file selected");
        });
        await step("open-real-directory-in-windows-explorer", async () => {
          await page.bringToFront();
          await page.getByText(fixture.folder, { exact: true }).click({ button: "right" });
          await reveal().click();
          await waitUntil(async () => {
            try { return (await explorerWindows()).some(window => normalize(window.path).toLowerCase() === normalize(fixture.folder).toLowerCase()); }
            catch (error) { evidence.explorerObservationError = error.message; return false; }
          }, "Explorer showing the fixture directory");
        });
      }
    } finally {
      await writeFile(join(directory, "chat-context-menu-evidence.json"), JSON.stringify(evidence, null, 2));
      await page.evaluate(text => window.piDesktop.clipboard.writeText(text), previousClipboard).catch(() => {});
      if (process.platform === "win32") {
        // Close only new Explorer windows still displaying this run's unique fixture directory.
        const script = `$shell=New-Object -ComObject Shell.Application; $existing=@($env:PIORA_TEST_EXPLORER_HANDLES -split ','); $shell.Windows() | ForEach-Object { try { if ([string]$_.HWND -notin $existing -and [string]$_.Document.Folder.Self.Path -eq $env:PIORA_TEST_EXPLORER_FOLDER) { $_.Quit() } } catch {} }`;
        await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 30000,
          env: { ...process.env, PIORA_TEST_EXPLORER_HANDLES: previousExplorerHandles.join(","), PIORA_TEST_EXPLORER_FOLDER: fixture.folder } });
      }
    }
  },
};

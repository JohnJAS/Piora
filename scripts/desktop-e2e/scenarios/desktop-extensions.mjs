import assert from "node:assert/strict";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

async function prepareInstalledFixtures(root) {
  async function prepare(id, version, file, code) {
    const home = join(root, id, "home");
    const installed = join(root, id, "installed");
    const entry = join(installed, "node_modules", id, file);
    await mkdir(dirname(entry), { recursive: true });
    await mkdir(home, { recursive: true });
    await writeFile(join(home, "retained-data.txt"), id);
    await writeFile(join(installed, "piora-adapter.json"), JSON.stringify({ version, adapter: 1 }));
    await writeFile(entry, code);
  }
  await prepare("dsh-pet", "0.3.8", "lib/standalone.js", `
    const { createServer } = require("node:http");
    const { mkdirSync, writeFileSync } = require("node:fs");
    const { join } = require("node:path");
    function dshHomeDir() { return process.env.DSH_HOME; }
    function electronCacheDir(input) { return 'legacy-cache'; }
    async function upstreamDownload() { const zipPath = await downloadArtifact({}); }
    const home = join(dshHomeDir(), "dsh-pet");
    const server = createServer((req, res) => {
      res.end("{}");
      if (req.url === "/shutdown") stop();
    });
    function stop() { server.close(() => process.exit(0)); server.closeAllConnections(); }
    process.on("SIGTERM", stop);
    server.listen(Number(process.argv.at(-1)), "127.0.0.1", () => {
      mkdirSync(home, { recursive: true });
      writeFileSync(join(home, "standalone-runtime.json"), JSON.stringify({
        pid: process.pid, port: server.address().port, token: "a".repeat(43),
      }));
    });
  `);
  await prepare("dsh-meme", "0.1.76", "index.js", `
    exports.apply = context => {
      for (const name of ["send_meme", "learn_meme", "meme_list", "meme_update"]) {
        context.tools.register({ name, execute: () => ({ ok: true }) });
      }
    };
  `);
  const meme = join(root, "dsh-meme", "installed", "node_modules", "dsh-meme");
  await mkdir(join(meme, "memes"));
  await writeFile(join(meme, "memes.js"), "export function bundledPacksDir() { return fileURLToPath(new URL('./memes', import.meta.url)) }");
}

export const desktopExtensions = {
  id: "desktop-extensions",
  scope: "real Electron settings, restricted desktop extension IPC and both real managers using local installed-program fixtures",
  coverage: ["both extensions on one page", "no project required", "installation entries", "untrusted action rejection",
    "desktop-only task endpoint", "independent start/stop and preferences", "autostart after app restart", "uninstall preserves data"],
  limits: ["test host entries represent installed programs; upstream installation and native windows have separate smoke tests", "model calls"],
  async run({ page, directory, restart, screenshot, step, waitUntil }) {
    let dialog;
    const pet = () => dialog.locator('[data-desktop-extension="dsh-pet"]');
    const meme = () => dialog.locator('[data-desktop-extension="dsh-meme"]');
    const autoStart = card => card.getByRole("switch", { name: /^(Start with Piora|随 Piora 启动)$/ });
    const start = card => card.getByRole("button", { name: /^(Start|启动)$/ });
    const stop = card => card.getByRole("button", { name: /^(Stop|停止)$/ });
    const uninstall = card => card.getByRole("button", { name: /^(Uninstall \(keep data\)|卸载（保留数据）)$/ });
    const installed = card => card.getByRole("button", { name: /^Install DSH|^安装 DSH/ });
    const root = join(directory, "agent", "piora", "desktop-extensions");

    async function openSettings() {
      await page.waitForFunction(() => document.querySelector("[data-app-hydrated]"));
      const settings = page.getByRole("button", { name: /^(Settings|设置)$/ });
      dialog = page.getByRole("dialog", { name: /^(Settings|设置)$/ });
      if (!await dialog.isVisible()) await settings.click();
      await dialog.waitFor();
      await dialog.getByTestId("settings-desktopExtensions").click();
      await pet().getByRole("heading", { name: "DSH Pet", exact: true }).waitFor();
      await meme().getByRole("heading", { name: "DSH Meme", exact: true }).waitFor();
    }
    await step("open-desktop-extensions", async () => {
      await openSettings();
    });
    await step("check-install-controls", async () => {
      for (const card of [pet(), meme()]) {
        assert.equal(await installed(card).isEnabled(), true);
        assert.equal(await autoStart(card).isChecked(), false);
        assert.equal(await autoStart(card).isEnabled(), false);
      }
      assert.equal(await pet().getByRole("switch").count(), 2);
      assert.equal(await meme().getByRole("switch").count(), 1);
      assert.equal(await dialog.getByText(/Agent (packages|插件)/).count() > 0, true);
      await screenshot("desktop-extensions.png");
    });
    await step("reject-unknown-action", async () => {
      const result = await page.evaluate(async () => {
        try { await window.piDesktop.dshPet.action("execute-arbitrary-code"); return "accepted"; }
        catch { return "rejected"; }
      });
      assert.equal(result, "rejected");
      const rejected = await page.evaluate(async () => {
        const bridge = window.piDesktop.desktopExtensions;
        return Promise.allSettled([
          bridge.action("unknown", "install"),
          bridge.action("dsh-meme", "folder"),
          bridge.preferences("dsh-meme", { syncTasks: true }),
        ]).then(results => results.map(item => item.status));
      });
      assert.deepEqual(rejected, ["rejected", "rejected", "rejected"]);
    });
    await step("desktop-task-endpoint", async () => {
      const endpoint = new URL("/api/desktop/dsh-pet/tasks", page.url()).href;
      const rejected = await fetch(endpoint);
      assert.equal(rejected.status, 403, "external callers must supply the desktop token");
      const result = await page.evaluate(async () => {
        const response = await fetch("/api/desktop/dsh-pet/tasks");
        return { status: response.status, body: await response.json() };
      });
      assert.equal(result.status, 200);
      assert.deepEqual(result.body, { tasks: [] }, "fresh profile exposes no previous chat data");
    });
    await step("start-stop-and-save-preferences-independently", async () => {
      await prepareInstalledFixtures(root);
      for (const card of [pet(), meme()]) {
        await start(card).click();
        await waitUntil(() => stop(card).isEnabled(), "extension is running");
        await autoStart(card).click();
        await waitUntil(() => autoStart(card).isChecked(), "auto-start is enabled");
      }
      await stop(pet()).click();
      await waitUntil(() => start(pet()).isEnabled(), "Pet stops before another operation");
      assert.equal(await stop(meme()).isEnabled(), true, "stopping Pet leaves Meme running");
      const compatibility = await page.evaluate(async () => {
        const petStatus = await window.piDesktop.dshPet.status();
        const response = await fetch("/api/memes?status=1");
        const meme = await response.json();
        return [petStatus.phase, response.status, meme.status?.phase];
      });
      assert.deepEqual(compatibility, ["stopped", 200, "running"]);
    });
    await step("restore-both-from-preferences-after-restart", async () => {
      page = await restart();
      await openSettings();
      for (const card of [pet(), meme()]) {
        await waitUntil(() => stop(card).isEnabled(), "extension restarts with Piora");
        assert.equal(await autoStart(card).isChecked(), true);
      }
      await screenshot("desktop-extensions-running.png");
    });
    await step("uninstall-programs-and-retain-data", async () => {
      for (const [card, id] of [[meme(), "dsh-meme"], [pet(), "dsh-pet"]]) {
        await uninstall(card).click();
        await waitUntil(() => installed(card).isEnabled(), "install control returns after uninstall");
        await assert.rejects(stat(join(root, id, "installed")), { code: "ENOENT" });
        assert.equal(await readFile(join(root, id, "home", "retained-data.txt"), "utf8"), id);
      }
    });
  },
};

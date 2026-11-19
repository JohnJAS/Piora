import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const cordisExtensions = {
  id: "cordis-extensions",
  scope: "Real Electron, Cordis child process, native extension window and versioned files with an isolated agent directory.",
  coverage: ["verified directory", "install and start", "native panel RPC", "live upgrade with schema migration", "autostart", "integrity error", "uninstall preserves preferences"],
  limits: ["Task Monitor uses the real desktop task projection with an empty synthetic profile", "no provider credentials"],
  async run({ page, directory, restart, getBrowser, screenshot, step, waitUntil }) {
    let card;
    const oldVersion = "1.0.0", newVersion = "1.1.0";
    const button = name => card.getByRole("button", { name });
    const start = () => button(/^(Start|启动)$/);
    const stop = () => button(/^(Stop|停止)$/);
    const install = () => button(/^(Install extension|安装扩展)$/);
    const panelButton = () => button(/^(Open panel|打开面板)$/);
    const autostart = () => card.getByRole("switch", { name: /^(Start with Piora|随 Piora 启动)$/ });
    const root = join(directory, "agent", "piora", "desktop-extensions", "cordis", "piora-task-monitor");
    async function openSettings() {
      const settings = page.getByRole("button", { name: /^(Settings|设置)$/ });
      const dialog = page.getByRole("dialog", { name: /^(Settings|设置)$/ });
      if (!await dialog.isVisible()) await settings.click();
      await dialog.waitFor();
      await dialog.getByTestId("settings-desktopExtensions").click();
      card = dialog.locator('[data-desktop-extension="piora-task-monitor"]');
      await card.getByRole("heading", { name: "Piora Task Monitor" }).waitFor();
    }
    async function panel() {
      await panelButton().click();
      const window = await waitUntil(() => getBrowser().contexts().flatMap(context => context.pages())
        .find(candidate => candidate.url().startsWith("data:text/html;base64,")), "the native Cordis panel");
      await window.locator("#version").filter({ hasText: /^\d+\.\d+\.\d+$/ }).waitFor();
      const bridge = await window.evaluate(() => [typeof window.pioraExtension.invoke, typeof window.require, typeof window.piDesktop]);
      assert.deepEqual(bridge, ["function", "undefined", "undefined"]);
      return window;
    }
    let opened;

    await step("install-verified-older-version", async () => {
      await openSettings();
      const select = card.getByRole("combobox", { name: /^(Version to install|安装版本)$/ });
      await select.selectOption(oldVersion);
      await install().click();
      await waitUntil(() => start().isEnabled(), "the verified version is installed");
      assert.ok((await card.innerText()).includes(oldVersion));
    });

    await step("open-real-sandboxed-panel-and-save-view", async () => {
      await start().click();
      await waitUntil(() => panelButton().isEnabled(), "running profile exposes its panel");
      opened = await panel();
      assert.equal(await opened.locator("#version").textContent(), oldVersion);
      await opened.getByRole("checkbox", { name: /^(Compact view|紧凑视图)$/ }).check();
      await waitUntil(() => opened.locator("body").evaluate(body => body.classList.contains("compact")), "RPC saves the compact preference");
      await assert.rejects(opened.evaluate(() => window.pioraExtension.invoke("unknown")));
      await opened.screenshot({ path: join(directory, "cordis-native-panel.png") });
    });

    await step("live-update-restarts-group-and-migrates-data", async () => {
      await page.bringToFront();
      await button(/^(Update to|更新到) 1\.1\.0$/).click();
      await waitUntil(() => opened.isClosed(), "previous-version panel is closed");
      await card.getByText(/Health check passed|健康检查通过/).waitFor();
      opened = await panel();
      assert.equal(await opened.locator("#version").textContent(), newVersion);
      assert.equal(await opened.getByRole("checkbox", { name: /^(Compact view|紧凑视图)$/ }).isChecked(), true);
      assert.equal(await opened.locator("#running").textContent(), "0");
      await opened.close();
      await screenshot("cordis-directory-installed.png");
    });

    await step("autostart-restores-the-activated-version", async () => {
      await autostart().click();
      await waitUntil(async () => await autostart().getAttribute("aria-checked") === "true", "autostart is saved");
      page = await restart();
      await openSettings();
      await waitUntil(() => panelButton().isEnabled(), "verified version starts on application relaunch");
      opened = await panel();
      assert.equal(await opened.locator("#version").textContent(), newVersion);
    });

    await step("stop-closes-panel-and-integrity-errors-are-visible", async () => {
      await page.bringToFront();
      await stop().click();
      await waitUntil(() => opened.isClosed(), "stop releases the native panel");
      await waitUntil(() => start().isEnabled(), "host has stopped");
      const state = JSON.parse(await readFile(join(root, "state.json"), "utf8"));
      const entry = join(root, "versions", state.active.id, "node_modules", "piora-task-monitor-service", "index.cjs");
      const original = await readFile(entry);
      await writeFile(entry, "invalid candidate");
      try {
        await start().click();
        await card.getByRole("alert").getByText(/integrity check failed/i).waitFor();
      } finally { await writeFile(entry, original); }
    });

    await step("uninstall-and-reinstall-retains-user-data", async () => {
      await button(/^(Uninstall \(keep data\)|卸载（保留数据）)$/).click();
      await waitUntil(() => install().isEnabled(), "extension is uninstalled");
      await card.getByRole("combobox", { name: /^(Version to install|安装版本)$/ }).selectOption(newVersion);
      await install().click();
      await waitUntil(() => start().isEnabled(), "latest release has reinstalled");
      await start().click();
      await waitUntil(() => panelButton().isEnabled(), "reinstalled extension is running");
      opened = await panel();
      assert.equal(await opened.getByRole("checkbox", { name: /^(Compact view|紧凑视图)$/ }).isChecked(), true);
      await opened.close();
    });

    if (process.env.PIORA_DESKTOP_E2E_CORDIS_DISCOVERY === "1") {
      await step("live-community-directory-is-read-only-for-unknown-versions", async () => {
        const community = page.getByRole("region", { name: /^(DSH community directory|DSH 社区目录)$/ });
        await community.getByRole("button", { name: /^(Load directory|加载目录)$/ }).click();
        const search = community.getByRole("searchbox", { name: /^(Search community extensions|搜索社区扩展)$/ });
        const alert = community.getByRole("alert");
        await waitUntil(async () => await search.isVisible() || await alert.isVisible(), "the live community directory response");
        if (await alert.isVisible()) assert.fail(await alert.innerText());
        const observed = community.getByText(/^(Unverified|未验证)$/).first();
        await observed.waitFor();
        assert.equal(await community.getByRole("button", { name: /^(Install extension|安装扩展)$/ }).count(), 0);
        await search.fill("no-such-extension-acceptance-query");
        await waitUntil(async () => await community.getByRole("listitem").count() === 0, "directory search filters the live entries");
        await search.clear();
        await observed.waitFor();
      });
    }
  },
};

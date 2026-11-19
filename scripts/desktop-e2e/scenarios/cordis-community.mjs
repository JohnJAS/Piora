import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const samples = [
  { name: "dsh-niuma-timer", older: "1.2.1", latest: "1.3.0" },
  { name: "dsh-pomodoro-box", older: "1.2.3", latest: "1.2.4" },
  { name: "dsh-panda-calendar", older: "1.2.4", latest: "1.2.5" },
];
let rejected;

async function fromRegistry(path, signal) {
  return fetch(new URL(path, "https://registry.npmjs.org/"), {
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]), redirect: "error",
  });
}

async function prepare({ env, paths, signal, registerCleanup, report }) {
  const archives = new Map(await Promise.all(samples.flatMap(({ name, older, latest }) =>
    [older, latest].map(async version => {
      const path = `/${name}/-/${name}-${version}.tgz`;
      const response = await fromRegistry(path, signal);
      if (!response.ok) throw new Error("Upstream tarball unavailable: " + path);
      return [path, Buffer.from(await response.arrayBuffer())];
    }))));
  const server = createServer(async (request, response) => {
    const path = request.url;
    if (archives.has(path)) {
      response.end(rejected === path ? "Acceptance fixture: archive integrity failure" : archives.get(path));
      return;
    }
    if (path?.match(/^\/dshmarket\/\d+\.\d+\.\d+$/)) {
      try {
        const upstream = await fromRegistry(path, signal);
        response.writeHead(upstream.status, { "Content-Type": "application/json" });
        response.end(Buffer.from(await upstream.arrayBuffer()));
      } catch { response.writeHead(502).end(); }
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  registerCleanup(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  env.PIORA_DSH_MEME_REGISTRY = `http://127.0.0.1:${server.address().port}/`;
  env.NPM_CONFIG_USERCONFIG = join(paths.agent, "community-test-npmrc");
  report.communityReleases = samples;
}

async function exercisePanel(window, name, first) {
  if (name === "dsh-niuma-timer") {
    await window.locator(".nt-chip").click();
    await window.locator(".nt-foot-actions .nt-btn").last().click();
    const salary = window.locator(".nt-form .nt-field input[type=number]").first();
    if (first) {
      await salary.fill("19000");
      await window.locator(".nt-form button.nt-btn.primary").click();
    }
    assert.equal(await salary.inputValue(), "19000");
    return;
  }
  if (name === "dsh-pomodoro-box") {
    await window.getByRole("button", { name: /^(Timer lengths|时长设置)$/ }).click();
    const duration = window.locator(".dshPomo_choices").first().getByRole("button", { name: /^45/ });
    if (first) await duration.click();
    assert.equal(await duration.getAttribute("aria-pressed"), "true");
    await window.getByRole("button", { name: /^(Timer lengths|时长设置)$/ }).click();
    if (first) {
      await window.locator(".dshPomo_dock .dshPomo_chip").first().click();
      await window.getByRole("button", { name: /^(Pause|暂停)$/ }).click();
      await window.getByRole("button", { name: /^(Reset|重置)$/ }).click();
    }
    return;
  }
  const month = window.locator(".pc-card").filter({ has: window.locator(".pc-calendar") }).locator(".pc-card-title");
  const before = await month.innerText();
  await window.getByRole("button", { name: /(?:Next month|下月|下个月)/i }).click();
  assert.notEqual(await month.innerText(), before);
  await window.locator(".pc-today-lunar").waitFor();
  await window.locator(".pc-ts-now").waitFor();
  assert.equal(await window.locator(".pc-weather-body").isVisible(), false);
}

export const cordisCommunity = {
  id: "cordis-community",
  scope: "Real npm tarballs, desktop Settings, Cordis worker, sandboxed original client modules, and on-disk activation slots in an isolated data directory.",
  coverage: ["community install buttons for three upstream plugins", "each original panel", "integrity failure rollback", "successful live update", "persisted settings and relaunch", "live DSH directory and npm compatibility diagnostics"],
  limits: ["the test registry serves authentic upstream bytes and substitutes invalid bytes once per upgrade", "Panda Calendar is offline", "no provider credentials", "no NSIS installer lifecycle"],
  prepare,
  async run({ page, directory, restart, getBrowser, step, waitUntil }) {
    let community;
    async function settings() {
      await page.getByRole("button", { name: /^(Settings|设置)$/ }).click();
      const dialog = page.getByRole("dialog", { name: /^(Settings|设置)$/ });
      await dialog.getByTestId("settings-desktopExtensions").click();
      community = dialog.getByRole("region", { name: /^(DSH community directory|DSH 社区目录)$/ });
      await community.getByRole("searchbox").waitFor();
    }
    const cardFor = name => community.locator(`[data-desktop-extension="${name}"]`);
    const stateRoot = name => join(directory, "agent", "piora", "desktop-extensions", "cordis", name);
    const disk = name => readFile(join(stateRoot(name), "state.json"), "utf8").then(JSON.parse);
    async function open(card, name, version) {
      await card.getByRole("button", { name: /^(Open panel|打开面板)$/ }).click();
      const window = await waitUntil(async () => {
        for (const context of getBrowser().contexts()) for (const candidate of context.pages()) {
          if (!candidate.url().startsWith("data:text/html;base64,")) continue;
          if (await candidate.locator(`#community-root[data-package="${name}"]`).count().catch(() => 0)) return candidate;
        }
        return null;
      }, "original native panel for " + name);
      assert.deepEqual(await window.evaluate(() => {
        const config = JSON.parse(document.getElementById("community-config").textContent);
        return [config.version, config.probe, typeof window.require, typeof window.piDesktop];
      }), [version, false, "undefined", "undefined"]);
      await window.locator("#community-root > *").first().waitFor();
      await assert.rejects(window.evaluate(() => window.pioraExtension.invoke("unknown")));
      return window;
    }

    await settings();
    for (const { name, older, latest } of samples) {
      const card = cardFor(name);
      const start = card.getByRole("button", { name: /^(Start|启动)$/ });
      const panelButton = card.getByRole("button", { name: /^(Open panel|打开面板)$/ });
      const update = card.getByRole("button", { name: "Update to " + latest }).or(card.getByRole("button", { name: "更新到 " + latest }));
      let baseline;
      let opened;
      await step(name + "-install-and-use-original-panel", async () => {
        await card.getByRole("combobox").selectOption(older);
        await card.getByRole("button", { name: new RegExp("^(Install|安装) " + older.replaceAll(".", "\\.") + "$") }).click();
        await start.click();
        await waitUntil(() => panelButton.isEnabled(), name + " is running");
        opened = await open(card, name, older);
        await exercisePanel(opened, name, true);
        baseline = await disk(name);
        assert.equal(baseline.active.version, older);
      });
      await step(name + "-failed-update-preserves-version-and-data", async () => {
        await page.bringToFront();
        rejected = `/${name}/-/${name}-${latest}.tgz`;
        await update.click();
        await card.getByText(/previous version and its data were restored|已恢复到原版本及原数据/).waitFor();
        await card.getByRole("alert").getByText(/integrity check failed/i).waitFor();
        assert.deepEqual((await disk(name)).active, baseline.active);
        assert.match(await card.innerText(), new RegExp("(Running|运行版本) " + older.replaceAll(".", "\\.")));
        await exercisePanel(opened, name, false);
        rejected = undefined;
      });
      await step(name + "-retry-update-restores-settings", async () => {
        await page.bringToFront();
        await update.click();
        await waitUntil(() => opened.isClosed(), "old native panel closed");
        await card.getByText(/Health check passed|健康检查通过/).waitFor();
        opened = await open(card, name, latest);
        await exercisePanel(opened, name, false);
        assert.deepEqual((await disk(name)).previous, baseline.active);
        await opened.screenshot({ path: join(directory, name + ".png") });
        await opened.close();
        await page.bringToFront();
        await card.getByRole("switch").click();
        await waitUntil(async () => await card.getByRole("switch").getAttribute("aria-checked") === "true", "autostart saved");
      });
    }

    await step("autostart-all-three-after-relaunch", async () => {
      page = await restart();
      await settings();
      for (const { name, latest } of samples) {
        const window = await open(cardFor(name), name, latest);
        await exercisePanel(window, name, false);
        await window.close();
        await page.bringToFront();
      }
    });
    await step("live-directory-explains-marketplace-blockers", async () => {
      await community.getByRole("button", { name: /^(Load directory|加载目录)$/ }).click();
      await community.getByRole("searchbox").fill("dshmarket");
      const row = community.locator('[data-community-package="dshmarket"]').first();
      await row.getByRole("button", { name: /Check compatibility|检查兼容性/ }).click();
      await row.getByText(/@deepseek-ai\/dsh-client-ui-settings/).waitFor();
      await row.getByText("./cordis.patch.yml", { exact: true }).waitFor();
      assert.equal(await row.getByRole("button", { name: /^(Install|安装)/ }).count(), 0);
      assert.match(await row.innerText(), /Incompatible|不兼容/);
    });
  },
};

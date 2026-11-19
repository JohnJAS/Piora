import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export const browserSettings = {
  id: "browser-settings",
  scope: "Real Electron settings renderer and persisted browser download preferences.",
  coverage: ["single browser heading", "styled download controls and zoom help", "keyboard toggle", "save, reload, invalid input and reset", "light, dark and narrow layouts"],
  limits: ["native directory chooser interaction", "actual downloads"],
  async run({ page, directory, reload, screenshot, step, waitUntil }) {
    const dialog = page.getByRole("dialog", { name: /^(Settings|设置)$/ });
    const downloads = dialog.locator('[data-settings-id="browser.downloads"]');
    const location = downloads.getByRole("textbox", { name: /^(Download location|下载位置)$/ });
    const ask = downloads.getByRole("switch", { name: /Ask where|每次下载前/ });
    const save = downloads.getByRole("button", { name: /^(Save download settings|保存下载设置)$/ });
    const reset = downloads.getByRole("button", { name: /^(Use system default location|使用系统默认位置)$/ });
    const status = downloads.getByRole("status");
    const open = async () => {
      await page.getByRole("button", { name: /^(Settings|设置)$/ }).click();
      await dialog.getByTestId("settings-browser").click();
      await waitUntil(() => location.isEnabled(), "desktop download preferences are available");
    };
    const folder = join(directory, "browser-settings-downloads", "a separate test directory");
    await mkdir(folder, { recursive: true });

    await step("browser-renders-one-page", async () => {
      await open();
      assert.equal(await dialog.getByRole("heading", { name: /^(Browser|浏览器)$/ }).count(), 1);
      assert.equal(await dialog.getByRole("heading", { name: /^(Page zoom|页面缩放)$/ }).count(), 1);
      assert.equal(await downloads.getByRole("button", { name: /^(Browse…|浏览…)$/ }).isVisible(), true);
      const layout = await downloads.evaluate(card => {
        const input = card.querySelector("input");
        const style = getComputedStyle(input);
        return { width: card.getBoundingClientRect().width, border: style.borderTopWidth, height: input.getBoundingClientRect().height };
      });
      assert.ok(layout.width <= 760, JSON.stringify(layout));
      assert.ok(layout.border !== "0px" && layout.height >= 32, JSON.stringify(layout));
      await screenshot("browser-settings-light.png");
    });

    await step("save-download-location-and-ask-switch", async () => {
      await location.fill(folder);
      await ask.focus();
      await page.keyboard.press("Space");
      assert.equal(await ask.getAttribute("aria-checked"), "true");
      await save.click();
      await status.getByText(/Download settings saved|下载设置已保存/).waitFor();
      await reload();
      await open();
      assert.equal(await location.inputValue(), folder);
      assert.equal(await ask.getAttribute("aria-checked"), "true");
    });

    await step("reject-invalid-path-and-reset-directory", async () => {
      await location.fill("relative/invalid-directory");
      await save.click();
      await downloads.getByRole("alert").waitFor();
      assert.ok((await downloads.locator("#browser-download-effective").textContent()).includes(folder));
      await reset.click();
      await status.getByText(/Download settings saved|下载设置已保存/).waitFor();
      assert.equal(await location.inputValue(), "");
      assert.equal(await ask.getAttribute("aria-checked"), "true");
    });

    await step("dark-and-narrow-download-layout", async () => {
      await dialog.getByTestId("settings-appearance").click();
      await dialog.locator('[role="radio"][data-theme-id="dark"]').click();
      await dialog.getByTestId("settings-browser").click();
      await location.waitFor();
      await page.setViewportSize({ width: 640, height: 740 });
      const geometry = await downloads.evaluate(card => {
        const { left, right } = card.getBoundingClientRect();
        return { left, right, clientWidth: document.documentElement.clientWidth, contentWidth: card.scrollWidth, width: card.clientWidth };
      });
      assert.ok(geometry.left >= 0 && geometry.right <= geometry.clientWidth + 1, JSON.stringify(geometry));
      assert.ok(geometry.contentWidth <= geometry.width + 1, JSON.stringify(geometry));
      await screenshot("browser-settings-dark-narrow.png");
    });
  },
};

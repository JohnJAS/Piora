import assert from "node:assert/strict";

export const desktopExtensions = {
  id: "desktop-extensions",
  scope: "real Electron settings and restricted desktop extension IPC; no package download",
  coverage: ["separate desktop extension settings", "no project required", "installation entry", "untrusted IPC action rejection", "desktop-only task endpoint"],
  limits: ["upstream installation and native renderer (separate verify-dsh-pet smoke)", "model calls", "packaged builds"],
  async run({ page, screenshot, step }) {
    let dialog;
    await step("open-desktop-extensions", async () => {
      await page.getByRole("button", { name: /^(Settings|设置)$/ }).click();
      dialog = page.getByRole("dialog", { name: /^(Settings|设置)$/ });
      await dialog.getByRole("button", { name: /^(Desktop extensions|桌面扩展)$/ }).click();
      await dialog.getByRole("heading", { name: "DSH Pet" }).waitFor();
    });
    await step("check-install-controls", async () => {
      const install = dialog.getByRole("button", { name: /^(Install DSH Pet|安装 DSH Pet)$/ });
      assert.equal(await install.isEnabled(), true);
      assert.equal(await dialog.getByRole("switch", { name: /^(Start with Piora|随 Piora 启动)$/ }).isChecked(), false);
      assert.equal(await dialog.getByRole("switch", { name: /^(Start with Piora|随 Piora 启动)$/ }).isEnabled(), false);
      assert.equal(await dialog.getByText(/Agent (packages|插件)/).count() > 0, true);
      await screenshot("desktop-extensions.png");
    });
    await step("reject-unknown-action", async () => {
      const result = await page.evaluate(async () => {
        try { await window.piDesktop.dshPet.action("execute-arbitrary-code"); return "accepted"; }
        catch { return "rejected"; }
      });
      assert.equal(result, "rejected");
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
  },
};

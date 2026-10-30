import assert from 'node:assert/strict';

export const settingsTheme = {
  id: 'settings-theme',
  scope: 'real Electron development window; theme UI and reload persistence',
  coverage: ['actual settings navigation and radio clicks', 'rendered theme and localStorage agreement', 'reload persistence', 'uncaught renderer errors'],
  limits: ['model calls and chat sending', 'native system dialogs', 'packaged builds and updates', 'visual design acceptance'],
  async run({ page, reload, screenshot, step, waitUntil }) {
    async function openAppearance() {
      await page.getByRole('button', { name: /^(Settings|设置)$/ }).click();
      const dialog = page.getByRole('dialog', { name: /^(Settings|设置)$/ });
      await dialog.getByRole('button', { name: /^(Appearance & Language|外观与界面)$/ }).click();
      await dialog.locator('[role="radio"][data-theme-id="dark"]').waitFor();
      return dialog;
    }
    async function assertTheme(theme) {
      await waitUntil(() => page.evaluate(expected => document.documentElement.dataset.theme === expected, theme), `rendered ${theme} theme`);
      // This only reads the persisted setting. The scenario never writes theme state through evaluate/API.
      const saved = await page.evaluate(() => localStorage.getItem('pi-theme:v1'));
      assert.ok(saved, 'Theme preference must be persisted');
      assert.equal(JSON.parse(saved).theme, theme);
    }
    let dialog;
    await step('open-settings', async () => { dialog = await openAppearance(); });
    await step('theme-dark', async () => {
      const radio = dialog.locator('[role="radio"][data-theme-id="dark"]');
      await radio.click(); await assertTheme('dark'); assert.equal(await radio.getAttribute('aria-checked'), 'true');
      await screenshot('dark.png');
    });
    await step('reload-dark', async () => {
      await reload(); await assertTheme('dark'); dialog = await openAppearance();
      assert.equal(await dialog.locator('[role="radio"][data-theme-id="dark"]').getAttribute('aria-checked'), 'true');
    });
    await step('theme-light', async () => {
      await dialog.locator('[role="radio"][data-theme-id="light"]').click(); await assertTheme('light');
    });
    await step('reload-light', async () => {
      await reload(); await assertTheme('light'); dialog = await openAppearance();
      assert.equal(await dialog.locator('[role="radio"][data-theme-id="light"]').getAttribute('aria-checked'), 'true');
      await screenshot('light-restored.png');
    });
  },
};

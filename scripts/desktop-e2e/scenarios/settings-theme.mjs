import assert from 'node:assert/strict';

export const settingsTheme = {
  id: 'settings-theme',
  scope: 'real Electron development window; theme UI and reload persistence',
  coverage: ['actual settings navigation and radio clicks', 'rendered theme and localStorage agreement', 'reload persistence', 'glacier parallax and reduced motion', 'uncaught renderer errors'],
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
    const still = () => dialog.locator('[data-appearance-look="nordic"]');
    const motion = () => dialog.locator('[data-appearance-look="glacier-motion"]');
    const scene = page.locator('.glacier-background-motion');
    const closeSettings = () => dialog.getByRole('button', { name: /^(Back to Piora|返回 Piora)$/ }).click();
    await step('glacier-parallax', async () => {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await motion().click();
      await waitUntil(() => page.evaluate(() => document.documentElement.dataset.appBackgroundPreset === 'nordic-ice-motion'), 'motion preset selected');
      assert.equal(await motion().getAttribute('aria-checked'), 'true');
      assert.equal(await still().getAttribute('aria-checked'), 'false');
      await closeSettings();
      await scene.waitFor({ state: 'visible' });
      await page.mouse.move(32, 140);
      await page.waitForFunction(() => {
        const offset = selector => new DOMMatrixReadOnly(getComputedStyle(document.querySelector(selector)).transform).m41;
        return offset('.glacier-facets-front') < offset('.glacier-facets-middle') - 4;
      });
      await screenshot('glacier-motion.png');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await scene.waitFor({ state: 'hidden' });
      assert.match(await page.evaluate(() => getComputedStyle(document.body, '::before').backgroundImage), /nordic-ice\.webp/);
    });
    await step('glacier-motion-preference', async () => {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await reload();
      await scene.waitFor({ state: 'visible' });
      dialog = await openAppearance();
      assert.equal(await motion().getAttribute('aria-checked'), 'true');
      await dialog.getByRole('tab', { name: /^(Background|背景)$/ }).click();
      const toggle = () => dialog.getByRole('checkbox', { name: /^(Background motion|背景微动)$/ });
      await toggle().uncheck();
      await reload();
      dialog = await openAppearance();
      assert.equal(await motion().getAttribute('aria-checked'), 'true');
      await dialog.getByRole('tab', { name: /^(Background|背景)$/ }).click();
      assert.equal(await toggle().isChecked(), false);
      assert.equal(await scene.count(), 0);
      await dialog.locator('[data-background-preset="nordic-ice-motion"]').waitFor();
      await dialog.locator('[data-background-preset="nordic-ice"]').waitFor();
      await dialog.getByRole('tab', { name: /^(Theme & colors|主题与配色)$/i }).click();
      await still().click();
      await waitUntil(() => page.evaluate(() => document.documentElement.dataset.appBackgroundPreset === 'nordic-ice'), 'still preset selected');
      assert.equal(await still().getAttribute('aria-checked'), 'true');
      assert.equal(await motion().getAttribute('aria-checked'), 'false');
      await closeSettings();
      assert.equal(await scene.count(), 0);
    });
  },
};

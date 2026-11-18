import assert from 'node:assert/strict';

export const settingsTheme = {
  id: 'settings-theme',
  scope: 'real Electron development window; theme UI and reload persistence',
  coverage: ['actual settings navigation and radio clicks', 'rendered theme and localStorage agreement', 'reload persistence', 'hands-free glacier and character wallpaper motion', 'glacier parallax, motion toggle and reduced motion', 'uncaught renderer errors'],
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
    const wallpaperStyle = selector => page.evaluate(selector => {
      const style = getComputedStyle(document.querySelector(selector), '::before');
      const matrix = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform);
      return { name: style.animationName, state: style.animationPlayState, x: matrix.m41, y: matrix.m42, scale: matrix.m11 };
    }, selector);
    async function assertAmbientMotion(selector) {
      const initial = await waitUntil(async () => {
        const style = await wallpaperStyle(selector);
        return style.name === 'app-background-drift' && style.state === 'running' && style;
      }, `running wallpaper animation on ${selector}`);
      const moved = await waitUntil(async () => {
        const style = await wallpaperStyle(selector);
        return Math.hypot(style.x - initial.x, style.y - initial.y) > 2 && style;
      }, `wallpaper moves without pointer input on ${selector}`);
      assert.ok(Math.abs(moved.x) <= 8.1 && Math.abs(moved.y) <= 5.1, JSON.stringify(moved));
      assert.ok(moved.scale >= 1.034 && moved.scale <= 1.046, JSON.stringify(moved));
    }
    const assertStaticWallpaper = selector => waitUntil(async () => (await wallpaperStyle(selector)).name === 'none', `still wallpaper on ${selector}`);
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
    const backgrounds = () => dialog.getByRole('tab', { name: /^(Background|背景)$/ });
    const colors = () => dialog.getByRole('tab', { name: /^(Theme & colors|主题与配色)$/i });
    const toggle = () => dialog.getByRole('checkbox', { name: /^(Background motion|背景微动)$/ });
    const assertPreset = preset => waitUntil(() => page.evaluate(preset => document.documentElement.dataset.appBackgroundPreset === preset, preset), `selected ${preset} background`);
    await step('glacier-parallax', async () => {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await motion().click();
      await assertPreset('nordic-ice-motion');
      assert.equal(await motion().getAttribute('aria-checked'), 'true');
      assert.equal(await still().getAttribute('aria-checked'), 'false');
      await assertAmbientMotion('.settings-backdrop');
      await closeSettings();
      await scene.waitFor({ state: 'visible' });
      await assertAmbientMotion('body');
      await page.mouse.move(32, 140);
      await page.waitForFunction(() => {
        const offset = selector => new DOMMatrixReadOnly(getComputedStyle(document.querySelector(selector)).transform).m41;
        return offset('.glacier-facets-front') < offset('.glacier-facets-middle') - 4;
      });
      await screenshot('glacier-motion.png');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await scene.waitFor({ state: 'hidden' });
      await assertStaticWallpaper('body');
      assert.match(await page.evaluate(() => getComputedStyle(document.body, '::before').backgroundImage), /nordic-ice\.webp/);
    });
    await step('glacier-motion-preference', async () => {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await reload();
      await scene.waitFor({ state: 'visible' });
      dialog = await openAppearance();
      assert.equal(await motion().getAttribute('aria-checked'), 'true');
      await backgrounds().click();
      await toggle().uncheck();
      await reload();
      dialog = await openAppearance();
      assert.equal(await motion().getAttribute('aria-checked'), 'true');
      await backgrounds().click();
      assert.equal(await toggle().isChecked(), false);
      assert.equal(await scene.count(), 0);
      await assertStaticWallpaper('.settings-backdrop');
      await dialog.locator('[data-background-preset="nordic-ice-motion"]').waitFor();
      await dialog.locator('[data-background-preset="nordic-ice"]').waitFor();
      await toggle().check();
      await colors().click();
      await still().click();
      await assertPreset('nordic-ice');
      assert.equal(await still().getAttribute('aria-checked'), 'true');
      assert.equal(await motion().getAttribute('aria-checked'), 'false');
      await assertStaticWallpaper('.settings-backdrop');
      await closeSettings();
      assert.equal(await scene.count(), 0);
      await assertStaticWallpaper('body');
    });
    await step('character-wallpaper-motion', async () => {
      dialog = await openAppearance();
      const look = preset => dialog.locator(`[data-appearance-look="${preset}"]`);
      for (const preset of ['character-gpt-ivory', 'character-whale-abyss']) {
        await look(preset).click();
        await assertTheme(preset);
        await assertPreset(preset);
        assert.equal(await look(preset).getAttribute('aria-pressed'), 'true');
        await assertAmbientMotion('.settings-backdrop');
      }
      await closeSettings();
      await assertAmbientMotion('body');
      await screenshot('character-motion.png');
      await reload();
      await assertPreset('character-whale-abyss');
      await assertAmbientMotion('body');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await assertStaticWallpaper('body');
      assert.match(await page.evaluate(() => getComputedStyle(document.body, '::before').backgroundImage), /whale-abyss\.webp/);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      dialog = await openAppearance();
      await backgrounds().click();
      await toggle().uncheck();
      await assertStaticWallpaper('.settings-backdrop');
      await reload();
      await assertPreset('character-whale-abyss');
      await assertStaticWallpaper('body');
      dialog = await openAppearance();
      await backgrounds().click();
      assert.equal(await toggle().isChecked(), false);
    });
  },
};

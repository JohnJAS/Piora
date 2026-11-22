import assert from 'node:assert/strict';

export const settingsTheme = {
  id: 'settings-theme',
  scope: 'real Electron development window; theme UI and reload persistence',
  coverage: ['actual settings navigation and radio clicks', 'rendered theme and localStorage agreement', 'reload persistence', 'glacier parallax and character pixel motion with fixed scenery', 'automatic whale-tide performance and return to idle', 'motion toggle and reduced motion', 'uncaught renderer errors'],
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
    async function assertGlacierDrift(selector) {
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
    const characterScene = page.locator('.character-background-motion');
    function readCharacterFrame(canvas) {
      // Read a rendered frame before the browser clears the WebGL back buffer.
      return canvas.evaluate(element => new Promise(resolve => {
        const gl = element.getContext('webgl');
        const tile = (x, y) => {
          const size = 32;
          const pixels = new Uint8Array(size * size * 4);
          gl.readPixels(Math.round(gl.drawingBufferWidth * x - size / 2),
            Math.round(gl.drawingBufferHeight * (1 - y) - size / 2), size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          return Array.from(pixels.filter((_, index) => index % 4 !== 3));
        };
        let attempts = 0;
        function sample() {
          const scenery = tile(0.18, 0.22);
          if (scenery.some(color => color > 0)) resolve({ scenery, character: tile(0.76, 0.23) });
          else if (++attempts < 4) requestAnimationFrame(sample);
          else resolve(null);
        }
        requestAnimationFrame(sample);
      }));
    }
    async function assertCharacterMotion(host, preset) {
      const canvas = page.locator(`${host} > .character-background-motion[data-character-background="${preset}"]`);
      await canvas.waitFor({ state: 'visible' });
      await assertStaticWallpaper(host);
      const first = await waitUntil(() => readCharacterFrame(canvas), `rendered character frame in ${host}`);
      await waitUntil(async () => {
        const next = await readCharacterFrame(canvas);
        if (!next) return false;
        assert.deepEqual(next.scenery, first.scenery, 'The scenery must stay in place during the character animation');
        return next.character.filter((color, index) => Math.abs(color - first.character[index]) > 6).length > 100;
      }, `character pixels move without pointer input in ${host}`);
      assert.equal(await characterScene.count(), 1);
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
    const backgrounds = () => dialog.getByRole('tab', { name: /^(Background|背景)$/ });
    const colors = () => dialog.getByRole('tab', { name: /^(Theme & colors|主题与配色)$/i });
    const toggle = () => dialog.getByRole('checkbox', { name: /^(Background motion|背景微动|Character animation|角色动画)$/ });
    const assertPreset = preset => waitUntil(() => page.evaluate(preset => document.documentElement.dataset.appBackgroundPreset === preset, preset), `selected ${preset} background`);
    await step('glacier-parallax', async () => {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await motion().click();
      await assertPreset('nordic-ice-motion');
      assert.equal(await motion().getAttribute('aria-checked'), 'true');
      assert.equal(await still().getAttribute('aria-checked'), 'false');
      await assertGlacierDrift('.settings-backdrop');
      await closeSettings();
      await scene.waitFor({ state: 'visible' });
      await assertGlacierDrift('body');
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
        await assertCharacterMotion('.settings-backdrop', preset);
        assert.equal(await page.locator('video.character-background-performance').count(), 0);
      }
      await closeSettings();
      await assertCharacterMotion('body', 'character-whale-abyss');
      await screenshot('character-motion.png');
      await reload();
      await assertPreset('character-whale-abyss');
      await assertCharacterMotion('body', 'character-whale-abyss');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await characterScene.waitFor({ state: 'detached' });
      await assertStaticWallpaper('body');
      assert.match(await page.evaluate(() => getComputedStyle(document.body, '::before').backgroundImage), /whale-abyss\.webp/);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      dialog = await openAppearance();
      await backgrounds().click();
      assert.ok(await toggle().isChecked());
      await toggle().uncheck();
      await characterScene.waitFor({ state: 'detached' });
      await assertStaticWallpaper('.settings-backdrop');
      await reload();
      await assertPreset('character-whale-abyss');
      await assertStaticWallpaper('body');
      dialog = await openAppearance();
      await backgrounds().click();
      assert.equal(await toggle().isChecked(), false);
      assert.equal(await characterScene.count(), 0);
      await toggle().check();
      await assertCharacterMotion('.settings-backdrop', 'character-whale-abyss');
    });
    await step('automatic-character-performance', async () => {
      const preset = 'character-whale-tide';
      await colors().click();
      await dialog.locator(`[data-appearance-look="${preset}"]`).click();
      await assertTheme(preset);
      await closeSettings();
      await reload();
      // No pointer input after reload. Check decoded media time as well as
      // visibility so an empty video/poster cannot satisfy this scenario.
      const film = page.locator('video.character-background-performance');
      const started = await waitUntil(() => film.evaluate(video => {
        const style = getComputedStyle(video);
        return document.hasFocus() && video.readyState >= 2 && video.currentTime > 0 && !video.paused &&
          style.opacity === '1' && style.pointerEvents === 'none' && video.currentTime;
      }), 'automatic layered character performance after reload');
      async function fixedGeometry() {
        const result = await film.evaluate(video => {
          const canvas = video.previousElementSibling;
          if (!canvas?.matches('canvas.character-background-motion')) throw new Error('Missing idle canvas beside the actor');
          const bounds = element => {
            const { x, y, width, height } = element.getBoundingClientRect();
            return [x, y, width, height];
          };
          const style = getComputedStyle(video);
          const wallpaper = getComputedStyle(video.parentElement, '::before');
          return {
            actor: bounds(video), idle: bounds(canvas),
            actorFit: style.objectFit, stageFit: style.backgroundSize, portraitFit: wallpaper.backgroundSize,
            actorPosition: style.objectPosition, stagePosition: style.backgroundPosition, portraitPosition: wallpaper.backgroundPosition,
            actorTransform: style.transform, portraitTransform: wallpaper.transform,
          };
        });
        assert.deepEqual(result.actor, result.idle, 'The actor and idle canvas must share a fixed viewport');
        assert.equal(result.actorFit, 'cover');
        assert.equal(result.stageFit, result.actorFit);
        // The idle wallpaper has an image layer and a fallback layer.
        for (const fit of result.portraitFit.split(', ')) assert.equal(fit, result.actorFit);
        assert.equal(result.actorPosition, result.stagePosition);
        for (const position of result.portraitPosition.split(', ')) assert.equal(position, result.stagePosition);
        assert.equal(result.actorTransform, result.portraitTransform);
        return result.actor;
      }
      const initialBounds = await fixedGeometry();
      const original = await film.elementHandle();
      dialog = await openAppearance();
      await waitUntil(() => film.evaluate((video, first) => video === first &&
        video.parentElement.matches('.settings-backdrop'), original), 'same performance moves into settings');
      assert.ok(await film.evaluate(video => video.currentTime) >= started);
      await fixedGeometry();
      await closeSettings();
      await waitUntil(() => film.evaluate((video, first) =>
        video === first && video.parentElement === document.body, original), 'same performance continues in the chat');
      assert.ok(await film.evaluate(video => video.currentTime) >= started);
      const duration = await film.evaluate(video => video.duration);
      assert.ok(Number.isFinite(duration) && duration > 0);
      await page.waitForFunction(video => !video.paused && video.currentTime >= video.duration * 0.45, original);
      assert.deepEqual(await fixedGeometry(), initialBounds, 'Turning and bowing must keep the original framing');
      const midActor = await film.evaluate(video => {
        const canvas = document.createElement('canvas');
        canvas.width = 96;
        canvas.height = 54;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        return Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data.filter((_, i) => i % 4 === 3));
      });
      await page.waitForFunction(video => video.ended && getComputedStyle(video).opacity === '0', original,
        { timeout: Math.ceil(duration * 1000) + 5000 });
      const media = await film.evaluate(video => ({
        width: video.videoWidth, height: video.videoHeight,
        frames: video.getVideoPlaybackQuality().totalVideoFrames,
      }));
      assert.ok(media.width >= 1920 && media.height >= 1080, 'The production performance must decode in full HD');
      assert.ok(media.frames >= Math.floor(duration * 59), 'The full performance must contain 60 fps motion');
      assert.deepEqual(await fixedGeometry(), initialBounds, 'Returning to the idle portrait must keep the original framing');

      // Compare the actual decoded first and last poses over the production
      // stage with the idle illustration, including their placement.
      const bookends = await film.evaluate(async (video, midActor) => {
        const painting = new Image();
        painting.src = '/themes/character-backgrounds/whale-tide.webp';
        const stage = new Image();
        const background = getComputedStyle(video).backgroundImage;
        stage.src = new URL(background.slice(4, -1).replace(/^"|"$/g, ''), location.href).href;
        if (!stage.src.endsWith('/performances/whale-tide-stage.webp')) throw new Error('Missing terrace layer');
        const first = document.createElement('video');
        first.muted = true;
        try {
          const firstFrame = new Promise((resolve, reject) => {
            first.onloadeddata = resolve;
            first.onerror = () => reject(new Error('Could not decode the opening actor frame'));
          });
          first.preload = 'auto';
          first.src = video.currentSrc;
          await Promise.all([painting.decode(), stage.decode(), firstFrame]);
          const portraitHeight = painting.naturalWidth * video.videoHeight / video.videoWidth;
          if (stage.naturalWidth * video.videoHeight !== stage.naturalHeight * video.videoWidth ||
              Math.abs(portraitHeight - painting.naturalHeight) > 1) {
            throw new Error('The terrace, actor and original painting have different aspect ratios');
          }
          const canvas = document.createElement('canvas');
          canvas.width = 384;
          canvas.height = 216;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.imageSmoothingQuality = 'high';
          const pixels = (...layers) => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            for (const layer of layers) ctx.drawImage(layer, 0, 0, canvas.width, canvas.height);
            return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          };
          const expected = pixels(painting);
          const errors = [first, video].map(actor => {
            const alpha = pixels(actor);
            if (alpha[(20 * canvas.width + 25) * 4 + 3] !== 0 || !alpha.some((v, i) => i % 4 === 3 && v > 250)) {
              throw new Error('Expected transparent sky and an opaque character in the decoded actor layer');
            }
            const actual = pixels(stage, actor);
            let error = 0;
            for (let i = 0; i < actual.length; i += 4) {
              for (let c = 0; c < 3; c++) error += Math.abs(actual[i + c] - expected[i + c]);
            }
            return error / (canvas.width * canvas.height * 3);
          });
          canvas.width = 96;
          canvas.height = 54;
          const idleAlpha = pixels(first).filter((_, i) => i % 4 === 3);
          const changed = idleAlpha.filter((v, i) => Math.abs(v - midActor[i]) > 100).length;
          return { errors, changed };
        } finally {
          first.removeAttribute('src');
          first.load();
        }
      }, midActor);
      for (const error of bookends.errors) {
        assert.ok(error < 4, `performance bookend differs from the idle painting by ${error} levels`);
      }
      assert.ok(bookends.changed > 50, 'The character silhouette must move across the fixed stage');
      await assertCharacterMotion('body', preset);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await original.dispose();
      await film.waitFor({ state: 'detached' });
      await characterScene.waitFor({ state: 'detached' });
    });
  },
};

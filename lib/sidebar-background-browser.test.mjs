import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import sharp from 'sharp';

const repo = path.resolve(import.meta.dirname, '..');

test('sidebar transmits wallpaper through the app shell regardless of style placement', { timeout: 60000 }, async () => {
  // Production styles in a layout fixture, not a full desktop UI acceptance.
  const styles = (await Promise.all([
    'app/globals.css', 'app/theme-backgrounds.css', 'app/character-themes.css',
    'components/SessionSidebar.module.css',
  ].map(file => readFile(path.join(repo, file), 'utf8')))).join('\n').replace(/^@import.*$/gm, '');
  const browser = await chromium.launch({ ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const evidence = path.join(repo, '.verification/sidebar-background');
    await mkdir(evidence, { recursive: true });
    const pixel = async () => [...await sharp(await page.screenshot()).extract({ left: 30, top: 400, width: 1, height: 1 }).removeAlpha().raw().toBuffer()];
    const delta = (a, b) => a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0);
    for (const width of [1440, 700]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ['character-whale-tide', 'character-whale-abyss', 'light', 'dark']) {
        for (const adjacentStyle of [false, true]) {
          await page.setContent(`<!doctype html><html data-theme='${theme}' data-app-background-active='true'><head><style>${styles}</style><style>
            *{box-sizing:border-box}*,*::before,*::after{transition:none!important;animation:none!important}html,body{margin:0;height:100%}.app-shell{display:flex;height:100dvh;overflow:hidden}.sidebar-container{display:flex;flex-direction:column;z-index:200}.workspace-main{flex:1}.shell{width:260px}.sectionLabel{padding:16px}
          </style></head><body>${adjacentStyle ? '<style>/* unhoisted scoped style */</style>' : ''}<div class='app-shell' style='background:var(--bg)'><div class='sidebar-container sidebar-open' style='background:var(--bg-panel)'><div class='session-sidebar-content shell'><div class='brandRow'>Piora</div><nav class='primaryNav'><button class='navButton'>新建对话</button></nav><div class='sectionLabel'>项目与会话</div></div></div><main class='workspace-main'></main></div><div class='test-portal' style='position:fixed;right:0;bottom:0;z-index:3000'>Menu</div></body></html>`);
          await page.evaluate(() => {
            const root = document.documentElement;
            root.style.setProperty('--app-background-overlay', '0%');
            root.style.setProperty('--app-background-sidebar-overlay', '0%');
            root.style.setProperty('--app-background-image', 'linear-gradient(rgb(220, 30, 70), rgb(220, 30, 70))');
          });
          const red = await pixel();
          await page.evaluate(() => document.documentElement.style.setProperty('--app-background-image', 'linear-gradient(rgb(20, 80, 220), rgb(20, 80, 220))'));
          const blue = await pixel();
          const label = `${theme}-${width}-${adjacentStyle ? 'inline' : 'hoisted'}`;
          await page.screenshot({ path: path.join(evidence, `${label}.png`) });
          assert.ok(delta(red, blue) > 300, `${label}: wallpaper must change sidebar pixels: ${red} -> ${blue}`);
          assert.ok(delta(blue, [20, 80, 220]) < 6, `${label}: no hidden opaque ancestor with washes disabled`);
          const surfaces = await page.evaluate(() => ['.app-shell', '.session-sidebar-content'].map(selector => ({
            background: getComputedStyle(document.querySelector(selector)).backgroundColor,
            image: getComputedStyle(document.querySelector(selector)).backgroundImage,
          })));
          assert.deepEqual(surfaces, Array(2).fill({ background: 'rgba(0, 0, 0, 0)', image: 'none' }));
          await page.evaluate(() => document.documentElement.style.setProperty('--app-background-sidebar-overlay', '36%'));
          const defaultWash = await pixel();
          await page.evaluate(() => document.documentElement.style.setProperty('--app-background-sidebar-overlay', '80%'));
          assert.ok(delta(defaultWash, await pixel()) > 30, `${label}: overlay changes visible pixels`);
          assert.equal(await page.locator('.test-portal').evaluate(el => getComputedStyle(el).position), 'fixed');
          await page.evaluate(() => delete document.documentElement.dataset.appBackgroundActive);
          const opaque = await pixel();
          await page.evaluate(() => document.documentElement.style.setProperty('--app-background-image', 'linear-gradient(red, red)'));
          assert.deepEqual(await pixel(), opaque, `${label}: disabling wallpaper restores the opaque sidebar`);
        }
      }
    }
    await writeFile(path.join(evidence, 'scope.txt'), 'Passed CSS/layout fixture: light/dark character and ordinary themes; desktop/mobile; hoisted/adjacent styles; wallpaper pixel changes; overlay controls; wallpaper disabled. Not a full desktop acceptance.\n');
  } finally {
    await browser.close();
  }
});

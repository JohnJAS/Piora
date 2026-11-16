import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack.js');
const repo = path.resolve(import.meta.dirname, '..');

test('subagent settings preserve profile and limit changes with readable responsive controls in both languages', { timeout: 180000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'piora-subagent-settings-'));
  const artifacts = path.join(repo, '.verification/subagent-settings-ui');
  let browser;
  try {
    await mkdir(artifacts, { recursive: true });
    await writeFile(path.join(directory, 'ts.cjs'), `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText`);
    await writeFile(path.join(directory, 'css.cjs'), `module.exports=function(s){const prefix=require('node:path').basename(this.resourcePath,'.module.css')+'_';const names=Object.fromEntries([...s.matchAll(/\\.([a-zA-Z][\\w-]*)/g)].map(m=>[m[1],prefix+m[1]]));const css=s.replace(/\\.([a-zA-Z][\\w-]*)/g,(_,n)=>'.'+names[n]);return 'const style=document.createElement("style");style.textContent='+JSON.stringify(css)+';document.head.appendChild(style);export default '+JSON.stringify(names)}`);
    await writeFile(path.join(directory, 'entry.tsx'), `import React from 'react';import{createRoot}from'react-dom/client';import{I18nProvider}from'@/hooks/useI18n';import{LaboratorySettings}from'@/components/LaboratorySettings';createRoot(document.getElementById('root')).render(<I18nProvider><main style={{maxWidth:1600,margin:'0 auto',padding:24}}><LaboratorySettings/></main></I18nProvider>);`);
    const compiler = webpack({ mode: 'development', target: 'web', devtool: false, entry: path.join(directory, 'entry.tsx'), output: { path: directory, filename: 'bundle.js', publicPath: '/' },
      resolve: { extensions: ['.tsx', '.ts', '.js'], modules: [path.join(repo, 'node_modules')], alias: { '@': repo } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(directory, 'ts.cjs') }, { test: /\.css$/, use: path.join(directory, 'css.cjs') }] } });
    await new Promise((resolve, reject) => compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors() ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve())));
    const preflight = await readFile(path.join(repo, 'node_modules/tailwindcss/preflight.css'), 'utf8');
    const globalCss = (await readFile(path.join(repo, 'app/globals.css'), 'utf8')).replace(/^@import.*$/gm, '');
    const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${preflight}\n${globalCss}body{margin:0;background:var(--bg);color:var(--text)}main{box-sizing:border-box}</style><div id="root"></div><script src="/bundle.js"></script>`;
    browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chromium', headless: true });
    const observations = [];
    for (const locale of ['zh-CN', 'en']) {
      let settings = { enabled: false, maxConcurrency: 4, timeoutSeconds: 300, maxTokens: 200000, maxResultChars: 8000, disabledProfiles: [], modelOverrides: {} };
      const profiles = [{ name: 'general-purpose', source: 'built-in', description: 'Independent work' }, { name: 'Explore', source: 'built-in', description: 'Read-only exploration' }];
      const page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: locale === 'en' ? 'en-US' : locale });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(value => localStorage.setItem('pi-locale', value), locale);
      await page.route('http://subagent-settings.test/**', async route => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname === '/api/settings/subagents') {
          if (route.request().method() === 'PUT') settings = route.request().postDataJSON();
          return route.fulfill({ json: { settings, profiles } });
        }
        if (pathname === '/api/settings/laboratory') return route.fulfill({ json: { planGoalEnabled: false } });
        if (pathname.endsWith('.js')) return route.fulfill({ contentType: 'text/javascript', body: await readFile(path.join(directory, path.basename(pathname))) });
        if (pathname.startsWith('/fonts/')) return route.fulfill({ contentType: 'font/woff2', body: await readFile(path.join(repo, 'public', pathname.slice(1))) });
        if (pathname.startsWith('/api/')) throw new Error('Unexpected API request: ' + pathname);
        return route.fulfill({ contentType: 'text/html', body: html });
      });
      await page.goto('http://subagent-settings.test/');
      await page.waitForFunction(value => document.documentElement.lang === value, locale);
      const card = page.locator('[data-settings-id="laboratory.subagents"]');
      const toggle = card.getByRole('switch');
      await page.waitForFunction(() => !document.querySelector('[data-testid="subagent-toggle"]')?.disabled);
      assert.equal(await toggle.isChecked(), false);
      assert.equal(await card.locator('details').getAttribute('open'), null);
      assert.equal(await card.getByRole('spinbutton').isVisible(), false);
      const save = action => Promise.all([page.waitForResponse(response => response.url().includes('/api/settings/subagents') && response.request().method() === 'PUT'), action()]);
      await save(() => toggle.click());
      await page.waitForFunction(() => document.querySelector('[data-testid="subagent-toggle"]')?.getAttribute('aria-checked') === 'true');
      await card.locator('summary').click();
      assert.equal(await card.getByRole('checkbox').count(), 2);
      const values = [['maxConcurrency', /concurrency|并发/i, 3], ['timeoutSeconds', /timeout|超时/i, 45], ['maxTokens', /token.*budget|token 预算/i, 100000], ['maxResultChars', /result characters|最大字符/i, 4096]];
      for (const [key, label, value] of values) {
        const input = card.getByRole('spinbutton', { name: label });
        await input.fill(String(value)); await save(() => input.press('Tab'));
        assert.equal(settings[key], value);
      }
      const explore = card.getByRole('checkbox', { name: /Explore/ });
      await save(() => explore.click()); assert.deepEqual(settings.disabledProfiles, ['Explore']);
      const model = card.getByRole('textbox', { name: /Explore/ });
      await model.fill('fixture/reader'); await save(() => model.press('Tab'));
      assert.equal(settings.modelOverrides.Explore, 'fixture/reader');
      await page.reload();
      await page.waitForFunction(() => !document.querySelector('[data-testid="subagent-toggle"]')?.disabled);
      await card.locator('summary').click();
      assert.equal(await explore.isChecked(), false);
      assert.equal(await model.inputValue(), 'fixture/reader');
      for (const [, label, value] of values) assert.equal(await card.getByRole('spinbutton', { name: label }).inputValue(), String(value));
      // Restore through the same UI so the previews show the ordinary defaults.
      await save(() => explore.click());
      await model.fill(''); await save(() => model.press('Tab'));
      for (const [key, label] of values) {
        const value = { maxConcurrency: 4, timeoutSeconds: 300, maxTokens: 200000, maxResultChars: 8000 }[key];
        const input = card.getByRole('spinbutton', { name: label });
        await input.fill(String(value)); await save(() => input.press('Tab'));
      }
      for (const width of [1680, 1100, 760, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        const geometry = await card.evaluate(element => {
          const bounds = element.getBoundingClientRect();
          const inputs = [...element.querySelectorAll('input')].map(input => { const r = input.getBoundingClientRect(); return { type: input.type, x: r.x, right: r.right, width: r.width }; });
          return { left: bounds.left, right: bounds.right, pageWidth: document.documentElement.scrollWidth, viewport: innerWidth, inputs };
        });
        assert.ok(geometry.pageWidth <= geometry.viewport + 1, `Horizontal overflow at ${locale}/${width}`);
        assert.ok(geometry.inputs.every(input => input.x >= geometry.left + 8 && input.right <= geometry.right - 8), 'Controls stay inside the card');
        assert.ok(geometry.inputs.filter(input => input.type === 'number').every(input => input.width <= 180), 'Numeric controls remain compact');
        assert.ok(geometry.inputs.filter(input => input.type === 'text').every(input => input.width >= 160), 'Model controls remain readable');
        observations.push({ locale, width, ...geometry });
        await page.screenshot({ path: path.join(artifacts, `${locale}-${width}.png`), fullPage: true, animations: 'disabled' });
      }
      await page.setViewportSize({ width: 1680, height: 1000 });
      await page.evaluate(() => { document.documentElement.classList.add('dark'); document.documentElement.dataset.theme = 'dark'; });
      await page.screenshot({ path: path.join(artifacts, `${locale}-dark.png`), fullPage: true, animations: 'disabled' });
      await card.locator('summary').focus(); await page.keyboard.press('Space');
      assert.equal(await card.locator('details').getAttribute('open'), null);
      await page.keyboard.press('Enter'); assert.notEqual(await card.locator('details').getAttribute('open'), null);
      assert.deepEqual(errors, []);
      await page.close();
    }
    await writeFile(path.join(artifacts, 'result.json'), JSON.stringify({ status: 'passed', scope: 'Headless component fixture with production React components and CSS; API responses are mocked, no desktop control', observations }, null, 2));
  } finally {
    await browser?.close();
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('piora-subagent-settings-'));
    await rm(directory, { recursive: true, force: true });
  }
});

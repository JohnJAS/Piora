import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";
const require = createRequire(import.meta.url);
const { webpack } = require("next/dist/compiled/webpack/webpack.js");
const repo = path.resolve(import.meta.dirname, "..");

test("embedded settings pages reveal wallpaper without making standalone dialogs transparent", { timeout: 120000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "piora-appearance-ui-"));
  let browser;
  try {
    await writeFile(path.join(root, "ts.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText`);
    await writeFile(path.join(root, "css.cjs"), `const path=require('node:path');module.exports=function(s){const prefix=path.basename(this.resourcePath).replace(/\\W/g,'')+'_';const names={};const css=s.replace(/:global\\(([^)]+)\\)|\\.([a-zA-Z][\\w-]*)/g,(m,g,n)=>g||'.'+(names[n]=prefix+n));return 'const el=document.createElement("style");el.textContent='+JSON.stringify(css)+';document.head.append(el);export default '+JSON.stringify(names)}`);
    await writeFile(path.join(root, "markdown.tsx"), `export const LazyMarkdownBody=({children})=><div>{children}</div>;`);
    await writeFile(path.join(root, "entry.tsx"), `import React from 'react';import{createRoot}from'react-dom/client';import{I18nProvider}from'@/hooks/useI18n';import{AutomationPanel}from'@/components/AutomationPanel';import{PluginsConfig}from'@/components/PluginsConfig';import{SkillsConfig}from'@/components/SkillsConfig';import{CompanionSettingsDialog}from'@/components/CompanionSettingsDialog';import{createDefaultCompanionPreferences}from'@/lib/companion-store';function App(){const[view,setView]=React.useState('automations');const[embedded,setEmbedded]=React.useState(true);window.setView=setView;window.setEmbedded=setEmbedded;const noop=()=>{};return <I18nProvider><div key={view+embedded} className={embedded?'settings-backdrop':''}><div className={embedded?'settings-dialog settings-embedded-section':''} data-page={view}>{view==='automations'?<AutomationPanel embedded={embedded}/>:view==='plugins'?<PluginsConfig embedded={embedded} cwd='/fixture' onClose={noop}/>:view==='skills'?<SkillsConfig embedded={embedded} cwd='/fixture' onClose={noop}/>:<CompanionSettingsDialog embedded={embedded} open onClose={noop} preferences={createDefaultCompanionPreferences()} setPreferences={noop} selectedPetId='' catalog={null} loading={false} onRefresh={noop} onSelectPet={noop}/>}</div></div></I18nProvider>}createRoot(document.getElementById('root')).render(<App/>);`);
    const compiler = webpack({ mode: "development", target: "web", devtool: false, entry: path.join(root, "entry.tsx"), output: { path: root, filename: "bundle.js", publicPath: "http://appearance-ui.test/" }, resolve: { extensions: [".tsx", ".ts", ".js"], modules: [path.join(repo, "node_modules"), "node_modules"], alias: { "@": repo } }, plugins: [new webpack.DefinePlugin({ "process.env": JSON.stringify({ NODE_ENV: "development" }) }), new webpack.NormalModuleReplacementPlugin(/^\.\/LazyMarkdownBody$/, path.join(root, "markdown.tsx"))], module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(root, "ts.cjs") }, { test: /\.css$/, use: path.join(root, "css.cjs") }] } });
    await new Promise((resolve, reject) => compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors() ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve())));
    browser = await chromium.launch({ ...(process.platform === "win32" ? { channel: "msedge" } : {}), headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, locale: "zh-CN", reducedMotion: "reduce" });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    const globals = (await readFile(path.join(repo, "app/globals.css"), "utf8")).replace(/^@import.*$/gm, "") + await readFile(path.join(repo, "app/theme-backgrounds.css"), "utf8");
    await page.route("http://appearance-ui.test/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith(".js")) await route.fulfill({ contentType: "text/javascript", body: await readFile(path.join(root, path.basename(url.pathname))) });
      else if (url.pathname.startsWith("/api/")) await route.fulfill({ json: { models: {}, modelList: [], defaultModel: null, thinkingLevels: {}, thinkingLevelMaps: {}, thinkingLevelPins: {}, automations: [], plugins: [], packages: [], sources: [], skills: [], servers: [], results: [], settings: {}, diagnostics: [], totals: { extensions: 0, skills: 0, prompts: 0, themes: 0 } } });
      else if (url.pathname === "/") await route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>${globals}*{box-sizing:border-box}html,body,#root,.settings-backdrop,.settings-dialog{height:100%;margin:0}.settings-backdrop{position:fixed;inset:0;z-index:3000}body{font-family:system-ui}</style><div id="root"></div><script src="/bundle.js"></script></html>` });
      else { try { await route.fulfill({ body: await readFile(path.join(repo, "public", url.pathname.slice(1))) }); } catch { await route.fulfill({ status: 404 }); } }
    });
    await page.goto("http://appearance-ui.test/");
    await page.waitForFunction(() => typeof window.setView === "function", null, { timeout: 10000 }).catch(error => { throw new Error(errors.join("; ") || error.message); });
    await page.evaluate(() => { document.documentElement.style.setProperty('--app-background-image', 'linear-gradient(#ff00ff,#ff00ff)'); document.documentElement.style.setProperty('--app-background-overlay', '0%'); });
    const selectors = { automations: '[class*="AutomationPanelmodulecss_root"]', plugins: '[role="region"]', skills: '[class*="Skillsmodulecss_shell"]', companion: '[class*="CompanionSettingsDialogmodulecss_dialog"]' };
    for (const [view, selector] of Object.entries(selectors)) {
      await page.evaluate(value => window.setView(value), view);
      const surface = page.locator(selector).first();
      await surface.waitFor({ timeout: 10000 }).catch(error => { throw new Error(view + ": " + (errors.join("; ") || error.message)); });
      await page.evaluate(async () => { delete document.documentElement.dataset.appBackgroundActive; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      await page.waitForFunction(selector => getComputedStyle(document.querySelector(selector)).backgroundColor !== "rgba(0, 0, 0, 0)", selector, { timeout: 5000 });
      const opaque = await surface.evaluate(el => getComputedStyle(el).backgroundColor);
      assert.notEqual(opaque, 'rgba(0, 0, 0, 0)', view + ' keeps its original solid surface without wallpaper: ' + JSON.stringify(await surface.evaluate(el => ({className: el.className, background: getComputedStyle(el).background, page: getComputedStyle(el).getPropertyValue("--settings-page-background"), active: document.documentElement.dataset.appBackgroundActive}))));
      await page.evaluate(async () => { document.documentElement.dataset.appBackgroundActive = 'true'; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      await page.waitForFunction(selector => getComputedStyle(document.querySelector(selector)).backgroundColor === "rgba(0, 0, 0, 0)", selector, { timeout: 5000 });
      const layers = await surface.evaluate(el => {
        const colors = [];
        while (el && !el.classList.contains('settings-backdrop')) { colors.push(getComputedStyle(el).backgroundColor); el = el.parentElement; }
        return colors;
      });
      assert.ok(layers.every(color => color === 'rgba(0, 0, 0, 0)'), view + ' has no opaque layer over wallpaper: ' + layers + JSON.stringify(await surface.evaluate(el => ({className: el.className, page: getComputedStyle(el).getPropertyValue('--settings-page-background'), active: document.documentElement.dataset.appBackgroundActive, parents: el.parentElement.parentElement.outerHTML.slice(0,500)}))));
      await page.evaluate(() => { window.setEmbedded(false); });
      await page.waitForFunction(() => !document.querySelector('.settings-embedded-section'));
      const standalone = page.locator(view === 'plugins' ? '[role="dialog"]' : selector).first();
      await standalone.waitFor();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.ok(await standalone.evaluate(el => { const style = getComputedStyle(el); return style.backgroundColor !== 'rgba(0, 0, 0, 0)' || style.backgroundImage !== 'none'; }), view + ' standalone surface retains its own painted background');
      await page.evaluate(() => { window.setEmbedded(true); });
      await page.locator('.settings-embedded-section').waitFor();
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await rm(root, { recursive: true, force: true });
  }
});

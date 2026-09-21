import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const { webpack } = require("next/dist/compiled/webpack/webpack.js");
const repo = path.resolve(import.meta.dirname, "..");

test("compaction notices preserve elapsed time, support dismissal and fit light, dark and narrow layouts", { timeout: 120_000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "piora-compaction-clock-"));
  let browser;
  try {
    await writeFile(path.join(root, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText`);
    await writeFile(path.join(root, "entry.tsx"), `
      import React from "react";
      import {createRoot} from "react-dom/client";
      import {CompactionProgress,CompactionResult} from ${JSON.stringify(path.join(repo, "components/CompactionProgress.tsx"))};
      import {I18nProvider} from ${JSON.stringify(path.join(repo, "hooks/useI18n.tsx"))};
      Date.now=()=>window.clockNow;
      function App() {
        const [active,setActive]=React.useState({id:"a",startedAt:window.serverStartedAt});
        window.showCompaction=setActive;
        return <I18nProvider><main className="specimen">{active && (active.result
          ? <CompactionResult result={active.result} onDismiss={()=>{window.dismisses++;setActive(null)}}/>
          : <CompactionProgress key={active.id} startedAt={active.startedAt} onStop={()=>window.stops++}/>)}</main></I18nProvider>;
      }
      createRoot(document.getElementById("root")).render(<App/>);
    `);
    const compiler = webpack({
      mode: "development", devtool: false, entry: path.join(root, "entry.tsx"),
      output: { path: root, filename: "bundle.js", publicPath: "/" },
      resolve: { extensions: [".tsx", ".ts", ".js"], modules: [path.join(repo, "node_modules"), "node_modules"], alias: { "@": repo } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(root, "loader.cjs") }] },
    });
    await new Promise((resolve, reject) => compiler.run((error, stats) => compiler.close(() => {
      if (error || stats.hasErrors()) reject(error || new Error(stats.toString({ all: false, errors: true })));
      else resolve();
    })));
    const bundle = await readFile(path.join(root, "bundle.js"), "utf8");
    const globals = await readFile(path.join(repo, "app/globals.css"), "utf8");
    const styles = [
      globals.match(/^:root \{[\s\S]*?^\}/m)[0],
      globals.match(/^html.dark \{[\s\S]*?^\}/m)[0],
      globals.slice(globals.indexOf(".compaction-notice {"), globals.indexOf(".model-settings-compaction {")),
      "*{box-sizing:border-box}html{font-size:14px}body{margin:0;background:var(--bg-panel);font-family:var(--ui-font-family)}.specimen{width:100%;max-width:640px;margin:auto;padding:32px 24px}",
    ].join("\n");
    const screenshots = process.env.PIORA_COMPACTION_SCREENSHOTS;
    if (screenshots) await mkdir(screenshots, { recursive: true });
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const page = await browser.newPage({ viewport: { width: 680, height: 360 }, deviceScaleFactor: 2 });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    let now = 118_000;
    const startedAt = 100_000;
    await page.route("http://compaction.test/**", route => route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><style>${styles}</style><div id="root"></div><script>localStorage.setItem("pi-locale","zh-CN");window.clockNow=${now};window.serverStartedAt=${startedAt};window.stops=0;window.dismisses=0;</script>`,
    }));
    const elapsed = seconds => page.waitForFunction(value => {
      const timer = document.querySelector(".compaction-progress-elapsed");
      const expected = [Math.floor(value / 60),value % 60].map(part=>String(part).padStart(2,"0")).join(":");
      return timer?.textContent === expected && timer?.getAttribute("aria-label") === `已等待 ${value} 秒`;
    }, seconds);
    await page.goto("http://compaction.test");
    await page.addScriptTag({ content: bundle });
    await elapsed(18);
    const capture = async name => {
      if (screenshots) await page.locator(".specimen").screenshot({ path: path.join(screenshots, `${name}.png`) });
    };
    await capture("compaction-progress-light");
    assert.equal(await page.getByRole("progressbar").getAttribute("aria-valuenow"), null, "unknown progress must not invent a percentage");
    // Mount another session's component; its independent run started later.
    await page.evaluate(() => { window.clockNow=130_000; window.showCompaction({id:"b",startedAt:128_000}); });
    await elapsed(2);
    await page.evaluate(() => { window.clockNow=135_000; window.showCompaction({id:"a",startedAt:100_000}); });
    await elapsed(35);
    // Full page reload obtains the same server origin, not the new mount time.
    now = 160_000;
    await page.reload();
    await page.addScriptTag({ content: bundle });
    await elapsed(60);
    await page.evaluate(() => { window.clockNow=167_000; });
    await elapsed(67);
    await page.getByRole("button", { name: "停止压缩" }).click();
    assert.equal(await page.evaluate(() => window.stops), 1);
    // The next run can reuse the same view but must use its own server origin.
    await page.evaluate(() => window.showCompaction({id:"a",startedAt:167_000}));
    await elapsed(0);
    await page.evaluate(() => { window.clockNow=170_000; });
    await elapsed(3);
    await page.evaluate(() => window.showCompaction({id:"a",startedAt:null}));
    await page.waitForFunction(() => !document.querySelector(".compaction-progress-elapsed"));
    assert.equal(await page.getByRole("status").count(), 1, "unknown origin shows status without a fabricated timer");
    await page.evaluate(() => window.showCompaction(null));
    await page.waitForFunction(() => !document.querySelector(".compaction-progress"));

    const showResult = () => page.evaluate(() => window.showCompaction({id:"a",result:{reason:"manual",tokensBefore:48200,estimatedTokensAfter:12600}}));
    await showResult();
    await page.getByRole("status").filter({hasText:"上下文已压缩"}).waitFor();
    assert.equal(await page.locator(".compaction-result-before").textContent(), "48.2k");
    assert.equal(await page.locator(".compaction-result-after").textContent(), "12.6k");
    assert.equal(await page.locator(".compaction-result .compaction-notice-description").textContent(), "压缩后估算 · 节省约 35.6k tokens");
    await capture("compaction-result-light");
    const fits = async () => {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      const card = await page.locator(".compaction-notice").boundingBox();
      const button = await page.locator(".compaction-notice button").boundingBox();
      assert.ok(button.x >= card.x && button.x + button.width <= card.x + card.width && button.y + button.height <= card.y + card.height, "action remains inside the card");
    };
    for (const dark of [false, true]) {
      await page.evaluate(value => document.documentElement.classList.toggle("dark", value), dark);
      await showResult();
      const background = await page.locator(".compaction-notice").evaluate(element=>getComputedStyle(element).backgroundColor);
      assert.equal(background, dark ? "rgb(17, 17, 19)" : "rgb(255, 255, 255)");
      if (dark) await capture("compaction-result-dark");
      for (const width of [680,320,280]) {
        await page.setViewportSize({width,height:500});
        await fits();
      }
      await page.getByRole("button", {name:"关闭压缩结果"}).focus();
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => !document.querySelector(".compaction-notice"));
      await page.evaluate(() => window.showCompaction({id:"a",startedAt:100_000}));
      await page.locator(".compaction-progress").waitFor();
      for (const width of [280,320,680]) {
        await page.setViewportSize({width,height:500});
        await fits();
      }
      if (dark) await capture("compaction-progress-dark");
    }
    assert.equal(await page.evaluate(() => window.dismisses), 2);
    await page.emulateMedia({reducedMotion:"reduce"});
    for (const selector of [".compaction-progress-spinner", ".compaction-progress-track > span"]) {
      assert.equal(await page.locator(selector).evaluate(element=>getComputedStyle(element).animationName), "none");
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await rm(root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";
const require = createRequire(import.meta.url);
const { webpack } = require("next/dist/compiled/webpack/webpack.js");
const repo = path.resolve(import.meta.dirname, "..");

for (const locale of ["zh-CN", "en-US"]) {
test(`workflow UI preserves revisions, switches sessions, reviews plans and changes budgets without resuming (${locale})`, { timeout: 180000 }, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "piora-workflow-ui-"));
  let browser;
  let page;
  const transport = [], browserMessages = [];
  const held = [];
  const laboratorySaveRecovery = Promise.withResolvers();
  const laboratoryEnableResponse = Promise.withResolvers();
  try {
    await writeFile(path.join(directory, "ts.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText`);
    await writeFile(path.join(directory, "css.cjs"), `module.exports=function(s){
      const prefix=require('node:path').basename(this.resourcePath).replace(/\\W/g,'_')+'_';
      const names=Object.fromEntries([...s.matchAll(/\\.([a-zA-Z][\\w-]*)/g)].map(m=>[m[1],prefix+m[1]]));
      const css=s.replace(/\\.([a-zA-Z][\\w-]*)/g,(_,name)=>'.'+names[name]);
      const inject=this.resourcePath.includes('Workflow')?'const style=document.createElement("style");style.textContent='+JSON.stringify(css)+';document.head.appendChild(style);':'';
      return inject+'export default '+JSON.stringify(names);
    }`);
    await writeFile(path.join(directory, "markdown.tsx"), 'import React from "react";export const MarkdownBody=({children})=><div>{children}</div>;');
    await writeFile(path.join(directory, "entry.tsx"), `
import React from 'react';import{createRoot}from'react-dom/client';
import{I18nProvider}from'@/hooks/useI18n';import{useWorkflow}from'@/hooks/useWorkflow';
import{WorkflowPanel}from'@/components/WorkflowPanel';import{WorkflowModePicker}from'@/components/WorkflowModePicker';
import{LaboratorySettings}from'@/components/LaboratorySettings';import{useLaboratorySettings}from'@/hooks/useLaboratorySettings';
import{AppTooltip}from'@/components/AppTooltip';
function App(){const[sid,setSid]=React.useState('one'),[choice,setChoice]=React.useState({mode:'agent',turnBudget:10}),[modeDisabled,setModeDisabled]=React.useState(false);
const lab=useLaboratorySettings();window.lab=lab;
React.useEffect(()=>{(window.laboratoryTrace??=[]).push({ready:lab.ready,error:lab.error,saving:lab.saving})},[lab.ready,lab.error,lab.saving]);
const execute=React.useCallback(async action=>{const res=await fetch('/api/agent/'+sid+'/workflow',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(action)});const data=await res.json();if(!res.ok)throw new Error(data.error);return data.snapshot},[sid]);
const state=useWorkflow(sid,true,false,execute);window.state=state;
return <><AppTooltip/><div style={{maxHeight:180,overflow:'auto'}}><LaboratorySettings/></div><output id="lab-state">{String(lab.planGoalEnabled)}</output><button id="switch" onClick={()=>setSid(sid==='one'?'two':'one')}>Switch chat</button><button id="refresh" onClick={()=>state.refresh()}>Refresh</button>
<div id="mode-fixture" style={{marginTop:120}}>{lab.planGoalEnabled&&<WorkflowModePicker value={choice} onChange={setChoice} disabled={modeDisabled}/>}</div><output id="choice">{JSON.stringify(choice)}</output>
<label><input id="disable-mode-picker" type="checkbox" checked={modeDisabled} onChange={event=>setModeDisabled(event.target.checked)}/>Disable mode picker</label>
<div id="workflow-area" style={{position:'fixed',bottom:60,left:16,right:16}}><WorkflowPanel snapshot={state.snapshot} busy={state.busy} running={false} enabled={lab.planGoalEnabled} error={state.error} onAction={state.act} onRefresh={state.refresh} onRequestRevision={()=>document.getElementById('composer')?.focus()}/><textarea aria-label="Message" id="composer" style={{width:'100%',height:40,boxSizing:'border-box'}}/></div></>}
createRoot(document.getElementById('root')).render(<I18nProvider><App/></I18nProvider>);`);
    const compiler = webpack({ mode: "development", target: "web", devtool: false, entry: path.join(directory, "entry.tsx"), output: { path: directory, filename: "bundle.js", publicPath: "/" },
      resolve: { extensions: [".tsx", ".ts", ".js"], modules: [path.join(repo, "node_modules")], alias: { "@": repo } },
      plugins: [new webpack.NormalModuleReplacementPlugin(/^\.\/MarkdownBody$/, path.join(directory, "markdown.tsx"))],
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(directory, "ts.cjs") }, { test: /\.css$/, use: path.join(directory, "css.cjs") }] } });
    await new Promise((resolve, reject) => compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors() ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve())));
    // Use the production tooltip rules, including shared floating-surface rules,
    // without bringing unrelated full-app layout into this focused fixture.
    const tooltipRules = [], composerThemeRules = [];
    const composerTokens = new Set(["--composer-background", "--composer-border", "--composer-filter", "--shadow-composer", "--interface-transparency", "--glass-edge-light", "--radius-panel", "--bg", "--bg-panel", "--text", "--text-muted", "--text-dim", "--border"]);
    require("postcss").parse(await readFile(path.join(repo, "app/globals.css"), "utf8")).walkRules(rule => {
      if (rule.parent.type === "root" && [":root", "html.dark"].includes(rule.selector)) {
        const declarations = rule.nodes.filter(node => node.type === "decl" && composerTokens.has(node.prop));
        if (declarations.length) composerThemeRules.push(rule.clone({ nodes: declarations.map(node => node.clone()) }).toString());
      }
      const selectors = rule.selectors.filter(selector => selector.includes(".app-tooltip"));
      if (!selectors.length) return;
      let copy = rule.clone({ selector: selectors.join(", ") });
      for (let parent = rule.parent; parent?.type === "atrule"; parent = parent.parent) {
        copy = parent.clone({ nodes: [] }).append(copy);
      }
      tooltipRules.push(copy.toString());
    });
    assert.ok(tooltipRules.length > 0, "the fixture loads real tooltip styling");
    const tooltipCss = tooltipRules.join("\n");
    assert.ok(composerThemeRules.some(rule => rule.includes("--composer-background:")), "the fixture loads the real composer transparency formula");
    const composerThemeCss = composerThemeRules.join("\n");
    browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : "chromium", headless: true });
    page = await browser.newPage({ locale, hasTouch: true, viewport: { width: 390, height: 800 } });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    page.on("console", message => { if (message.type() === "warning" || message.type() === "error") browserMessages.push({ type: message.type(), text: message.text() }); });
    page.on("request", request => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.endsWith(".js") || pathname === "/api/settings/laboratory") transport.push({ event: "request", path: pathname, method: request.method(), retry: request.headers()["x-piora-fixture-retry"] ?? null });
    });
    page.on("response", response => {
      const pathname = new URL(response.url()).pathname;
      if (pathname.endsWith(".js") || pathname === "/api/settings/laboratory") transport.push({ event: "response", path: pathname, status: response.status(), retry: response.request().headers()["x-piora-fixture-retry"] ?? null });
    });
    const clockStart = new Date("2026-11-11T00:00:00Z");
    await page.clock.install({ time: clockStart });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    const run = { id: "plan-one", kind: "plan", status: "awaiting_approval", objective: "Review before editing", title: "Plan proposal", markdown: "# Implementation\n1. Inspect\n2. Verify", criteria: [], progress: "", reason: "", turnBudget: 10, turnsUsed: 1, version: 1, createdAt: 1, updatedAt: 1, noProgressTurns: 0 };
    const states = {
      one: { sessionId: "one", revision: 1, mode: "plan", turnBudget: 10, current: run, history: [] },
      two: { sessionId: "two", revision: 1, mode: "goal", turnBudget: 2, current: { ...run, id: "goal-two", kind: "goal", title: "Goal objective", objective: "Complete the checks", status: "budget_exhausted", markdown: "", turnBudget: 2, turnsUsed: 2, criteria: [{ id: "test", text: "Check passes", evidence: "node test: 1 passed", status: "verified" }] }, history: [] },
    };
    const actions = [];
    let holdNext = false;
    let holdNextAction = false;
    let failNextAction = false;
    let reconcileFailedAction = false;
    let failNextWorkflowRead = false;
    let laboratory = { planGoalEnabled: false };
    let holdLaboratoryRead = false;
    let failLaboratoryRead = true;
    let failLaboratoryWrite = true;
    let holdLaboratoryWrite = false;
    let laboratoryWriteFailed = false;
    let laboratoryReadCount = 0;
    let laboratoryRetryReadCount = 0;
    await page.route("http://127.0.0.1:38201/**", async route => {
      const url = new URL(route.request().url());
      // Locale imports are separate webpack chunks. Replaying the entry bundle
      // for them remounts React and resets the shared laboratory state.
      if (url.pathname.endsWith(".js")) return route.fulfill({ contentType: "text/javascript", body: await readFile(path.join(directory, path.basename(url.pathname))) });
      if (!url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: '<!doctype html><meta charset="utf-8"><style>:root{--bg:#fff;--bg-panel:#fafafa;--bg-hover:#f1f1f1;--bg-selected:#eee;--border:#dedede;--border-soft:#dedede;--surface-raised:#fff;--floating-background:#fff;--floating-border:#dedede;--floating-filter:none;--floating-shadow:0 5px 18px #0002;--radius-control:8px;--ui-font-family:Arial,sans-serif;--text:#262626;--text-muted:#666;--text-dim:#a3a3a3;--accent:#2563eb;--text-xs:12px;--text-sm:14px}body{font-family:Arial,sans-serif;color:var(--text);line-height:1.5}' + tooltipCss + composerThemeCss + '</style><div id="root"></div><script src="/bundle.js"></script>' });
      if (url.pathname === "/api/models") return route.fulfill({ json: { models: {}, modelList: [] } });
      if (url.pathname === "/api/settings/subagents") return route.fulfill({ json: {
        settings: { enabled: false, maxConcurrency: 4, timeoutSeconds: 300, maxTokens: 200000, maxResultChars: 8000, disabledProfiles: [], modelOverrides: {} }, profiles: [],
      } });
      if (url.pathname === "/api/settings/laboratory") {
        if (route.request().method() === "PUT") {
          if (failLaboratoryWrite) { failLaboratoryWrite = false; laboratoryWriteFailed = true; return route.fulfill({ status: 500, json: { error: "fixture save failed" } }); }
          if (holdLaboratoryWrite) { holdLaboratoryWrite = false; await laboratoryEnableResponse.promise; }
          laboratoryWriteFailed = false; laboratorySaveRecovery.resolve();
          laboratory = route.request().postDataJSON(); return route.fulfill({ json: laboratory });
        }
        laboratoryReadCount++;
        if (route.request().headers()["x-piora-fixture-retry"] === "true") {
          laboratoryRetryReadCount++;
          failLaboratoryRead = false;
        }
        if (failLaboratoryRead) return route.fulfill({ status: 503, json: { error: `fixture read failed ${laboratoryReadCount}` } });
        if (laboratoryWriteFailed) await laboratorySaveRecovery.promise;
        const captured = { ...laboratory };
        if (holdLaboratoryRead) { holdLaboratoryRead = false; await new Promise(resolve => held.push(resolve)); }
        return route.fulfill({ json: captured }).catch(() => {});
      }
      const sid = url.pathname.split("/")[3];
      if (!states[sid]) return route.fulfill({ status: 404, json: {} });
      if (route.request().method() === "POST") {
        const action = route.request().postDataJSON(); actions.push(action);
        assert.equal(action.runId, states[sid].current.id);
        assert.equal(action.expectedRevision, states[sid].revision);
        if (holdNextAction) { holdNextAction = false; await new Promise(resolve => held.push(resolve)); }
        if (failNextAction) { failNextAction = false; reconcileFailedAction = true; return route.fulfill({ status: 500, json: { error: "fixture action failed" } }); }
        const state = states[sid];
        state.revision++;
        if (action.action === "revise") { state.history.push({ ...state.current }); state.current = { ...state.current, status: "planning", version: 2 }; }
        if (action.action === "approve") { state.mode = "agent"; state.current.status = "running"; }
        if (action.action === "exit") { state.mode = "agent"; state.current.status = "cancelled"; }
        if (action.action === "set_budget") { state.turnBudget = action.turnBudget; state.current.turnBudget = action.turnBudget; }
        if (action.action === "resume") state.current.status = "running";
        if (action.action === "pause") state.current.status = "paused";
        if (action.action === "cancel") state.current.status = "cancelled";
        return route.fulfill({ json: { snapshot: state } });
      }
      if (failNextWorkflowRead) { failNextWorkflowRead = false; return route.fulfill({ status: 503, json: { error: "fixture workflow read failed" } }); }
      const captured = structuredClone(states[sid]);
      const afterFailedAction = reconcileFailedAction;
      reconcileFailedAction = false;
      if (holdNext) { holdNext = false; await new Promise(resolve => held.push(resolve)); }
      return route.fulfill({ json: captured, ...(afterFailedAction ? { headers: { "x-fixture-action-reconciliation": "true" } } : {}) }).catch(() => {});
    });
    await page.goto("http://127.0.0.1:38201");
    const expectedLanguage = locale === "en-US" ? "en" : "zh-CN";
    await page.waitForFunction(language => document.documentElement.lang === language, expectedLanguage);
    assert.equal(await page.locator("html").getAttribute("lang"), expectedLanguage);
    if (locale === "en-US") assert.ok(transport.some(event => event.event === "response" && event.path !== "/bundle.js" && /messages_en.*\.js$/.test(event.path) && event.status === 200), "English must load its real locale chunk rather than silently fall back");
    await page.getByTestId("workflow-peek-toggle").waitFor();
    await page.waitForFunction(() => Boolean(window.lab.error));
    assert.equal(await page.evaluate(() => window.lab.ready), false, "a failed first read must not confirm disabled settings");
    // Keep all reads failed until this boundary, including a real background
    // poll. Pausing timers does not suppress focus/online reconciliation.
    const failedPoll = page.waitForResponse(response => response.url().endsWith("/api/settings/laboratory") && response.status() === 503);
    await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 6_000));
    await (await failedPoll).finished();
    await page.waitForFunction(expected => window.lab.error === expected, `fixture read failed ${laboratoryReadCount}`);
    const retry = page.getByRole("button", { name: /重新加载|Retry loading/ });
    await page.bringToFront();
    await retry.focus();
    // Annotate only a GET synchronously started by the real, trusted Retry
    // click. The production handler and fetch still run normally; ambient
    // focus/visibility/online reads can never unlock this fixture response.
    await retry.evaluate(button => {
      const originalFetch = window.fetch;
      let inRetryClick = false;
      window.fixtureRetryClicks = 0;
      window.fixtureRetryButton = button;
      const beginClick = event => {
        if (!event.isTrusted || !button.contains(event.target)) return;
        inRetryClick = true;
        window.fixtureRetryClicks++;
      };
      const endClick = () => { inRetryClick = false; };
      document.addEventListener("click", beginClick, true);
      window.addEventListener("click", endClick);
      window.fetch = (input, init) => {
        if (inRetryClick && typeof input === "string" && new URL(input, location.href).pathname === "/api/settings/laboratory"
          && (init?.method ?? "GET") === "GET") {
          const headers = new Headers(init?.headers);
          headers.set("x-piora-fixture-retry", "true");
          init = { ...init, headers };
        }
        return originalFetch.call(window, input, init);
      };
      window.cleanupFixtureRetry = () => {
        window.fetch = originalFetch;
        document.removeEventListener("click", beginClick, true);
        window.removeEventListener("click", endClick);
      };
    });
    for (const type of ["focus", "visibilitychange", "online"]) {
      const failedReconcile = page.waitForResponse(response => response.url().endsWith("/api/settings/laboratory") && response.status() === 503);
      await page.evaluate(type => (type === "visibilitychange" ? document : window).dispatchEvent(new Event(type)), type);
      await (await failedReconcile).finished();
      await page.waitForFunction(expected => window.lab.error === expected, `fixture read failed ${laboratoryReadCount}`);
      assert.equal(await page.evaluate(() => window.lab.ready), false, `${type} cannot preempt the explicit Retry`);
      assert.equal(await retry.count(), 1, `the Retry button survives ${type} before its click`);
      assert.equal(laboratoryRetryReadCount, 0);
    }
    const readsBeforeRetry = laboratoryReadCount;
    const retryResponse = page.waitForResponse(response => response.url().endsWith("/api/settings/laboratory")
      && response.request().headers()["x-piora-fixture-retry"] === "true" && response.status() === 200);
    await retry.click();
    await retryResponse;
    assert.equal(await page.evaluate(() => window.fixtureRetryClicks), 1, "one trusted Retry click reached the production handler");
    assert.equal(laboratoryRetryReadCount, 1, "the successful GET originated synchronously from that click");
    assert.equal(laboratoryReadCount, readsBeforeRetry + 1, "the explicit Retry click starts one new settings GET");
    await page.evaluate(() => window.cleanupFixtureRetry());
    await page.clock.resume();
    await page.waitForFunction(() => window.lab.ready);
    const preview = page.getByTestId("workflow-peek-content");
    const toggle = page.getByTestId("workflow-peek-toggle");
    const reveal = async () => { if (!(await preview.isVisible())) await toggle.click(); await preview.waitFor({ state: "visible" }); };
    const dismissOutside = async () => { await page.locator("#composer").click(); await preview.waitFor({ state: "hidden" }); };
    const screenshot = async name => {
      if (!process.env.PIORA_WORKFLOW_SCREENSHOTS) return;
      await mkdir(process.env.PIORA_WORKFLOW_SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: path.join(process.env.PIORA_WORKFLOW_SCREENSHOTS, `${locale}-${name}.png`), animations: "disabled" });
    };
    assert.equal(await preview.isVisible(), false, "disabled laboratory features do not automatically open stored plans");
    const collapsedComposer = await page.locator("#composer").boundingBox();
    const summaryActions = page.getByTestId("workflow-summary-actions");
    assert.equal(await summaryActions.isVisible(), true, "plan decisions are visible even with details collapsed");
    assert.equal(await preview.locator('[data-testid^="workflow-plan-"]').count(), 0, "plan action buttons are outside the disclosure");
    assert.equal(await page.locator("button button").count(), 0, "summary actions are separate buttons rather than nested interactive controls");
    const summaryGeometry = await summaryActions.evaluate(group => ({
      group: group.getBoundingClientRect().toJSON(),
      buttons: [...group.querySelectorAll("button")].map(button => button.getBoundingClientRect().toJSON()),
    }));
    assert.ok(summaryGeometry.buttons.every(button => button.x >= 16 && button.right <= 374 && button.height >= 28), "narrow layouts keep every plan decision visible and usable");
    await screenshot("collapsed");
    await toggle.hover();
    assert.equal(await preview.isVisible(), false, "hovering the summary does not open details or move action targets");
    await reveal();
    assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    assert.deepEqual(await page.locator("#composer").boundingBox(), collapsedComposer, "preview overlays history without moving the composer");
    const expandedBox = await preview.boundingBox();
    assert.ok(expandedBox.y >= 0 && expandedBox.x >= 0 && expandedBox.x + expandedBox.width <= 390);
    await screenshot("expanded");
    await page.mouse.move(0, 0);
    const glassResults = [];
    for (const dark of [false, true]) {
      for (const transparency of [0, 80]) {
        const styles = await preview.evaluate((details, { dark, transparency }) => {
          document.documentElement.classList.toggle("dark", dark);
          document.documentElement.style.setProperty("--interface-transparency", String(transparency));
          document.body.style.background = "linear-gradient(135deg, #a5ddff 10%, #f9c9e8 48%, #b6e6ba 90%) fixed";
          const reference = document.createElement("div");
          reference.style.cssText = "position:fixed;visibility:hidden;background:var(--composer-background);backdrop-filter:var(--composer-filter);border:1px solid var(--composer-border);box-shadow:var(--shadow-composer)";
          document.body.append(reference);
          document.getAnimations().forEach(animation => animation.finish());
          const surface = details.parentElement;
          const read = (element, pseudo) => {
            const computed = getComputedStyle(element, pseudo);
            return { background: computed.backgroundImage, color: computed.backgroundColor, filter: computed.backdropFilter,
              border: computed.borderTopColor, shadow: computed.boxShadow, overflow: computed.overflow };
          };
          const result = { reference: read(reference), summary: read(surface), summaryGlass: read(surface, "::before"), details: read(details),
            detailsAboveSummary: details.getBoundingClientRect().bottom <= surface.getBoundingClientRect().top + 2 };
          reference.remove();
          return result;
        }, { dark, transparency });
        assert.match(styles.reference.background, /^linear-gradient\(/, "the production composer uses its transparency gradient");
        assert.match(styles.reference.filter, /blur\(/, "the composer reference retains backdrop blur");
        assert.equal(styles.summary.color, "rgba(0, 0, 0, 0)", "the summary has no opaque layer over its glass pseudo-element");
        for (const [name, surface] of [["summary glass", styles.summaryGlass], ["details", styles.details]]) {
          assert.equal(surface.background, styles.reference.background, `${name} follows the real composer background in ${dark ? "dark" : "light"} at ${transparency}% transparency`);
          assert.equal(surface.color, styles.reference.color, `${name} has no extra opaque background`);
          assert.equal(surface.filter, styles.reference.filter, `${name} uses the same backdrop filter as the composer`);
        }
        for (const [name, surface] of [["summary", styles.summary], ["details", styles.details]]) {
          assert.equal(surface.border, styles.reference.border, `${name} uses the composer border`);
          assert.equal(surface.shadow, styles.reference.shadow, `${name} uses the composer shadow`);
        }
        assert.equal(styles.summary.overflow, "visible", "the glass summary does not clip details above it");
        assert.equal(styles.detailsAboveSummary, true);
        glassResults.push(styles.reference.background);
        if (transparency === 80) await screenshot(`glass-${dark ? "dark" : "light"}-expanded`);
      }
    }
    assert.equal(new Set(glassResults).size, 4, "both theme and transparency changes reach the workflow surfaces");
    await page.evaluate(() => {
      document.documentElement.classList.remove("dark");
      document.documentElement.style.removeProperty("--interface-transparency");
      document.body.style.removeProperty("background");
    });
    await page.mouse.move(0, 0);
    assert.equal(await preview.isVisible(), true, "an explicitly opened plan stays readable after the pointer leaves");
    await preview.locator("strong").first().click();
    assert.equal(await preview.isVisible(), true, "clicks inside the details do not dismiss them");
    await dismissOutside();
    assert.equal(await page.locator("#composer").evaluate(element => element === document.activeElement), true, "outside clicks keep the destination focus");
    // Keyboard focus only exposes the control; activation opens and Escape closes.
    await page.locator("#composer").focus();
    await page.keyboard.press("Tab");
    await toggle.focus();
    assert.equal(await preview.isVisible(), false, "keyboard focus alone does not open details");
    await page.keyboard.press("Enter");
    await preview.waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await preview.waitFor({ state: "hidden" });
    assert.equal(await toggle.evaluate(element => element === document.activeElement), true);
    // Explicit clicks and taps consistently toggle the same readable panel.
    await toggle.click();
    await page.mouse.move(0, 0);
    await preview.waitFor({ state: "visible" });
    await toggle.click();
    await preview.waitFor({ state: "hidden" });
    await page.mouse.move(0, 0);
    const touchTarget = await toggle.boundingBox();
    await page.touchscreen.tap(touchTarget.x + touchTarget.width / 2, touchTarget.y + touchTarget.height / 2);
    await preview.waitFor({ state: "visible" });
    await page.touchscreen.tap(touchTarget.x + touchTarget.width / 2, touchTarget.y + touchTarget.height / 2);
    await preview.waitFor({ state: "hidden" });
    await page.setViewportSize({ width: 1100, height: 800 });
    await reveal();
    await screenshot("desktop-expanded");
    await dismissOutside();
    await page.setViewportSize({ width: 390, height: 800 });
    assert.equal(await page.getByTestId("workflow-mode-select").count(), 0);
    assert.equal(await page.getByTestId("workflow-plan-approve").isDisabled(), true);
    assert.equal(await page.getByTestId("workflow-plan-revise").isDisabled(), true);
    assert.equal(await page.getByTestId("workflow-plan-exit").isDisabled(), false);
    const laboratoryToggle = page.getByRole("switch", { name: locale === "zh-CN" ? "Plan / Goal 模式" : "Plan and Goal modes", exact: true });
    assert.equal(await laboratoryToggle.getAttribute("data-testid"), "laboratory-plan-goal-toggle");
    assert.equal(await laboratoryToggle.isChecked(), false);
    await laboratoryToggle.click();
    await page.waitForFunction(() => Boolean(window.lab.error));
    assert.equal(await laboratoryToggle.isChecked(), false, "failed saves cannot enable workflows locally");
    assert.equal(await page.getByTestId("workflow-mode-select").count(), 0);
    holdLaboratoryWrite = true;
    await laboratoryToggle.focus();
    await page.keyboard.press("Space");
    await page.waitForFunction(() => window.lab.saving);
    // Saving disables the switch and naturally drops its focus. Establish a
    // stable user destination before the response opens the actionable plan.
    await page.locator("#composer").fill("Keep typing while settings save");
    laboratoryEnableResponse.resolve();
    await page.waitForFunction(() => window.lab.planGoalEnabled);
    assert.equal(await laboratoryToggle.isChecked(), true);
    assert.equal(await page.locator("#lab-state").textContent(), "true", "separate subscribers update from the same confirmed server setting");
    await preview.waitFor({ state: "visible" });
    assert.equal(await page.locator("#composer").evaluate(element => document.activeElement === element), true, "a newly actionable plan opens without stealing the user's input focus");
    assert.equal(await page.locator("#composer").inputValue(), "Keep typing while settings save");
    await page.mouse.move(0, 0);
    assert.equal(await preview.isVisible(), true, "automatic review stays open until explicitly dismissed");
    await dismissOutside();
    await page.locator("#refresh").click();
    await page.waitForFunction(() => !window.state.busy && window.state.snapshot?.revision === 1);
    assert.equal(await preview.isVisible(), false, "refreshing the same plan version does not reopen dismissed details");
    await page.locator("#switch").click();
    await page.waitForFunction(() => window.state.snapshot?.sessionId === "two");
    await page.locator("#switch").click();
    await page.waitForFunction(() => window.state.snapshot?.sessionId === "one");
    assert.equal(await preview.isVisible(), false, "returning to a chat preserves dismissal of the same plan version");
    const modePicker = page.getByTestId("workflow-mode-select");
    const modeToggle = page.getByTestId("workflow-mode-toggle");
    const modeMenu = page.getByTestId("workflow-mode-menu");
    const modeButton = mode => page.getByTestId(`workflow-mode-${mode}`);
    const assertChoice = async (mode, turnBudget = 10) => assert.deepEqual(JSON.parse(await page.locator("#choice").textContent()), { mode, turnBudget });
    const assertModeCollapsed = async mode => {
      assert.equal(await modeToggle.getAttribute("aria-expanded"), "false");
      assert.equal(await modePicker.getByRole("button").count(), 1, "collapsed options are absent from the accessibility tree");
      assert.equal(await modeMenu.count(), 0, "closed mode menus are unmounted");
      assert.ok((await modeToggle.textContent()).includes(mode), "the compact trigger displays the current mode");
    };
    await assertModeCollapsed("Agent");
    assert.equal(await modeToggle.locator("svg").count(), 1, "the compact trigger keeps only the mode icon without a disclosure arrow");
    const compactModeBox = await modePicker.boundingBox();
    await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now())));
    await modeToggle.click();
    assert.equal(await modeToggle.getAttribute("aria-expanded"), "true");
    assert.deepEqual(await modePicker.boundingBox(), compactModeBox, "opening the menu does not resize or move its trigger");
    const menuBounds = await modeMenu.boundingBox();
    assert.ok(menuBounds.y + menuBounds.height <= compactModeBox.y - 4, "the mode menu opens above the trigger");
    assert.ok(menuBounds.x >= 0 && menuBounds.x + menuBounds.width <= 390 && menuBounds.y >= 0, "the menu stays inside the viewport");
    for (const mode of ["agent", "plan", "goal"]) {
      assert.equal(await modeButton(mode).locator("svg").count(), 1, `${mode} retains its identifying icon`);
      assert.equal(await modeButton(mode).isVisible(), true, `${mode} is directly visible in the open menu`);
      assert.equal(await modeButton(mode).getAttribute("aria-pressed"), String(mode === "agent"));
    }
    const tooltip = page.getByRole("tooltip");
    const modeHelp = {};
    for (const mode of ["agent", "plan", "goal"]) modeHelp[mode] = await modeButton(mode).locator("span[hidden]").textContent();
    const assertModeHelp = async mode => {
      await page.clock.runFor(500);
      await page.locator(".app-tooltip.is-visible").waitFor();
      await tooltip.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
      assert.equal(await tooltip.textContent(), modeHelp[mode], "the tooltip shows the complete help for the active mode");
      const painted = await tooltip.evaluate(element => {
        const menu = document.querySelector('[data-testid="workflow-mode-menu"]');
        const rect = element.getBoundingClientRect();
        const menuRect = menu.getBoundingClientRect();
        const original = element.style.getPropertyValue("pointer-events");
        const priority = element.style.getPropertyPriority("pointer-events");
        element.style.setProperty("pointer-events", "auto", "important");
        let frontmost;
        try {
          frontmost = [[.5, .5], [.2, .3], [.8, .3], [.2, .7], [.8, .7]].every(([x, y]) => {
            const hit = document.elementFromPoint(rect.left + rect.width * x, rect.top + rect.height * y);
            return hit === element || element.contains(hit);
          });
        } finally {
          if (original) element.style.setProperty("pointer-events", original, priority);
          else element.style.removeProperty("pointer-events");
        }
        return { rect: rect.toJSON(), menu: menuRect.toJSON(), frontmost,
          tooltipLayer: Number(getComputedStyle(element).zIndex), menuLayer: Number(getComputedStyle(menu).zIndex),
          opacity: Number(getComputedStyle(element).opacity), viewport: { width: innerWidth, height: innerHeight } };
      });
      assert.ok(painted.rect.left >= 0 && painted.rect.top >= 0 && painted.rect.right <= painted.viewport.width && painted.rect.bottom <= painted.viewport.height,
        `mode help stays fully inside the viewport: ${JSON.stringify(painted)}`);
      assert.ok(painted.rect.bottom <= painted.menu.top || painted.rect.top >= painted.menu.bottom,
        `mode help sits outside the whole menu rather than covering adjacent modes: ${JSON.stringify(painted)}`);
      assert.ok(painted.tooltipLayer > painted.menuLayer, "mode help is stacked above the popup that owns it");
      assert.equal(painted.opacity, 1);
      assert.equal(painted.frontmost, true, "the actual painted tooltip is unobscured across its text area");
    };
    await modeButton("plan").hover();
    await assertModeHelp("plan");
    await screenshot("mode-plan-help");
    await modeButton("goal").hover();
    await assertModeHelp("goal");
    await screenshot("mode-goal-help");
    // Hover changes descriptions without changing keyboard selection or focus.
    await assertChoice("agent");
    await page.keyboard.press("ArrowRight");
    assert.equal(await modeButton("plan").evaluate(element => element === document.activeElement), true);
    await assertModeHelp("plan");
    await screenshot("mode-keyboard-help");
    await page.keyboard.press("Escape");
    await assertModeCollapsed("Agent");
    await page.clock.runFor(500);
    assert.ok(["", modeHelp.agent].includes(await tooltip.textContent()), "Escape never leaves help from an unmounted popup option");
    await modeToggle.click();
    await modeButton("goal").hover();
    await assertModeHelp("goal");
    await page.locator("#composer").click();
    await assertModeCollapsed("Agent");
    await page.clock.runFor(1000);
    assert.equal(await page.locator(".app-tooltip.is-visible").count(), 0, "outside dismissal cancels visible and pending popup help");
    assert.equal(await tooltip.textContent(), "");
    await modeToggle.click();
    await modeButton("plan").click();
    await assertChoice("plan");
    assert.equal(await modeToggle.getAttribute("aria-expanded"), "true", "selection applies without dismissing the choices");
    await page.clock.runFor(1200);
    assert.equal(await modeToggle.getAttribute("aria-expanded"), "true", "hovering the chosen mode keeps it open beyond the former selection deadline");
    await modeButton("goal").click();
    await assertChoice("goal");
    assert.equal(await modeButton("goal").getAttribute("aria-pressed"), "true");
    assert.equal(await modeButton("agent").getAttribute("aria-pressed"), "false");
    await modeButton("agent").hover();
    await page.clock.runFor(1200);
    assert.equal(await modeToggle.getAttribute("aria-expanded"), "true", "moving between options stays inside the dismissal boundary");
    await assertChoice("goal");
    await page.locator("#composer").hover();
    await page.clock.runFor(120);
    assert.equal(await modeToggle.getAttribute("aria-expanded"), "true", "leaving the group has a grace period");
    await modeButton("plan").hover();
    await page.clock.runFor(1200);
    assert.equal(await modeToggle.getAttribute("aria-expanded"), "true", "re-entering cancels the pending collapse");
    await page.getByTestId("workflow-budget-input").hover();
    await page.clock.runFor(199);
    assert.equal(await modeToggle.getAttribute("aria-expanded"), "true", "Goal budget is outside the mode boundary but keeps the leave grace period");
    await page.clock.runFor(1);
    await assertModeCollapsed("Goal");
    assert.equal(await modeToggle.evaluate(element => element === document.activeElement), true, "pointer-leave collapse returns disappearing option focus to the current-mode trigger");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "mode controls fit a narrow viewport");
    await screenshot("goal-mode");
    await page.getByTestId("workflow-budget-input").fill("7");
    assert.equal(await page.locator("#choice").textContent(), '{"mode":"goal","turnBudget":7}');

    // Keyboard navigation previews focus without silently changing the mode.
    await modeToggle.focus();
    await page.keyboard.press("Enter");
    assert.equal(await modeButton("goal").evaluate(element => element === document.activeElement), true);
    await page.keyboard.press("ArrowLeft");
    assert.equal(await modeButton("plan").evaluate(element => element === document.activeElement), true);
    await assertChoice("goal", 7);
    await page.keyboard.press("Escape");
    await assertModeCollapsed("Goal");
    await assertChoice("goal", 7);
    assert.equal(await modeToggle.evaluate(element => element === document.activeElement), true);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Home");
    assert.equal(await modeButton("agent").evaluate(element => element === document.activeElement), true);
    await page.keyboard.press("End");
    assert.equal(await modeButton("goal").evaluate(element => element === document.activeElement), true);
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Space");
    await assertChoice("plan", 7);
    assert.equal(await page.getByTestId("workflow-budget-input").count(), 0);
    await page.clock.runFor(1200);
    assert.equal(await modeToggle.getAttribute("aria-expanded"), "true", "keyboard selection waits for explicit dismissal or focus leaving");
    assert.equal(await modeButton("plan").evaluate(element => element === document.activeElement), true);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await assertChoice("goal", 7);
    await page.keyboard.press("Tab");
    await assertModeCollapsed("Goal");
    assert.equal(await page.getByTestId("workflow-budget-input").evaluate(element => element === document.activeElement), true, "Tab reaches the Goal budget instead of trapping or resetting focus");
    await page.clock.runFor(520);
    assert.equal(await page.getByTestId("workflow-budget-input").evaluate(element => element === document.activeElement), true, "a cancelled collapse timer cannot steal focus back");

    // Reopen a closing control immediately: neither a dismissal lock nor the
    // previous pointer-leave timer may consume the next interaction or its focus.
    await modeToggle.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Enter");
    assert.equal(await modeToggle.getAttribute("aria-expanded"), "true");
    assert.equal(await modeButton("goal").evaluate(element => element === document.activeElement), true, "reopening during collapse focuses the current choice immediately");
    await assertChoice("goal", 7);
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Enter");
    await assertChoice("plan", 7);
    await modeButton("plan").hover();
    await page.locator("#composer").hover();
    await page.clock.runFor(120);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Enter");
    await page.clock.runFor(400);
    assert.equal(await modeToggle.getAttribute("aria-expanded"), "true", "the cancelled leave deadline cannot close a reopened control");
    assert.equal(await modeButton("plan").evaluate(element => element === document.activeElement), true, "reversal preserves focus after the old deadline");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await assertChoice("goal", 7);
    await page.clock.runFor(1200);
    assert.equal(await modeToggle.getAttribute("aria-expanded"), "true", "a choice made during reversal also stays open");
    await page.keyboard.press("Escape");
    await assertModeCollapsed("Goal");

    // A real pointer can choose the first option immediately after opening.
    await modeToggle.click();
    const exposedAgent = await modeButton("agent").boundingBox();
    assert.ok(exposedAgent);
    await page.mouse.click(exposedAgent.x + exposedAgent.width / 2, exposedAgent.y + exposedAgent.height / 2);
    await assertChoice("agent", 7);
    assert.equal(await modeToggle.getAttribute("aria-expanded"), "true");
    assert.equal(await modeButton("agent").evaluate(element => element === document.activeElement), true);
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await assertChoice("goal", 7);
    await page.clock.runFor(1200);
    assert.equal(await modeToggle.getAttribute("aria-expanded"), "true", "rapid pointer and keyboard choices do not create a selection timer");
    await page.getByTestId("workflow-budget-input").hover();
    await page.clock.runFor(200);
    await assertModeCollapsed("Goal");
    assert.equal(await page.getByTestId("workflow-budget-input").inputValue(), "7", "rapid choices preserve the Goal budget");

    await modeToggle.click();
    await page.locator("#composer").click();
    await assertModeCollapsed("Goal");
    await assertChoice("goal", 7);
    assert.equal(await page.locator("#composer").evaluate(element => element === document.activeElement), true, "outside clicks preserve the destination focus");
    await page.locator("#disable-mode-picker").check();
    assert.equal(await modeToggle.isDisabled(), true);
    assert.equal(await page.getByTestId("workflow-budget-input").isDisabled(), true);
    await modeToggle.click({ force: true });
    await assertModeCollapsed("Goal");
    assert.equal(await modeMenu.count(), 0, "disabled controls cannot open a menu");
    await assertChoice("goal", 7);
    await page.locator("#disable-mode-picker").uncheck();

    // Reduced motion removes animation, not the pointer dismissal boundary.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await modeToggle.click();
    const motionDurations = await modePicker.evaluate(element => [element, ...element.querySelectorAll("*"), ...document.querySelectorAll('[data-testid="workflow-mode-menu"], [data-testid="workflow-mode-menu"] *')].flatMap(node => {
      const style = getComputedStyle(node);
      return [style.transitionDuration, style.animationDuration].flatMap(value => value.split(",").map(parseFloat));
    }));
    assert.ok(motionDurations.every(duration => duration === 0), "reduced-motion users receive no mode expansion animations");
    await modeButton("plan").click();
    await assertChoice("plan", 7);
    await page.clock.runFor(1200);
    assert.equal(await modeToggle.getAttribute("aria-expanded"), "true");
    await page.locator("#composer").hover();
    await page.clock.runFor(200);
    await assertModeCollapsed("Plan");
    assert.equal(await page.getByTestId("workflow-budget-input").count(), 0);

    // Touch emits pointerleave when lifting a finger, not when leaving a hover
    // region. A tap selection stays visible until the user taps elsewhere.
    await modeToggle.tap();
    await modeButton("goal").tap();
    await assertChoice("goal", 7);
    await page.clock.runFor(1200);
    assert.equal(await modeToggle.getAttribute("aria-expanded"), "true", "lifting a touch pointer must not start a collapse timer");
    await page.getByTestId("workflow-budget-input").tap();
    await assertModeCollapsed("Goal");
    await page.clock.runFor(1200);
    assert.equal(await page.getByTestId("workflow-budget-input").evaluate(element => element === document.activeElement), true, "touch dismissal preserves the budget input focus");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.clock.resume();
    await page.setViewportSize({ width: 390, height: 480 });
    await page.locator("#composer").evaluate(element => { element.style.height = "220px"; });
    await reveal();
    assert.ok((await preview.boundingBox()).y >= 10, "preview stays within a short window above a tall composer");
    assert.ok(await preview.evaluate(element => element.scrollHeight > element.clientHeight), "long details remain scrollable within the available height");
    await page.mouse.move(0, 0);
    await page.locator("#composer").evaluate(element => { element.style.height = "40px"; });
    await page.setViewportSize({ width: 390, height: 800 });
    await page.locator("#composer").fill("Preserve my revision notes");
    holdNext = true;
    await page.locator("#refresh").click();
    await page.waitForFunction(() => window.state.snapshot?.revision === 1);
    assert.equal(await preview.isVisible(), false);
    assert.equal(await page.getByTestId("workflow-plan-revise").isVisible(), true, "revision is directly available without reopening the full plan");
    await page.getByTestId("workflow-plan-revise").click();
    await page.waitForFunction(() => window.state.snapshot?.revision === 2);
    held.splice(0).forEach(resolve => resolve());
    await page.waitForTimeout(100);
    assert.equal(await page.getByTestId("workflow-panel").getAttribute("data-status"), "planning");
    assert.equal(await preview.isVisible(), true, "revision keeps the plan available while editing requirements");
    assert.equal(await page.locator("#composer").inputValue(), "Preserve my revision notes");
    assert.equal(await page.locator("#composer").evaluate(element => element === document.activeElement), true, "successful revision focuses the existing composer without replacing its draft");
    await page.getByTestId("workflow-history").locator("summary").first().click();
    assert.equal(await page.getByTestId("workflow-history-entry").count(), 1);
    assert.equal(await page.getByTestId("workflow-history-entry").getAttribute("data-status"), "awaiting_approval");
    await dismissOutside();
    holdNext = true;
    await page.locator("#refresh").click();
    await page.locator("#switch").click();
    await page.waitForFunction(() => window.state.snapshot?.sessionId === "two");
    held.splice(0).forEach(resolve => resolve());
    assert.equal(await page.getByTestId("workflow-panel").getAttribute("data-run-id"), "goal-two");
    assert.equal(await preview.isVisible(), false, "switching chats resets the preview");
    await reveal();
    assert.equal(await page.getByTestId("workflow-goal-resume").isDisabled(), true);
    await page.getByTestId("workflow-run-budget-input").fill("4");
    await page.getByTestId("workflow-goal-set-budget").click();
    await page.waitForFunction(() => window.state.snapshot?.current.turnBudget === 4);
    assert.equal(await page.getByTestId("workflow-panel").getAttribute("data-status"), "budget_exhausted");
    assert.equal(actions.some(action => action.action === "resume"), false);
    await page.getByTestId("workflow-goal-resume").focus();
    await page.keyboard.press("Enter");
    await page.getByTestId("workflow-goal-pause").waitFor();
    await page.mouse.move(0, 0);
    assert.equal(await preview.isVisible(), true, "pointer movement after resuming does not silently dismiss details");
    await dismissOutside();
    assert.equal(await page.getByTestId("workflow-goal-pause").isVisible(), true, "Goal pause remains directly available with details closed");
    await page.getByTestId("workflow-goal-pause").click();
    await page.getByTestId("workflow-goal-resume").waitFor();
    holdLaboratoryRead = true;
    await page.evaluate(() => { void window.lab.refresh(); });
    await page.waitForTimeout(50);
    await page.getByTestId("laboratory-plan-goal-toggle").click();
    await page.waitForFunction(() => !window.lab.planGoalEnabled);
    assert.equal(await laboratoryToggle.isChecked(), false);
    held.splice(0).forEach(resolve => resolve());
    assert.equal(await page.getByTestId("workflow-mode-select").count(), 0);
    assert.equal(await page.getByTestId("workflow-goal-resume").isDisabled(), true);
    assert.equal(await page.getByTestId("workflow-goal-set-budget").isDisabled(), true);
    assert.equal(await page.getByTestId("workflow-goal-cancel").isDisabled(), false);
    assert.equal(await page.getByTestId("workflow-laboratory-disabled").count(), 1);
    assert.equal(await page.getByTestId("workflow-goal-cancel").isVisible(), true, "a disabled laboratory still permits cancellation from the summary bar");
    await page.getByTestId("workflow-goal-cancel").click();
    await page.waitForFunction(() => window.state.snapshot?.current.status === "cancelled");
    assert.equal(await page.getByTestId("workflow-peek").count(), 0, "a cancelled Goal releases the workflow strip immediately");
    assert.equal(await page.getByTestId("workflow-goal-cancel").count(), 0);
    assert.deepEqual(actions.map(action => action.action), ["revise", "set_budget", "resume", "pause", "cancel"]);
    await page.reload();
    await page.getByTestId("workflow-peek-toggle").waitFor();
    await page.waitForFunction(() => window.lab.ready);
    assert.equal(await page.getByTestId("workflow-mode-select").count(), 0, "reload reads the disabled server setting");
    laboratory.planGoalEnabled = true;
    await page.evaluate(() => window.dispatchEvent(new StorageEvent("storage", { key: "piora-laboratory-settings-changed", newValue: "external-change" })));
    await page.getByTestId("workflow-mode-select").waitFor();
    assert.equal(await page.getByTestId("workflow-panel").getAttribute("data-status"), "planning");
    await page.locator("#composer").fill("Do not steal this input focus");
    states.one.current = { ...states.one.current, id: "next-plan-in-same-chat", status: "awaiting_approval" };
    states.one.revision++;
    await page.evaluate(() => window.state.refresh());
    await page.waitForFunction(() => window.state.snapshot?.current.id === "next-plan-in-same-chat");
    await preview.waitFor({ state: "visible" });
    assert.equal(await page.locator("#composer").evaluate(element => element === document.activeElement), true, "new plan review opens without interrupting ongoing input");
    assert.equal(await page.locator("#composer").inputValue(), "Do not steal this input focus");
    await page.mouse.move(0, 0);
    assert.equal(await preview.isVisible(), true, "new plan review stays open after the pointer leaves");
    await dismissOutside();
    states.one.revision++;
    await page.evaluate(() => window.state.refresh());
    await page.waitForFunction(revision => window.state.snapshot?.revision === revision, states.one.revision);
    assert.equal(await preview.isVisible(), false, "snapshot revisions alone never reopen a dismissed plan version");
    states.one.current.version++;
    states.one.revision++;
    await page.evaluate(() => window.state.refresh());
    await page.waitForFunction(version => window.state.snapshot?.current.version === version, states.one.current.version);
    await preview.waitFor({ state: "visible" });
    assert.equal(await page.locator("#composer").evaluate(element => element === document.activeElement), true);
    failNextAction = true;
    const approvalReconciled = page.waitForResponse(response => response.headers()["x-fixture-action-reconciliation"] === "true");
    await page.getByTestId("workflow-plan-approve").click();
    await page.getByRole("alert").filter({ hasText: "fixture action failed" }).waitFor();
    await (await approvalReconciled).finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.getByRole("alert").filter({ hasText: "fixture action failed" }).isVisible(), true, "successful background reconciliation must not erase the failed approval error");
    assert.equal(await preview.isVisible(), true, "failed approval keeps the plan and error visible");
    assert.equal(states.one.current.status, "awaiting_approval");
    holdNextAction = true;
    await page.getByTestId("workflow-plan-approve").click();
    await page.waitForFunction(() => window.state.busy);
    assert.equal(await page.getByRole("alert").filter({ hasText: "fixture action failed" }).count(), 0, "a deliberate retry clears the previous action error");
    assert.equal(await preview.isVisible(), true, "approval does not collapse the plan before the server accepts it");
    assert.equal(await page.getByTestId("workflow-plan-approve").isDisabled(), true);
    held.splice(0).forEach(resolve => resolve());
    await page.waitForFunction(() => window.state.snapshot?.current.status === "running");
    await preview.waitFor({ state: "hidden" });
    assert.equal(await page.evaluate(() => window.state.snapshot.mode), "agent");
    assert.equal(await toggle.isVisible(), true, "an approved Plan stays visible while executing even after the snapshot mode becomes Agent");
    assert.equal(await page.getByTestId("workflow-plan-approve").count(), 0);
    assert.equal(await page.getByTestId("workflow-plan-revise").count(), 0, "executing plans do not offer review actions");

    states.one.current = { ...states.one.current, id: "plan-to-exit", status: "awaiting_approval", version: 1 };
    states.one.mode = "plan";
    states.one.revision++;
    await page.evaluate(() => window.state.refresh());
    await page.waitForFunction(() => window.state.snapshot?.current.id === "plan-to-exit");
    await preview.waitFor({ state: "visible" });
    failNextAction = true;
    const exitReconciled = page.waitForResponse(response => response.headers()["x-fixture-action-reconciliation"] === "true");
    await page.getByTestId("workflow-plan-exit").click();
    await page.getByRole("alert").filter({ hasText: "fixture action failed" }).waitFor();
    await (await exitReconciled).finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.getByRole("alert").filter({ hasText: "fixture action failed" }).isVisible(), true, "reconciliation also preserves failed exit feedback");
    assert.equal(await preview.isVisible(), true, "failed exit also preserves the current plan");
    await page.getByRole("alert").filter({ hasText: "fixture action failed" }).getByRole("button").click();
    await page.waitForFunction(() => window.state.error === null);
    assert.equal(states.one.current.status, "awaiting_approval", "manual refresh clears stale feedback without executing the failed exit");
    await reveal();
    await page.getByTestId("workflow-plan-exit").click();
    await page.waitForFunction(() => window.state.snapshot?.current.status === "cancelled");
    await preview.waitFor({ state: "hidden" });
    assert.equal(await page.getByTestId("workflow-peek").count(), 0, "exiting a Plan removes its terminal strip rather than leaving a disabled prior mode");
    assert.deepEqual(actions.slice(5).map(action => action.action), ["approve", "approve", "exit", "exit"]);

    const chooseDraft = async mode => {
      // This focused fixture mounts the picker separately above the composer;
      // close an automatic review before interacting with that fixture area.
      await page.locator("#composer").click();
      await modeToggle.click();
      await modeButton(mode).click();
      await page.locator("#composer").click();
      await assertChoice(mode);
    };
    const assertNoWorkflowStrip = async reason => {
      assert.equal(await page.getByTestId("workflow-peek").count(), 0, reason);
      assert.equal(await toggle.count(), 0, "there is no obsolete disclosure trigger");
      assert.equal(await preview.count(), 0, "there is no hidden obsolete details overlay");
      assert.equal(await summaryActions.count(), 0, "terminal workflows expose no stale action buttons");
    };
    const refreshSnapshot = async () => {
      states.one.revision++;
      await page.evaluate(() => window.state.refresh());
      await page.waitForFunction(revision => window.state.snapshot?.revision === revision, states.one.revision);
    };
    const cancelledPlan = structuredClone(states.one.current);
    for (const mode of ["goal", "agent"]) {
      await chooseDraft(mode);
      await assertNoWorkflowStrip(`choosing ${mode} after exiting a Plan cannot resurrect the old Plan strip`);
      assert.deepEqual(await page.evaluate(() => window.state.snapshot), states.one, "draft changes never delete or replace the stored workflow");
    }
    await screenshot("cancelled-plan-agent-draft");
    states.one.history.push(cancelledPlan);
    states.one.current = { ...cancelledPlan, id: "completed-plan", status: "completed" };
    await refreshSnapshot();
    await assertNoWorkflowStrip("a completed current Plan does not occupy the composer strip");
    for (const mode of ["goal", "agent"]) {
      await chooseDraft(mode);
      await assertNoWorkflowStrip(`a completed Plan stays absent after choosing ${mode}`);
    }
    states.one.history.push(structuredClone(states.one.current));
    states.one.current = null;
    await refreshSnapshot();
    await assertNoWorkflowStrip("history alone does not create a workflow strip");
    const retainedHistory = structuredClone(states.one.history);
    await chooseDraft("goal");
    await assertNoWorkflowStrip("selecting a new Goal does not promote historical Plans into the current strip");
    assert.deepEqual(await page.evaluate(() => window.state.snapshot.history), retainedHistory, "hidden terminal details remain in the workflow history model");
    failNextWorkflowRead = true;
    await page.evaluate(() => window.state.refresh());
    const loadError = page.getByRole("alert").filter({ hasText: locale === "zh-CN" ? "无法加载工作流状态。" : "Workflow state could not be loaded." });
    await loadError.waitFor();
    await assertNoWorkflowStrip("a history-only load failure displays its error without resurrecting the strip");
    await loadError.getByRole("button").click();
    await page.waitForFunction(() => window.state.error === null);

    // The displayed workflow comes from the current run, independently of the
    // next message's mode and the Agent mode used during approved execution.
    for (const [kind, statuses] of [["plan", ["planning", "awaiting_approval", "running", "waiting", "paused", "failed"]], ["goal", ["running", "waiting", "paused", "failed", "budget_exhausted"]]]) {
      for (const status of statuses) {
        states.one.current = { ...run, id: `${kind}-${status}`, kind, status };
        states.one.mode = "agent";
        await refreshSnapshot();
        assert.equal(await toggle.isVisible(), true, `${kind} ${status} remains an actionable current workflow`);
        assert.equal(await page.getByTestId("workflow-panel").getAttribute("data-run-id"), `${kind}-${status}`);
        assert.equal(await page.getByTestId("workflow-panel").getAttribute("data-status"), status);
        await chooseDraft(kind === "plan" ? "goal" : "agent");
        assert.equal(await toggle.isVisible(), true, `changing a draft does not hide a ${status} ${kind}`);
        assert.deepEqual(await page.evaluate(() => window.state.snapshot), states.one, "draft selection preserves the current run and its history exactly");
      }
    }
    await reveal();
    await page.getByTestId("workflow-history").locator("summary").first().click();
    assert.equal(await page.getByTestId("workflow-history-entry").count(), retainedHistory.length, "retained history remains available with the next active workflow");
    assert.deepEqual(await page.getByTestId("workflow-history-entry").evaluateAll(entries => entries.map(entry => entry.dataset.status)), retainedHistory.map(entry => entry.status).reverse());
    assert.deepEqual(errors, []);
  } catch (error) {
    const state = await page?.evaluate(() => ({
      language: navigator.language, ready: window.lab?.ready, error: window.lab?.error,
      retryClicks: window.fixtureRetryClicks ?? 0,
      retryCaptureButtonConnected: window.fixtureRetryButton?.isConnected ?? null,
      laboratoryTrace: window.laboratoryTrace?.slice(-20) ?? [],
      retryButtons: [...document.querySelectorAll("button")].filter(button => /^(重新加载|Retry loading)$/.test(button.textContent.trim())).length,
    })).catch(failure => ({ error: String(failure) }));
    t.diagnostic(JSON.stringify({ locale, retryRequests: transport.filter(event => event.event === "request" && event.retry === "true").length,
      transport: transport.slice(-60), browserMessages: { first: browserMessages.slice(0, 10), last: browserMessages.slice(-10) }, state }));
    throw error;
  } finally {
    laboratorySaveRecovery.resolve();
    laboratoryEnableResponse.resolve();
    held.splice(0).forEach(resolve => resolve());
    await browser?.close();
    assert.equal(path.dirname(directory), tmpdir());
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
}

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const { webpack } = require("next/dist/compiled/webpack/webpack.js");
const repo = path.resolve(import.meta.dirname, "..");

test("right panel always uses the live desktop browser and keeps the web fallback isolated", { timeout: 120000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "piora-browser-isolation-ui-"));
  let browser;
  try {
    await writeFile(path.join(root, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText`);
    await writeFile(path.join(root, "css.cjs"), `module.exports=s=>"export default "+JSON.stringify(Object.fromEntries([...s.matchAll(/\\.([a-zA-Z][\\w-]*)/g)].map(m=>[m[1],m[1]])))`);
    await writeFile(path.join(root, "entry.tsx"), `import {createRoot} from "react-dom/client";import {I18nProvider} from ${JSON.stringify(path.join(repo, "hooks/useI18n.tsx"))};import {BrowserPanel} from ${JSON.stringify(path.join(repo, "components/workspace/BrowserPanel.tsx"))};createRoot(document.getElementById("root")).render(<I18nProvider><div id="browser-panel" style={{height:500}}><BrowserPanel active={true} maximized={false} sessionId="test-session"/></div></I18nProvider>);`);
    const compiler = webpack({ mode: "development", target: "web", devtool: false, entry: path.join(root, "entry.tsx"), output: { path: root, filename: "bundle.js", publicPath: "http://browser-isolation.test/" }, resolve: { extensions: [".tsx", ".ts", ".js"], modules: [path.join(repo, "node_modules"), "node_modules"], alias: { "@": repo } }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(root, "loader.cjs") }, { test: /\.css$/, use: path.join(root, "css.cjs") }] } });
    await new Promise((resolve, reject) => compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors() ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve())));
    const css = await readFile(path.join(repo, "components/workspace/WorkspacePanel.module.css"), "utf8");
    const documentBody = `<!doctype html><style>:root{--text-xs:11px;--text-sm:13px;--text-base:14px;--radius-control:6px}*{box-sizing:border-box}body{margin:0;font:14px system-ui}#root{height:100vh}${css}</style><div id="root"></div><script src="/bundle.js"></script>`;
    const state = { ready: true, revision: 1, title: "Independent browser page", url: "https://manual.test/account", viewport: { width: 1280, height: 800 }, cursor: "default", activeTabIndex: 0, tabs: [{ index: 0, title: "Independent browser page", url: "https://manual.test/account" }] };
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
    const serveBundle = async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith(".js")) return route.fulfill({ contentType: "text/javascript; charset=utf-8", body: await readFile(path.join(root, path.basename(url.pathname))) });
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: documentBody });
    };

    browser = await chromium.launch({ channel: "msedge", headless: true });
    const desktopPage = await browser.newPage({ viewport: { width: 600, height: 750 } });
    const desktopErrors = [];
    const desktopApiRequests = [];
    desktopPage.on("pageerror", (error) => desktopErrors.push(error.message));
    desktopPage.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/browser")) desktopApiRequests.push(request.url());
    });
    await desktopPage.addInitScript(() => {
      localStorage.setItem("pi-locale", "zh-CN");
      localStorage.setItem("piora-desktop-browser-onboarding-v1", "done");
      window.nativeActions = [];
      window.nativeViewports = [];
      const nativeState = { sessionId: "test-session", activeTabId: "native-tab", url: "https://native.test/", title: "Native", tabs: [{ id: "native-tab", title: "Native", url: "https://native.test/" }], canGoBack: false, canGoForward: false, loading: false };
      window.piDesktop = { browser: {
        setViewport: async (bounds, visible) => { window.nativeViewports.push({ ...bounds, visible }); },
        action: async (input) => { window.nativeActions.push(input); return nativeState; },
        getState: async () => nativeState,
        onState: () => () => {}, onDownload: () => () => {},
        importChromeBookmarks: async () => ({ bookmarkCount: 0, profiles: [] }),
        showBookmarkMenu: async () => null,
      } };
    });
    await desktopPage.route("http://browser-isolation.test/**", serveBundle);
    await desktopPage.goto("http://browser-isolation.test/");
    await desktopPage.locator('[data-native-browser="true"]').waitFor();
    assert.equal(await desktopPage.getByRole("switch").count(), 0, "the browser mode setting is removed");
    assert.equal(desktopApiRequests.length, 0, "the desktop panel must not call the background-browser API");
    assert.deepEqual(await desktopPage.evaluate(() => window.nativeActions), [{ action: "set_session", sessionId: "test-session" }]);

    const fallbackPage = await browser.newPage({ viewport: { width: 600, height: 750 } });
    const fallbackErrors = [];
    const fallbackRequests = [];
    fallbackPage.on("pageerror", (error) => fallbackErrors.push(error.message));
    await fallbackPage.addInitScript(() => localStorage.setItem("pi-locale", "zh-CN"));
    await fallbackPage.route("http://browser-isolation.test/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/browser") {
        fallbackRequests.push({ url: route.request().url(), body: route.request().postDataJSON?.() });
        return route.fulfill({ json: state });
      }
      if (url.pathname === "/api/browser/screenshot") {
        fallbackRequests.push({ url: route.request().url() });
        return route.fulfill({ contentType: "image/png", body: png });
      }
      return serveBundle(route);
    });
    await fallbackPage.goto("http://browser-isolation.test/");
    await fallbackPage.getByText("Independent browser page", { exact: true }).waitFor();
    await fallbackPage.waitForTimeout(200);
    assert.equal(await fallbackPage.locator('[data-native-browser="true"]').count(), 0);
    assert.equal(await fallbackPage.getByRole("switch").count(), 0);
    assert.ok(fallbackRequests.length > 0);
    assert.equal(fallbackRequests.some((request) => request.url.includes("sessionId=") || request.body?.sessionId), false, "fallback UI must never reuse an Agent session");
    assert.deepEqual(desktopErrors, []);
    assert.deepEqual(fallbackErrors, []);
  } finally {
    await browser?.close();
    await rm(root, { recursive: true, force: true });
  }
});

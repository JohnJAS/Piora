import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import test from "node:test";
import { createJiti } from "jiti";

test("Agent browser always runs headlessly and reuses sign-ins across restart", { timeout: 180000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "piora-background-browser-"));
  const oldDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  const server = createServer((request, response) => {
    if (request.url === "/login") response.setHeader("Set-Cookie", "piora_test_login=signed-in; Path=/; HttpOnly");
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(`<title>Account</title><h1>${request.headers.cookie?.includes("piora_test_login=signed-in") ? "Authenticated" : "Login"}</h1>`);
  });
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const jiti = createJiti(import.meta.url);
    const extension = await jiti.import("../extensions/piora-browser.ts");
    let tool;
    extension.default({ registerTool(value) { tool = value; }, on() {} });
    const execute = (params) => tool.execute("test", params, undefined, undefined, { sessionManager: { getSessionId: () => "background-test" } });

    await execute({ action: "open", url: `${url}/login` });
    await execute({ action: "evaluate", text: "localStorage.setItem('saved-login', 'yes')" });
    await execute({ action: "open", url: `${url}/account` });
    assert.match(JSON.stringify(await execute({ action: "snapshot" })), /Authenticated/);
    assert.equal((await extension.getBrowserViewState()).url, "about:blank");
    await extension.performBrowserViewAction({ action: "navigate", url: `${url}/visible` });
    assert.match(JSON.stringify(await execute({ action: "snapshot" })), /\/account/);
    assert.doesNotMatch(JSON.stringify(await execute({ action: "tabs" })), /\/visible/);
    const visibleState = await extension.getBrowserViewState();
    assert.equal(visibleState.url, `${url}/visible`);
    assert.equal(visibleState.tabs.length, 1, "the fallback UI owns a separate tab list");
    const runtime = globalThis.__pioraBrowserRuntime;
    const context = await runtime.contextPromise;
    assert.match(await context.pages()[0].evaluate(() => navigator.userAgent), /HeadlessChrome/, "Agent browsing must not open a desktop window");
    const snapshot = JSON.parse(await readFile(path.join(root, "piora/browser-profile/piora-storage-state.json"), "utf8"));
    assert.ok(snapshot.cookies.some((cookie) => cookie.name === "piora_test_login" && cookie.expires === -1));

    // Force the session-cookie recovery path instead of relying on Chromium's exit behavior.
    await context.clearCookies();
    if (runtime.persistTimer) clearTimeout(runtime.persistTimer);
    await runtime.persistChain;
    await context.close();
    await execute({ action: "open", url: `${url}/account` });
    assert.match(JSON.stringify(await execute({ action: "snapshot" })), /Authenticated/);
    assert.match(JSON.stringify(await execute({ action: "evaluate", text: "localStorage.getItem('saved-login')" })), /yes/);
  } finally {
    const runtime = globalThis.__pioraBrowserRuntime;
    if (runtime?.persistTimer) clearTimeout(runtime.persistTimer);
    await runtime?.persistChain;
    await (await runtime?.contextPromise)?.close();
    if (oldDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldDir;
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

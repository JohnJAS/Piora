// Full Next app verification with isolated data and real Git fixtures. No model or push.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve, relative } from "node:path";
import { chromium } from "playwright-core";
import { isolatedEnvironment, reservePort, startProcess, stopProcess, waitUntil } from "./desktop-e2e/lifecycle.mjs";

const root = resolve(import.meta.dirname, "..");
const directory = join(root, ".verification", `git-tools-${Date.now()}`);
await mkdir(directory, { recursive: true });
const agent = join(directory, "agent"), repo = join(directory, "Piora-demo");
await mkdir(agent); await mkdir(repo);
await writeFile(join(agent, "settings.json"), JSON.stringify({ packages: [], extensions: [], skills: [] }));
await writeFile(join(directory, "tsconfig.json"), JSON.stringify({ extends: "../../tsconfig.json", compilerOptions: { tsBuildInfoFile: "./web.tsbuildinfo" }, include: ["../../**/*.ts", "../../**/*.tsx"] }));
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", windowsHide: true }).trim();
git("init", "-b", "main"); git("config", "user.name", "Piora UI Fixture"); git("config", "user.email", "fixture@example.invalid");
await writeFile(join(repo, "README.md"), "# Git 工具测试\n\n这是隔离的测试项目。\n");
git("add", "."); git("commit", "-m", "Initialize UI fixture");
const other = join(directory, "Piora-demo-worktrees", "layout");
git("worktree", "add", "-b", "codex/layout", other);
await writeFile(join(other, "untracked.txt"), "dirty worktree fixture\n");
await writeFile(join(repo, "README.md"), "# Git 工具\n\n这是隔离的测试项目。\n\n- 查看更改\n- 切换工作树\n- 创建独立任务\n");
const sessionId = randomUUID(), timestamp = new Date().toISOString();
const entries = [{ type: "session", version: 3, id: sessionId, timestamp, cwd: repo }];
let parentId = null;
const append = (value) => { const id = randomUUID().slice(0, 8); entries.push({ ...value, id, parentId, timestamp }); parentId = id; };
const session = {
  getSessionId: () => sessionId,
  appendSessionInfo: name => append({ type: "session_info", name }),
  appendMessage: message => append({ type: "message", message }),
};
session.appendSessionInfo("重构工作树入口");
session.appendMessage({ role: "user", content: "把工作树管理放到对话右上角，方便查看当前分支和更改。", timestamp: Date.now() });
session.appendMessage({ role: "assistant", content: [{ type: "text", text: "工作树入口已整合到右上角的 **Git 工具**。\n\n可以查看当前分支和代码更改，展开工作树列表，并在独立目录中开始新对话。\n\n提交与推送继续使用现有的更改面板。" }], api: "openai-completions", provider: "fixture", model: "fixture", timestamp: Date.now(), stopReason: "stop", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
const sessionDirectory = join(agent, "sessions", `--${repo.replace(/[:\\/]/g, "-")}--`);
await mkdir(sessionDirectory, { recursive: true });
await writeFile(join(sessionDirectory, `${timestamp.replace(/[:.]/g, "-")}_${sessionId}.jsonl`), entries.map(entry => JSON.stringify(entry)).join("\n") + "\n");
const port = await reservePort();
const env = isolatedEnvironment(process.env, { agent, profile: join(directory, "profile"), dist: relative(root, join(directory, "next")).replaceAll("\\", "/"), tsconfig: relative(root, join(directory, "tsconfig.json")).replaceAll("\\", "/"), port: port.port, debugPort: 0 });
const log = createWriteStream(join(directory, "app.log"));
let server, browser;
const report = { status: "running", directory, boundary: "Full Next app, real Git operations, seeded conversation; no real model or Electron package", steps: [], errors: [] };
const step = async (name, action) => { console.log(name); await action(); report.steps.push(name); };
try {
  await port.release();
  server = startProcess(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "-H", "127.0.0.1", "-p", String(port.port), "--turbopack"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  server.child.stdout.pipe(log, { end: false }); server.child.stderr.pipe(log, { end: false });
  const origin = `http://127.0.0.1:${port.port}`;
  console.log(`Starting full app: ${origin}; artifacts: ${directory}`);
  await waitUntil(async () => { try { return (await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } }, { timeoutMs: 240000, intervalMs: 1000 });
  console.log("Warming read-only routes before UI validation");
  for (const route of [`/api/sessions/${session.getSessionId()}?deferThinking=1&deferMedia=1`, `/api/models?cwd=${encodeURIComponent(repo)}`, `/api/worktrees?cwd=${encodeURIComponent(repo)}`, `/api/git/status?cwd=${encodeURIComponent(repo)}&projection=summary`, `/api/agent/${session.getSessionId()}`]) {
    const response = await fetch(`${origin}${route}`, { signal: AbortSignal.timeout(180000) }); await response.text();
  }
  browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : "chromium", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: "zh-CN" });
  page.setDefaultTimeout(90000);
  page.on("pageerror", error => report.errors.push(error.message));
  await page.addInitScript(() => { localStorage.setItem("pi-locale", "zh-CN"); localStorage.setItem("piora-first-run-onboarding:v1", JSON.stringify({ version: 1, status: "dismissed", step: "model" })); });
  await page.goto(`${origin}/?session=${session.getSessionId()}`, { waitUntil: "domcontentloaded", timeout: 600000 });
  const tools = () => page.getByRole("dialog", { name: "Git 工具", exact: true });
  const open = async () => { await page.getByRole("button", { name: "Git 工具", exact: true }).click(); await tools().waitFor(); };
  const expand = async () => { await tools().getByRole("button", { name: "main", exact: true }).click(); await tools().getByText("codex/layout", { exact: true }).waitFor(); };
  await step("open full application and compact Git tools", async () => {
    await page.getByText("把工作树管理放到对话右上角，方便查看当前分支和更改。", { exact: true }).waitFor();
    await open(); assert.equal(await page.locator(".project-worktree-section").count(), 0);
    await tools().getByText("主工作区", { exact: true }).waitFor(); await page.mouse.move(700, 500);
    await page.screenshot({ path: join(directory, "git-tools-overview.png") });
  });
  await step("expand worktrees; Escape returns focus", async () => {
    await expand(); await page.mouse.move(700, 300); await page.screenshot({ path: join(directory, "git-tools-worktrees.png") });
    await page.keyboard.press("Escape"); await tools().waitFor({ state: "hidden" });
    assert.equal(await page.getByRole("button", { name: "Git 工具", exact: true }).evaluate(el => el === document.activeElement), true);
  });
  await step("open existing commit UI on first mount without submitting", async () => {
    await open(); await tools().getByRole("button", { name: /提交或推送/ }).click();
    await page.getByRole("textbox", { name: "提交说明", exact: true }).waitFor(); await page.screenshot({ path: join(directory, "git-tools-commit.png") });
  });
  await step("dirty checkout requires an explicit second confirmation", async () => {
    await open(); await expand(); await tools().getByRole("button", { name: /^移除工作树目录 .*[/\\]layout（保留分支）$/ }).click();
    await tools().getByRole("button", { name: "移除工作树", exact: true }).click(); await tools().getByText(/永久丢弃/).waitFor();
    assert.equal(await readFile(join(other, "untracked.txt"), "utf8"), "dirty worktree fixture\n");
    await page.screenshot({ path: join(directory, "git-tools-dirty-confirm.png") }); await tools().getByRole("button", { name: "取消", exact: true }).click();
  });
  await step("create checkout from UI and open a new conversation", async () => {
    await tools().getByRole("button", { name: /新建工作树/ }).click(); await tools().getByRole("textbox", { name: "分支名称", exact: true }).fill("codex/ui-created");
    await tools().getByRole("button", { name: "创建并打开", exact: true }).click(); await tools().waitFor({ state: "hidden" });
    await open(); await tools().getByRole("button", { name: "codex/ui-created", exact: true }).waitFor();
    assert.match(new URL(page.url()).searchParams.get("cwd"), /codex-ui-created/);
    assert.match(git("worktree", "list", "--porcelain"), /refs\/heads\/codex\/ui-created/); await page.screenshot({ path: join(directory, "git-tools-created.png") });
  });
  await step("reload restores current checkout and narrow popover fits", async () => {
    await page.reload({ waitUntil: "domcontentloaded" }); await open(); await tools().getByRole("button", { name: "codex/ui-created", exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 }); const rect = await tools().boundingBox(); assert.ok(rect.x >= 0 && rect.x + rect.width <= 390);
    await page.screenshot({ path: join(directory, "git-tools-mobile.png") });
  });
  assert.deepEqual(report.errors, []); report.status = "passed";
} catch (error) {
  report.status = "failed"; report.error = String(error.stack || error);
  try {
    const page = browser?.contexts()[0]?.pages()[0];
    if (page) {
      await writeFile(join(directory, "failure.html"), await page.content());
      await page.screenshot({ path: join(directory, "failure.png") });
    }
  } catch {}
  console.error(report.error); process.exitCode = 1;
} finally {
  await browser?.close(); if (server) await stopProcess(server); log.end();
  await writeFile(join(directory, "report.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ status: report.status, directory, steps: report.steps }));
}

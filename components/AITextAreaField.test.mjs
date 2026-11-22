import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const { webpack } = require("next/dist/compiled/webpack/webpack.js");
const repo = path.resolve(import.meta.dirname, "..");
const projectRoot = "C:/fixture/team";
const optimizerModel = { provider: "fixture", modelId: "text-optimizer" };
const defaultModel = { provider: "fixture", modelId: "chat-model" };

async function buildSettingsFixture(directory) {
  const entry = path.join(directory, "entry.tsx");
  const tsLoader = path.join(directory, "typescript.cjs");
  const cssLoader = path.join(directory, "css.cjs");
  await Promise.all([
    writeFile(tsLoader, `
      const ts = require(${JSON.stringify(require.resolve("typescript"))});
      module.exports = (source) => ts.transpileModule(source, {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText;
    `),
    writeFile(cssLoader, String.raw`
      module.exports = (source) => "export default " + JSON.stringify(
        Object.fromEntries([...source.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((match) => [match[1], match[1]]))
      );
    `),
    writeFile(entry, `
      import { createRoot } from "react-dom/client";
      import { RoomSettingsDialog } from "@/components/RoomSettingsDialog";
      import { createRoomChatProfile } from "@/lib/team-agent-templates";
      import { writePromptOptimizerModel } from "@/lib/prompt-optimizer-settings";

      const projectRoot = ${JSON.stringify(projectRoot)};
      const room = {
        id: "fixture-room",
        name: "发布协作",
        projectRoot,
        workspace: { mode: "managed", path: projectRoot + "/shared", label: "共享" },
        coordination: { mode: "manual", coordinatorMemberId: "member", maxConcurrency: 1, leaseDurationMs: 60000 },
        members: [{
          memberId: "member",
          profile: createRoomChatProfile({ name: "小林", role: "coordinator" }),
          binding: { sessionId: "fixture-session", cwd: projectRoot, managedByPiora: true, status: "ready" },
        }],
      };
      writePromptOptimizerModel(${JSON.stringify(optimizerModel)}, localStorage);
      const noop = () => {};
      createRoot(document.getElementById("root")).render(
        <RoomSettingsDialog room={room} onClose={noop} onRoomChange={noop} onRoomDeleted={noop} />
      );
    `),
  ]);
  const compiler = webpack({
    mode: "development",
    target: "web",
    devtool: false,
    entry,
    output: { path: directory, filename: "settings.js" },
    resolve: { extensions: [".tsx", ".ts", ".js"], modules: [path.join(repo, "node_modules"), "node_modules"], alias: { "@": repo } },
    module: {
      parser: { javascript: { dynamicImportMode: "eager" } },
      rules: [
        { test: /\.tsx?$/, exclude: /node_modules/, use: tsLoader },
        { test: /\.css$/, use: cssLoader },
      ],
    },
  });
  await new Promise((resolve, reject) => {
    compiler.run((error, stats) => compiler.close((closeError) => {
      if (error || closeError) reject(error ?? closeError);
      else if (stats.hasErrors()) reject(new Error(stats.toString({ all: false, errors: true })));
      else resolve();
    }));
  });
  const [bundle, globals, settingsCss] = await Promise.all([
    readFile(path.join(directory, "settings.js")),
    readFile(path.join(repo, "app/globals.css"), "utf8"),
    readFile(path.join(repo, "components/RoomSettingsDialog.module.css"), "utf8"),
  ]);
  return { bundle, css: globals.replace(/^@import.*$/gm, "") + settingsCss };
}

test("team settings fields explain their purpose and only replace text when the AI preview is adopted", { timeout: 120_000 }, async (t) => {
  const tempRoot = await realpath(tmpdir());
  const directory = await mkdtemp(path.join(tempRoot, "piora-ai-textarea-"));
  t.after(async () => {
    const resolvedDirectory = await realpath(directory);
    assert.equal(resolvedDirectory, directory);
    assert.equal(path.dirname(resolvedDirectory), tempRoot);
    await rm(directory, { recursive: true, force: true });
  });
  const { bundle, css } = await buildSettingsFixture(directory);
  const browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : "chromium", headless: true });
  const releaseOptimization = Promise.withResolvers();
  let page;
  t.after(async () => {
    releaseOptimization.resolve();
    try {
      await page?.unrouteAll({ behavior: "wait" });
    } finally {
      await browser.close();
    }
  });
  page = await browser.newPage({ viewport: { width: 1200, height: 860 } });
  page.setDefaultTimeout(10_000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const origin = "https://ai-textarea.test";
  const optimizeUrl = origin + "/api/prompts/optimize";
  const original = "检查安装流程，记录失败原因。";
  const optimized = "按步骤检查安装流程，记录每个失败步骤和对应的错误信息。";
  const responses = {
    "/": {
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="root"></div><script src="/settings.js"></script>`,
    },
    "/settings.js": { contentType: "text/javascript; charset=utf-8", body: bundle },
    "/api/sessions": { json: { sessions: [] } },
    "/api/rooms/fixture-room": { json: { audit: [] } },
    "/api/models": {
      json: {
        modelList: [defaultModel, optimizerModel].map(({ provider, modelId }) => ({ provider, id: modelId })),
        defaultModel,
      },
    },
  };
  await page.route(origin + "/**", (route) => route.fulfill(responses[new URL(route.request().url()).pathname] ?? { status: 404 }));
  await page.route(optimizeUrl, async (route) => {
    await releaseOptimization.promise;
    await route.fulfill({ json: { optimizedPrompt: optimized } });
  });
  await page.goto(origin + "/");

  const dialog = page.getByRole("dialog", { name: "协作空间设置" });
  const descriptionField = dialog.locator("label").filter({ has: page.getByText("团队说明", { exact: true }) });
  const description = descriptionField.getByRole("textbox");
  const optimize = descriptionField.getByRole("button", { name: "AI 优化团队说明", exact: true });
  const preview = descriptionField.getByText("优化结果预览", { exact: true });
  await descriptionField.getByText(/^说明团队要解决什么/).waitFor();
  await description.fill(original);

  const [request] = await Promise.all([page.waitForRequest(optimizeUrl), optimize.click()]);
  assert.equal(request.method(), "POST");
  const { prompt, provider, modelId, cwd } = request.postDataJSON();
  assert.deepEqual({ prompt, provider, modelId, cwd }, { prompt: original, ...optimizerModel, cwd: projectRoot });
  assert.equal(await description.inputValue(), original, "the original remains while the model is working");
  assert.equal(await preview.count(), 0);

  releaseOptimization.resolve();
  await preview.waitFor();
  await descriptionField.getByText(optimized, { exact: true }).waitFor();
  assert.equal(await description.inputValue(), original, "displaying the preview leaves the draft unchanged");

  await descriptionField.getByRole("button", { name: "保留原文", exact: true }).click();
  await preview.waitFor({ state: "detached" });
  assert.equal(await description.inputValue(), original, "dismissing the preview keeps the original");

  await optimize.click();
  await preview.waitFor();
  assert.equal(await description.inputValue(), original);
  await descriptionField.getByRole("button", { name: "采用优化结果", exact: true }).click();
  await preview.waitFor({ state: "detached" });
  assert.equal(await description.inputValue(), optimized);

  const nav = dialog.getByRole("navigation", { name: "协作空间设置分类" });
  await nav.getByRole("button", { name: "智能体", exact: true }).click();
  const memberField = dialog.getByRole("article").locator("label").filter({ has: page.getByText("成员设定（可选）", { exact: true }) });
  await memberField.getByRole("textbox").waitFor();
  await memberField.getByText("自由定义擅长领域、性格、说话风格或工作方式；留空也能正常交流。", { exact: true }).waitFor();
  await nav.getByRole("button", { name: "工作区", exact: true }).click();
  const workspaceField = dialog.locator("label").filter({ has: page.getByText("协作约定", { exact: true }) });
  await workspaceField.getByRole("textbox").waitFor();
  await workspaceField.getByText(/^约定文件放哪里/).waitFor();
  await nav.getByRole("button", { name: "概览", exact: true }).click();
  assert.equal(await description.inputValue(), optimized, "the settings draft retains the adopted text across tabs");
  assert.deepEqual(pageErrors, []);
});

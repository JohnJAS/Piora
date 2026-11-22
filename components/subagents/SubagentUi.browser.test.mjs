import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const { webpack } = require("next/dist/compiled/webpack/webpack.js");
const repo = path.resolve(import.meta.dirname, "../..");

test("refactored subagent task card, completion card, inspector timeline, fullResult, switcher, rejected card and profile studio work cleanly", { timeout: 180_000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "piora-subagent-ui-"));
  const artifacts = path.join(repo, ".verification", "subagent-refactor-ui");
  let browser;
  try {
    await mkdir(artifacts, { recursive: true });
    await writeFile(path.join(directory, "ts.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText`);
    await writeFile(path.join(directory, "css.cjs"), `module.exports=function(s){const prefix=require('node:path').basename(this.resourcePath,'.module.css')+'_';const names=Object.fromEntries([...s.matchAll(/\\.([a-zA-Z][\\w-]*)/g)].map(m=>[m[1],prefix+m[1]]));const css=s.replace(/\\.([a-zA-Z][\\w-]*)/g,(_,n)=>'.'+names[n]);return 'const style=document.createElement("style");style.textContent='+JSON.stringify(css)+';document.head.appendChild(style);export default '+JSON.stringify(names)}`);

    await writeFile(path.join(directory, "entry.tsx"), `
      import React, { useState } from "react";
      import { createRoot } from "react-dom/client";
      import { I18nProvider } from "@/hooks/useI18n";
      import { ContinueSubagentContext, OpenSubagentContext } from "@/hooks/useSubagents";
      import { SubagentTaskCard } from "@/components/SubagentTaskCard";
      import { SubagentInspector } from "@/components/SubagentInspector";
      import { SubagentCompletionCard } from "@/components/subagents/SubagentCompletionCard";
      import { SubagentSettings } from "@/components/SubagentSettings";

      const runningSeed = {
        agentId: "agent_live",
        parentSessionId: "session_1",
        parentToolCallId: "tc_live",
        agentType: "Explore",
        description: "梳理子代理模块架构与数据流",
        status: "running",
        background: true,
        startedAt: Date.now() - 18_000,
        attemptStartedAt: Date.now() - 18_000,
        attempt: 1,
        revision: 3,
        model: "anthropic/claude-sonnet-4-6",
        result: "",
        totalTokens: 3420,
        totalToolUseCount: 4,
        currentTool: "grep",
        currentActivity: 'grep · "SubagentRuntime" · lib/subagent-runtime.ts',
      };

      const longSummaryBody = "### 审查结论\\n\\n" + "R".repeat(7_945) + "\\n[Truncated; see child transcript.]";
      const completedSeed = {
        agentId: "agent_done",
        parentSessionId: "session_1",
        parentToolCallId: "tc_done",
        agentType: "reviewer",
        description: "审查 SubagentSettings 与 API 权限校验",
        status: "completed",
        background: true,
        startedAt: Date.now() - 75_000,
        attemptStartedAt: Date.now() - 75_000,
        endedAt: Date.now() - 12_000,
        attempt: 2,
        revision: 9,
        model: "openai/gpt-5",
        result: longSummaryBody,
        resultTruncated: true,
        totalTokens: 12480,
        totalToolUseCount: 7,
      };

      const unavailableSeed = {
        agentId: "agent_missing_full",
        parentSessionId: "session_1",
        parentToolCallId: "tc_missing",
        agentType: "reviewer",
        description: "离线不可恢复摘要卡片",
        status: "completed",
        background: true,
        startedAt: Date.now() - 80_000,
        attemptStartedAt: Date.now() - 80_000,
        endedAt: Date.now() - 20_000,
        attempt: 1,
        revision: 2,
        model: "openai/gpt-5",
        result: "SUMMARY_ONLY_FALLBACK\\n[Truncated; see child transcript.]",
        resultTruncated: true,
        totalTokens: 900,
        totalToolUseCount: 1,
      };

      const rejectedToolResult = {
        role: "toolResult",
        toolCallId: "tc_rejected",
        toolName: "Agent",
        isError: true,
        content: [{ type: "text", text: "Subagent concurrency limit (4) reached." }],
        timestamp: Date.now(),
      };

      function Showcase() {
        const [selection, setSelection] = useState({ parentSessionId: "session_1", agentId: "agent_done" });
        const [wide, setWide] = useState(false);
        const [continued, setContinued] = useState("");
        return (
          <I18nProvider>
            <ContinueSubagentContext.Provider value={record => setContinued(record.agentId)}>
              <OpenSubagentContext.Provider value={next => setSelection(next)}>
                <div style={{ display: "grid", gridTemplateColumns: wide ? "minmax(0, 1fr) 520px" : "minmax(0, 1fr) 372px", minHeight: "100vh", background: "var(--bg)" }}>
                  <main style={{ padding: 24, maxWidth: 820, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
                    <div id="continued-output">{continued}</div>
                    <button type="button" id="open-agent-21" onClick={() => setSelection({ parentSessionId: "session_1", agentId: "agent_21" })}>Open #21</button>
                    <SubagentTaskCard sessionId="session_1" toolCallId="tc_live" toolName="Agent" seed={runningSeed} />
                    <SubagentTaskCard sessionId="session_1" toolCallId="tc_done" toolName="SendMessage" seed={completedSeed} />
                    <SubagentTaskCard sessionId="session_1" toolCallId="tc_rejected" toolName="Agent" input={{ description: "Overflow task" }} toolResult={rejectedToolResult} />
                    <SubagentCompletionCard
                      sessionId="session_1"
                      record={completedSeed}
                      rawText={"<subagent-notification>\\n审查 SubagentSettings 与 API 权限校验: completed\\nagentId: agent_done\\n" + longSummaryBody + "\\n</subagent-notification>"}
                    />
                    <SubagentCompletionCard
                      sessionId="session_1"
                      record={unavailableSeed}
                      rawText={"<subagent-notification>\\n离线不可恢复摘要卡片: completed\\nagentId: agent_missing_full\\n" + unavailableSeed.result + "\\n</subagent-notification>"}
                    />
                    <div style={{ marginTop: 24 }}>
                      <SubagentSettings cwd="F:/Piora" />
                    </div>
                  </main>
                  <aside style={{ borderLeft: "1px solid var(--border)", height: "100vh", position: "sticky", top: 0 }}>
                    {selection && (
                      <SubagentInspector
                        selection={selection}
                        onClose={() => setSelection(null)}
                        onSelect={setSelection}
                        modal={false}
                        expandedWidth={wide}
                        onToggleWidth={() => setWide(v => !v)}
                      />
                    )}
                  </aside>
                </div>
              </OpenSubagentContext.Provider>
            </ContinueSubagentContext.Provider>
          </I18nProvider>
        );
      }
      createRoot(document.getElementById("root")).render(<Showcase />);
    `);

    const compiler = webpack({
      mode: "development",
      target: "web",
      devtool: false,
      entry: path.join(directory, "entry.tsx"),
      output: { path: directory, filename: "bundle.js", publicPath: "/" },
      resolve: { extensions: [".tsx", ".ts", ".js"], modules: [path.join(repo, "node_modules"), "node_modules"], alias: { "@": repo } },
      module: {
        rules: [
          { test: /\.tsx?$/, exclude: /node_modules/, use: path.join(directory, "ts.cjs") },
          { test: /\.css$/, use: path.join(directory, "css.cjs") },
        ],
      },
    });
    await new Promise((resolve, reject) => compiler.run((error, stats) => compiler.close(() => (
      error || stats.hasErrors() ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve()
    ))));

    const preflight = await readFile(path.join(repo, "node_modules/tailwindcss/preflight.css"), "utf8");
    const globalCss = (await readFile(path.join(repo, "app/globals.css"), "utf8")).replace(/^@import.*$/gm, "");
    const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${preflight}\n${globalCss}body{margin:0;background:var(--bg);color:var(--text);font-family:var(--ui-font-family)}</style><div id="root"></div><script src="/bundle.js"></script>`;

    browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : "chromium", headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: "zh-CN" });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem("pi-locale", "zh-CN");
      window.__copiedTexts = [];
      window.piDesktop = {
        clipboard: {
          writeText: async text => { window.__copiedTexts.push(text); },
        },
      };
    });

    let settings = { limitsVersion: 1, enabled: true, maxConcurrency: 4, timeoutSeconds: 300, maxTokens: 0, maxResultChars: 8_000, disabledProfiles: [], modelOverrides: {} };
    let profiles = [
      { name: "general-purpose", source: "built-in", description: "Independent work", systemPrompt: "Complete tasks cleanly.", maxTurns: 30 },
      { name: "Explore", source: "built-in", description: "Read-only exploration", systemPrompt: "Explore read-only.", tools: ["read", "grep", "find", "ls"], maxTurns: 20 },
      { name: "locked", source: "project", description: "Zero-tool agent", systemPrompt: "Analyze text only.", tools: [], disallowedTools: ["bash", "write"], maxTurns: 10 },
    ];
    const savedProfilePayloads = [];
    const summary8k = "### 审查结论\n\n" + "R".repeat(7_945) + "\n[Truncated; see child transcript.]";
    const fullResultText = `${summary8k.replace("\n[Truncated; see child transcript.]", "")}${"Z".repeat(4_100)}\n\nFULL_RESULT_TAIL_MARKER`;
    assert.ok(fullResultText.length > 12_000);
    const recordsMap = {
      agent_live: {
        agentId: "agent_live", parentSessionId: "session_1", parentToolCallId: "tc_live",
        agentType: "Explore", description: "梳理子代理模块架构与数据流", status: "running", background: true,
        startedAt: Date.now() - 18_000, attemptStartedAt: Date.now() - 18_000, attempt: 1, revision: 3,
        model: "anthropic/claude-sonnet-4-6", result: "", totalTokens: 3420, totalToolUseCount: 4,
        currentTool: "grep", currentActivity: 'grep · "SubagentRuntime" · lib/subagent-runtime.ts',
      },
      agent_done: {
        agentId: "agent_done", parentSessionId: "session_1", parentToolCallId: "tc_done",
        agentType: "reviewer", description: "审查 SubagentSettings 与 API 权限校验", status: "completed", background: true,
        startedAt: Date.now() - 75_000, attemptStartedAt: Date.now() - 75_000, endedAt: Date.now() - 12_000,
        attempt: 2, revision: 9, model: "openai/gpt-5",
        result: summary8k,
        resultTruncated: true,
        totalTokens: 12480, totalToolUseCount: 7,
      },
      agent_missing_full: {
        agentId: "agent_missing_full", parentSessionId: "session_1", parentToolCallId: "tc_missing",
        agentType: "reviewer", description: "离线不可恢复摘要卡片", status: "completed", background: true,
        startedAt: Date.now() - 80_000, attemptStartedAt: Date.now() - 80_000, endedAt: Date.now() - 20_000,
        attempt: 1, revision: 2, model: "openai/gpt-5",
        result: "SUMMARY_ONLY_FALLBACK\\n[Truncated; see child transcript.]",
        resultTruncated: true,
        totalTokens: 900, totalToolUseCount: 1,
      },
    };
    const allSiblings = [
      recordsMap.agent_live,
      recordsMap.agent_done,
      ...Array.from({ length: 19 }, (_, idx) => ({
        agentId: `agent_${idx + 3}`,
        parentSessionId: "session_1",
        parentToolCallId: `tc_${idx + 3}`,
        agentType: "Explore",
        description: `子任务 #${idx + 3}`,
        status: "completed",
        background: false,
        startedAt: Date.now() - (100 + idx) * 1000,
        attemptStartedAt: Date.now() - (100 + idx) * 1000,
        endedAt: Date.now() - (90 + idx) * 1000,
        attempt: 1,
        revision: 1,
        result: `Result #${idx + 3}`,
        totalTokens: 50,
        totalToolUseCount: 1,
      })),
    ];
    recordsMap.agent_21 = allSiblings[20];
    const transcript = {
      entries: [
        { id: "e1", role: "user", text: "请审查 SubagentSettings 的自定义配置保存逻辑与安全边界。", timestamp: Date.now() - 74_000 },
        { id: "e2", role: "toolCall", toolName: "read", toolSummary: "lib/subagents/profile-manager.ts", toolCallId: "c-1", text: "", timestamp: Date.now() - 60_000 },
        { id: "e2b", role: "toolCall", toolName: "ls", toolSummary: "lib/subagents", toolCallId: "c-2", text: "", timestamp: Date.now() - 60_000 },
        { id: "e3", role: "toolResult", toolName: "read", toolCallId: "c-1", text: "export function saveCustomSubagentProfile(...) { ... }", timestamp: Date.now() - 59_000 },
        { id: "e4", role: "assistant", text: "已确认 `assertWithinDirectory` 覆盖了所有写入和重命名清理路径。", timestamp: Date.now() - 20_000 },
      ],
      before: null,
    };

    await page.route("http://subagent-ui.test/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/agent/session_1/subagents") {
        if (url.searchParams.get("view") === "list") {
          const offset = Number(url.searchParams.get("offset") ?? "0");
          const slice = allSiblings.slice(offset, offset + 20);
          return route.fulfill({
            json: { records: slice, total: allSiblings.length, nextOffset: offset + 20 < allSiblings.length ? offset + 20 : null },
          });
        }
        const id = url.searchParams.get("agentId") ?? "agent_done";
        const rec = recordsMap[id];
        return route.fulfill({
          json: {
            records: rec ? [rec] : [],
            ...(url.searchParams.get("transcript") === "true" ? { transcript } : {}),
            ...(url.searchParams.get("fullResult") === "true"
              ? { fullResult: id === "agent_done" ? fullResultText : id === "agent_missing_full" ? null : rec?.result ?? null }
              : {}),
          },
        });
      }
      if (url.pathname === "/api/settings/subagents") {
        if (route.request().method() === "PUT") settings = route.request().postDataJSON();
        return route.fulfill({ json: { settings, profiles, warnings: [], hasProjectScope: true } });
      }
      if (url.pathname === "/api/settings/subagents/profiles") {
        const body = route.request().postDataJSON();
        savedProfilePayloads.push(body);
        if (route.request().method() === "POST") {
          const nextProfile = {
            name: body.name,
            source: body.scope,
            description: body.description,
            systemPrompt: body.systemPrompt,
            tools: body.tools,
            disallowedTools: body.disallowedTools,
            model: body.model,
            maxTurns: body.maxTurns,
            background: body.background,
          };
          profiles = [...profiles.filter(p => p.name !== body.previousName && p.name !== body.name), nextProfile];
          return route.fulfill({ json: { profile: nextProfile, profiles, warnings: [], settings } });
        }
        if (route.request().method() === "DELETE") {
          profiles = profiles.filter(p => p.name !== body.name);
          return route.fulfill({ json: { deleted: true, profiles, warnings: [], settings } });
        }
      }
      if (url.pathname === "/api/models") {
        return route.fulfill({
          json: {
            models: {},
            modelList: [
              { provider: "anthropic", id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
              { provider: "openai", id: "gpt-5", name: "GPT-5" },
            ],
          },
        });
      }
      if (url.pathname === "/api/agent/running") return route.fulfill({ json: { runningSessions: [] } });
      if (url.pathname.endsWith(".js")) return route.fulfill({ contentType: "text/javascript", body: await readFile(path.join(directory, path.basename(url.pathname))) });
      if (url.pathname.startsWith("/fonts/")) return route.fulfill({ contentType: "font/woff2", body: await readFile(path.join(repo, "public", url.pathname.slice(1))) });
      return route.fulfill({ contentType: "text/html", body: html });
    });

    await page.goto("http://subagent-ui.test/");
    const inspector = page.locator('[data-subagent-inspector="agent_done"]');
    await inspector.locator('[data-subagent-role="toolCall"]').first().waitFor();

    // 1. Completion card strips XML tags and displays clean Markdown content
    const completion = page.locator('[data-subagent-completion="agent_done"]');
    await completion.waitFor();
    const completionText = await completion.innerText();
    assert.ok(!completionText.includes("<subagent-notification>"), "raw XML tags must not appear in completion card");
    assert.ok(completionText.includes("审查结论"));

    // N6: Completion card copy button recovers full 12k result identical to inspector copy button
    await completion.locator("[data-subagent-copy-result]").click();
    await page.waitForFunction(() => window.__copiedTexts.length === 1);
    await inspector.locator("[data-subagent-copy-result]").click();
    await page.waitForFunction(() => window.__copiedTexts.length === 2);
    const copiedPair = await page.evaluate(() => window.__copiedTexts);
    assert.equal(copiedPair[0], fullResultText, "completion card must copy the full recovered result");
    assert.equal(copiedPair[0], copiedPair[1], "completion card and inspector must copy byte-identical full text");
    assert.ok(copiedPair[0].endsWith("FULL_RESULT_TAIL_MARKER"));

    // N6 fallback: when fullResult is unavailable (null), completion card copies summary & surfaces explicit notice
    const missingCompletion = page.locator('[data-subagent-completion="agent_missing_full"]');
    await missingCompletion.locator("[data-subagent-copy-result]").click();
    await missingCompletion.locator("[data-subagent-copy-status]").waitFor();
    assert.match(await missingCompletion.locator("[data-subagent-copy-status]").innerText(), /已复制摘要/);
    assert.equal((await page.evaluate(() => window.__copiedTexts)).at(-1), "SUMMARY_ONLY_FALLBACK\n[Truncated; see child transcript.]");

    // 2. Live running card shows live tool activity strip
    const runningCard = page.locator('[data-subagent-id="agent_live"]');
    assert.ok((await runningCard.innerText()).includes("SubagentRuntime"));

    // 3. R9: Pre-launch rejected card shows real failure reason instead of "正在启动子代理…"
    const rejectedCard = page.locator('[data-subagent-id="pending"]');
    assert.equal(await rejectedCard.getAttribute("data-subagent-status"), "failed");
    const rejectedText = await rejectedCard.innerText();
    assert.ok(!rejectedText.includes("正在启动子代理"), "rejected card must not stay in waiting state");
    assert.ok(rejectedText.includes("Subagent concurrency limit (4) reached."));

    // 4. R5: Truncated result expands via fullResult=true to show tail marker
    await inspector.locator("[data-subagent-expand-result]").click();
    await inspector.getByText("FULL_RESULT_TAIL_MARKER", { exact: false }).waitFor();

    // 5. R10: Timeline shows multiple toolCalls and filters cleanly to tools-only
    assert.ok((await inspector.innerText()).includes("lib/subagents/profile-manager.ts"));
    await inspector.getByRole("button", { name: /^工具/ }).click();
    assert.equal(await inspector.locator('[data-subagent-role="user"]').count(), 0);
    assert.equal(await inspector.locator('[data-subagent-role="toolCall"]').count(), 2);
    await inspector.getByRole("button", { name: /^全部/ }).click();

    // 6. Continue-in-chat button triggers callback without placing any textarea in inspector
    assert.equal(await inspector.locator("textarea").count(), 0);
    await inspector.getByRole("button", { name: "在对话中继续" }).click();
    assert.equal(await page.locator("#continued-output").textContent(), "agent_done");

    // 7. R11: 21st subagent stays selected in switcher (never jumps to page 1 item 1) and supports Load more
    await page.locator("#open-agent-21").click();
    const inspector21 = page.locator('[data-subagent-inspector="agent_21"]');
    await inspector21.locator("h2", { hasText: "子任务 #21" }).waitFor();
    const switcher21 = inspector21.getByRole("combobox", { name: "切换本对话中的子代理" });
    assert.equal(await switcher21.inputValue(), "agent_21");
    await inspector21.locator("[data-subagent-switcher-more]").click();
    assert.equal(await switcher21.locator("option").count(), 21);
    await switcher21.selectOption("agent_done");
    await inspector.waitFor();

    // 8. R2: Editing ONLY description on `locked` preserves tools:[] and disallowedTools:["bash","write"]
    const settingsCard = page.locator('[data-settings-id="laboratory.subagents"]');
    await settingsCard.locator("summary").click();
    await page.screenshot({ path: path.join(artifacts, "light-showcase.png"), fullPage: true, animations: "disabled" });

    const lockedCard = settingsCard.locator('[data-subagent-profile="locked"]');
    await lockedCard.getByRole("button", { name: "编辑" }).click();
    const editor = page.getByTestId("subagent-profile-editor");
    await editor.waitFor();
    const descInput = editor.locator('input[placeholder*="一句话"]');
    await descInput.fill("Updated description only");
    await editor.getByRole("button", { name: "保存代理" }).click();
    await editor.waitFor({ state: "hidden" });
    const editPayload = savedProfilePayloads.at(-1);
    assert.equal(editPayload.description, "Updated description only");
    assert.deepEqual(editPayload.tools, [], "editing description must preserve explicit tools: []");
    assert.deepEqual(editPayload.disallowedTools, ["bash", "write"], "editing description must preserve disallowedTools");

    // 9. Create a custom profile from template via visual editor modal
    await settingsCard.getByRole("button", { name: "代码审查员" }).click();
    await editor.waitFor();
    await page.screenshot({ path: path.join(artifacts, "light-profile-editor.png"), animations: "disabled" });
    await editor.getByRole("button", { name: "保存代理" }).click();
    await editor.waitFor({ state: "hidden" });
    await settingsCard.locator('[data-subagent-profile="reviewer"]').waitFor();

    // 10. Dark mode visual check & screenshot
    await page.evaluate(() => {
      document.documentElement.classList.add("dark");
      document.documentElement.dataset.theme = "dark";
    });
    await page.screenshot({ path: path.join(artifacts, "dark-showcase.png"), fullPage: true, animations: "disabled" });

    assert.deepEqual(errors, []);
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await page.close();
  } finally {
    await browser?.close();
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});

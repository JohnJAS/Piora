import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { ChatInput, ModelErrorBanner, ModelScopeWarningBanner, filterModelOptions, getContextRemainingPercent, joinSpeechText } = await jiti.import("./ChatInput.tsx");
// Import through the same tsconfig alias used by the component so Jiti reuses
// the exact context module instead of creating a second provider instance.
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const globalCss = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const chatInputSource = readFileSync(new URL("./ChatInput.tsx", import.meta.url), "utf8");

test("uses an ordinary cursor for the session information hover", () => {
  assert.match(globalCss, /\.session-stats-trigger\s*\{[^}]*cursor:\s*default/s);
  assert.doesNotMatch(globalCss, /\.session-stats-trigger\s*\{[^}]*cursor:\s*help/s);
});

test("renders the upstream model error", () => {
  const html = renderToStaticMarkup(
    React.createElement(ModelErrorBanner, {
      error: "Invalid models.json schema:\nproviders.custom.models.0.id must not be empty",
    }),
  );

  assert.match(html, /role="alert"/);
  assert.match(html, /模型错误/);
  assert.match(html, /providers\.custom\.models\.0\.id must not be empty/);
});

test("does not render an empty model error", () => {
  assert.equal(renderToStaticMarkup(React.createElement(ModelErrorBanner, { error: null })), "");
});

test("renders enabledModels scope warnings", () => {
  const html = renderToStaticMarkup(
    React.createElement(ModelScopeWarningBanner, {
      warnings: ['No models match pattern "ghost-gateway/*"'],
    }),
  );

  assert.match(html, /模型范围警告/);
  assert.match(html, /ghost-gateway/);
  assert.equal(renderToStaticMarkup(React.createElement(ModelScopeWarningBanner, { warnings: [] })), "");
});

test("keeps the model selector visible when a model error leaves no options", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        onModelChange() {},
        isStreaming: false,
        modelError: "Invalid models.json schema",
        modelList: [],
        modelNames: {},
      }),
    ),
  );

  assert.match(html, />没有可用模型</);
  assert.match(html, /title="没有可用模型"/);
});

test("uses one composer chip for model and reasoning without a speed setting", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        onModelChange() {},
        onThinkingLevelChange() {},
        isStreaming: false,
        model: { provider: "openai", modelId: "gpt-5" },
        modelList: [{ provider: "openai", id: "gpt-5", name: "GPT-5" }],
        thinkingLevel: "high",
      }),
    ),
  );

  assert.match(html, /class="model-settings-trigger-label">GPT-5/);
  assert.match(html, /class="model-settings-trigger-reasoning">高/);
  assert.match(chatInputSource, /createPortal\(/);
  assert.match(chatInputSource, /model-settings-row-value/);
  assert.match(chatInputSource, /desktopPanelLeft/);
  assert.match(chatInputSource, /submenuCenter/);
  assert.match(chatInputSource, /position: "fixed"/);
  assert.match(chatInputSource, /transform: "translateX\(-50%\)"/);
  assert.match(chatInputSource, /width: submenuWidth/);
  assert.doesNotMatch(chatInputSource, /chat\.speed|model-settings-speed/);
});

test("filters model options by name and id", () => {
  const options = [
    { provider: "ollama", modelId: "qwen3:latest", name: "Qwen 3" },
    { provider: "anthropic", modelId: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    { provider: "openai", modelId: "gpt-5.4", name: "GPT-5.4" },
  ];

  assert.deepEqual(filterModelOptions(options, "QWEN"), [options[0]]);
  assert.deepEqual(filterModelOptions(options, "claude-sonnet"), [options[1]]);
  assert.equal(filterModelOptions(options, "OpenAI").length, 0);
  assert.equal(filterModelOptions(options, "anthropic/claude").length, 0);
  assert.equal(filterModelOptions(options, "missing").length, 0);
  assert.equal(filterModelOptions(options, "  "), options);
});

test("derives remaining context from live token counts", () => {
  assert.equal(getContextRemainingPercent({ percent: 99, contextWindow: 200_000, tokens: 50_000 }), 75);
  assert.equal(getContextRemainingPercent({ percent: 35, contextWindow: 200_000, tokens: null }), 65);
  assert.equal(getContextRemainingPercent({ percent: 130, contextWindow: 200_000, tokens: null }), 0);
  assert.equal(getContextRemainingPercent({ percent: null, contextWindow: 200_000, tokens: null }), null);
});

test("inserts dictated text at the caret with locale-aware spacing", () => {
  assert.deepEqual(joinSpeechText("请帮我", " 修复这个问题 ", "谢谢", "zh-CN"), {
    value: "请帮我修复这个问题谢谢",
    selection: 9,
  });
  assert.deepEqual(joinSpeechText("Please", " fix this ", "today", "en-US"), {
    value: "Please fix this today",
    selection: 15,
  });
  assert.deepEqual(joinSpeechText("", " hello ", "", "en-US"), {
    value: "hello",
    selection: 5,
  });
});

test("keeps voice dictation user-controlled and progressive", () => {
  assert.match(chatInputSource, /useLocalDictation/);
  assert.match(chatInputSource, /voiceTranscribing/);
  assert.match(chatInputSource, /webkitSpeechRecognition/);
  assert.match(chatInputSource, /recognition\.continuous = true/);
  assert.match(chatInputSource, /recognition\.interimResults = true/);
  assert.match(chatInputSource, /aria-pressed=\{voiceListening\}/);
  assert.match(chatInputSource, /stopVoiceInput\(true\);[\s\S]*?setValue\(""\)/);
});

test("renders an icon-only send control and dynamic context ring", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        onModelChange() {},
        isStreaming: false,
        model: { provider: "openai", modelId: "gpt-5" },
        modelList: [{ provider: "openai", id: "gpt-5", name: "GPT-5" }],
        contextUsage: { percent: 40, contextWindow: 100_000, tokens: 40_000 },
        sessionStats: {
          sessionId: "session-1",
          sessionName: "Icon migration task",
          userMessages: 3,
          assistantMessages: 2,
          toolCalls: 4,
          toolResults: 4,
          totalMessages: 9,
          tokens: { input: 1_000, output: 500, cacheRead: 250, cacheWrite: 0, total: 1_750 },
          cost: 0.0123,
        },
      }),
    ),
  );

  assert.match(html, /aria-label="发送"/);
  assert.doesNotMatch(html, />Send<\/button>/);
  assert.match(html, /data-context-used="40\.00"/);
  assert.match(html, /stroke-dasharray="40 60"/);
  assert.match(html, /上下文窗口/);
  assert.match(html, /40% 已用/);
  assert.match(html, /已用 40k 个令牌，共 100k/);
  assert.match(html, /data-model-brand="openai"/);
  assert.doesNotMatch(html, /<button[^>]*data-context-used/);
  assert.ok(html.indexOf("data-context-used") < html.indexOf('title="选择模型"'));
  assert.match(html, /class="session-stats-tooltip"/);
  assert.match(html, /class="session-stats-tooltip-title">会话信息</);
  assert.doesNotMatch(html, /class="session-stats-tooltip-title">Icon migration task</);
  assert.match(html, /width="18" height="18"[^>]*stroke-width="1\.75"[^>]*><path d="M5 21v-6"/);
  assert.match(html, /消息/);
  assert.match(html, /1,750/);
});

test("uses the model family icon even when the provider is a custom gateway", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        onModelChange() {},
        isStreaming: false,
        model: { provider: "acme-gateway", modelId: "deepseek-v4-flash" },
        modelList: [{ provider: "acme-gateway", id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }],
      }),
    ),
  );

  assert.match(html, /data-model-brand="deepseek"/);
  assert.doesNotMatch(html, /data-model-brand="custom"/);
});

test("renders an icon-only stop control", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        isStreaming: true,
      }),
    ),
  );

  assert.match(html, /aria-label="停止智能体"/);
  assert.doesNotMatch(html, />Steer</);
  assert.doesNotMatch(html, />Send directly</);
});

test("renders queued guidance as a compact composer tray", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        onRecallQueue() {},
        isStreaming: true,
        queuedMessages: {
          steering: ["Adjust the spacing around the composer"],
          followUp: ["Run the visual check afterward"],
        },
      }),
    ),
  );

  assert.match(html, /class="composer-queue-tray"/);
  assert.match(html, /class="composer-queue-row is-steer"/);
  assert.match(html, /class="composer-queue-row is-follow-up"/);
  assert.match(html, />引导</);
  assert.match(html, />排队</);
  assert.match(html, /aria-label="移回输入框"/);
  assert.doesNotMatch(html, /class="composer-shell" title="Adjust the spacing/);
});

test("keeps an unknown context ring visible before runtime usage is available", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        isStreaming: false,
      }),
    ),
  );

  assert.match(html, /data-context-used="unknown"/);
  assert.match(html, /stroke-dasharray="3 6"/);
});

test("designs prompt optimization as a preview before replacing the draft", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        isStreaming: false,
        model: { provider: "openai", modelId: "gpt-5" },
      }),
    ),
  );

  assert.match(html, /aria-label="优化提示词"/);
  assert.match(html, /class="prompt-optimize-button"/);
  assert.match(chatInputSource, /fetch\("\/api\/prompts\/optimize"/);
  assert.match(chatInputSource, /prompt-optimization-review/);
  assert.match(chatInputSource, /chat\.keepOriginalPrompt/);
  assert.match(chatInputSource, /chat\.useOptimizedPrompt/);
  assert.match(
    chatInputSource,
    /className="is-primary"[\s\S]*?onClick=\{\(\) => \{[\s\S]*?setValue\(promptOptimization\.result!\)[\s\S]*?chat\.useOptimizedPrompt/,
  );
});

test("renders compact errors above the input as a wrapping alert", () => {
  const error = "Compaction failed: OpenAI API error (403): <html>request forbidden</html>";
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        onCompact() {},
        isStreaming: false,
        compactError: error,
      }),
    ),
  );

  assert.match(html, /role="alert"/);
  assert.match(html, /Compaction failed: OpenAI API error/);
  assert.match(html, /&lt;html&gt;request forbidden&lt;\/html&gt;/);
  assert.match(html, /white-space:pre-wrap/);
  assert.ok(html.indexOf('role="alert"') < html.indexOf("<textarea"));
});

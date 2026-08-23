import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { MessageView, getUserMessagePreview } = await jiti.import("./MessageView.tsx");
// Import through the same tsconfig alias used by the component so Jiti reuses
// the exact context module instead of creating a second provider instance.
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

function renderMessage(message, props = {}) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(MessageView, { message, ...props }),
    ),
  );
}

test("collapses long user queries to an eight-line preview", () => {
  const content = Array.from({ length: 20 }, (_, index) => `log line ${index + 1}`).join("\n");
  const preview = getUserMessagePreview(content);
  const html = renderMessage({ role: "user", content, timestamp: Date.now() });

  assert.equal(preview.collapsible, true);
  assert.equal(preview.lineCount, 20);
  assert.match(preview.preview, /log line 8$/);
  assert.doesNotMatch(preview.preview, /log line 9/);
  assert.match(html, /class="message-user-expand"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /展开完整消息 · 20 行/);
  assert.doesNotMatch(html, /log line 9/);
});

test("renders short user queries without an expand control", () => {
  const html = renderMessage({ role: "user", content: "one\ntwo\nthree", timestamp: Date.now() });
  assert.doesNotMatch(html, /message-user-expand/);
});

test("renders a provider error when the assistant message has no content", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [],
    stopReason: "error",
    errorMessage: "OpenAI API error (403): <html>request forbidden</html>",
  });

  assert.match(html, /role="alert"/);
  assert.match(html, /Error: OpenAI API error \(403\)/);
  assert.match(html, /&lt;html&gt;request forbidden&lt;\/html&gt;/);
});

test("renders the final response duration in the assistant footer", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    timestamp: 12_500,
    content: [{ type: "text", text: "Done" }],
  }, { showTimestamp: true, responseStartedAt: 10_000 });

  assert.match(html, /响应耗时 2\.5s/);
  assert.match(html, /message-response-meta/);
});

test("renders partial assistant content before the provider error", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [{ type: "text", text: "Partial response" }],
    stopReason: "error",
    errorMessage: "Connection closed",
  });

  assert.match(html, /Partial response/);
  assert.match(html, /Error: Connection closed/);
});

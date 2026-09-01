import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { findVisionAgentStatus, VisionAgentStatus } = await jiti.import("./VisionAgentStatus.tsx");
const t = (key, params) => ({
  "chat.visionAnalyzingOne": "正在使用视觉模型识别图片…",
  "chat.visionAnalyzingMany": `正在使用视觉模型识别 ${params?.count} 张图片…`,
  "chat.visionReady": "图片识别完成，正在生成回答…",
  "chat.visionFailedTitle": "图片识别失败",
  "chat.visionFailedBody": "原图没有发送给当前仅支持文本的模型。",
  "chat.visionRetry": "重试识别",
  "chat.visionConfigure": "配置视觉模型",
  "chat.visionFailureDetails": "查看原因",
})[key] ?? key;

test("finds only the visual agent status among extension statuses", () => {
  assert.deepEqual(findVisionAgentStatus([
    { key: "memory", text: "ready" },
    { key: "piora-vision-agent", text: "Analyzing 2 images…" },
  ]), { phase: "analyzing", imageCount: 2 });
});

test("renders active image analysis as a polite, indeterminate inline status", () => {
  const html = renderToStaticMarkup(React.createElement(VisionAgentStatus, {
    status: { phase: "analyzing", imageCount: 2 },
    t,
  }));
  assert.match(html, /class="vision-agent-progress"/);
  assert.match(html, /role="status"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /正在使用视觉模型识别 2 张图片/);
});

test("renders a persistent failure with retry, configuration, and private details on demand", () => {
  const html = renderToStaticMarkup(React.createElement(VisionAgentStatus, {
    status: { phase: "failed", reason: "credential expired" },
    t,
    onRetry() {},
    onConfigure() {},
  }));
  assert.match(html, /role="alert"/);
  assert.match(html, /重试识别/);
  assert.match(html, /配置视觉模型/);
  assert.match(html, /<details>/);
  assert.match(html, /credential expired/);
});

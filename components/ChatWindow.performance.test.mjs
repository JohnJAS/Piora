import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const inputSource = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const scrollRailSource = await readFile(new URL("./ChatScrollRail.tsx", import.meta.url), "utf8");
const globalCss = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const resizerSource = await readFile(new URL("../hooks/useResizablePanel.ts", import.meta.url), "utf8");

test("memoizes historical chat metadata away from streaming token renders", () => {
  assert.match(source, /const chatRenderMetadata = useMemo/);
  assert.match(source, /\}, \[messages\]\);/);
  assert.match(source, /const \{ toolResultsMap, visibleRefIndexByMessage, lastUserIdx, lastAnchorIdx \} = chatRenderMetadata/);
});

test("long chat rows use browser rendering containment", () => {
  assert.match(source, /className="chat-message-shell"/);
  assert.match(source, /const rendered: Array<\(\) => ReactNode> = \[\]/);
  assert.match(source, /rendered\.slice\(startIndex\)\.map\(\(render\) => render\(\)\)/);
  assert.doesNotMatch(source, /const rendered: ReactNode\[\]/);
});

test("materializes only the visible history tail", () => {
  assert.match(source, /rendered\.push\(\(\) => renderMessage\(messageIndex\)\)/);
  assert.match(source, /Build cheap factories for the full history/);
});

test("uses a responsive conversation column with resize and scroll rails", () => {
  assert.match(source, /followDefaultWidth:\s*true/);
  assert.match(source, /const CHAT_COLUMN_LEFT_PADDING = 36/);
  assert.match(source, /surfaceWidth - CHAT_COLUMN_LEFT_PADDING - CHAT_INPUT_RIGHT_PADDING/);
  assert.match(source, /className="chat-column"/);
  assert.match(source, /chat-column-resize-handle is-left/);
  assert.match(source, /data-resize-growth-direction="left"/);
  assert.doesNotMatch(source, /chat-column-resize-handle is-right/);
  assert.match(source, /<ChatScrollRail/);
  assert.match(source, /id="chat-scroll-container"/);
  assert.doesNotMatch(source, /maxWidth:\s*820/);
  assert.match(inputSource, /className="composer-column"/);
  assert.doesNotMatch(inputSource, /maxWidth:\s*820/);
  assert.match(globalCss, /--chat-column-width, clamp\(820px, 72vw, 1180px\)/);
  assert.match(globalCss, /\.chat-column-resize-handle\.is-left\s*\{[\s\S]*?left:\s*max\(2px,/);
  assert.match(inputSource, /paddingLeft:\s*variant === "launcher" \? 0 : isMobile \? 16 : 36/);
  assert.match(globalCss, /\.chat-column-scroll-rail/);
  assert.match(globalCss, /\.chat-column-scroll-thumb/);
  assert.match(globalCss, /\.chat-column-scroll-rail\s*\{[^}]*right:\s*calc\(38px \+ max\(0px, \(100% - 88px/s);
  assert.match(globalCss, /\.chat-column-scroll-rail\s*\{[^}]*cursor:\s*default/s);
  assert.match(globalCss, /\.chat-column-scroll-thumb\s*\{[^}]*width:\s*6px[^}]*opacity:\s*0\.78/s);
  assert.match(scrollRailSource, /role="scrollbar"/);
  assert.match(scrollRailSource, /onPointerMove/);
  assert.match(scrollRailSource, /onWheel/);
  assert.match(scrollRailSource, /event\.key === "PageDown"/);
  assert.match(resizerSource, /drag\.growthDirection === "right"/);
  assert.match(resizerSource, /readGrowthDirection\(event\.currentTarget, growthDirection\)/);
});

test("replaces the native conversation scrollbar with the draggable scroll rail", () => {
  assert.match(source, /id="chat-scroll-container"[^>]*className="chat-scroll-container flex-1 overflow-y-auto pt-4"/);
  assert.match(globalCss, /\.chat-scroll-container\s*\{[\s\S]*?scrollbar-width:\s*none/);
  assert.match(globalCss, /\.chat-scroll-container::\-webkit-scrollbar\s*\{[\s\S]*?display:\s*none/);
});

test("manual scrolling keeps the jump-to-latest control visible and resumes live follow", () => {
  assert.match(source, /const shouldShow = liveOutputFollowPaused \|\| shouldShowScrollToBottom/);
  assert.match(source, /t\(liveOutputFollowPaused \? "chat\.resumeAutoScroll" : "chat\.scrollToBottom"\)/);
  assert.match(source, /onClick=\{handleScrollToBottom\}/);
});

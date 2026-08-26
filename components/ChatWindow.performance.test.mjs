import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

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

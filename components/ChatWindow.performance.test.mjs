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
  assert.match(source, /rendered\.slice\(startIndex\)/);
});

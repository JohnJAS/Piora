import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("../desktop/src/main.ts", import.meta.url), "utf8");
const state = readFileSync(new URL("../desktop/src/desktop-state.ts", import.meta.url), "utf8");
const preload = readFileSync(new URL("../desktop/src/preload.ts", import.meta.url), "utf8");
const drag = readFileSync(new URL("../hooks/useDragDrop.ts", import.meta.url), "utf8");

test("desktop stage three capabilities remain explicit and IPC-scoped", () => {
  assert.match(main, /requestSingleInstanceLock/);
  assert.match(main, /readMainWindowState/);
  assert.match(main, /writeMainWindowState/);
  assert.match(main, /webContents\.on\("context-menu"/);
  assert.match(main, /new Tray/);
  assert.match(main, /globalShortcut\.register/);
  assert.match(main, /isTrustedMainWindowSender/);
  assert.match(state, /maximized: boolean/);
  assert.match(preload, /pi:set-global-shortcut/);
  assert.match(drag, /item\.kind === "file"/);
});

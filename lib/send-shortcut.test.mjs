import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  DEFAULT_SEND_SHORTCUT,
  SEND_SHORTCUT_STORAGE_KEY,
  isPlainEnter,
  matchesSendShortcut,
  parseStoredSendShortcut,
} = await jiti.import("./send-shortcut.ts");

function keyEvent(overrides = {}) {
  return {
    key: "Enter",
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...overrides,
  };
}

test("defaults invalid or missing preferences to Enter", () => {
  assert.equal(DEFAULT_SEND_SHORTCUT, "enter");
  assert.equal(SEND_SHORTCUT_STORAGE_KEY, "piora-send-shortcut:v1");
  assert.equal(parseStoredSendShortcut(null), "enter");
  assert.equal(parseStoredSendShortcut("invalid"), "enter");
  assert.equal(parseStoredSendShortcut("ctrl-enter"), "ctrl-enter");
});

test("Enter mode sends only on an unmodified Enter key", () => {
  assert.equal(matchesSendShortcut(keyEvent(), "enter"), true);
  assert.equal(isPlainEnter(keyEvent()), true);
  assert.equal(matchesSendShortcut(keyEvent({ ctrlKey: true }), "enter"), false);
  assert.equal(matchesSendShortcut(keyEvent({ shiftKey: true }), "enter"), false);
  assert.equal(matchesSendShortcut(keyEvent({ altKey: true }), "enter"), false);
  assert.equal(matchesSendShortcut(keyEvent({ metaKey: true }), "enter"), false);
});

test("Ctrl+Enter mode sends only on the exact Ctrl+Enter combination", () => {
  assert.equal(matchesSendShortcut(keyEvent({ ctrlKey: true }), "ctrl-enter"), true);
  assert.equal(matchesSendShortcut(keyEvent(), "ctrl-enter"), false);
  assert.equal(matchesSendShortcut(keyEvent({ ctrlKey: true, shiftKey: true }), "ctrl-enter"), false);
  assert.equal(matchesSendShortcut(keyEvent({ ctrlKey: true, altKey: true }), "ctrl-enter"), false);
  assert.equal(matchesSendShortcut(keyEvent({ metaKey: true }), "ctrl-enter"), false);
  assert.equal(matchesSendShortcut(keyEvent({ key: "NumpadEnter", ctrlKey: true }), "ctrl-enter"), false);
});

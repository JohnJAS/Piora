import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [chatInput, settingsDialog, settingsCss, hook, autoScrollHook] = await Promise.all([
  readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8"),
  readFile(new URL("./SettingsDialog.tsx", import.meta.url), "utf8"),
  readFile(new URL("./SettingsDialog.module.css", import.meta.url), "utf8"),
  readFile(new URL("../hooks/useSendShortcut.ts", import.meta.url), "utf8"),
  readFile(new URL("../hooks/useLiveOutputAutoScrollPreference.ts", import.meta.url), "utf8"),
]);

test("conversation settings expose one mutually exclusive send shortcut choice", () => {
  assert.match(settingsDialog, /role="radiogroup"/);
  assert.match(settingsDialog, /aria-checked=\{sendShortcut === "enter"\}/);
  assert.match(settingsDialog, /aria-checked=\{sendShortcut === "ctrl-enter"\}/);
  assert.match(settingsDialog, /setSendShortcut\("enter"\)/);
  assert.match(settingsDialog, /setSendShortcut\("ctrl-enter"\)/);
  assert.match(settingsCss, /\.shortcutOption\[aria-checked="true"\]/);
});

test("individual chat shortcuts are fixed and cannot inherit group chat preferences", () => {
  assert.doesNotMatch(chatInput, /useSendShortcut|matchesSendShortcut|streamingSendPreference/);
  assert.match(chatInput, /if \(isPlainEnter\(e\)\)/);
  assert.match(chatInput, /e\.ctrlKey && !e\.metaKey && !e\.altKey && !e\.shiftKey/);
  assert.match(chatInput, /sendQueued\("steer"\)/);
  assert.match(chatInput, /sendQueued\("followup"\)/);
});

test("the preference synchronizes all mounted consumers and browser tabs", () => {
  assert.match(hook, /useSyncExternalStore/);
  assert.match(hook, /listeners\.forEach/);
  assert.match(hook, /window\.localStorage\.setItem\(SEND_SHORTCUT_STORAGE_KEY, shortcut\)/);
  assert.match(hook, /window\.addEventListener\("storage"/);
});

test("legacy default steering settings and dropdown are removed", () => {
  assert.doesNotMatch(settingsDialog, /useStreamingSendPreference|streamingSendDefault|conversation.streamingSend/);
  assert.doesNotMatch(chatInput, /streaming-action-toggle|streamingActionMenu/);
});

test("conversation settings expose a synchronized live-output auto-scroll switch", () => {
  assert.match(settingsDialog, /aria-checked=\{liveOutputAutoScrollEnabled\}/);
  assert.match(settingsDialog, /setLiveOutputAutoScrollEnabled\(!liveOutputAutoScrollEnabled\)/);
  assert.match(autoScrollHook, /useSyncExternalStore/);
  assert.match(autoScrollHook, /LIVE_OUTPUT_AUTO_SCROLL_STORAGE_KEY/);
  assert.match(autoScrollHook, /window\.addEventListener\("storage"/);
});

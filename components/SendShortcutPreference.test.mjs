import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [chatInput, settingsDialog, settingsCss, hook, streamingHook] = await Promise.all([
  readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8"),
  readFile(new URL("./SettingsDialog.tsx", import.meta.url), "utf8"),
  readFile(new URL("./SettingsDialog.module.css", import.meta.url), "utf8"),
  readFile(new URL("../hooks/useSendShortcut.ts", import.meta.url), "utf8"),
  readFile(new URL("../hooks/useStreamingSendPreference.ts", import.meta.url), "utf8"),
]);

test("conversation settings expose one mutually exclusive send shortcut choice", () => {
  assert.match(settingsDialog, /role="radiogroup"/);
  assert.match(settingsDialog, /aria-checked=\{sendShortcut === "enter"\}/);
  assert.match(settingsDialog, /aria-checked=\{sendShortcut === "ctrl-enter"\}/);
  assert.match(settingsDialog, /setSendShortcut\("enter"\)/);
  assert.match(settingsDialog, /setSendShortcut\("ctrl-enter"\)/);
  assert.match(settingsCss, /\.shortcutOption\[aria-checked="true"\]/);
});

test("the composer uses the live preference for sending while keeping completion Enter plain", () => {
  assert.match(chatInput, /matchesSendShortcut\(e, sendShortcut\)/);
  assert.match(chatInput, /useSendShortcut\(\)/);
  assert.match(chatInput, /e\.key === "Tab" \|\| isPlainEnter\(e\)/);
  assert.doesNotMatch(chatInput, /if \(e\.key === "Enter" && !e\.shiftKey\) \{\s*e\.preventDefault\(\);\s*if \(isStreaming/);
});

test("the preference synchronizes all mounted consumers and browser tabs", () => {
  assert.match(hook, /useSyncExternalStore/);
  assert.match(hook, /listeners\.forEach/);
  assert.match(hook, /window\.localStorage\.setItem\(SEND_SHORTCUT_STORAGE_KEY, shortcut\)/);
  assert.match(hook, /window\.addEventListener\("storage"/);
});

test("conversation settings can opt into a default running-task send action", () => {
  assert.match(settingsDialog, /role="switch"[\s\S]*?aria-checked=\{streamingSendPreference\.enabled\}/);
  assert.match(settingsDialog, /setStreamingSendDefaultEnabled\(!streamingSendPreference\.enabled\)/);
  assert.match(settingsDialog, /streamingSendPreference\.enabled \? \(/);
  assert.match(settingsDialog, /setStreamingSendDefaultBehavior\("steer"\)/);
  assert.match(settingsDialog, /setStreamingSendDefaultBehavior\("followup"\)/);
});

test("disabled keeps the chooser while enabled sends with the selected default", () => {
  assert.match(chatInput, /if \(streamingSendPreference\.enabled\) \{\s*sendQueued\(streamingSendPreference\.behavior\)/);
  assert.match(chatInput, /setStreamingActionMenuOpen\(true\)/);
  assert.match(chatInput, /const primaryStreamingMode = streamingSendPreference\.enabled \? streamingSendPreference\.behavior : "steer"/);
  assert.match(chatInput, /onClick=\{\(\) => sendQueued\(primaryStreamingMode\)\}/);
  assert.match(streamingHook, /useSyncExternalStore/);
  assert.match(streamingHook, /STREAMING_SEND_PREFERENCE_STORAGE_KEY/);
});

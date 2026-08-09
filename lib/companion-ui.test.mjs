import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { enLocale } = await jiti.import("./i18n/messages/en.ts");
const { zhCNLocale } = await jiti.import("./i18n/messages/zh-CN.ts");

const REQUIRED_MESSAGES = [
  "companion.title",
  "companion.open",
  "companion.close",
  "companion.tab.todos",
  "companion.tab.phrases",
  "companion.tab.pets",
  "companion.activity.idle",
  "companion.activity.running",
  "companion.activity.waiting",
  "companion.activity.review",
  "companion.activity.failed",
  "companion.oneClickReady",
  "companion.oneClickBusy",
  "companion.discoveredCodexPets",
  "companion.importFailed",
  "companion.source.codexBuiltinCache",
  "companion.source.codexCustom",
  "companion.source.codexLegacyAvatar",
  "companion.source.pioraInstalled",
  "companion.settingsTitle",
  "companion.settingsDescription",
  "companion.showCompanion",
  "companion.showCompanionDescription",
  "companion.petAppearance",
  "companion.petAppearanceDescription",
  "companion.desktopMode",
  "companion.desktopModeDescription",
  "companion.focusApp",
  "companion.dragHint",
];

test("companion UI has complete English and Chinese messages", () => {
  for (const locale of [enLocale, zhCNLocale]) {
    for (const key of REQUIRED_MESSAGES) {
      assert.equal(typeof locale.messages[key], "string", `${locale.id} is missing ${key}`);
      assert.notEqual(locale.messages[key].trim(), "", `${locale.id} has an empty ${key}`);
    }
  }
});

test("companion remains a local UI surface wired to the existing chat input", async () => {
  const [component, input, shell, chat, preferences, petLoader, settings, companionSettings, desktop, desktopPet] = await Promise.all([
    readFile(new URL("../components/CompanionPet.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/ChatInput.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/AppShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/ChatWindow.tsx", import.meta.url), "utf8"),
    readFile(new URL("../hooks/useCompanionPreferences.ts", import.meta.url), "utf8"),
    readFile(new URL("../hooks/useCompanionPets.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/SettingsDialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/CompanionSettingsDialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../desktop/src/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/DesktopCompanionWindow.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(preferences, /COMPANION_STORAGE_KEY/);
  assert.match(preferences, /window\.localStorage\.setItem/);
  assert.match(preferences, /window\.addEventListener\("storage"/);
  assert.match(component, /prefers-reduced-motion/);
  assert.match(component, /getCompanionAnimationFrameIndices/);
  assert.match(component, /getCompanionAtlasFramePosition/);
  assert.match(component, /renderablePet\.frame \?\?/);
  assert.match(component, /animation\.loopStart === undefined \? 0 : animation\.loopStart/);
  assert.match(component, /state\.id === animation\.fallback/);
  assert.match(component, /frameIndices\[reducedMotion \? 0/);
  assert.match(petLoader, /method:\s*"POST"/);
  assert.match(petLoader, /sourceKind:\s*pet\.sourceKind/);
  assert.match(petLoader, /pet\.sourceKey/);
  assert.match(component, /role="tablist"/);
  assert.match(component, /data-testid="companion-dock"/);
  assert.doesNotMatch(component, /https?:\/\//);

  assert.match(input, /sendText:\s*\(text: string\) => boolean/);
  assert.match(input, /if \(!message \|\| isStreaming\) return false/);
  assert.match(input, /onSend\(message\)/);
  assert.match(shell, /chatInputRef\.current\?\.sendText\(text\)/);
  assert.match(shell, /useCompanionPreferences\(\)/);
  assert.match(shell, /<CompanionSettingsDialog/);
  assert.match(settings, /key:\s*"companion"/);
  assert.match(settings, /onActiveKeyChange\(entry\.key\)/);
  assert.match(shell, /companion:\s*\([\s\S]*?<CompanionSettingsDialog[\s\S]*?embedded/);
  assert.match(companionSettings, /role="switch"/);
  assert.match(companionSettings, /onCompanionOpenChange\(!companionOpen\)/);
  assert.match(desktop, /sendMenuAction\("toggle-companion"\)/);
  assert.doesNotMatch(desktop, /sendMenuAction\("companion-settings"\)/);
  assert.match(desktop, /function createCompanionWindow/);
  assert.match(desktop, /transparent:\s*true/);
  assert.match(desktop, /alwaysOnTop:\s*true/);
  assert.match(shell, /setCompanionWindowVisible/);
  assert.match(shell, /new BroadcastChannel\("pi-companion-runtime-v1"\)/);
  assert.match(desktopPet, /SpritePet/);
  assert.match(desktopPet, /companionAction\?\.\("focus-main"\)/);
  assert.match(chat, /onCompanionActivityChange/);
  assert.match(chat, /hasReviewRequest:\s*Boolean\(extensionDialog \|\| extensionCustomUi\)/);
});

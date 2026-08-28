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
  "companion.tab.tasks",
  "companion.tab.library",
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
  "companion.source.pioraBundled",
  "companion.source.pioraInstalled",
  "companion.settingsTitle",
  "companion.settingsDescription",
  "companion.showCompanion",
  "companion.showCompanionDescription",
  "companion.alwaysOnTop",
  "companion.alwaysOnTopDescription",
  "companion.petAppearance",
  "companion.petAppearanceDescription",
  "companion.desktopMode",
  "companion.desktopModeDescription",
  "companion.focusApp",
  "companion.dragHint",
  "companion.pokeHint",
  "companion.idleTricks",
  "companion.idleTricksDescription",
  "companion.model.title",
  "companion.model.select",
  "companion.model.privacy",
  "companion.speech.modelRequired",
  "companion.library.kind.code",
  "companion.workspaceTitle",
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
  const [component, manager, input, shell, chat, preferences, petLoader, settings, companionSettings, desktop, desktopPet, desktopPetStyles, speechRoute] = await Promise.all([
    readFile(new URL("../components/CompanionPet.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/CompanionDataManager.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/ChatInput.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/AppShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/ChatWindow.tsx", import.meta.url), "utf8"),
    readFile(new URL("../hooks/useCompanionPreferences.ts", import.meta.url), "utf8"),
    readFile(new URL("../hooks/useCompanionPets.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/SettingsDialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/CompanionSettingsDialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../desktop/src/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/DesktopCompanionWindow.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/DesktopCompanionWindow.module.css", import.meta.url), "utf8"),
    readFile(new URL("../app/api/companion/speech/route.ts", import.meta.url), "utf8"),
  ]);
  const rootLayout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  const nextConfig = await readFile(new URL("../next.config.ts", import.meta.url), "utf8");

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
  assert.match(component, /prepareCompanionPersistentAnimation/);
  assert.match(component, /prepareCompanionTransientAnimation/);
  assert.match(component, /completedEventKey/);
  assert.match(petLoader, /method:\s*"POST"/);
  assert.match(petLoader, /sourceKind:\s*pet\.sourceKind/);
  assert.match(petLoader, /pet\.sourceKey/);
  assert.match(petLoader, /new BroadcastChannel\(COMPANION_PETS_CHANNEL\)/);
  assert.match(petLoader, /type: "pets-changed"/);
  assert.match(manager, /role="tablist"/);
  assert.match(manager, /preferences\.library/);
  assert.match(manager, /type="range"/);
  assert.match(component, /data-testid="companion-dock"/);
  assert.doesNotMatch(component, /https?:\/\//);

  assert.match(input, /sendText:\s*\(text: string\) => boolean/);
  assert.match(input, /if \(!message \|\| isStreaming \|\| isAutoModelSelection\) return false/);
  assert.match(input, /onSend\(message\)/);
  assert.match(shell, /chatInputRef\.current\?\.sendText\(text\)/);
  assert.match(shell, /useCompanionPreferences\(\)/);
  assert.match(shell, /<CompanionSettingsDialog/);
  assert.match(settings, /key:\s*"companion"/);
  assert.match(settings, /onActiveKeyChange\(entry\.key\)/);
  assert.match(shell, /companion:\s*\([\s\S]*?<CompanionSettingsDialog[\s\S]*?embedded/);
  assert.match(companionSettings, /role="switch"/);
  assert.match(companionSettings, /onCompanionOpenChange\(!companionOpen\)/);
  assert.match(companionSettings, /onAlwaysOnTopChange\(!alwaysOnTop\)/);
  assert.match(companionSettings, /preferences\.interactionModel/);
  assert.match(companionSettings, /<CompanionDataManager/);
  assert.match(desktop, /sendMenuAction\("toggle-companion"\)/);
  assert.doesNotMatch(desktop, /sendMenuAction\("companion-settings"\)/);
  assert.match(desktop, /function createCompanionWindow/);
  assert.match(desktop, /COMPANION_COMPACT_HEIGHT/);
  assert.match(desktop, /COMPANION_EXPANDED_HEIGHT/);
  assert.match(desktop, /setCompanionWindowExpanded/);
  assert.match(desktop, /startCompanionWindowWalk/);
  assert.match(desktop, /dragCompanionBounds/);
  assert.match(desktop, /transparent:\s*true/);
  assert.match(desktop, /alwaysOnTop:\s*companionAlwaysOnTop/);
  assert.match(desktop, /setAlwaysOnTop\(alwaysOnTop, alwaysOnTop \? "screen-saver" : "normal"\)/);
  assert.match(desktop, /window\.once\("ready-to-show"/);
  assert.match(desktop, /Companion page failed to load/);
  assert.match(shell, /setCompanionWindowVisible/);
  assert.match(shell, /setCompanionWindowAlwaysOnTop/);
  assert.match(shell, /new BroadcastChannel\("pi-companion-runtime-v1"\)/);
  assert.match(desktopPet, /SpritePet/);
  assert.match(desktopPet, /useRunningTaskSnapshots\(\)/);
  assert.match(desktopPet, /runningTasks\.map/);
  assert.match(desktopPet, /snapshot\.activity\?\.message/);
  assert.match(desktopPet, /previousTasksRef/);
  assert.match(desktopPet, /runtimeEvent/);
  assert.match(desktopPet, /item\.id === activity\.sessionId/);
  assert.match(desktopPet, /displayActivity\.status === "idle"\) return \[\]/);
  assert.match(desktopPet, /setCompanionWindowExpanded\?\.\(bubblesExpanded\)/);
  assert.match(desktopPet, /runningTaskCount/);
  assert.match(desktopPet, /aria-expanded=\{bubblesExpanded\}/);
  assert.match(desktopPet, /item\.id\.startsWith\("personal:"\) \? "personal" : "task"/);
  assert.match(desktop, /window\.webContents\.on\("context-menu"/);
  assert.match(desktop, /Menu\.buildFromTemplate/);
  assert.match(desktopPet, /className=\{styles\.activityBubble\}/);
  assert.match(desktopPet, /role="status"/);
  assert.match(desktopPet, /data-visible="true"/);
  assert.doesNotMatch(desktopPet, /setBubbleVisible|bubbleTimerRef/);
  assert.match(desktopPet, /data-testid="companion-speech-bubble"/);
  assert.match(desktopPet, /requestCompanionSpeech/);
  assert.match(desktopPet, /buildCompanionInteractionContext/);
  assert.doesNotMatch(desktopPet, /pickCompanionSpeechLine|SPEECH_LINES/);
  assert.match(speechRoute, /completeSimple/);
  assert.match(speechRoute, /cacheRetention: "none"/);
  assert.match(speechRoute, /untrusted data/);
  assert.doesNotMatch(desktopPet, /careBar|handleCare|getCompanionCareLevels|applyCompanionCareAction/);
  assert.match(desktopPet, /onPointerDown=\{handlePetPointerDown\}/);
  assert.match(desktopPet, /PET_DRAG_THRESHOLD_PX/);
  assert.match(desktopPet, /moveCompanionWindow/);
  assert.match(desktopPet, /deriveCompanionTaskPresentation/);
  assert.match(desktopPet, /overlayEvent=\{overlayEvent \?\? undefined\}/);
  assert.match(desktopPet, /idleTricks=\{idleTricksEnabled\}/);
  assert.match(desktopPet, /motionDirection=\{motionDirection\}/);
  assert.match(desktopPetStyles, /\.activityBubble/);
  assert.match(desktopPetStyles, /\.activityBubble\[data-visible="true"\]/);
  assert.match(desktopPetStyles, /\.activityBubbles\s*\{[^}]*bottom:\s*160px/s);
  assert.match(desktopPetStyles, /\.activityBubbles\s*\{[^}]*align-content:\s*end/s);
  assert.match(desktopPetStyles, /\.activityBubble\[data-kind="status"\]::after/);
  assert.match(desktopPetStyles, /\.bubbleToggle/);
  assert.doesNotMatch(desktopPetStyles, /\.careBar|\.careButton|companion-care-need/);
  assert.match(desktopPetStyles, /\.petStage/);
  assert.doesNotMatch(desktopPetStyles, /\.statusDot/);
  assert.doesNotMatch(desktopPetStyles, /\.dragSurface\s*\{[^}]*background:/);
  assert.doesNotMatch(desktopPetStyles, /\.actions/);
  assert.match(rootLayout, /location\.pathname===\"\/desktop-pet\"/);
  assert.match(rootLayout, /surfaceInitializationScript[\s\S]*BACKGROUND_INITIALIZATION_SCRIPT/);
  assert.match(nextConfig, /devIndicators:\s*false/);
  assert.match(companionSettings, /data-open-pet-runtime/);
  assert.match(companionSettings, /github\.com\/alterhq\/openpets/);
  assert.match(chat, /onCompanionActivityChange/);
  assert.match(chat, /hasReviewRequest:\s*Boolean\(extensionDialog \|\| extensionCustomUi\)/);
  assert.match(chat, /companionRunIdRef/);
  assert.match(chat, /kind = "started"/);
  assert.match(chat, /kind = "completed"/);
});

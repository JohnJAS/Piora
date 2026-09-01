import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [guide, shell, picker, chat, settings, css] = await Promise.all([
  readFile(new URL("./FirstRunOnboarding.tsx", import.meta.url), "utf8"),
  readFile(new URL("./AppShell.tsx", import.meta.url), "utf8"),
  readFile(new URL("./NewSessionProjectPicker.tsx", import.meta.url), "utf8"),
  readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8"),
  readFile(new URL("./SettingsDialog.tsx", import.meta.url), "utf8"),
  readFile(new URL("./FirstRunOnboarding.module.css", import.meta.url), "utf8"),
]);

test("first-run guide covers the real model, project, and first-message path", () => {
  assert.match(guide, /FIRST_RUN_ONBOARDING_STEPS/);
  assert.match(guide, /fetchModelCatalog\(\{/);
  assert.match(guide, /onOpenModels\(\)/);
  assert.match(guide, /onChooseProject\(\)/);
  assert.match(guide, /onPrepareFirstPrompt\(t\("onboarding\.chat\.example"\)\)/);
  assert.match(shell, /onOpenModels=\{\(\) => openSettings\("models"\)\}/);
  assert.match(shell, /onProjectSelected=\{setOnboardingProjectCwd\}/);
  assert.match(shell, /onPromptSubmitted=\{\(\) => setOnboardingPromptSubmittedKey/);
  assert.match(chat, /onSend=\{handleComposerSend\}/);
});

test("guide resumes safely and existing users are not auto-interrupted", () => {
  assert.match(guide, /fetch\("\/api\/sessions"/);
  assert.match(guide, /sessionCount === null/);
  assert.match(guide, /presentation === "paused"/);
  assert.match(guide, /className=\{styles\.resumePill\}/);
  assert.match(guide, /createFirstRunOnboardingState\("dismissed"/);
  assert.match(settings, /settings\.firstRunGuideAction/);
  assert.match(shell, /setOnboardingRestartKey/);
});

test("project chooser is explicitly controlled by the guide without duplicating the composer", () => {
  assert.match(picker, /projectPickerRequestKey/);
  assert.match(picker, /setProjectMenuOpen\(true\)/);
  assert.match(picker, /onProjectSelected\?\.\(project\.cwd\)/);
  assert.equal((picker.match(/<ChatInput\s*\n/g) ?? []).length, 1);
});

test("guide is responsive, keyboard-contained, and follows theme variables", () => {
  assert.match(guide, /useFocusTrap/);
  assert.match(guide, /aria-modal="true"/);
  assert.match(css, /var\(--bg\)/);
  assert.match(css, /var\(--accent\)/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /prefers-reduced-motion/);
});

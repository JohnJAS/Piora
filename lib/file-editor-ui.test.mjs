import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { enLocale } = await jiti.import("./i18n/messages/en.ts");
const { zhCNLocale } = await jiti.import("./i18n/messages/zh-CN.ts");

const REQUIRED_EDITOR_MESSAGES = [
  "fileEditor.externalChangeTitle",
  "fileEditor.externalChangeBody",
  "fileEditor.reloadConfirmTitle",
  "fileEditor.reloadConfirmBody",
  "fileEditor.overwriteConfirmTitle",
  "fileEditor.overwriteConfirmBody",
  "fileEditor.confirmReload",
  "fileEditor.confirmOverwrite",
  "fileEditor.saveFailed",
  "fileEditor.unsaved",
  "fileEditor.cursorPosition",
  "i18n.edit",
];

test("file editor conflict flow has complete English and Chinese messages", () => {
  for (const locale of [enLocale, zhCNLocale]) {
    for (const key of REQUIRED_EDITOR_MESSAGES) {
      assert.equal(typeof locale.messages[key], "string", `${locale.id} is missing ${key}`);
      assert.notEqual(locale.messages[key].trim(), "", `${locale.id} has an empty ${key}`);
    }
  }
});

test("file editor conflict decisions stay inside the application UI", async () => {
  const source = await readFile(new URL("../components/FileViewer.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /window\.confirm\s*\(/);
  assert.match(source, /setConflictDecision\("reload"\)/);
  assert.match(source, /setConflictDecision\("overwrite"\)/);
});

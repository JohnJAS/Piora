import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  PIORA_SIDE_CHAT_FOCUS_COMPOSER_EVENT,
  PIORA_SIDE_CHAT_INSERT_MAIN_EVENT,
  SIDE_CHAT_LOADING_PREFIX,
  SIDE_CHAT_SKIP_TEMP_CLOSE_CONFIRM_KEY,
  SIDE_CHAT_TAB_PREFIX,
  deriveParentStatus,
  isSideChatTab,
  parseSideChatTabId,
  toSideChatLoadingTabId,
  toSideChatTabId,
} = await jiti.import("./side-chat-events.ts");

test("side chat tab helpers round-trip live and loading tab ids", () => {
  const live = toSideChatTabId("abc-123");
  const loading = toSideChatLoadingTabId("req-1");
  assert.equal(live, `${SIDE_CHAT_TAB_PREFIX}abc-123`);
  assert.equal(loading, `${SIDE_CHAT_LOADING_PREFIX}req-1`);
  assert.equal(isSideChatTab(live), true);
  assert.equal(isSideChatTab(loading), true);
  assert.equal(isSideChatTab("files"), false);
  assert.deepEqual(parseSideChatTabId(live), { kind: "live", id: "abc-123" });
  assert.deepEqual(parseSideChatTabId(loading), { kind: "loading", id: "req-1" });
  assert.equal(parseSideChatTabId("review"), null);
  assert.equal(PIORA_SIDE_CHAT_INSERT_MAIN_EVENT, "piora:side-chat-insert-main");
  assert.equal(PIORA_SIDE_CHAT_FOCUS_COMPOSER_EVENT, "piora:side-chat-focus-composer");
  assert.equal(SIDE_CHAT_SKIP_TEMP_CLOSE_CONFIRM_KEY, "piora-side-chat-skip-temp-close-confirm");
});

test("deriveParentStatus maps parent runtime and attention phases accurately", () => {
  assert.equal(deriveParentStatus(null, false), "idle");
  assert.equal(deriveParentStatus(null, true), "running");
  assert.equal(deriveParentStatus({ id: "p", runtime: "running", pendingApproval: false, lastPromptFailed: false }), "running");
  assert.equal(deriveParentStatus({ id: "p", runtime: "compacting", pendingApproval: false, lastPromptFailed: false }), "compacting");
  assert.equal(deriveParentStatus({ id: "p", runtime: "idle", pendingApproval: true, lastPromptFailed: false }), "needs_approval");
  assert.equal(deriveParentStatus({ id: "p", runtime: "idle", pendingApproval: false, lastPromptFailed: false, awaitingPlanApproval: true }), "needs_approval");
  assert.equal(deriveParentStatus({ id: "p", runtime: "idle", pendingApproval: false, lastPromptFailed: true }), "failed");
  assert.equal(
    deriveParentStatus({
      id: "p",
      runtime: "idle",
      pendingApproval: false,
      lastPromptFailed: false,
      taskRun: {
        runId: "r",
        kind: "goal",
        phase: "waiting_user",
        status: "waiting",
        updatedAt: 0,
      },
    }),
    "needs_input",
  );
});

test("UI surfaces wire Side Chat cleanly across settings, composer, queue, history, and RightPanel", () => {
  const labsSource = readFileSync(new URL("../LaboratorySettings.tsx", import.meta.url), "utf8");
  const workflowHookSource = readFileSync(new URL("../workflow/useComposerWorkflow.ts", import.meta.url), "utf8");
  const rightPanelSource = readFileSync(new URL("../workspace/RightPanel.tsx", import.meta.url), "utf8");
  const chatWindowSource = readFileSync(new URL("../ChatWindow.tsx", import.meta.url), "utf8");
  const historySource = readFileSync(new URL("../ChatHistory.tsx", import.meta.url), "utf8");
  const commandCardSource = readFileSync(new URL("../ChatCommandCard.tsx", import.meta.url), "utf8");
  const appShellSource = readFileSync(new URL("../AppShell.tsx", import.meta.url), "utf8");

  assert.match(labsSource, /data-testid="laboratory-side-chat-toggle"/);
  assert.match(labsSource, /useSideChatSettings/);
  assert.match(workflowHookSource, /sidechat:open/);
  assert.match(workflowHookSource, /parseSideSlashTrigger/);
  assert.match(workflowHookSource, /sideChat\.nestedForbidden/);
  assert.match(rightPanelSource, /SideChatTabStripItems/);
  assert.match(rightPanelSource, /SideChatTabPanels/);
  assert.match(rightPanelSource, /SideChatMenuEntries/);
  assert.match(chatWindowSource, /SideChatSelectionMenu/);
  assert.match(chatWindowSource, /openInSideChat/);
  assert.match(chatWindowSource, /onOpenPendingInSideChat/);
  assert.match(historySource, /onInsertIntoMain/);
  assert.match(commandCardSource, /openInSideChat/);
  assert.match(commandCardSource, /onOpenPendingInSideChat/);
  assert.match(appShellSource, /useSideChatController/);
  assert.match(appShellSource, /data-testid="topbar-side-chat-button"/);
  assert.match(appShellSource, /SideChatCloseConfirmDialog/);
  assert.match(appShellSource, /panel\.openSideChat/);
  assert.match(appShellSource, /composer\.focusMainChat/);

  const stageStandaloneSource = readFileSync(new URL("../../scripts/stage-standalone.mjs", import.meta.url), "utf8");
  assert.match(stageStandaloneSource, /["']extensions\/piora-side-chat\.ts["']/);
});

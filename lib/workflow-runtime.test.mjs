import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { WorkflowRuntime, planToolAllowed } = await jiti.import("./workflow-runtime.ts");
const { WorkflowStore } = await jiti.import("./workflow-store.ts");
const { writeLaboratorySettings, getLaboratorySettingsPath } = await jiti.import("./laboratory-settings.ts");
async function fixture(t, mode = "goal", turnBudget = 10) {
  const directory = await mkdtemp(join(tmpdir(), "piora-workflow-"));
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = directory;
  writeLaboratorySettings({ planGoalEnabled: true });
  t.after(async () => {
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDir;
    await rm(directory, { recursive: true, force: true });
  });
  const store = new WorkflowStore(directory);
  const runtime = new WorkflowRuntime("session-a", store);
  runtime.attach(); runtime.configure({ mode, turnBudget }); runtime.preparePrompt("Preserve the full original goal, including tests."); runtime.beginTurn();
  return { runtime, store };
}
function action(runtime, name, extra = {}) {
  const state = runtime.getSnapshot();
  return runtime.action({ action: name, runId: state.current.id, expectedRevision: state.revision, ...extra });
}
test("Plan enforces inspection tools and explicit HTTP URL reads", () => {
  for (const name of ["read", "grep", "find", "ls", "piora_request_user_input"]) assert.equal(planToolAllowed(name, {}), true);
  for (const name of ["bash", "powershell", "write", "edit", "mcp_read", "unknown"]) assert.equal(planToolAllowed(name, {}), false);
  for (const value of [{ action: "open", url: "https://example.com" }, { action: "snapshot" }]) assert.equal(planToolAllowed("browser", value), true);
  for (const value of [{ action: "open", url: "javascript:alert(1)" }, { action: "new_tab", url: "file:///secret" }, { action: "evaluate" }, { action: "click" }, { action: "type" }, { action: "press" }]) assert.equal(planToolAllowed("browser", value), false);
});
test("a missing extension cannot activate a mode", async t => {
  const { store } = await fixture(t);
  const runtime = new WorkflowRuntime("unattached", store);
  assert.throws(() => runtime.configure({ mode: "plan" }), /unavailable/);
});
test("plan snapshots survive reads, revisions preserve history, approval is one-shot", async t => {
  const { runtime, store } = await fixture(t, "plan");
  runtime.submitPlan("First", "# Objective\nFull objective\n# Steps\n1. Implement\n# Verify\nRun tests");
  const first = runtime.getSnapshot();
  assert.equal(store.read("session-a").snapshot.current.markdown, first.current.markdown);
  assert.throws(() => runtime.preparePrompt("sneak implementation"), /Review/);
  action(runtime, "revise"); runtime.preparePrompt("Revise validation"); runtime.beginTurn(); runtime.submitPlan("Second", "Revised complete plan");
  const revised = runtime.getSnapshot();
  assert.equal(revised.history[0].markdown, first.current.markdown);
  assert.equal(revised.current.version, 2);
  const input = { action: "approve", runId: revised.current.id, expectedRevision: revised.revision };
  assert.match(runtime.action(input).prompt, /Revised complete plan/);
  assert.equal(runtime.action(input).prompt, undefined);
  assert.equal(runtime.getSnapshot().mode, "agent");
  runtime.preparePrompt("synthetic approval instruction");
  assert.equal(runtime.getSnapshot().current.objective, first.current.objective);
  runtime.onPromptSettled(); assert.equal(runtime.getSnapshot().current.status, "completed");
});
test("stale actions cannot approve a different plan", async t => {
  const { runtime } = await fixture(t, "plan"); runtime.submitPlan("Plan", "Content");
  const state = runtime.getSnapshot(); action(runtime, "revise");
  assert.throws(() => runtime.action({ action: "approve", runId: state.current.id, expectedRevision: state.revision }), /stale/);
});

test("inline revision admits exact feedback with the immutable prior plan, or leaves review unchanged if its helper is unavailable", async t => {
  const { runtime } = await fixture(t, "plan");
  runtime.submitPlan("Original", "Original plan");
  const original = runtime.getSnapshot();
  runtime.attach(() => ["read"]);
  assert.throws(() => action(runtime, "revise", { feedback: "Add the missing checks" }), /piora_submit_plan/);
  assert.deepEqual(runtime.getSnapshot(), original);
  runtime.attach(() => ["read", "piora_submit_plan"]);
  const input = { action: "revise", runId: original.current.id, expectedRevision: original.revision, feedback: "Add the missing checks\nand keep the original scope." };
  const result = runtime.action(input);
  assert.equal(result.prompt, input.feedback);
  assert.equal(result.snapshot.current.version, original.current.version + 1);
  assert.equal(result.snapshot.current.status, "planning");
  assert.deepEqual(result.snapshot.history.at(-1), original.current);
  assert.equal(runtime.action(input).prompt, undefined, "retry must not advance the version twice");
});

test("resuming interrupted approved execution preserves its exact plan as an earlier version", async t => {
  const { runtime } = await fixture(t, "plan");
  runtime.submitPlan("Approved artifact", "Exact approved content");
  action(runtime, "approve"); runtime.onAbort();
  const approved = runtime.getSnapshot().current;
  assert.match(action(runtime, "resume").prompt, /请继续完善当前计划，提交完整的修订版计划供审核/);
  runtime.preparePrompt("Host resume instruction"); runtime.beginTurn();
  runtime.submitPlan("Revised artifact", "New plan after interruption");
  const revised = runtime.getSnapshot();
  assert.equal(revised.mode, "plan");
  assert.equal(revised.current.status, "awaiting_approval");
  assert.equal(revised.current.version, approved.version + 1);
  assert.equal(revised.history.at(-1).markdown, approved.markdown);
  assert.equal(revised.history.at(-1).title, approved.title);
  assert.equal(revised.history.at(-1).version, approved.version);
});
test("goal requires evidence for every locked criterion and retains objective", async t => {
  const { runtime } = await fixture(t);
  const pending = { id: "tests", text: "Tests pass", status: "pending", evidence: "" };
  runtime.updateGoal({ progress: "Started", criteria: [pending] });
  assert.throws(() => runtime.updateGoal({ progress: "Done", status: "completed" }), /Every acceptance/);
  assert.throws(() => runtime.updateGoal({ progress: "Narrow scope", criteria: [{ ...pending, text: "Only a tiny test" }] }), /redefined/);
  runtime.updateGoal({ progress: "Tested", criteria: [{ ...pending, status: "verified", evidence: "node --test selected.test.mjs: 3 passed" }], status: "completed" });
  assert.equal(runtime.endTurn(), undefined);
  assert.equal(runtime.getSnapshot().current.turnsUsed, 1);
  assert.match(runtime.getSnapshot().current.objective, /including tests/);
});
test("budget terminates continuation, raising it requires explicit resume", async t => {
  const { runtime } = await fixture(t, "goal", 2);
  runtime.updateGoal({ progress: "First progress" }); assert.match(runtime.endTurn(), /请继续推进当前目标/);
  runtime.beginTurn(); runtime.updateGoal({ progress: "Second progress" }); assert.equal(runtime.endTurn(), undefined);
  assert.equal(runtime.getSnapshot().current.status, "budget_exhausted");
  assert.throws(() => action(runtime, "resume"), /Increase/);
  action(runtime, "set_budget", { turnBudget: 4 }); assert.equal(runtime.getSnapshot().current.status, "budget_exhausted");
  assert.match(action(runtime, "resume").prompt, /请继续推进当前目标/);
});
test("three unchanged turns stop for no progress", async t => {
  const { runtime } = await fixture(t);
  assert.ok(runtime.endTurn()); runtime.beginTurn(); assert.ok(runtime.endTurn()); runtime.beginTurn();
  assert.equal(runtime.endTurn(), undefined);
  assert.equal(runtime.getSnapshot().current.reason, "no_progress");
});
test("user clarification resumes a waiting goal without rewriting its objective or criteria", async t => {
  const { runtime } = await fixture(t);
  runtime.updateGoal({ progress: "Need the target path", status: "waiting", reason: "Which folder?", criteria: [{ id: "target", text: "Complete the requested change", status: "pending", evidence: "" }] });
  const original = runtime.getSnapshot().current;
  runtime.endTurn(); runtime.preparePrompt("Use the project folder");
  const resumed = runtime.getSnapshot().current;
  assert.equal(resumed.status, "running");
  assert.equal(resumed.objective, original.objective);
  assert.deepEqual(resumed.criteria, original.criteria);
  action(runtime, "pause");
  assert.throws(() => runtime.preparePrompt("A new message"), /Resume/);
});
test("a missing required helper cannot activate or resume a workflow", async t => {
  const { runtime } = await fixture(t, "plan");
  action(runtime, "pause");
  runtime.attach(() => ["read"]);
  assert.throws(() => runtime.configure({ mode: "goal" }), /piora_update_goal/);
  assert.throws(() => action(runtime, "resume"), /piora_submit_plan/);
});

test("a clarification cannot exceed the budget after the final turn waits for user input", async t => {
  const { runtime } = await fixture(t, "goal", 1);
  runtime.updateGoal({ progress: "Need a path", status: "waiting", reason: "Which folder?" });
  runtime.endTurn();
  assert.equal(runtime.getSnapshot().current.turnsUsed, 1);
  assert.equal(runtime.getSnapshot().current.status, "waiting");
  assert.throws(() => runtime.preparePrompt("Use the project folder"), /Increase the turn budget/);
  assert.throws(() => action(runtime, "resume"), /Increase the turn budget/);
  action(runtime, "set_budget", { turnBudget: 2 });
  runtime.preparePrompt("Use the project folder");
  assert.equal(runtime.getSnapshot().current.status, "running");
  assert.match(runtime.getSnapshot().current.objective, /including tests/);
});
test("pause and cancellation fence late completion and queued continuation", async t => {
  const { runtime } = await fixture(t);
  action(runtime, "pause");
  assert.throws(() => runtime.updateGoal({ progress: "Late", status: "completed" }), /not active/);
  assert.equal(runtime.endTurn(), undefined);
  action(runtime, "resume"); runtime.beginTurn(); action(runtime, "cancel"); runtime.onAbort();
  assert.equal(runtime.endTurn(), undefined); assert.equal(runtime.getSnapshot().current.status, "cancelled");
});
test("restart pauses active work without altering review-ready plans or other sessions", async t => {
  const { runtime, store } = await fixture(t);
  const record = store.read("session-a"); record.epoch = "dead-process"; store.write(record);
  assert.equal(store.read("session-a").snapshot.current.reason, "host_restarted");
  assert.equal(store.read("session-b").snapshot.current, null);
  assert.equal(runtime.getSnapshot().current.status, "paused");
});
test("restart preserves an exact pending plan but fences pre-restart approval clicks", async t => {
  const { runtime, store } = await fixture(t, "plan"); runtime.submitPlan("Review", "Exact immutable plan");
  const before = runtime.getSnapshot();
  const record = store.read("session-a"); record.epoch = "dead-process"; store.write(record);
  const after = runtime.getSnapshot();
  assert.equal(after.current.status, "awaiting_approval");
  assert.equal(after.current.markdown, before.current.markdown);
  assert.ok(after.revision > before.revision);
  assert.throws(() => runtime.action({ action: "approve", runId: before.current.id, expectedRevision: before.revision }), /stale/);
});
test("error settlement records failure and does not overwrite finished or review-ready runs", async t => {
  const { runtime } = await fixture(t, "plan"); runtime.submitPlan("Review", "Plan"); runtime.onAbort(); runtime.onPromptError("transport");
  assert.equal(runtime.getSnapshot().current.status, "awaiting_approval");
  action(runtime, "approve"); runtime.onPromptError("provider failed"); assert.equal(runtime.getSnapshot().current.status, "failed");
});

for (const approved of [false, true]) {
  test(`explicit exit dismisses a failed ${approved ? "approved execution" : "planning run"} before ordinary Agent and a new Goal`, async t => {
    const { runtime, store } = await fixture(t, "plan");
    if (approved) {
      runtime.submitPlan("Approved artifact", "Preserve this exact plan after failure");
      action(runtime, "approve");
    }
    runtime.onPromptError("provider failed");
    const failed = runtime.getSnapshot();
    assert.equal(failed.current.status, "failed", "a failure alone does not dismiss the recoverable Plan");
    const exited = action(runtime, "exit");
    assert.equal(exited.prompt, undefined, "exiting does not start a prompt");
    assert.equal(exited.snapshot.mode, "agent");
    assert.equal(exited.snapshot.current.status, "cancelled");
    assert.equal(exited.snapshot.current.reason, "user_exited");
    assert.equal(exited.snapshot.current.id, failed.current.id);
    assert.equal(exited.snapshot.current.markdown, failed.current.markdown);
    assert.equal(exited.snapshot.current.objective, failed.current.objective);
    assert.deepEqual(store.read("session-a").snapshot, exited.snapshot, "dismissal is durable rather than a local UI override");

    runtime.preparePrompt("An ordinary Agent request");
    assert.equal(runtime.beginTurn(), "", "ordinary Agent starts without a workflow instruction");
    assert.equal(runtime.getSnapshot().mode, "agent");
    assert.equal(runtime.getSnapshot().current.status, "cancelled", "an Agent prompt does not reactivate the dismissed Plan");
    runtime.configure({ mode: "goal", turnBudget: 3 });
    runtime.preparePrompt("A new independent Goal");
    const next = runtime.getSnapshot();
    assert.equal(next.mode, "goal");
    assert.equal(next.current.kind, "goal");
    assert.equal(next.current.status, "running");
    assert.equal(next.current.objective, "A new independent Goal");
    assert.equal(next.current.turnBudget, 3);
    assert.notEqual(next.current.id, failed.current.id);
    assert.equal(next.history.at(-1).id, failed.current.id);
    assert.equal(next.history.at(-1).status, "cancelled");
    assert.equal(next.history.at(-1).reason, "user_exited");
    assert.equal(next.history.at(-1).markdown, failed.current.markdown);
  });
}

for (const status of ["completed", "cancelled"]) {
  test(`exiting an already ${status} Plan preserves its recorded result`, async t => {
    const { runtime } = await fixture(t, "plan");
    runtime.submitPlan("Recorded plan", "Exact plan artifact");
    if (status === "completed") {
      action(runtime, "approve");
      runtime.onPromptSettled();
    } else runtime.configure({ mode: "agent" });
    const before = runtime.getSnapshot().current;
    assert.equal(before.status, status);
    const { snapshot, prompt } = action(runtime, "exit");
    assert.equal(prompt, undefined);
    assert.equal(snapshot.mode, "agent");
    // Action journaling can advance updatedAt, but cannot rewrite the result.
    assert.deepEqual({ ...snapshot.current, updatedAt: 0 }, { ...before, updatedAt: 0 });
  });
}

for (const enabled of [true, false]) {
  test(`a failed Goal can be cancelled with Laboratory ${enabled ? "enabled" : "disabled"} before Agent and a new Goal`, async t => {
    const { runtime, store } = await fixture(t);
    runtime.updateGoal({ progress: "Saved progress before a provider failure", criteria: [{ id: "tests", text: "Requested tests pass", status: "pending", evidence: "" }] });
    runtime.onPromptError("provider failed");
    const failed = runtime.getSnapshot();
    assert.equal(failed.current.status, "failed", "failure remains recoverable until an explicit action");
    writeLaboratorySettings({ planGoalEnabled: enabled });
    const cancelled = action(runtime, "cancel");
    assert.equal(cancelled.prompt, undefined, "cancellation never starts another prompt");
    assert.equal(cancelled.snapshot.mode, "agent");
    assert.equal(cancelled.snapshot.current.status, "cancelled");
    assert.equal(cancelled.snapshot.current.reason, "user_cancelled");
    assert.equal(cancelled.snapshot.current.id, failed.current.id);
    assert.equal(cancelled.snapshot.current.objective, failed.current.objective);
    assert.equal(cancelled.snapshot.current.progress, failed.current.progress);
    assert.deepEqual(cancelled.snapshot.current.criteria, failed.current.criteria);
    assert.deepEqual(store.read("session-a").snapshot, cancelled.snapshot, "the explicit cancellation persists on disk");

    runtime.preparePrompt("Ordinary Agent work after cancelling the failed Goal");
    assert.equal(runtime.beginTurn(), "");
    assert.equal(runtime.getSnapshot().mode, "agent");
    assert.equal(runtime.getSnapshot().current.status, "cancelled");
    writeLaboratorySettings({ planGoalEnabled: true });
    runtime.configure({ mode: "goal", turnBudget: 4 });
    runtime.preparePrompt("A fresh Goal after cancellation");
    const next = runtime.getSnapshot();
    assert.equal(next.current.kind, "goal");
    assert.equal(next.current.status, "running");
    assert.equal(next.current.objective, "A fresh Goal after cancellation");
    assert.equal(next.current.turnBudget, 4);
    assert.notEqual(next.current.id, failed.current.id);
    assert.equal(next.history.at(-1).id, failed.current.id);
    assert.equal(next.history.at(-1).reason, "user_cancelled");
    assert.equal(next.history.at(-1).status, "cancelled");
    assert.deepEqual(next.history.at(-1).criteria, failed.current.criteria);
  });
}

for (const status of ["completed", "cancelled"]) {
  test(`an already ${status} Goal still rejects a fresh cancel action without rewriting its result`, async t => {
    const { runtime, store } = await fixture(t);
    if (status === "completed") runtime.updateGoal({ progress: "Verified", status: "completed", criteria: [{ id: "test", text: "Test passed", status: "verified", evidence: "Observed passing test output" }] });
    else action(runtime, "cancel");
    const before = store.read("session-a");
    assert.equal(before.snapshot.current.status, status);
    assert.throws(() => action(runtime, "cancel"), /already ended/);
    assert.deepEqual(store.read("session-a"), before, "rejected cancellation preserves the result and action journal exactly");
  });
}

test("failed Plan cancel rules are unchanged; dismissal still uses explicit exit", async t => {
  const { runtime, store } = await fixture(t, "plan");
  runtime.onPromptError("planning failed");
  const before = store.read("session-a");
  assert.throws(() => action(runtime, "cancel"), /already ended/);
  assert.deepEqual(store.read("session-a"), before);
  assert.equal(action(runtime, "exit").snapshot.current.reason, "user_exited");
});

test("laboratory disable gates activation and continuation while preserving a resumable goal", async t => {
  const { runtime } = await fixture(t);
  runtime.updateGoal({ progress: "Inspected requirements", criteria: [{ id: "tests", text: "Requested tests pass", status: "pending", evidence: "" }] });
  const before = runtime.getSnapshot();
  writeLaboratorySettings({ planGoalEnabled: false });
  assert.deepEqual(runtime.getSnapshot(), before, "saving the switch does not erase or rewrite workflow history");
  assert.throws(() => runtime.configure({ mode: "plan" }), /Settings > Laboratory/);
  assert.throws(() => runtime.preparePrompt("Bypass using an API prompt"), /Settings > Laboratory/);
  assert.throws(() => action(runtime, "set_budget", { turnBudget: 20 }), /Settings > Laboratory/);
  assert.equal(runtime.endTurn(), undefined);
  const paused = runtime.getSnapshot();
  assert.equal(paused.current.status, "paused");
  assert.equal(paused.current.reason, "laboratory_disabled");
  assert.equal(paused.current.turnsUsed, 1);
  assert.throws(() => action(runtime, "resume"), /Settings > Laboratory/);
  writeLaboratorySettings({ planGoalEnabled: true });
  assert.match(action(runtime, "resume").prompt, /请继续推进当前目标，沿用已保存的原始目标/);
  assert.equal(runtime.getSnapshot().current.objective, before.current.objective);
  assert.deepEqual(runtime.getSnapshot().current.criteria, before.current.criteria);
});

test("disabling laboratory keeps current Plan read-only and review history while blocking approve and revise", async t => {
  const { runtime } = await fixture(t, "plan");
  writeLaboratorySettings({ planGoalEnabled: false });
  assert.equal(planToolAllowed("write", {}), false);
  runtime.submitPlan("Saved while disabled", "Exact review artifact");
  const review = runtime.getSnapshot();
  for (const name of ["approve", "revise"]) assert.throws(() => action(runtime, name), /Settings > Laboratory/);
  assert.deepEqual(runtime.getSnapshot(), review);
  action(runtime, "exit");
  assert.equal(runtime.getSnapshot().mode, "agent");
  assert.equal(runtime.getSnapshot().current.markdown, review.current.markdown);
});

test("laboratory disabled still permits pause, cancel and selecting ordinary Agent", async t => {
  const { runtime } = await fixture(t);
  writeLaboratorySettings({ planGoalEnabled: false });
  action(runtime, "pause"); action(runtime, "cancel");
  runtime.configure({ mode: "agent" }); runtime.preparePrompt("Normal Agent request");
  assert.equal(runtime.getSnapshot().mode, "agent");
  assert.equal(runtime.getSnapshot().current.status, "cancelled");
});

test("a corrupt laboratory file pauses goal settlement without throwing or queuing another turn", async t => {
  const { runtime } = await fixture(t);
  const objective = runtime.getSnapshot().current.objective;
  await writeFile(getLaboratorySettingsPath(), "{malformed-json");
  assert.equal(runtime.endTurn(), undefined);
  const paused = runtime.getSnapshot();
  assert.equal(paused.current.status, "paused");
  assert.equal(paused.current.reason, "laboratory_disabled");
  assert.equal(paused.current.turnsUsed, 1);
  assert.equal(paused.current.objective, objective);
  writeLaboratorySettings({ planGoalEnabled: true });
  assert.match(action(runtime, "resume").prompt, /请继续推进当前目标，沿用已保存的原始目标/);
});

const { readPlanDocument } = await jiti.import("./workflow/plan-store.ts");
const { isPlanImplementationMessage, isEditedPlanImplementationMessage } = await jiti.import("./workflow/plan-prompt.ts");
const { parseWorkflowSlashTrigger, matchesWorkflowMentionQuery, shouldBackspaceExitWorkflowMode } = await jiti.import("./workflow/composer-triggers.ts");

test("Plan persists editable PLAN.md, tracks user edits, and emits canonical implementation prompt", async t => {
  const { runtime } = await fixture(t, "plan");
  runtime.submitPlan("Initial plan", "# Plan\n1. Step A");
  const submitted = runtime.getSnapshot();
  assert.ok(submitted.current.planFilePath, "PLAN.md path is persisted");
  assert.equal(readPlanDocument(submitted.current.planFilePath), "# Plan\n1. Step A");
  assert.equal(submitted.current.planEditedByUser, undefined);

  const edited = runtime.savePlanMarkdown(submitted.current.id, "# Plan\n1. Step A (revised by user)", submitted.revision);
  assert.equal(edited.current.planEditedByUser, true);
  assert.equal(readPlanDocument(edited.current.planFilePath), "# Plan\n1. Step A (revised by user)");

  const approved = action(runtime, "approve");
  assert.equal(isPlanImplementationMessage(approved.prompt), true);
  assert.equal(isEditedPlanImplementationMessage(approved.prompt), true);
  assert.match(approved.prompt, /Step A \(revised by user\)/);
});

test("todoSteps carry across Goal turns, autoContinuing is transient, and completion records completedGoal badge", async t => {
  const { runtime, store } = await fixture(t, "goal", 3);
  runtime.updateTodoSteps([
    { id: "s1", label: "Inspect code", status: "completed" },
    { id: "s2", label: "Implement feature", status: "in_progress" },
  ]);
  assert.equal(runtime.getSnapshot().todoSteps.length, 2);
  const cont = runtime.endTurn();
  assert.ok(cont);
  assert.equal(runtime.getSnapshot().autoContinuing, true);
  assert.equal(store.read("session-a").snapshot.autoContinuing, undefined, "autoContinuing is transient and never persisted to disk");
  runtime.beginTurn();
  assert.equal(runtime.getSnapshot().autoContinuing, undefined);
  assert.equal(runtime.getSnapshot().todoSteps.length, 2);

  runtime.updateGoal({
    progress: "All steps done",
    status: "completed",
    criteria: [{ id: "done", text: "Finished", status: "verified", evidence: "Verified output" }],
    steps: [
      { id: "s1", label: "Inspect code", status: "completed" },
      { id: "s2", label: "Implement feature", status: "completed" },
    ],
  });
  const done = runtime.getSnapshot();
  assert.equal(done.current.status, "completed");
  assert.equal(done.current.activeSince, null);
  assert.equal(typeof done.current.timeUsedMs, "number");
  assert.equal(done.todoSteps, undefined);
  assert.equal(done.current.steps.length, 2);
  assert.ok(done.completedGoal && done.completedGoal.runId === done.current.id);
});

test("terminal transitions clear live todoSteps across Goal cancel, Plan exit, and Plan completion", async t => {
  const goalFixture = await fixture(t, "goal", 3);
  goalFixture.runtime.updateTodoSteps([{ id: "g1", label: "Work", status: "in_progress" }]);
  assert.equal(goalFixture.runtime.getSnapshot().todoSteps.length, 1);
  const cancelled = action(goalFixture.runtime, "cancel");
  assert.equal(cancelled.snapshot.current.status, "cancelled");
  assert.equal(cancelled.snapshot.todoSteps, undefined);

  const planFixture = await fixture(t, "plan", 5);
  planFixture.runtime.updateTodoSteps([{ id: "p1", label: "Research", status: "completed" }]);
  assert.equal(planFixture.runtime.getSnapshot().todoSteps.length, 1);
  const exited = action(planFixture.runtime, "exit");
  assert.equal(exited.snapshot.current.status, "cancelled");
  assert.equal(exited.snapshot.todoSteps, undefined);

  const planCompleteFixture = await fixture(t, "plan", 5);
  planCompleteFixture.runtime.submitPlan("Ready plan", "# Plan\n1. Run");
  action(planCompleteFixture.runtime, "approve");
  planCompleteFixture.runtime.updateTodoSteps([{ id: "p2", label: "Execute", status: "completed" }]);
  assert.equal(planCompleteFixture.runtime.getSnapshot().todoSteps.length, 1);
  planCompleteFixture.runtime.onPromptSettled();
  const settled = planCompleteFixture.runtime.getSnapshot();
  assert.equal(settled.current.status, "completed");
  assert.equal(settled.todoSteps, undefined);
  assert.equal(settled.current.steps.length, 1);
});

test("edit_goal updates objective without starting a turn and replace_goal archives active goal cleanly", async t => {
  const { runtime } = await fixture(t, "goal", 5);
  const edited = action(runtime, "edit_goal", { objective: "Updated full goal objective", turnBudget: 8 });
  assert.equal(edited.prompt, undefined);
  assert.equal(edited.snapshot.current.objective, "Updated full goal objective");
  assert.equal(edited.snapshot.current.turnBudget, 8);

  const replaced = action(runtime, "replace_goal");
  assert.equal(replaced.prompt, undefined);
  assert.equal(replaced.snapshot.current, null);
  assert.equal(replaced.snapshot.mode, "goal");
  assert.equal(replaced.snapshot.history.at(-1).status, "cancelled");
  assert.equal(replaced.snapshot.history.at(-1).reason, "goal_replaced");
});

test("paused goal supports Keep paused (Agent turn) and Resume goal with user message", async t => {
  const { runtime } = await fixture(t, "goal", 5);
  const originalId = runtime.getSnapshot().current.id;
  action(runtime, "pause");
  assert.equal(runtime.getSnapshot().current.status, "paused");

  // Keep paused: ordinary Agent turn leaves paused Goal intact.
  runtime.configure({ mode: "agent", preservePausedGoal: true });
  runtime.preparePrompt("Quick side question");
  assert.equal(runtime.beginTurn(), "");
  assert.equal(runtime.getSnapshot().current.id, originalId);
  assert.equal(runtime.getSnapshot().current.status, "paused");

  // Resume goal with user message: restores running state on the same Goal run.
  runtime.configure({ mode: "goal", resumePausedGoal: true });
  runtime.preparePrompt("Also verify edge case B", { resumePausedGoal: true });
  assert.equal(runtime.getSnapshot().current.id, originalId);
  assert.equal(runtime.getSnapshot().current.status, "running");
});

test("composer workflow triggers parse /plan, /goal, @mentions, and Backspace-at-start exit", () => {
  assert.deepEqual(parseWorkflowSlashTrigger("/plan"), { kind: "plan", rest: "" });
  assert.deepEqual(parseWorkflowSlashTrigger("/goal Ship feature X"), { kind: "goal", rest: "Ship feature X" });
  assert.deepEqual(parseWorkflowSlashTrigger("/goooal Keep working"), { kind: "goal", rest: "Keep working" });
  assert.equal(parseWorkflowSlashTrigger("/compact"), null);
  assert.equal(matchesWorkflowMentionQuery("pl", "plan"), true);
  assert.equal(matchesWorkflowMentionQuery("gooal", "goal"), true);
  assert.equal(matchesWorkflowMentionQuery("foo", "goal"), false);
  assert.equal(shouldBackspaceExitWorkflowMode({ mode: "plan", goalDrafting: false, value: "hello", selectionStart: 0, selectionEnd: 0, key: "Backspace" }), "plan");
  assert.equal(shouldBackspaceExitWorkflowMode({ mode: "plan", goalDrafting: false, value: "hello", selectionStart: 2, selectionEnd: 2, key: "Backspace" }), null);
  assert.equal(shouldBackspaceExitWorkflowMode({ mode: "agent", goalDrafting: true, value: "", selectionStart: 0, selectionEnd: 0, key: "Backspace" }), "goal");
  assert.equal(shouldBackspaceExitWorkflowMode({ mode: "agent", goalDrafting: true, value: "abc", selectionStart: 0, selectionEnd: 0, key: "Backspace" }), null);
});

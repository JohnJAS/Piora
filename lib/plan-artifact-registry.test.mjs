import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const plans = await jiti.import("./plan-artifact-registry.ts");
const promptRuns = await jiti.import("./prompt-run-registry.ts");
const { projectPlanArtifactTaskRun } = await jiti.import("./task-run.ts");

test.afterEach(() => {
  plans.resetPlanArtifactRegistryForTests();
  promptRuns.resetPromptRunRegistryForTests();
});

function draft(objective = "Implement structured plans") {
  return {
    objective,
    assumptions: ["The current session remains available"],
    successCriteria: ["The plan survives restoration", "Approval never executes code"],
    steps: [
      { id: "schema", title: "Define the schema", dependsOn: [] },
      { id: "ui", title: "Add the review UI", description: "Support editing and approval", dependsOn: ["schema"] },
    ],
  };
}

function beginTool(sessionId = "session-plan") {
  const run = promptRuns.beginPromptRun(sessionId);
  return { run, tool: promptRuns.requirePromptToolIdentity(sessionId, "tool-plan") };
}

test("submits a versioned draft and projects it as a TaskRun waiting for approval", () => {
  const { tool } = beginTool();
  const state = plans.submitPlanArtifact(tool, draft());
  const taskRun = projectPlanArtifactTaskRun(state);

  assert.equal(state.status, "draft");
  assert.equal(state.revision, 1);
  assert.equal(state.plan.steps[1].dependsOn[0], "schema");
  assert.equal(taskRun.source, "plan");
  assert.equal(taskRun.phase, "waiting_approval");
  assert.equal(taskRun.plan.id, state.plan.id);

  state.plan.steps[0].title = "mutated copy";
  assert.equal(plans.getPlanArtifact(tool.sessionId).plan.steps[0].title, "Define the schema");
});

test("edits with optimistic revision checks and approval creates a ready TaskRun", () => {
  const { tool } = beginTool("session-edit-plan");
  const submitted = plans.submitPlanArtifact(tool, draft());
  const edited = plans.updatePlanArtifact(tool.sessionId, submitted.revision, draft("Edited objective"));

  assert.equal(edited.revision, 2);
  assert.equal(edited.plan.id, submitted.plan.id);
  assert.equal(edited.plan.objective, "Edited objective");
  assert.throws(
    () => plans.updatePlanArtifact(tool.sessionId, submitted.revision, draft("Stale edit")),
    /changed from revision 1 to 2/,
  );

  const approved = plans.approvePlanArtifact(tool.sessionId, edited.revision);
  const taskRun = projectPlanArtifactTaskRun(approved);
  assert.equal(approved.status, "approved");
  assert.equal(approved.revision, 3);
  assert.equal(taskRun.phase, "planned");
  assert.equal(taskRun.attempt, 0);
  assert.equal(taskRun.startedAt, undefined);
  assert.throws(
    () => plans.updatePlanArtifact(tool.sessionId, approved.revision, draft()),
    /already approved/,
  );
});

test("restores the latest valid artifact on the active session branch", () => {
  const { tool } = beginTool("session-restore-plan");
  const first = plans.submitPlanArtifact(tool, draft("First revision"));
  const second = plans.updatePlanArtifact(tool.sessionId, first.revision, draft("Second revision"));
  plans.resetPlanArtifactRegistryForTests();

  const restored = plans.restorePlanArtifactFromEntries(tool.sessionId, [
    { type: "custom", customType: plans.PLAN_ARTIFACT_ENTRY_TYPE, data: first },
    { type: "custom", customType: "unrelated", data: second },
    { type: "custom", customType: plans.PLAN_ARTIFACT_ENTRY_TYPE, data: second },
  ]);

  assert.equal(restored.revision, 2);
  assert.equal(restored.plan.objective, "Second revision");
});

test("rejects unknown and cyclic dependencies", () => {
  const { tool } = beginTool("session-invalid-plan");
  assert.throws(
    () => plans.submitPlanArtifact(tool, {
      ...draft(),
      steps: [{ id: "one", title: "One", dependsOn: ["missing"] }],
    }),
    /depends on unknown step missing/,
  );
  assert.throws(
    () => plans.submitPlanArtifact(tool, {
      ...draft(),
      steps: [
        { id: "one", title: "One", dependsOn: ["two"] },
        { id: "two", title: "Two", dependsOn: ["one"] },
      ],
    }),
    /dependency cycle/,
  );
});

test("executes approved steps in dependency order and completes only after verification", async () => {
  const planning = beginTool("session-execute-plan");
  const submitted = plans.submitPlanArtifact(planning.tool, draft("Execute the approved plan"));
  const approved = plans.approvePlanArtifact(planning.tool.sessionId, submitted.revision);
  await promptRuns.finishPromptRun(planning.run, "idle");

  const executionRun = promptRuns.beginPromptRun(planning.tool.sessionId);
  const executing = plans.beginPlanExecution(executionRun, approved.plan.id, approved.revision);
  const tool = promptRuns.requirePromptToolIdentity(planning.tool.sessionId, "execution-tool");
  assert.equal(executing.execution.status, "running");
  assert.equal(executing.execution.attempt, 1);
  assert.equal(projectPlanArtifactTaskRun(executing).phase, "running");

  assert.throws(() => plans.startPlanStep(tool, "ui"), /unmet dependencies: schema/);
  plans.startPlanStep(tool, "schema");
  assert.throws(
    () => plans.completePlanStep(tool, "schema", "Unverified result"),
    /requires concrete evidence/,
  );
  plans.addPlanExecutionEvidence(tool, "Schema behavior verified by focused tests", "verification", "schema", [0]);
  plans.addPlanExecutionArtifact(tool, "lib/plan-schema.ts", "file", "Structured plan schema", "schema");
  plans.completePlanStep(tool, "schema", "Schema implemented and tested");
  plans.startPlanStep(tool, "ui");
  plans.addPlanExecutionEvidence(tool, "Approval UI behavior inspected", "observation", "ui");
  plans.completePlanStep(tool, "ui", "Review UI implemented and tested");
  const verifying = plans.beginPlanVerification(tool);
  assert.equal(verifying.execution.status, "verifying");
  assert.throws(
    () => plans.completePlanExecution(tool, "Missing change summary"),
    /requires a change summary/,
  );
  plans.recordPlanChangeSummary(tool, "Added a durable plan schema and explicit approval UI.");
  assert.throws(
    () => plans.completePlanExecution(tool, "Only model-reported evidence exists"),
    /runtime-captured verification command/,
  );
  plans.capturePlanRuntimeToolResult(executionRun, "runtime-shell", "bash", { command: "echo npm test" }, false);
  assert.throws(
    () => plans.completePlanExecution(tool, "A shell command is not verification"),
    /runtime-captured verification command/,
  );
  plans.capturePlanRuntimeToolResult(executionRun, "runtime-test", "bash", { command: "npm test" }, false);
  assert.throws(
    () => plans.completePlanExecution(tool, "One success criterion is still uncovered"),
    /success criteria: 1/,
  );
  plans.addPlanExecutionEvidence(tool, "Approval remains separate from execution", "verification", undefined, [1]);
  const completed = plans.completePlanExecution(tool, "All success criteria verified");
  const taskRun = projectPlanArtifactTaskRun(completed);

  assert.equal(completed.execution.status, "completed");
  assert.deepEqual(completed.plan.steps.map(({ status }) => status), ["completed", "completed"]);
  assert.equal(taskRun.phase, "completed");
  assert.equal(taskRun.attempt, 1);
  assert.equal(taskRun.progress, "All success criteria verified");
  assert.equal(taskRun.evidence.length, 5);
  assert.equal(taskRun.evidence.find((item) => item.toolCallId === "runtime-test").source, "runtime");
  assert.equal(taskRun.artifacts.length, 1);
  assert.equal(taskRun.artifacts[0].name, "lib/plan-schema.ts");
  assert.ok(taskRun.finishedAt);
});

test("captures file, commit, and Git provenance from runtime-owned inputs", async () => {
  const planning = beginTool("session-runtime-provenance");
  const submitted = plans.submitPlanArtifact(planning.tool, {
    objective: "Capture trustworthy provenance",
    assumptions: [],
    successCriteria: ["Runtime evidence is distinguishable"],
    steps: [{ id: "capture", title: "Capture runtime events", dependsOn: [] }],
  });
  const approved = plans.approvePlanArtifact(planning.tool.sessionId, submitted.revision);
  await promptRuns.finishPromptRun(planning.run, "idle");

  const executionRun = promptRuns.beginPromptRun(planning.tool.sessionId);
  plans.beginPlanExecution(executionRun, approved.plan.id, approved.revision);
  const tool = promptRuns.requirePromptToolIdentity(planning.tool.sessionId, "runtime-tool");
  plans.startPlanStep(tool, "capture");

  const edited = plans.capturePlanRuntimeToolResult(
    executionRun,
    "edit-call",
    "edit",
    { path: "lib/runtime.ts" },
    false,
  );
  assert.equal(edited.execution.evidence.at(-1).source, "runtime");
  assert.equal(edited.execution.artifacts.at(-1).name, "lib/runtime.ts");
  const deduplicated = plans.capturePlanRuntimeToolResult(
    executionRun,
    "edit-call",
    "edit",
    { path: "lib/runtime.ts" },
    false,
  );
  assert.equal(deduplicated.execution.artifacts.length, 1);

  const beforeFailedCheck = deduplicated.revision;
  const failedCheck = plans.capturePlanRuntimeToolResult(
    executionRun,
    "failed-test",
    "bash",
    { command: "npm test" },
    true,
  );
  assert.equal(failedCheck.revision, beforeFailedCheck);

  plans.completePlanStep(tool, "capture", "Runtime edit was captured");
  plans.beginPlanVerification(tool);
  const gitSnapshot = plans.capturePlanGitSnapshot(tool, {
    isGitRepository: true,
    repositoryRoot: "C:/workspace/project",
    branch: "codex/runtime-evidence",
    files: [{
      filePath: "lib/runtime.ts",
      status: "modified",
      code: "M",
      indexStatus: " ",
      worktreeStatus: "M",
      additions: 4,
      deletions: 1,
    }],
    additions: 4,
    deletions: 1,
  });
  assert.match(gitSnapshot.execution.evidence.at(-1).summary, /1 changed files, \+4\/-1/);
  assert.equal(gitSnapshot.execution.evidence.at(-1).source, "runtime");

  const committed = plans.capturePlanRuntimeToolResult(
    executionRun,
    "commit-call",
    "bash",
    { command: "git commit -m runtime" },
    false,
    { content: [{ type: "text", text: "[codex/runtime-evidence abc1234] runtime" }] },
  );
  const commit = committed.execution.artifacts.find((item) => item.kind === "commit");
  assert.equal(commit.name, "Git commit abc1234");
  assert.equal(commit.source, "runtime");
});

test("settles user waits and resumes the same execution as a new attempt", async () => {
  const planning = beginTool("session-resume-plan");
  const submitted = plans.submitPlanArtifact(planning.tool, draft("Resume an interrupted plan"));
  const approved = plans.approvePlanArtifact(planning.tool.sessionId, submitted.revision);
  await promptRuns.finishPromptRun(planning.run, "idle");

  const firstRun = promptRuns.beginPromptRun(planning.tool.sessionId);
  plans.beginPlanExecution(firstRun, approved.plan.id, approved.revision);
  const waiting = plans.settlePlanExecutionFromGoal(
    planning.tool.sessionId,
    firstRun.runId,
    "waiting_user",
    "Choose a deployment target",
  );
  assert.equal(waiting.execution.status, "waiting_user");
  assert.equal(projectPlanArtifactTaskRun(waiting).phase, "waiting_user");
  await promptRuns.finishPromptRun(firstRun, "idle");

  const secondRun = promptRuns.beginPromptRun(planning.tool.sessionId);
  const resumed = plans.resumePlanExecution(secondRun);
  assert.equal(resumed.execution.status, "running");
  assert.equal(resumed.execution.attempt, 2);
  assert.equal(resumed.execution.runId, secondRun.runId);
});

test("restoring an in-flight execution marks it interrupted instead of pretending it is live", async () => {
  const planning = beginTool("session-restore-execution");
  const submitted = plans.submitPlanArtifact(planning.tool, draft("Restore safely"));
  const approved = plans.approvePlanArtifact(planning.tool.sessionId, submitted.revision);
  await promptRuns.finishPromptRun(planning.run, "idle");
  const executionRun = promptRuns.beginPromptRun(planning.tool.sessionId);
  plans.beginPlanExecution(executionRun, approved.plan.id, approved.revision);
  const executionTool = promptRuns.requirePromptToolIdentity(planning.tool.sessionId, "legacy-evidence");
  plans.startPlanStep(executionTool, "schema");
  const running = plans.addPlanExecutionEvidence(executionTool, "Legacy evidence", "observation", "schema");
  const legacyRunning = structuredClone(running);
  delete legacyRunning.execution.evidence[0].source;
  plans.resetPlanArtifactRegistryForTests();

  const restored = plans.restorePlanArtifactFromEntries(planning.tool.sessionId, [{
    type: "custom",
    customType: plans.PLAN_ARTIFACT_ENTRY_TYPE,
    data: legacyRunning,
  }]);
  assert.equal(restored.execution.status, "interrupted");
  assert.equal(restored.revision, running.revision + 1);
  assert.equal(restored.execution.evidence[0].source, "model");
  assert.match(restored.execution.reason, /previous runtime ended/);
});

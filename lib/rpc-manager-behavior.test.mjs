import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const promptRuns = await jiti.import("./prompt-run-registry.ts");
const goals = await jiti.import("./goal-run-registry.ts");
const plans = await jiti.import("./plan-artifact-registry.ts");

test.afterEach(() => {
  promptRuns.resetPromptRunRegistryForTests();
  goals.resetGoalRunRegistryForTests();
  plans.resetPlanArtifactRegistryForTests();
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createFakeSession(sessionId, toolNames = [], initialSessionName) {
  const promptStarted = deferred();
  const promptFinished = deferred();
  let activeTools = ["read", "bash", "edit", "grep"];
  let abortCount = 0;
  let reloadCount = 0;
  let sessionName = initialSessionName;
  let sessionNameReadCount = 0;
  let subscriber = () => {};
  const customEntries = [];
  const state = { systemPrompt: "Base instructions", thinkingLevel: "off" };

  return {
    promptStarted,
    promptFinished,
    customEntries,
    emit: (event) => subscriber(event),
    get abortCount() { return abortCount; },
    get reloadCount() { return reloadCount; },
    get sessionNameReadCount() { return sessionNameReadCount; },
    session: {
      sessionId,
      sessionFile: undefined,
      isStreaming: false,
      isCompacting: false,
      isBashRunning: false,
      autoCompactionEnabled: true,
      autoRetryEnabled: true,
      model: undefined,
      modelRuntime: {
        getModel: () => undefined,
        refresh: async () => undefined,
      },
      sessionManager: {
        getCwd: () => process.cwd(),
        getSessionName: () => {
          sessionNameReadCount += 1;
          return sessionName;
        },
        getBranch: () => [],
        getEntries: () => customEntries.map((entry) => ({ type: "custom", ...entry })),
        appendCustomEntry: (customType, data) => {
          customEntries.push({ customType, data });
          return `custom-${customEntries.length}`;
        },
      },
      agent: { state },
      extensionRunner: { getRegisteredCommands: () => [] },
      promptTemplates: [],
      resourceLoader: {
        getSkills: () => ({ skills: [] }),
        getExtensions: () => ({
          extensions: [
            { resolvedPath: resolve(process.cwd(), "extensions", "piora-plan.ts") },
            { resolvedPath: resolve(process.cwd(), "extensions", "piora-goal.ts") },
          ],
          errors: [],
        }),
      },
      subscribe: (listener) => {
        subscriber = listener;
        return () => { subscriber = () => {}; };
      },
      prompt: async () => {
        promptStarted.resolve();
        await promptFinished.promise;
      },
      setSessionName: (name) => { sessionName = name; },
      abort: async () => { abortCount += 1; },
      reload: async () => {
        reloadCount += 1;
        state.systemPrompt = "Updated instructions";
      },
      getActiveToolNames: () => [...activeTools],
      setActiveToolsByName: (names) => { activeTools = [...names]; },
      getAllTools: () => toolNames.map((name) => ({ name, description: `${name} description` })),
      getContextUsage: () => undefined,
      pendingMessageCount: 0,
      getSteeringMessages: () => [],
      getFollowUpMessages: () => [],
    },
  };
}

test("runtime snapshots reuse the cached session title until a rename updates it", () => {
  const fake = createFakeSession("session-cached-title", [], "Initial title");
  const wrapper = new AgentSessionWrapper(fake.session);

  assert.equal(fake.sessionNameReadCount, 1);
  assert.equal(wrapper.getTaskRuntimeSnapshot().title, "Initial title");
  assert.equal(wrapper.getTaskRuntimeSnapshot().title, "Initial title");
  assert.equal(fake.sessionNameReadCount, 1);

  wrapper.setSessionName("Renamed title");
  assert.equal(wrapper.getTaskRuntimeSnapshot().title, "Renamed title");
  assert.equal(fake.sessionNameReadCount, 1);
  wrapper.destroy();
});

test("session tools can be disabled, re-enabled, persisted, and temporarily augmented by plan mode", async () => {
  const fake = createFakeSession("session-capabilities", ["read", "browser", "piora_plan"]);
  const wrapper = new AgentSessionWrapper(fake.session);
  wrapper.initializeSessionCapabilities();

  assert.deepEqual(fake.session.getActiveToolNames(), ["browser", "read"]);
  const browserOff = await wrapper.send({
    type: "set_capabilities",
    preset: "custom",
    enabledCapabilityIds: ["tool:read"],
    expectedRevision: 0,
  });
  assert.equal(browserOff.policy.preset, "custom");
  assert.deepEqual(fake.session.getActiveToolNames(), ["read"]);

  await wrapper.send({
    type: "set_capabilities",
    preset: "custom",
    enabledCapabilityIds: ["tool:read", "tool:browser"],
    expectedRevision: 1,
  });
  assert.deepEqual(fake.session.getActiveToolNames(), ["browser", "read"]);

  await wrapper.send({
    type: "set_capabilities",
    preset: "custom",
    enabledCapabilityIds: [],
    expectedRevision: 2,
  });
  assert.deepEqual(fake.session.getActiveToolNames(), []);
  assert.equal(fake.customEntries.at(-1).customType, "piora-session-capabilities");
  await assert.rejects(
    wrapper.send({ type: "set_capabilities", preset: "coding", expectedRevision: 0 }),
    /another view/,
  );

  const promptDone = new Promise((resolve) => {
    wrapper.onEvent((event) => {
      if (event.type === "prompt_done") resolve();
    });
  });
  await wrapper.send({ type: "prompt", message: "Plan without workspace access", planMode: true });
  await fake.promptStarted.promise;
  assert.deepEqual(fake.session.getActiveToolNames(), ["piora_plan"]);

  fake.promptFinished.resolve();
  await promptDone;
  assert.deepEqual(fake.session.getActiveToolNames(), []);
  wrapper.destroy();
});

test("plan RPC commands persist edits and approval without starting execution", async () => {
  const sessionId = "session-plan-review";
  const run = promptRuns.beginPromptRun(sessionId);
  const tool = promptRuns.requirePromptToolIdentity(sessionId, "plan-tool");
  const draft = plans.submitPlanArtifact(tool, {
    objective: "Review a structured plan",
    assumptions: [],
    successCriteria: ["Approval creates a planned TaskRun"],
    steps: [{ id: "review", title: "Review the plan", dependsOn: [] }],
  });
  await promptRuns.finishPromptRun(run, "idle");

  const fake = createFakeSession(sessionId);
  const wrapper = new AgentSessionWrapper(fake.session);
  const edited = await wrapper.send({
    type: "plan_update",
    expectedRevision: draft.revision,
    plan: {
      objective: "Review and approve a structured plan",
      assumptions: [],
      successCriteria: ["Approval creates a planned TaskRun"],
      steps: [{ id: "review", title: "Review the updated plan", dependsOn: [] }],
    },
  });
  assert.equal(edited.plan.revision, 2);
  assert.equal(edited.taskRun.phase, "waiting_approval");

  const approved = await wrapper.send({
    type: "plan_approve",
    expectedRevision: edited.plan.revision,
  });
  assert.equal(approved.plan.status, "approved");
  assert.equal(approved.taskRun.phase, "planned");
  assert.equal(approved.taskRun.startedAt, undefined);
  assert.equal((await wrapper.send({ type: "get_state" })).plan.status, "approved");
  wrapper.destroy();
});

test("an active plan prompt owns a server-side mutation lock until state is restored", async () => {
  const fake = createFakeSession("session-plan-lock");
  const wrapper = new AgentSessionWrapper(fake.session);
  const promptDone = new Promise((resolve) => {
    wrapper.onEvent((event) => {
      if (event.type === "prompt_done") resolve();
    });
  });

  await wrapper.send({ type: "prompt", message: "Plan a safe change", planMode: true });
  await fake.promptStarted.promise;

  assert.deepEqual(fake.session.getActiveToolNames(), ["read", "grep"]);
  assert.equal((await wrapper.send({ type: "get_state" })).promptMode, "plan");
  await assert.rejects(wrapper.send({ type: "set_tools", toolNames: ["read"] }), /session is busy/);
  await assert.rejects(wrapper.send({ type: "fork", entryId: "entry" }), /session is busy/);
  await assert.rejects(wrapper.send({ type: "reload" }), /session is busy/);

  fake.promptFinished.resolve();
  await promptDone;

  assert.deepEqual(fake.session.getActiveToolNames(), ["read", "bash", "edit", "grep"]);
  assert.equal(fake.session.agent.state.systemPrompt, "Base instructions");
  assert.equal((await wrapper.send({ type: "get_state" })).promptMode, "normal");
  wrapper.destroy();
});

test("an approved plan starts an explicit target-mode execution and interruption is persisted", async () => {
  const sessionId = "session-plan-execution";
  const planningRun = promptRuns.beginPromptRun(sessionId);
  const planningTool = promptRuns.requirePromptToolIdentity(sessionId, "planning-tool");
  const submitted = plans.submitPlanArtifact(planningTool, {
    objective: "Execute only after approval",
    assumptions: [],
    successCriteria: ["Execution starts in Target Mode"],
    steps: [{ id: "implement", title: "Implement the change", dependsOn: [] }],
  });
  const approved = plans.approvePlanArtifact(sessionId, submitted.revision);
  await promptRuns.finishPromptRun(planningRun, "idle");

  const fake = createFakeSession(sessionId);
  const wrapper = new AgentSessionWrapper(fake.session);
  const events = [];
  wrapper.onEvent((event) => events.push(event));
  await wrapper.send({
    type: "prompt",
    message: "Execute the approved structured plan",
    goalMode: true,
    planExecution: { planId: approved.plan.id, expectedRevision: approved.revision },
  });
  await fake.promptStarted.promise;

  const runningState = await wrapper.send({ type: "get_state" });
  assert.equal(runningState.promptMode, "goal");
  assert.equal(runningState.plan.execution.status, "running");
  assert.equal(runningState.planTaskRun.phase, "running");
  assert.equal(wrapper.getTaskRuntimeSnapshot().taskRun.source, "plan");
  assert.ok(events.some((event) => event.type === "plan_execution_start"));

  wrapper.destroy();
  fake.promptFinished.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  const persistedPlan = fake.customEntries
    .filter((entry) => entry.customType === plans.PLAN_ARTIFACT_ENTRY_TYPE)
    .at(-1)?.data;
  assert.equal(persistedPlan.execution.status, "interrupted");
  assert.equal(plans.getPlanArtifact(sessionId), undefined);
});

test("session tool events persist runtime-owned plan evidence", async () => {
  const sessionId = "session-runtime-tool-events";
  const planningRun = promptRuns.beginPromptRun(sessionId);
  const planningTool = promptRuns.requirePromptToolIdentity(sessionId, "planning-tool");
  const submitted = plans.submitPlanArtifact(planningTool, {
    objective: "Capture a real verification command",
    assumptions: [],
    successCriteria: ["The runtime records test success"],
    steps: [{ id: "verify", title: "Run verification", dependsOn: [] }],
  });
  const approved = plans.approvePlanArtifact(sessionId, submitted.revision);
  await promptRuns.finishPromptRun(planningRun, "idle");

  const fake = createFakeSession(sessionId);
  const wrapper = new AgentSessionWrapper(fake.session);
  const events = [];
  wrapper.onEvent((event) => events.push(event));
  wrapper.start();
  await wrapper.send({
    type: "prompt",
    message: "Execute and verify",
    goalMode: true,
    planExecution: { planId: approved.plan.id, expectedRevision: approved.revision },
  });
  await fake.promptStarted.promise;
  const executionTool = promptRuns.requirePromptToolIdentity(sessionId, "execution-tool");
  plans.startPlanStep(executionTool, "verify");

  fake.emit({
    type: "tool_execution_start",
    toolCallId: "test-call",
    toolName: "bash",
    args: { command: "npm test" },
  });
  fake.emit({
    type: "tool_execution_end",
    toolCallId: "test-call",
    toolName: "bash",
    result: { content: [{ type: "text", text: "tests passed" }] },
    isError: false,
  });

  const runtimeEvidence = plans.getPlanArtifact(sessionId).execution.evidence.at(-1);
  wrapper.destroy();
  fake.promptFinished.resolve();
  assert.equal(runtimeEvidence.source, "runtime");
  assert.equal(runtimeEvidence.kind, "verification");
  assert.equal(runtimeEvidence.toolCallId, "test-call");
  assert.ok(fake.customEntries.some((entry) => (
    entry.customType === plans.PLAN_ARTIFACT_ENTRY_TYPE
      && entry.data.execution.evidence.some((item) => item.toolCallId === "test-call")
  )));
  assert.ok(events.some((event) => event.type === "plan_progress"));
});

test("destroy aborts an active prompt and does not restore state into the dead session", async () => {
  const fake = createFakeSession("session-plan-destroy");
  const wrapper = new AgentSessionWrapper(fake.session);

  await wrapper.send({ type: "prompt", message: "Plan before shutdown", planMode: true });
  await fake.promptStarted.promise;
  wrapper.destroy();
  fake.promptFinished.resolve();

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fake.abortCount, 1);
  assert.deepEqual(fake.session.getActiveToolNames(), ["read", "grep"]);
});

test("abort acknowledges before slow model cleanup becomes idle", async () => {
  const fake = createFakeSession("session-fast-abort");
  const abortFinished = deferred();
  fake.session.abort = async () => { await abortFinished.promise; };
  const wrapper = new AgentSessionWrapper(fake.session);

  await wrapper.send({ type: "prompt", message: "Wait for a slow model" });
  await fake.promptStarted.promise;

  const result = await Promise.race([
    wrapper.send({ type: "abort" }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("abort acknowledgement timed out")), 100)),
  ]);
  assert.deepEqual(result, { accepted: true });
  assert.equal(wrapper.getRuntime(), "stopping");

  fake.promptFinished.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(wrapper.getRuntime(), "stopping");
  await assert.rejects(
    wrapper.send({ type: "prompt", message: "Do not overlap abort cleanup" }),
    /session is busy/,
  );

  abortFinished.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(wrapper.getRuntime(), "idle");
  wrapper.destroy();
});

test("disabled prompt-mode extensions are rejected before a prompt run starts", async () => {
  const fake = createFakeSession("session-disabled-plan");
  fake.session.resourceLoader.getExtensions = () => ({ extensions: [], errors: [] });
  const wrapper = new AgentSessionWrapper(fake.session);

  await assert.rejects(
    wrapper.send({ type: "prompt", message: "Plan this", planMode: true }),
    /Plan mode is disabled/,
  );
  assert.equal(fake.session.getActiveToolNames().includes("bash"), true);
  wrapper.destroy();
});

test("runtime snapshots project a waiting target goal into the shared TaskRun contract", () => {
  const run = promptRuns.beginPromptRun("session-task-run-projection");
  goals.beginGoalRun(run, "Publish after the user chooses visibility");
  const tool = promptRuns.requirePromptToolIdentity("session-task-run-projection", "tool-waiting");
  goals.waitGoalForUser(tool, "Choose public or private visibility");

  const fake = createFakeSession("session-task-run-projection");
  const wrapper = new AgentSessionWrapper(fake.session);
  const snapshot = wrapper.getTaskRuntimeSnapshot();

  assert.equal(snapshot.goal?.status, "waiting_user");
  assert.equal(snapshot.taskRun?.source, "goal");
  assert.equal(snapshot.taskRun?.phase, "waiting_user");
  assert.match(snapshot.taskRun?.reason ?? "", /public or private/);
  wrapper.destroy();
});

test("extension restart destroys an idle wrapper so the next request rebuilds its load plan", async () => {
  const fake = createFakeSession("session-extension-restart");
  const wrapper = new AgentSessionWrapper(fake.session);
  await wrapper.send({ type: "restart_extensions" });
  assert.equal(wrapper.isAlive(), false);
});

test("system prompt changes reload idle sessions and defer busy sessions without aborting them", async () => {
  const idle = createFakeSession("session-system-prompt-idle");
  const idleWrapper = new AgentSessionWrapper(idle.session);
  const idleEvents = [];
  idleWrapper.onEvent((event) => idleEvents.push(event));

  assert.equal(await idleWrapper.requestSystemPromptReload(), "reloaded");
  assert.equal(idle.reloadCount, 1);
  assert.equal(idle.session.agent.state.systemPrompt, "Updated instructions");
  assert.ok(idleEvents.some((event) => event.type === "system_prompt_reloaded"));
  idleWrapper.destroy();

  const busy = createFakeSession("session-system-prompt-busy");
  const busyWrapper = new AgentSessionWrapper(busy.session);
  const reloaded = new Promise((resolve) => {
    busyWrapper.onEvent((event) => {
      if (event.type === "system_prompt_reloaded") resolve();
    });
  });
  await busyWrapper.send({ type: "prompt", message: "Keep this run alive while settings change" });
  await busy.promptStarted.promise;
  assert.equal(await busyWrapper.requestSystemPromptReload(), "deferred");
  assert.equal(busy.reloadCount, 0);
  assert.equal(busy.abortCount, 0);

  busy.promptFinished.resolve();
  await reloaded;
  assert.equal(busy.reloadCount, 1);
  assert.equal(busy.abortCount, 0);
  busyWrapper.destroy();
});

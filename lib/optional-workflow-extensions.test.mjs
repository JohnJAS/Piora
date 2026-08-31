import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DefaultResourceLoader, getAgentDir } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const firstParty = await jiti.import("./first-party-extensions.ts");

const rpc = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/agent/[id]/route.ts", import.meta.url), "utf8");
const input = await readFile(new URL("../components/ChatInput.tsx", import.meta.url), "utf8");
const messageTypes = await readFile(new URL("./session-message-types.ts", import.meta.url), "utf8");

test("Goals and Plans are configurable normal-profile extensions disabled by default", () => {
  for (const id of ["piora:goal", "piora:plan"]) {
    const descriptor = firstParty.FIRST_PARTY_EXTENSIONS.find((item) => item.id === id);
    assert.ok(descriptor);
    assert.equal(descriptor.required, undefined);
    assert.equal(descriptor.defaultEnabled, false);
    assert.deepEqual(descriptor.profiles, ["normal"]);
  }
});

test("enabling the extension modules registers ordinary tools and slash commands", async () => {
  const goalPath = new URL("../extensions/piora-goal.ts", import.meta.url).pathname.replace(/^\/(.:)/, "$1");
  const planPath = new URL("../extensions/piora-plan.ts", import.meta.url).pathname.replace(/^\/(.:)/, "$1");
  const loader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: getAgentDir(),
    additionalExtensionPaths: [goalPath, planPath],
    noExtensions: true,
  });
  await loader.reload();
  const loaded = loader.getExtensions().extensions;
  const goal = loaded.find(({ resolvedPath }) => resolvedPath.endsWith("piora-goal.ts"));
  const plan = loaded.find(({ resolvedPath }) => resolvedPath.endsWith("piora-plan.ts"));

  assert.ok(goal?.tools.has("piora_goal"));
  assert.ok(goal?.commands.has("goal"));
  assert.ok(plan?.tools.has("piora_plan"));
  assert.ok(plan?.tools.has("piora_plan_execution"));
  assert.ok(plan?.commands.has("plan"));

  const context = {
    sessionManager: { getSessionId: () => "session-optional-workflows", getBranch: () => [] },
    ui: { setStatus: () => {}, setWidget: () => {}, notify: () => {} },
  };
  assert.equal(await goal.handlers.get("before_agent_start")?.[0]({ prompt: "hello" }, context), undefined);
  assert.equal(await plan.handlers.get("before_agent_start")?.[0]({ prompt: "hello" }, context), undefined);
});

test("the core prompt protocol and composer contain no Goal or Plan mode switches", () => {
  for (const source of [rpc, route, input, messageTypes]) {
    assert.doesNotMatch(source, /goalMode|planMode|planExecution|promptMode/);
  }
  assert.doesNotMatch(rpc, /runGoalModeContinuations|enterPlanMode|projectPlanArtifactTaskRun/);
  assert.doesNotMatch(input, /chat\.goalMode|chat\.planMode|composer-mode-chip/);
});

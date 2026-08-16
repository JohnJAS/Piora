import assert from "node:assert/strict";
import test from "node:test";
import { DefaultResourceLoader, getAgentDir } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const modes = await jiti.import("./prompt-mode-runtime.ts");

test.afterEach(() => modes.resetActivePromptModesForTests());

test("the plan extension supplies instructions only for an active plan-mode run", async () => {
  const extensionPath = new URL("../extensions/piora-plan.ts", import.meta.url).pathname.replace(/^\/(.:)/, "$1");
  const loader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: getAgentDir(),
    additionalExtensionPaths: [extensionPath],
    noExtensions: true,
  });
  await loader.reload();
  const extension = loader.getExtensions().extensions.find(({ resolvedPath }) => resolvedPath.endsWith("piora-plan.ts"));
  assert.ok(extension);
  assert.ok(extension.commands.has("plan"));
  assert.ok(extension.tools.has("piora_plan"));
  assert.ok(extension.tools.has("piora_plan_execution"));
  const beforeStart = extension.handlers.get("before_agent_start")?.[0];
  assert.equal(typeof beforeStart, "function");

  const statuses = [];
  const context = {
    sessionManager: { getSessionId: () => "session-plan-extension" },
    ui: { setStatus: (...args) => statuses.push(args) },
  };
  assert.equal(await beforeStart({}, context), undefined);

  modes.beginActivePromptMode({ sessionId: "session-plan-extension", runId: "run-plan" }, "plan");
  const injected = await beforeStart({}, context);
  assert.match(injected.message.content, /PIORA PLAN MODE ACTIVE/);
  assert.match(injected.message.content, /Do not modify files/);
  assert.match(injected.message.content, /call piora_plan exactly once/);
  assert.deepEqual(statuses.at(-1), ["piora-plan", "Plan mode · read only"]);
});

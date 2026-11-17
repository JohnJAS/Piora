import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { defaultRunningStatusLabels, RUNNING_STATUS_MAX_PROMPT_LENGTH } from "./running-status-labels.ts";

test("status generation uses the configured model without a chat turn and rejects invalid batches", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "piora-status-generation-"));
  const state = { calls: [], visible: true, text: JSON.stringify(defaultRunningStatusLabels("zh-CN")) };
  globalThis.__pioraStatusGenerationFixture = state;
  try {
    const stub = path.join(directory, "stub.ts").replaceAll("\\", "/");
    await writeFile(stub, `
      const state = globalThis.__pioraStatusGenerationFixture;
      const model = { provider:'fixture',id:'default',name:'Fixture Model' };
      export class ModelRequestCwdError extends Error {}
      export const resolveModelRequestCwd = async value => value || '/fixture';
      export const createTrustedModelServices = async () => ({ settingsManager:{getEnabledModels:()=>undefined,getDefaultProvider:()=>undefined,getDefaultModel:()=>undefined}, modelRuntime:{completeSimple:async(model,input,options)=>{state.calls.push({model,input,options});return {stopReason:'stop',content:[{type:'text',text:state.text}]};}} });
      export const readDefaultModel = () => ({provider:'fixture',modelId:'default'});
      export const resolveDefaultModelPreference = input => input.explicitDefault;
      export const resolveVisibleModels = async () => ({visible:state.visible?[model]:[]});
      export const selectInitialModelScope = (scope,options) => ({model:scope.visible.find(model=>model.id===options.defaultModel.modelId)});
    `);
    let source = await readFile(new URL("../app/api/running-status/generate/route.ts", import.meta.url), "utf8");
    for (const name of ["model-runtime-context", "model-policy", "default-model-store", "model-scope"]) source = source.replaceAll(JSON.stringify(`@/lib/${name}`), JSON.stringify(stub));
    for (const name of ["bounded-json", "request-security", "running-status-labels"]) source = source.replaceAll(JSON.stringify(`@/lib/${name}`), JSON.stringify(path.resolve("lib", `${name}.ts`).replaceAll("\\", "/")));
    const target = path.join(directory, "route.ts"); await writeFile(target, source);
    const { POST } = await createJiti(import.meta.url).import(target);
    const request = (body = { locale: "zh-CN", cwd: "/fixture" }, init = {}) => new Request("http://localhost:30141/api/running-status/generate", { method: "POST", headers: { host: "localhost:30141", "Content-Type": "application/json" }, body: JSON.stringify(body), ...init });
    const response = await POST(request());
    assert.equal(response.status, 200);
    assert.equal((await response.json()).labels.length, 50);
    assert.equal(state.calls.length, 1);
    assert.equal(state.calls[0].model.id, "default");
    assert.match(state.calls[0].input.systemPrompt, /exactly 50/);
    assert.equal(state.calls[0].input.messages.length, 1);
    assert.equal(state.calls[0].input.messages[0].content, "Generate the 50 status messages now.");
    assert.equal(state.calls[0].options.cacheRetention, "none");
    const requirements = "轻松幽默，像程序员的内心独白。\n每条 6～12 字，不要表情符号。";
    assert.equal((await POST(request({ locale: "en", cwd: "/fixture", prompt: `  ${requirements}\n ` }))).status, 200);
    const custom = state.calls.at(-1).input;
    assert.match(custom.systemPrompt, /Language: English/);
    assert.equal(custom.systemPrompt.includes(requirements), false, "writing requirements are sent as user content");
    assert.ok(custom.messages[0].content.endsWith(requirements), "the complete multiline style prompt reaches the model");
    assert.equal((await POST(request({ prompt: " \n\t " }))).status, 200);
    assert.equal(state.calls.at(-1).input.messages[0].content, state.calls[0].input.messages[0].content, "blank requirements keep default generation");
    assert.equal((await POST(request({ prompt: "风".repeat(RUNNING_STATUS_MAX_PROMPT_LENGTH) }))).status, 200);
    state.text = JSON.stringify(defaultRunningStatusLabels("zh-CN").slice(1));
    assert.equal((await POST(request())).status, 502);
    state.visible = false;
    assert.equal((await POST(request())).status, 422);
    const calls = state.calls.length;
    assert.equal((await POST(request({}, { headers: { host: "localhost:30141", origin: "https://external.invalid", "Content-Type": "application/json" } }))).status, 403);
    assert.equal((await POST(request({}, { headers: { host: "localhost:30141", "Content-Type": "text/plain" } }))).status, 415);
    assert.equal((await POST(request({ cwd: 3 }))).status, 400);
    for (const prompt of [null, 42, {}, [], "x".repeat(RUNNING_STATUS_MAX_PROMPT_LENGTH + 1)]) {
      assert.equal((await POST(request({ prompt }))).status, 400);
    }
    assert.equal((await POST(request({ padding: "x".repeat(9000) }))).status, 413);
    assert.equal(state.calls.length, calls, "invalid requests never call a model");
    state.visible = true;
    const controller = new AbortController(); controller.abort();
    assert.equal((await POST(request({}, { signal: controller.signal }))).status, 502);
    assert.equal(state.calls.length, calls, "cancelled requests never start model work");
  } finally {
    delete globalThis.__pioraStatusGenerationFixture;
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith("piora-status-generation-"));
    await rm(directory, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { runVoiceInput } = await createJiti(import.meta.url).import("./harmony/audio/audio-session.ts");
const asset = { id: "a", hash: "audio-hash", durationMs: 100 };
const profile = { targetAppId: "com.test", entry: { id: "mic" }, ready: { id: "listening" }, result: { text: "测试语料", match: "exact" }, mode: "tap" };
function fixture() {
  const state = { phase: "initial", plays: 0, entry: 0, app: "com.test", window: "1" };
  const controller = new AbortController();
  const context = { serial: "phone", signal: controller.signal, beforeDispatch() {},
    backend: { async semanticAction() { state.entry++; state.phase = "ready"; } },
    async capture() { return { serial: "phone", quality: { treeStatus: "valid", scopeComplete: true, scope: "active-windows", appId: state.app, windowId: state.window },
      nodes: [{ ref: "mic", id: "mic", bounds: { left: 0, top: 0, right: 100, bottom: 100 } }, ...(state.phase === "ready" ? [{ ref: "ready", id: "listening" }] : []), ...(state.phase === "result" ? [{ ref: "result", text: "测试语料" }] : [])] }; },
    async play() { state.plays++; state.phase = "result"; },
  };
  return { state, context, controller };
}
test("acoustic voice completes only after ready, playback and actual expected transcript", async () => {
  const { state, context } = fixture();
  const result = await runVoiceInput(profile, asset, context, 1000);
  assert.equal(result.status,"passed"); assert.equal(result.verification,"device-transcript"); assert.equal(state.plays,1);
  assert.deepEqual(result.phases.map(item=>item.phase),["enter-listening","listening-ready","playback-started","playback-completed","recognition-verified"]);
  assert.equal(JSON.stringify(result).includes("测试语料"),false);
});
test("playback with no recognized output cannot pass", async () => {
  const { context } = fixture(); context.play = async () => {};
  await assert.rejects(runVoiceInput(profile, asset, context, 1000));
});
test("wrong app and old transcript are rejected before playback or input", async () => {
  for (const setting of ["app","phase"]) {
    const {state,context}=fixture(); if(setting==="app") state.app="com.other"; else state.phase="result";
    await assert.rejects(runVoiceInput(profile,asset,context,1000)); assert.equal(state.plays,0); assert.equal(state.entry,0);
  }
});
test("push-to-talk cancellation releases its hold in the same composite scope", async () => {
  const {context,state,controller}=fixture(); let releases=0;
  context.hold=async (_point,_duration,signal)=>{ state.phase="ready"; await new Promise((resolve)=>signal.addEventListener("abort",()=>{releases++;resolve();},{once:true})); };
  context.play=async signal=>{ controller.abort(); if(signal.aborted) throw new Error("cancelled"); };
  await assert.rejects(runVoiceInput({...profile,mode:"push-to-talk",holdDurationMs:1500},asset,context,2000));
  assert.equal(releases,1);
});

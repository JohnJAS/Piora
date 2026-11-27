import assert from "node:assert/strict";
import test from "node:test";
import { defaultPredictionSettings, validatePredictionSettings, predictionContext, normalizePredictionText } from "./input-prediction.ts";
test("prediction is disabled by default and validates model and timeout", () => {
 assert.equal(defaultPredictionSettings().enabled,false);
 assert.throws(()=>validatePredictionSettings({enabled:true,model:{provider:"",modelId:"a"},timeoutMs:30000}));
 assert.throws(()=>validatePredictionSettings({enabled:true,model:null,timeoutMs:0}));
 assert.equal(validatePredictionSettings({enabled:true,model:{provider:"a",modelId:"b"},timeoutMs:5000}).timeoutMs,5000);
});
test("prediction keeps history and tool results but omits media bytes", () => {
 const context=predictionContext([{role:"user",content:"old request"},{role:"toolResult",content:[{type:"text",text:"tool output"},{type:"image",data:"base64"}]}]);
 assert.match(context,/old request/);assert.match(context,/tool output/);assert.doesNotMatch(context,/base64/);
});

test("prediction output is bounded and cannot turn into a composer command", () => {
  assert.equal(normalizePredictionText("  Please continue.  "), "Please continue.");
  assert.equal(normalizePredictionText(" /side something"), "");
  assert.equal(normalizePredictionText(" !echo example"), "");
  assert.equal(normalizePredictionText("字".repeat(1001)), "");
  assert.equal(normalizePredictionText("📌".repeat(1000)), "📌".repeat(1000));
});

import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";

function loadTypeScriptModule(relativePath) {
  const filename = path.resolve(process.cwd(), relativePath);
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(output, {
    module: loadedModule,
    exports: loadedModule.exports,
    require: createRequire(filename),
  }, { filename });
  return loadedModule.exports;
}

const { shouldShowScrollToBottom } = loadTypeScriptModule("lib/chat-scroll.ts");

test("live tail spacer alone does not reveal the scroll-to-bottom control", () => {
  assert.equal(shouldShowScrollToBottom({
    scrollHeight: 1180,
    scrollTop: 0,
    clientHeight: 600,
    transientTailHeight: 600,
    threshold: 96,
  }), false);
});

test("overflowing message content reveals the control when the user is away from the bottom", () => {
  assert.equal(shouldShowScrollToBottom({
    scrollHeight: 1500,
    scrollTop: 200,
    clientHeight: 600,
    transientTailHeight: 600,
    threshold: 96,
  }), true);
});

test("the control stays hidden near the bottom", () => {
  assert.equal(shouldShowScrollToBottom({
    scrollHeight: 1500,
    scrollTop: 830,
    clientHeight: 600,
    transientTailHeight: 600,
    threshold: 96,
  }), false);
});

test("reaching the real content bottom hides the control even with a tail spacer", () => {
  // scrollTop = contentHeight - clientHeight (300) = the scroll-to-bottom
  // target with a 600px live-tail spacer in place. The spacer must not keep
  // the button visible once the user is at the conversation's actual bottom.
  assert.equal(shouldShowScrollToBottom({
    scrollHeight: 1500,
    scrollTop: 300,
    clientHeight: 600,
    transientTailHeight: 600,
    threshold: 96,
  }), false);
});

import assert from "node:assert/strict";
import test from "node:test";

import { ModelChangeCoordinator, runModelChange } from "./model-change-coordinator.ts";

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

test("slash-created sessions finish an explicit model switch before the immediate first prompt", async () => {
  const coordinator = new ModelChangeCoordinator();
  const modelChange = deferred();
  const calls = ["set_model:start"];

  coordinator.track(modelChange.promise.then((succeeded) => {
    calls.push("set_model:end");
    return succeeded;
  }));

  const send = (async () => {
    if (await coordinator.waitForIdle()) calls.push("prompt");
  })();

  await Promise.resolve();
  assert.deepEqual(calls, ["set_model:start"]);

  modelChange.resolve(true);
  await send;
  assert.deepEqual(calls, ["set_model:start", "set_model:end", "prompt"]);
});

test("a failed explicit model switch blocks the immediate first prompt", async () => {
  const coordinator = new ModelChangeCoordinator();
  const modelChange = deferred();
  let promptCount = 0;

  coordinator.track(modelChange.promise);
  const send = (async () => {
    if (await coordinator.waitForIdle()) promptCount += 1;
  })();

  modelChange.resolve(false);
  await send;
  assert.equal(promptCount, 0);
});

test("a failed explicit model switch runs recovery and reports failure", async () => {
  let selectedModel = "new-model";
  const notices = [];
  const failure = new Error("model unavailable");

  const succeeded = await runModelChange(
    async () => { throw failure; },
    (error) => {
      selectedModel = "previous-model";
      notices.push(error);
    },
  );

  assert.equal(succeeded, false);
  assert.equal(selectedModel, "previous-model");
  assert.deepEqual(notices, [failure]);
});

test("an older failed switch cannot block a newer successful selection", async () => {
  const coordinator = new ModelChangeCoordinator();
  const olderChange = deferred();
  const newerChange = deferred();

  coordinator.track(olderChange.promise);
  const waiting = coordinator.waitForIdle();
  coordinator.track(newerChange.promise);

  newerChange.resolve(true);
  await Promise.resolve();
  olderChange.resolve(false);
  assert.equal(await waiting, true);
});

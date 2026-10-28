import assert from "node:assert/strict";
import test from "node:test";
import { findReusableTests, inspectTestJobs, selectMainPushRun } from "../scripts/reuse-main-ci-tests.mjs";

const sha = "a".repeat(40);
const run = { id: 42, head_sha: sha, head_branch: "main", event: "push", path: ".github/workflows/ci.yml", status: "in_progress" };
const jobs = () => ["ubuntu-latest", "windows-latest"].flatMap(os => [1, 2, 3, 4, 5, 6].map(shard => ({
  name: `tests / Tests (${os}, shard ${shard}/6)`, status: "completed", conclusion: "success",
})));

test("reuse selects only a main push from the CI workflow for the exact commit", () => {
  for (const changed of [{ head_sha: "b".repeat(40) }, { head_branch: "other" }, { event: "pull_request" }, { path: ".github/workflows/other.yml" }]) {
    assert.equal(selectMainPushRun([{ ...run, ...changed }], sha), null);
  }
  assert.equal(selectMainPushRun([{ ...run, head_sha: "b".repeat(40) }, run], sha), run);
});

test("all twelve distinct platform shards must finish successfully before reuse", () => {
  const complete = jobs();
  assert.equal(inspectTestJobs(run, complete), "reuse");
  assert.equal(inspectTestJobs(run, complete.slice(1)), "wait");
  assert.equal(inspectTestJobs({ ...run, status: "completed" }, complete.slice(1)), "fallback");
  for (const conclusion of ["failure", "cancelled", "skipped"]) {
    assert.equal(inspectTestJobs(run, [{ ...complete[0], conclusion }, ...complete.slice(1)]), "fallback");
  }
  assert.equal(inspectTestJobs(run, [...complete, complete[0]]), "fallback");
  assert.equal(inspectTestJobs(run, [{ ...complete[0], status: "in_progress", conclusion: null }, ...complete.slice(1)]), "wait");
});

test("waits for the matching run and completed shards before reusing them", async () => {
  let clock = 0, polls = 0;
  const result = await findReusableTests({ sha, now: () => clock, delay: async ms => { clock += ms; }, pollMs: 10,
    getRuns: async () => ++polls === 1 ? [] : [run], getJobs: async () => polls < 3 ? jobs().slice(1) : jobs() });
  assert.equal(result, "reuse");
  assert.equal(polls, 3);
});

test("missing, failed, cancelled, timed out, or unreadable CI results run the full fallback", async () => {
  const base = { sha, getRuns: async () => [run], getJobs: async () => jobs(), delay: async () => {} };
  assert.equal(await findReusableTests({ ...base, sha: "invalid" }), "fallback");
  assert.equal(await findReusableTests({ ...base, getRuns: async () => { throw new Error("unavailable"); } }), "fallback");
  assert.equal(await findReusableTests({ ...base, getJobs: async () => [{ ...jobs()[0], conclusion: "failure" }] }), "fallback");
  let clock = 0;
  assert.equal(await findReusableTests({ ...base, now: () => clock, delay: async ms => { clock += ms; }, pollMs: 10,
    missingRunWaitMs: 20, getRuns: async () => [] }), "fallback");
  clock = 0;
  assert.equal(await findReusableTests({ ...base, now: () => clock, delay: async ms => { clock += ms; }, pollMs: 10,
    maxWaitMs: 20, getJobs: async () => [] }), "fallback");
});

import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { normalizeUserInputAnswers, normalizeUserInputQuestions, userInputTimeoutMs } = await jiti.import("./user-input.ts");

test("question deadlines are finite, bounded, and default to one minute", () => {
  for (const value of [undefined, 0, -1, NaN, Infinity]) assert.equal(userInputTimeoutMs(value), 60_000);
  assert.equal(userInputTimeoutMs(1), 30_000);
  assert.equal(userInputTimeoutMs(120_000), 120_000);
  assert.equal(userInputTimeoutMs(900_000), 300_000);
});

test("normalizes structured single, multiple, and text questions", () => {
  const questions = normalizeUserInputQuestions([
    { id: "strategy", header: "Approach", question: "Which approach?", kind: "single_select", options: [{ label: "A", description: "Fast" }, { label: "B" }] },
    { id: "targets", question: "Which targets?", kind: "multi_select", options: [{ label: "Windows" }, { label: "Linux" }] },
    { id: "notes", question: "Anything else?", kind: "text", multiline: true, required: false },
  ]);
  assert.equal(questions.length, 3);
  assert.equal(questions[0].required, true);
  assert.equal(questions[2].required, false);
  assert.deepEqual(normalizeUserInputAnswers(questions, {
    strategy: ["A"], targets: ["Windows", "Linux"], notes: [],
  }), { strategy: ["A"], targets: ["Windows", "Linux"], notes: [] });
});

test("accepts the card's custom Other answer for select questions", () => {
  const questions = normalizeUserInputQuestions([
    { id: "choice", question: "Choose", kind: "single_select", options: [{ label: "A" }, { label: "B" }] },
    { id: "targets", question: "Which targets?", kind: "multi_select", options: [{ label: "Windows" }, { label: "Linux" }] },
  ]);
  assert.deepEqual(
    normalizeUserInputAnswers(questions, { choice: ["我的自定义方案"], targets: ["Windows", "移动端"] }),
    { choice: ["我的自定义方案"], targets: ["Windows", "移动端"] },
  );
});

test("rejects ambiguous schemas and malformed answers", () => {
  assert.throws(() => normalizeUserInputQuestions([]), /between 1 and 3/);
  assert.throws(() => normalizeUserInputQuestions([
    { id: "choice", question: "Choose", kind: "single_select", options: [{ label: "Only" }] },
  ]), /between 2 and 6 options/);
  const questions = normalizeUserInputQuestions([
    { id: "choice", question: "Choose", kind: "single_select", options: [{ label: "A" }, { label: "B" }] },
  ]);
  assert.throws(() => normalizeUserInputAnswers(questions, { choice: ["x".repeat(8001)] }), /invalid/);
  assert.throws(() => normalizeUserInputAnswers(questions, { choice: ["A", "B"] }), /only one selection/);
  assert.throws(() => normalizeUserInputAnswers(questions, { choice: [] }), /required/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { findHarmonyNodes, harmonyNodeCenter, resolveHarmonyNode, HarmonyError } = await jiti.import("./harmony/index.ts");

const nodes = [
  { ref: "root", type: "Column", visible: true, bounds: { left: 0, top: 0, right: 400, bottom: 800 } },
  { ref: "form", parentRef: "root", id: "login-form", type: "Column", visible: true, bounds: { left: 20, top: 100, right: 380, bottom: 600 } },
  { ref: "email", parentRef: "form", id: "email", type: "TextInput", hint: "Email", focused: true, enabled: true, visible: true, bounds: { left: 40, top: 140, right: 360, bottom: 200 } },
  { ref: "submit-a", parentRef: "form", id: "submit", type: "Button", text: "Sign in", clickable: true, enabled: true, visible: true, bounds: { left: 40, top: 240, right: 180, bottom: 300 } },
  { ref: "submit-b", parentRef: "root", type: "Button", text: "Sign in later", clickable: true, enabled: true, visible: true, bounds: { left: 40, top: 650, right: 240, bottom: 710 } },
];

test("semantic selectors combine stable fields, state, matching mode, and ancestry", () => {
  const matches = findHarmonyNodes(nodes, {
    text: "sign in",
    match: "exact",
    clickable: true,
    within: { id: "login-form" },
  });
  assert.deepEqual(matches.map((node) => node.ref), ["submit-a"]);
  assert.equal(resolveHarmonyNode(nodes, { hint: "mail", match: "contains", focused: true }).ref, "email");
});

test("ambiguous selectors fail explicitly unless the caller supplies an index", () => {
  assert.throws(
    () => resolveHarmonyNode(nodes, { text: "Sign in", match: "starts_with" }),
    (error) => error instanceof HarmonyError && error.code === "UI_TARGET_AMBIGUOUS",
  );
  assert.equal(resolveHarmonyNode(nodes, { text: "Sign in", match: "starts_with", index: 1 }).ref, "submit-b");
});

test("selector target coordinates are derived only from current bounded nodes", () => {
  assert.deepEqual(harmonyNodeCenter(nodes[3]), { x: 110, y: 270 });
  assert.throws(
    () => resolveHarmonyNode(nodes, { id: "missing" }),
    (error) => error instanceof HarmonyError && error.code === "UI_TARGET_NOT_FOUND",
  );
});

test("selector validation rejects malformed runtime values before matching", () => {
  assert.throws(
    () => findHarmonyNodes(nodes, { text: 42 }),
    (error) => error instanceof HarmonyError && error.code === "INVALID_ARGUMENT",
  );
  assert.throws(
    () => findHarmonyNodes(nodes, { id: "submit", enabled: "yes" }),
    (error) => error instanceof HarmonyError && error.code === "INVALID_ARGUMENT",
  );
  assert.throws(
    () => findHarmonyNodes(nodes, { id: "submit", match: "regex" }),
    (error) => error instanceof HarmonyError && error.code === "INVALID_ARGUMENT",
  );
  assert.equal(resolveHarmonyNode(nodes, { enabled: true, focused: true }).ref, "email");
});

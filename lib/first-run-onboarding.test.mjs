import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./first-run-onboarding.ts");
  } catch {
    return import("./first-run-onboarding.ts");
  }
}

const subject = await loadSubject();

test("first-run state is versioned and rejects malformed storage", () => {
  const active = subject.createFirstRunOnboardingState();
  assert.deepEqual(active, { version: 1, status: "active", step: "model" });
  assert.deepEqual(subject.parseFirstRunOnboardingState(JSON.stringify(active)), active);
  assert.equal(subject.parseFirstRunOnboardingState("not-json"), null);
  assert.equal(subject.parseFirstRunOnboardingState(JSON.stringify({ version: 2, status: "active", step: "model" })), null);
  assert.equal(subject.parseFirstRunOnboardingState(JSON.stringify({ version: 1, status: "active", step: "unknown" })), null);
});

test("automatic onboarding welcomes new profiles without interrupting existing users", () => {
  assert.equal(subject.resolveInitialFirstRunOnboardingState(null, 0).status, "active");
  assert.equal(subject.resolveInitialFirstRunOnboardingState(null, 3).status, "dismissed");

  const restored = subject.createFirstRunOnboardingState("active", "project");
  assert.equal(subject.resolveInitialFirstRunOnboardingState(restored, 99), restored);
});

test("steps advance in order and stop on the first-message step", () => {
  assert.equal(subject.nextFirstRunOnboardingStep("model"), "project");
  assert.equal(subject.nextFirstRunOnboardingStep("project"), "chat");
  assert.equal(subject.nextFirstRunOnboardingStep("chat"), "chat");
});

test("storage helpers preserve progress and tolerate blocked storage", () => {
  const values = new Map();
  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
  };
  const state = subject.createFirstRunOnboardingState("active", "chat");
  subject.writeFirstRunOnboardingState(storage, state);
  assert.deepEqual(subject.readFirstRunOnboardingState(storage), state);

  const blocked = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
  };
  assert.equal(subject.readFirstRunOnboardingState(blocked), null);
  assert.doesNotThrow(() => subject.writeFirstRunOnboardingState(blocked, state));
});

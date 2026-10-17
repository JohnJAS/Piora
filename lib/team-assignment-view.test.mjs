import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { teamAssignmentText } = await createJiti(import.meta.url).import("./team-assignment-view.ts");

test("model assignment exposes registered evidence and review IDs without runtime leases", () => {
  const run = {
    id: "run", phase: "synthesizing", objective: "deliver",
    plan: { successCriteria: [{ id: "correct", required: true }] },
    tasks: { task: { id: "task", title: "verify", status: "completed", dependsOn: [], acceptanceCriteria: ["read file"], lease: { token: "private-lease" }, submission: { evidenceIds: ["evidence-id"], artifactIds: ["artifact-id"] } } },
    evidence: { "evidence-id": { id: "evidence-id", kind: "observation", summary: "reread file", source: { toolName: "read", toolCallId: "read-id" } } },
    artifacts: { "artifact-id": { id: "artifact-id", name: "report.md" } },
    reviewDecisions: { review: { verdict: "approved", evidenceIds: ["evidence-id"] } },
    activeDispatches: { dispatch: { leaseTokenHash: "private-hash" } },
  };
  const text = teamAssignmentText(run, "__synthesis__");
  const model = JSON.parse(text);
  assert.equal(model.evidence["evidence-id"].source.toolCallId, "read-id");
  assert.equal(model.tasks[0].submission.evidenceIds[0], "evidence-id");
  assert.equal(model.reviewDecisions.review.verdict, "approved");
  assert.equal(model.plan.successCriteria[0].id, "correct");
  assert.doesNotMatch(text, /private-lease|private-hash|leaseToken/);
});

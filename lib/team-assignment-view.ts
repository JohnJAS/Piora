import type { TeamRunState } from "./team-types";

/** Model-visible assignment data; execution leases stay runtime-only. */
export function teamAssignmentText(run: TeamRunState, taskId: string): string {
  const tasks = Object.values(run.tasks).map((task) => ({
    id: task.id, title: task.title, description: task.description,
    acceptanceCriteria: task.acceptanceCriteria, status: task.status,
    dependsOn: task.dependsOn, submission: task.submission,
  }));
  return JSON.stringify({
    runId: run.id, objective: run.objective, phase: run.phase,
    plan: run.plan, currentTaskId: taskId, tasks,
    artifacts: run.artifacts, evidence: run.evidence, reviewDecisions: run.reviewDecisions,
  }, null, 2);
}

import type { WorkflowRun } from "../workflow-types.ts";

export const PLAN_IMPLEMENT_PREFIX = "Execute the approved plan in this conversation.";
export const PLAN_IMPLEMENT_EDITED_PREFIX = "PLEASE IMPLEMENT THIS PLAN:";

export function buildPlanImplementationPrompt(
  run: Pick<WorkflowRun, "objective" | "version" | "markdown" | "planEditedByUser">,
  markdownOverride?: string,
): string {
  const effectiveMarkdown = markdownOverride ?? run.markdown;
  const edited = Boolean(run.planEditedByUser || (markdownOverride !== undefined && markdownOverride !== run.markdown));
  if (edited) {
    return `${PLAN_IMPLEMENT_EDITED_PREFIX}\n\nObjective:\n${run.objective}\n\nApproved plan (version ${run.version}, edited by user):\n${effectiveMarkdown}`;
  }
  return `${PLAN_IMPLEMENT_PREFIX} Preserve the approved scope and report actual verification.\n\nObjective:\n${run.objective}\n\nApproved plan (version ${run.version}):\n${effectiveMarkdown}`;
}

export function isPlanImplementationMessage(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith(PLAN_IMPLEMENT_PREFIX)
    || trimmed.startsWith(PLAN_IMPLEMENT_EDITED_PREFIX)
    || /^please implement (?:this|the) plan\.?$/i.test(trimmed.trim());
}

export function isEditedPlanImplementationMessage(text: string): boolean {
  return text.trimStart().startsWith(PLAN_IMPLEMENT_EDITED_PREFIX);
}

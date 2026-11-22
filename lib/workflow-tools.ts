/** Host workflow controls are enabled by Laboratory, not project tool presets. */
export const WORKFLOW_TOOL_NAMES = ["piora_submit_plan", "piora_update_goal", "piora_update_steps"] as const;

export function isWorkflowTool(name: string): boolean {
  return (WORKFLOW_TOOL_NAMES as readonly string[]).includes(name);
}

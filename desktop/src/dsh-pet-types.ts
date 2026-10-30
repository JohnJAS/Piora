export const DSH_PET_VERSION = "0.3.8";
export type DshPetAction = "install" | "start" | "stop" | "uninstall" | "settings" | "folder" | "cancel";
export interface DshPetProgress { stage: "installer" | "package" | "dependencies"; received: number; total: number | null }
export interface DshPetStatus {
  version: string;
  installed: boolean;
  phase: "absent" | "stopped" | "installing" | "starting" | "running" | "stopping" | "error";
  autoStart: boolean;
  syncTasks: boolean;
  error: string | null;
  progress: DshPetProgress | null;
}
export interface DshPetBridge {
  status(): Promise<DshPetStatus>;
  action(action: DshPetAction): Promise<DshPetStatus>;
  preferences(value: { autoStart?: boolean; syncTasks?: boolean }): Promise<DshPetStatus>;
}

/** Deliberately contains no chat text, tool arguments, credentials or model reasoning. */
export interface PetTaskSnapshot {
  id: string;
  runtime: string;
  pendingApproval?: boolean;
  activity?: { kind: string; updatedAt?: number };
  taskRun?: { phase: string; updatedAt?: number; attempt?: number };
}
export type PetWorkState = "thinking" | "working" | "result" | "waiting" | "success" | "error";

export class PetTaskProjection {
  private previous = new Map<string, string>();
  private terminal: { state: PetWorkState; until: number } | undefined;
  reset(): void { this.previous.clear(); this.terminal = undefined; }
  update(tasks: PetTaskSnapshot[], now = Date.now()): PetWorkState | null {
    const next = new Map<string, string>();
    for (const task of tasks) {
      const phase = task.taskRun?.phase ?? task.runtime;
      const identity = `${task.taskRun?.attempt ?? 0}:${phase}`;
      next.set(task.id, identity);
      if (this.previous.has(task.id) && this.previous.get(task.id) !== identity) {
        if (phase === "completed" || phase === "failed") {
          this.terminal = { state: phase === "completed" ? "success" : "error", until: now + 8_000 };
        }
      }
    }
    this.previous = next;
    const waiting = tasks.some(task => task.pendingApproval || ["waiting_approval", "waiting_user", "blocked"].includes(task.taskRun?.phase ?? ""));
    if (waiting) { this.terminal = undefined; return "waiting"; }
    const active = tasks.filter(task => task.runtime !== "idle").sort((a, b) => (b.activity?.updatedAt ?? 0) - (a.activity?.updatedAt ?? 0))[0];
    if (active) {
      this.terminal = undefined;
      if (active.runtime === "stopping") return "waiting";
      if (active.runtime === "compacting" || active.taskRun?.phase === "verifying") return "result";
      return ["tool", "command"].includes(active.activity?.kind ?? "") ? "working" : active.activity?.kind === "assistant" ? "result" : "thinking";
    }
    return this.terminal && now < this.terminal.until ? this.terminal.state : null;
  }
}

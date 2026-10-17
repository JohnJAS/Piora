import type { RoomMessage } from "./room-types";
import type { TeamRunState } from "./team-types";

export function isCurrentRoomQuestion(message: RoomMessage | undefined, run: TeamRunState | undefined): boolean {
  return Boolean(message && run?.phase === "waiting_user" && !run.stopRequested
    && message.correlationId === `team:${run.id}:question:${run.retryGeneration ?? 0}`);
}

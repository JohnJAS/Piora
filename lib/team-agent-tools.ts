import type { TeamAgentProfile } from "./team-types";

export async function configureTeamAgentTools(
  session: { inner: { getActiveToolNames(): string[] }; send(command: { type: string; toolNames: string[] }): Promise<unknown> },
  profile: TeamAgentProfile,
): Promise<void> {
  // The coding preset excludes collaboration. Managed members still need it
  // for intake, task execution and restored sessions.
  const inherited = session.inner.getActiveToolNames();
  await session.send({ type: "set_team_tools", toolNames: profile.toolPolicy.mode === "allowlist" ? profile.toolPolicy.toolNames : [...new Set([...inherited, "piora_room"])] });
}

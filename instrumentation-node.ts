import { configureHttpDispatcher } from "@/lib/http-dispatcher";
import { startRemoteControlConnector } from "@/lib/remote-control-connector";
import { bootstrapTeamRuntime } from "@/lib/team-bootstrap";

export function registerNodeInstrumentation(): void {
  configureHttpDispatcher();
  startRemoteControlConnector();
  void bootstrapTeamRuntime().catch((error) => {
    console.error("[piora-team] startup recovery failed:", error instanceof Error ? error.message : String(error));
  });
}

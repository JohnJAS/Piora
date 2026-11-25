"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  getAgentThemeMoodSnapshot,
  publishAgentThemeMood,
  subscribeAgentThemeMood,
  type AgentMoodInput,
  type AgentThemeMoodSnapshot,
} from "@/lib/appearance/agent-mood-store";

const SERVER_SNAPSHOT: AgentThemeMoodSnapshot = Object.freeze({
  mood: "idle",
  liveMood: "idle",
  previewMood: null,
  activeTaskCount: 0,
  runningSubagentCount: 0,
  isBackgroundOnly: false,
  pulseKey: null,
  pulseKind: null,
  pulseAt: 0,
});

function getServerSnapshot(): AgentThemeMoodSnapshot {
  return SERVER_SNAPSHOT;
}

export function useAgentThemeMood(): AgentThemeMoodSnapshot {
  return useSyncExternalStore(
    subscribeAgentThemeMood,
    getAgentThemeMoodSnapshot,
    getServerSnapshot,
  );
}

export function useAgentThemeMoodPublisher(input: AgentMoodInput): void {
  const { currentActivity, runningTasks, activeSessionId } = input;
  useEffect(() => {
    publishAgentThemeMood({
      currentActivity,
      runningTasks,
      activeSessionId,
    });
  }, [activeSessionId, currentActivity, runningTasks]);
}

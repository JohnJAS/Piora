"use client";

import { useSyncExternalStore } from "react";
import {
  getFlagshipPerformanceBusSnapshot,
  subscribeFlagshipPerformanceBus,
  type FlagshipPerformanceBusState,
} from "@/lib/appearance/flagship-performance-bus";

const SERVER_SNAPSHOT: FlagshipPerformanceBusState = Object.freeze({
  activeClipId: null,
  phase: "idle",
  lastRequest: null,
});

function getServerSnapshot(): FlagshipPerformanceBusState {
  return SERVER_SNAPSHOT;
}

export function useFlagshipPerformanceBus(): FlagshipPerformanceBusState {
  return useSyncExternalStore(
    subscribeFlagshipPerformanceBus,
    getFlagshipPerformanceBusSnapshot,
    getServerSnapshot,
  );
}

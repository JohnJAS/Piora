"use client";

import { useCallback, useEffect, useState } from "react";
import {
  characterDirectorState, getCharacterSessionCue, type ComposerActivity, type SessionPhase,
} from "@/lib/character-director-state";

/** Publish the visible main conversation without putting animation on React's render loop. */
export function useCharacterDirectorState(enabled: boolean, phase: SessionPhase, cueKey?: string, cueKind?: string, cancelled = false, stopReason?: string) {
  const [source] = useState(() => Symbol("main conversation"));

  useEffect(() => {
    if (!enabled) return;
    const terminalCue = getCharacterSessionCue(cueKey, cueKind, stopReason);
    characterDirectorState.session(source, phase, terminalCue, cancelled || (cueKind === "completed" && stopReason === "aborted"));
  }, [cancelled, cueKey, cueKind, enabled, phase, source, stopReason]);

  useEffect(() => {
    if (enabled) return () => characterDirectorState.release(source);
  }, [enabled, source]);

  const publishComposer = useCallback((activity: ComposerActivity) => {
    characterDirectorState.composer(source, activity);
  }, [source]);
  return enabled ? publishComposer : undefined;
}

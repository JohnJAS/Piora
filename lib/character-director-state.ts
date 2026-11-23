export const CHARACTER_STATES = [
  "idle", "user_typing", "thinking", "working_tools", "streaming", "waiting_approval",
  "success", "error", "sleepy", "greet",
] as const;

export type CharacterState = typeof CHARACTER_STATES[number];
export type ComposerActivity = "focus" | "input" | "blur";
export type SessionPhase = "idle" | "thinking" | "working_tools" | "streaming" | "waiting_approval" | "error";

export const CHARACTER_IDLE_MS = 10 * 60_000;
export const CHARACTER_SUCCESS_MS = 3_500;
export const CHARACTER_GREET_COOLDOWN_MS = 5_000;
const GREETING_MS = 2_200;
const TYPING_THROTTLE_MS = 250;
const TYPING_HOLD_MS = 1_200;

export type SessionCue = { key: string; kind: "started" | "completed" | "failed" };

export function getCharacterSessionCue(key: string | undefined, kind: string | undefined, stopReason?: string): SessionCue | undefined {
  if (!key || (kind !== "started" && kind !== "completed" && kind !== "failed")) return;
  // The journal can absorb a provider failure into the assistant reply and
  // dismiss its transient notice before the busy flag settles.
  if (kind === "completed" && stopReason === "error") return { key: key + "/reply-error", kind: "failed" };
  return { key, kind };
}

export function getCharacterSessionPhase(signals: {
  approval: boolean;
  retrying: boolean;
  tools: boolean;
  streamingText: boolean;
  busy: boolean;
}): SessionPhase {
  if (signals.approval) return "waiting_approval";
  if (signals.retrying) return "error";
  if (signals.tools) return "working_tools";
  if (signals.streamingText) return "streaming";
  return signals.busy ? "thinking" : "idle";
}

export function createCharacterDirectorState(now = () => performance.now()) {
  let owner: symbol | undefined;
  let phase: SessionPhase = "idle";
  let lastCue: string | undefined;
  let lastInteraction = now();
  let lastTyping = -Infinity;
  let typingUntil = -Infinity;
  let lastGreeting = -Infinity;
  let terminal: { state: "success" | "error"; until: number } | undefined;

  function clearSession() {
    phase = "idle";
    lastCue = undefined;
    terminal = undefined;
    typingUntil = lastTyping = -Infinity;
  }

  return {
    session(source: symbol, next: SessionPhase, cue?: SessionCue, cancelled = false) {
      if (owner !== source) {
        clearSession();
        owner = source;
      }
      const time = now();
      if (phase !== "idle" && next === "idle") lastInteraction = time;
      if (phase === "idle" && next !== "idle") {
        terminal = undefined;
        typingUntil = -Infinity;
      }
      phase = next;
      if (!cue || cue.key === lastCue) return;
      lastCue = cue.key;
      if (cue.kind === "started") terminal = undefined;
      else if (!cancelled) {
        terminal = { state: cue.kind === "completed" ? "success" : "error", until: time + CHARACTER_SUCCESS_MS };
        lastInteraction = time;
      }
    },
    release(source: symbol) {
      if (owner !== source) return;
      owner = undefined;
      clearSession();
    },
    composer(source: symbol, activity: ComposerActivity) {
      if (owner !== source) return;
      const time = now();
      lastInteraction = time;
      if (activity === "blur") {
        typingUntil = lastTyping = -Infinity;
      } else if (time - lastTyping >= TYPING_THROTTLE_MS) {
        lastTyping = time;
        typingUntil = time + TYPING_HOLD_MS;
      }
    },
    interact() {
      lastInteraction = now();
    },
    greet() {
      const time = now();
      lastInteraction = time;
      if (phase !== "idle" || (terminal && time < terminal.until) || time - lastGreeting < CHARACTER_GREET_COOLDOWN_MS) return false;
      lastGreeting = time;
      return true;
    },
    state(): CharacterState {
      const time = now();
      if (phase !== "idle") return phase;
      if (terminal && time < terminal.until) return terminal.state;
      if (time - lastGreeting < GREETING_MS) return "greet";
      if (time < typingUntil) return "user_typing";
      return time - lastInteraction >= CHARACTER_IDLE_MS ? "sleepy" : "idle";
    },
  };
}

// The main chat and background share a document in both desktop and web mode.
export const characterDirectorState = createCharacterDirectorState();

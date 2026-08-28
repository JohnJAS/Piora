import type { Locale } from "./i18n/types";
import type { CompanionActivityStatus } from "./companion";
import type { TaskRuntimeActivityKind, TaskRuntimeSnapshot } from "./task-status";

/**
 * Pure presentation behavior for the companion pets: idle trick variety,
 * interaction reactions, speech lines, and agent-state presentation. Nothing
 * here touches the network or the agent runtime.
 */

export type CompanionInteractionKind = "poke";

export interface CompanionTaskPresentation {
  status: CompanionActivityStatus;
  activityKind: TaskRuntimeActivityKind | "idle" | "failed" | "review";
}

/**
 * Normalizes the agent runtime into pet-facing state. The task stream remains
 * the source of truth; the pet never guesses work from timers or chat text.
 */
export function deriveCompanionTaskPresentation(
  snapshot: Pick<TaskRuntimeSnapshot, "runtime" | "pendingApproval" | "lastPromptFailed" | "activity" | "taskRun">,
): CompanionTaskPresentation {
  if (snapshot.lastPromptFailed || snapshot.taskRun?.phase === "failed") {
    return { status: "failed", activityKind: "failed" };
  }
  if (
    snapshot.pendingApproval
    || snapshot.activity?.kind === "approval"
    || snapshot.taskRun?.phase === "waiting_approval"
    || snapshot.taskRun?.phase === "waiting_user"
  ) {
    return { status: "review", activityKind: "review" };
  }
  if (snapshot.runtime === "idle") return { status: "idle", activityKind: "idle" };
  if (snapshot.activity?.kind === "thinking" || snapshot.activity?.kind === "retry") {
    return { status: "waiting", activityKind: snapshot.activity.kind };
  }
  if (snapshot.runtime === "compacting") return { status: "running", activityKind: "compacting" };
  return { status: "running", activityKind: snapshot.activity?.kind ?? "prompt" };
}

export const COMPANION_WANDER_MIN_DELAY_MS = 10_000;
export const COMPANION_WANDER_EXTRA_DELAY_MS = 14_000;

export function getCompanionWanderDelay(random: () => number = Math.random): number {
  return Math.round(COMPANION_WANDER_MIN_DELAY_MS + random() * COMPANION_WANDER_EXTRA_DELAY_MS);
}

export function isCompanionInteractionKind(value: unknown): value is CompanionInteractionKind {
  return value === "poke";
}

/** Reaction animation preferences per interaction, ordered best-first. */
const INTERACTION_STATE_PREFERENCES: Record<CompanionInteractionKind, readonly string[]> = {
  poke: ["jumping", "bounce", "look-directions-a", "waving", "idle"],
};

const IDLE_TRICK_STATE_PREFERENCES: readonly string[] = [
  "waving", "jumping", "look-directions-a", "look-directions-b", "bounce", "spin", "dance",
];

/**
 * Picks a one-shot animation for an interaction or idle trick. Prefers the
 * pet-specific chain, avoids repeating the previous choice while a different
 * candidate exists, and returns null when the sprite has no suitable state.
 */
export function pickCompanionReactionStateId(
  availableIds: readonly string[],
  preferenceChain: readonly string[],
  previousId?: string | null,
  random: () => number = Math.random,
): string | null {
  const available = new Set(availableIds);
  const candidates = preferenceChain.filter((id) => available.has(id));
  if (candidates.length === 0) return null;
  const varied = candidates.filter((id) => id !== previousId);
  const pool = varied.length > 0 ? varied : candidates;
  return pool[Math.floor(random() * pool.length)] ?? null;
}

export function pickCompanionIdleTrickStateId(
  availableIds: readonly string[],
  previousId?: string | null,
  random: () => number = Math.random,
): string | null {
  return pickCompanionReactionStateId(availableIds, IDLE_TRICK_STATE_PREFERENCES, previousId, random);
}

export function pickCompanionInteractionStateId(
  availableIds: readonly string[],
  kind: CompanionInteractionKind,
  previousId?: string | null,
  random: () => number = Math.random,
): string | null {
  return pickCompanionReactionStateId(availableIds, INTERACTION_STATE_PREFERENCES[kind], previousId, random);
}

// ---------------------------------------------------------------------------
// Speech lines
// ---------------------------------------------------------------------------

export type CompanionSpeechCategory =
  | "started" | "completed" | "failed"
  | "idle" | "running" | "waiting" | "review"
  | "poke";

const SPEECH_LINES: Record<CompanionSpeechCategory, Record<Locale, readonly string[]>> = {
  started: {
    "zh-CN": ["开工啦，看我的！", "收到，这就去搬砖。", "让我来搞定～"],
    en: ["On it — watch me go!", "Got it, digging in now.", "Leave this one to me~"],
  },
  completed: {
    "zh-CN": ["搞定！快来验收～", "任务完成，求表扬！", "收工啦，休息一下？"],
    en: ["All done — come take a look!", "Task complete. Praise, please!", "Wrapped up! Break time?"],
  },
  failed: {
    "zh-CN": ["呜…出了点问题，需要你看看。", "这次没成功，别担心，我再试试。", "有个错误，等你来救场。"],
    en: ["Um… something broke. Need you.", "That did not work. I will retry.", "An error popped up — help?"],
  },
  idle: {
    "zh-CN": ["发呆中…有任务随时叫我。", "顺便一提，今天也要加油哦。", " zzZ…啊，我没睡着！", "在等你的新指令呢～"],
    en: ["Idling… call me anytime.", "Random tip: you are doing great.", "zzZ… I was not asleep!", "Waiting for your next idea~"],
  },
  running: {
    "zh-CN": ["努力工作中，稍等哦。", "正在翻文件、改代码…", "别急，马上就好！"],
    en: ["Working hard, hang tight.", "Reading files, editing code…", "Almost there — promise!"],
  },
  waiting: {
    "zh-CN": ["喂，轮到你啦！", "我在等你的回复哦～", "需要你输入，快回来！"],
    en: ["Hey, your turn!", "Still waiting on you~", "Need your input — come back!"],
  },
  review: {
    "zh-CN": ["改动好了，等你审阅！", "有一份变更需要你确认。", "验收时间到，快看看吧～"],
    en: ["Changes ready for review!", "One diff awaits your approval.", "Review time — take a look~"],
  },
  poke: {
    "zh-CN": ["嘿嘿，好痒！", "戳我干嘛呀～", "变焦！(左右张望)", "再戳我就要跳起来了哦！", "是你呀！有事吗？"],
    en: ["Hehe, that tickles!", "Why the poke~", "Whoa! *(looks around)*", "Poke me again and I jump!", "Oh hi! Need something?"],
  },
};

export function listCompanionSpeechLines(category: CompanionSpeechCategory, locale: Locale): readonly string[] {
  const byLocale = SPEECH_LINES[category];
  return byLocale[locale] ?? byLocale.en;
}

export function pickCompanionSpeechLine(
  category: CompanionSpeechCategory,
  locale: Locale,
  previousLine?: string | null,
  random: () => number = Math.random,
): string {
  const lines = listCompanionSpeechLines(category, locale);
  if (lines.length === 0) return "";
  const varied = lines.filter((line) => line !== previousLine);
  const pool = varied.length > 0 ? varied : lines;
  return pool[Math.floor(random() * pool.length)] ?? "";
}

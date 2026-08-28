import type { Locale } from "./i18n/types";

/**
 * Pure presentation behavior for the companion pets: idle trick variety,
 * interaction reactions, speech lines, and the lightweight care loop. Nothing
 * here touches the network or the agent runtime.
 */

export type CompanionInteractionKind = "poke" | "feed" | "water" | "pet";

export function isCompanionInteractionKind(value: unknown): value is CompanionInteractionKind {
  return value === "poke" || value === "feed" || value === "water" || value === "pet";
}

export type CompanionCareNeedId = "hunger" | "thirst" | "affection";

export interface CompanionCareTimestamps {
  fedAt: number;
  wateredAt: number;
  pettedAt: number;
}

/** Reaction animation preferences per interaction, ordered best-first. */
const INTERACTION_STATE_PREFERENCES: Record<CompanionInteractionKind, readonly string[]> = {
  poke: ["jumping", "bounce", "look-directions-a", "waving", "idle"],
  feed: ["waving", "jumping", "bounce", "idle"],
  water: ["waving", "bounce", "jumping", "idle"],
  pet: ["waving", "look-directions-b", "bounce", "idle"],
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
  | "poke" | "feed" | "water" | "pet"
  | "hungry" | "thirsty" | "lonely";

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
    "zh-CN": ["发呆中…有任务随时叫我。", "顺便一提，今天也要加油哦。", " zzZ…啊，我没睡着！", "在等你的新指令呢～", "要不要摸摸我？"],
    en: ["Idling… call me anytime.", "Random tip: you are doing great.", "zzZ… I was not asleep!", "Waiting for your next idea~", "A pet would be nice, you know."],
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
  feed: {
    "zh-CN": ["开饭啦！谢谢投喂～", "唔，吃饱了！", "这个好吃！"],
    en: ["Yum — thanks for the snack!", "Mmph… full now!", "Tasty!"],
  },
  water: {
    "zh-CN": ["咕嘟咕嘟…谢谢！", "喝水喝水，代码不秃。", "清爽！"],
    en: ["Glug glug… thanks!", "Hydrated, ready to code.", "Refreshing!"],
  },
  pet: {
    "zh-CN": ["好舒服～再摸摸。", "最喜欢你了！", "咕噜咕噜…(蹭)"],
    en: ["So cozy… more please.", "You are the best!", "Purr… *(leans in)*"],
  },
  hungry: {
    "zh-CN": ["肚子饿了…有吃的吗？", "饿到跑不动了，投喂一下嘛。"],
    en: ["So hungry… got a snack?", "Too hungry to run. Feed me?"],
  },
  thirsty: {
    "zh-CN": ["口渴了…想喝水。", "嗓子冒烟啦，来点水？"],
    en: ["Thirsty… water please?", "Throat is dry — some water?"],
  },
  lonely: {
    "zh-CN": ["好久没被摸摸头了…", "有点孤单，陪我玩会儿？"],
    en: ["No head pats in ages…", "A bit lonely — play with me?"],
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

// ---------------------------------------------------------------------------
// Care loop: needs decay over real time and are restored by user actions.
// Deliberately tamagotchi-lite: no death, no punishment — low needs only make
// the pet ask for attention.
// ---------------------------------------------------------------------------

export const COMPANION_CARE_DECAY_MS: Record<CompanionCareNeedId, number> = {
  hunger: 6 * 60 * 60 * 1000,
  thirst: 4 * 60 * 60 * 1000,
  affection: 12 * 60 * 60 * 1000,
};

/** Needs at or below this level count as "needs attention" for nagging. */
export const COMPANION_CARE_NEED_THRESHOLD = 25;

export const COMPANION_CARE_NEED_IDS: readonly CompanionCareNeedId[] = ["hunger", "thirst", "affection"];

export function getCompanionCareLevel(
  need: CompanionCareNeedId,
  timestamps: CompanionCareTimestamps,
  now: number,
): number {
  const key = need === "hunger" ? "fedAt" : need === "thirst" ? "wateredAt" : "pettedAt";
  const lastAt = Number.isFinite(timestamps[key]) ? timestamps[key] : 0;
  const elapsed = Math.max(0, now - lastAt);
  const decay = COMPANION_CARE_DECAY_MS[need];
  if (elapsed >= decay) return 0;
  return Math.round(100 * (1 - elapsed / decay));
}

export function getCompanionCareLevels(
  timestamps: CompanionCareTimestamps,
  now: number,
): Record<CompanionCareNeedId, number> {
  return {
    hunger: getCompanionCareLevel("hunger", timestamps, now),
    thirst: getCompanionCareLevel("thirst", timestamps, now),
    affection: getCompanionCareLevel("affection", timestamps, now),
  };
}

export function listCompanionCareNeeds(levels: Record<CompanionCareNeedId, number>): CompanionCareNeedId[] {
  return COMPANION_CARE_NEED_IDS.filter((need) => (levels[need] ?? 100) <= COMPANION_CARE_NEED_THRESHOLD);
}

export type CompanionCareMood = "happy" | "content" | "uneasy" | "unhappy";

export function deriveCompanionCareMood(levels: Record<CompanionCareNeedId, number>): CompanionCareMood {
  const lowest = Math.min(...COMPANION_CARE_NEED_IDS.map((need) => levels[need] ?? 100));
  if (lowest >= 70) return "happy";
  if (lowest >= 40) return "content";
  if (lowest >= 15) return "uneasy";
  return "unhappy";
}

/** Records a care action; "poke" deliberately does not change care state. */
export function applyCompanionCareAction(
  timestamps: CompanionCareTimestamps,
  action: Exclude<CompanionInteractionKind, "poke"> | CompanionCareNeedId,
  now: number,
): CompanionCareTimestamps {
  if (action === "feed" || action === "hunger") return { ...timestamps, fedAt: now };
  if (action === "water" || action === "thirst") return { ...timestamps, wateredAt: now };
  if (action === "pet" || action === "affection") return { ...timestamps, pettedAt: now };
  return { ...timestamps };
}

export function normalizeCompanionCareTimestamps(value: unknown, now: number): CompanionCareTimestamps {
  const record = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const read = (key: string): number => {
    const raw = record[key];
    return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : now;
  };
  return { fedAt: read("fedAt"), wateredAt: read("wateredAt"), pettedAt: read("pettedAt") };
}

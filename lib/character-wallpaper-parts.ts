import { partsA } from "./character-wallpaper-parts-a";
import { partsB } from "./character-wallpaper-parts-b";

type Point = readonly [x: number, y: number];
export interface WallpaperPart {
  name: string;
  pivot: Point;
  outline: readonly Point[];
  holes?: readonly (readonly Point[])[];
  angle: number;
  follow: number;
  rigid?: boolean;
  parent?: readonly [shoulderX: number, shoulderY: number, upperArmRadius: number, angle: number];
  tether?: readonly [anchorX: number, anchorY: number, falloff: number];
}

const parts: Record<string, WallpaperPart[]> = { ...partsA, ...partsB };

// Rest, anticipation, accent, hold, recovery. Each time is in seconds.
// A dragon opens its wing and suspends the crystal; a listening ear perks
// up quickly and settles twice. The painted pose determines the performance.
const gestures = {
  unfurl: [0.24, 0.68, 2.35, 3.30, 5.10, 8.9],
  listen: [0.40, 0.84, 1.30, 1.85, 3.18, 6.8],
  read:   [0.38, 0.94, 2.24, 3.08, 4.68, 8.5],
  offer:  [0.26, 0.76, 1.92, 2.98, 4.42, 7.9],
  play:   [0.30, 0.66, 1.57, 2.05, 3.52, 6.6],
  float:  [0.16, 0.68, 2.52, 3.00, 5.48, 8.6],
} as const;

const choreography: Record<string, keyof typeof gestures> = {
  "claude-autumn": "read", "claude-lamp": "read", "claude-paper": "offer",
  "ernie-garden": "read", "gemini-prism": "listen", "glm-ink": "listen",
  "gpt-cloud": "float", "gpt-ivory": "unfurl", "gpt-orbit": "unfurl",
  "grok-eclipse": "unfurl", "kimi-moon": "play",
  "kitty-moon": "offer", "kitty-ribbon": "listen", "kitty-strawberry": "offer",
  "minimax-coral": "play", "qwen-porcelain": "unfurl", "seed-scarf": "float",
  "seed-soda": "play", "whale-abyss": "float", "whale-rice": "offer", "whale-tide": "offer",
};

export function getCharacterPerformance(id: string) {
  const gesture = choreography[id.replace(/^character-/, "")];
  if (!gesture || !Object.hasOwn(parts, id)) throw new Error("Missing character choreography: " + id);
  return { parts: parts[id], beats: gestures[gesture] };
}

export type CharacterPerformance = ReturnType<typeof getCharacterPerformance>;

export function partBounds(part: WallpaperPart): [number, number, number, number] {
  const xs = part.outline.map(([x]) => x);
  const ys = part.outline.map(([, y]) => y);
  const x = Math.floor(Math.min(...xs)) - 4;
  const y = Math.floor(Math.min(...ys)) - 4;
  return [x, y, Math.ceil(Math.max(...xs)) + 5 - x, Math.ceil(Math.max(...ys)) + 5 - y];
}

export function gestureAt(time: number, beats: CharacterPerformance["beats"]) {
  const [start, anticipation, accent, hold, recover, repeat] = beats;
  const t = Math.max(0, time) % repeat;
  function ease(a: number, b: number) {
    const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
    return x * x * (3 - 2 * x);
  }
  return -0.13 * ease(start, anticipation) + 1.13 * ease(anticipation, accent)
    - 1.07 * ease(hold, recover) + 0.07 * ease(recover, recover + 0.65);
}

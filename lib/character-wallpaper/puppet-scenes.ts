export type PuppetScene = "paper" | "lamp" | "autumn";

type Vignette = {
  head: number;
  reach: number;
  chin: number;
  page: number;
  smile: number;
  gazeX: number;
  gazeY: number;
  carry: number;
  write: number;
  glow: number;
};
type Beat = { at: number; motion: Partial<Vignette> };

const REST: Vignette = {
  head: 0, reach: 0, chin: 0, page: 0, smile: 0,
  gazeX: 0, gazeY: 0, carry: 0, write: 0, glow: 0,
};
const CHANNELS = Object.keys(REST) as (keyof Vignette)[];

const VIGNETTES: Record<Exclude<PuppetScene, "paper">, Beat[]> = {
  lamp: [
    { at: 0, motion: {} },
    { at: 0.6, motion: { head: 3, gazeX: 0.45, glow: 1 } },
    { at: 1.47, motion: { head: 6, reach: 1, gazeX: 0.65, gazeY: 0.5, carry: 1, glow: 0.5 } },
    { at: 2.05, motion: { head: 8, reach: 1, gazeX: 0.72, gazeY: 0.68, carry: 1, glow: 0.15 } },
    { at: 2.8, motion: { head: 4, reach: 1, gazeX: -0.5, gazeY: 0.6, carry: 1, glow: 0.2 } },
    { at: 3.59, motion: { head: 2, reach: 0.12, carry: 0.12, glow: 0.34 } },
    { at: 4.11, motion: { head: -5, smile: 1, glow: 0.48 } },
    { at: 4.75, motion: {} },
  ],
  autumn: [
    { at: 0, motion: {} },
    { at: 0.69, motion: { head: 6, chin: 1, gazeX: 0.65, gazeY: -0.45 } },
    { at: 1.19, motion: { head: 9, chin: 1, gazeX: 0.78, gazeY: -0.2 } },
    { at: 1.97, motion: { head: -8, reach: 1, gazeX: -0.52, gazeY: 0.72, write: 1 } },
    { at: 2.67, motion: { head: -10, reach: 1, gazeX: -0.65, gazeY: 0.78, write: 1, page: 0.08 } },
    { at: 2.99, motion: { head: -5, reach: 1, gazeX: -0.45, gazeY: 0.6, page: 1 } },
    { at: 3.58, motion: { head: -4, reach: 0.26, gazeX: -0.22, gazeY: 0.1 } },
    { at: 4.08, motion: { head: 5, gazeX: 0.08, smile: 1 } },
    { at: 4.75, motion: {} },
  ],
};

export function sampleVignette(scene: Exclude<PuppetScene, "paper">, seconds: number) {
  const beats = VIGNETTES[scene];
  if (seconds <= 0 || seconds >= beats[beats.length - 1].at) {
    return { motion: REST, active: seconds === 0 };
  }
  const index = beats.findIndex((beat) => seconds <= beat.at);
  const before = beats[index - 1], after = beats[index];
  const t = (seconds - before.at) / (after.at - before.at);
  const eased = t * t * (3 - 2 * t);
  const motion = { ...REST };
  for (const key of CHANNELS) {
    const from = before.motion[key] ?? REST[key], to = after.motion[key] ?? REST[key];
    motion[key] = from + (to - from) * eased;
  }
  return { motion, active: true };
}

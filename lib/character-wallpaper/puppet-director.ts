import type { CharacterState } from "../character-director-state";
import { sampleVignette, type PuppetScene } from "./puppet-scenes.ts";

export const HANDS = ["idle", "page_turn", "chin_rest", "wave_greet"] as const;
export const EXPRESSIONS = ["neutral", "smile", "thinking", "focused", "worried", "sleepy"] as const;
export const BLINKS = ["open", "half", "closed"] as const;
export const MOUTHS = ["closed", "half", "open"] as const;

type Pose = {
  lean: number; lift: number; head: number; headX: number; headY: number;
  arm: number; book: number; page: number; breath: number; talk: number; wave: number;
};
type Stance = {
  motion: Partial<Pose>;
  face: typeof EXPRESSIONS[number];
  hand: typeof HANDS[number];
};

const STANCES: Record<CharacterState, Stance> = {
  idle: { motion: {}, face: "neutral", hand: "idle" },
  user_typing: {
    motion: { lean: 2.9, lift: -2, head: -5, headX: -5, headY: 3, book: -3 }, face: "focused", hand: "idle",
  },
  thinking: {
    motion: { lean: 2.1, head: 8, headX: -2, headY: -4, arm: -6, book: 3 }, face: "thinking", hand: "chin_rest",
  },
  working_tools: {
    motion: { lean: 3.2, head: -7, headY: 6, arm: 4, book: -2, page: 0.6 }, face: "focused", hand: "page_turn",
  },
  streaming: {
    motion: { lean: -1.8, lift: -5, head: 3.5, headX: -5, headY: -5, book: 2, talk: 1 }, face: "neutral", hand: "idle",
  },
  waiting_approval: {
    motion: { lean: 1, lift: -5, head: -3.5, headX: -6, headY: -5, arm: -6 }, face: "thinking", hand: "wave_greet",
  },
  success: {
    motion: { lean: -2.5, lift: -6, head: 5, headY: -2, arm: -6, wave: 0.65 }, face: "smile", hand: "wave_greet",
  },
  error: {
    motion: { lean: -4, lift: 2, head: -5, headY: 4, arm: 4, breath: 0.74 }, face: "worried", hand: "idle",
  },
  sleepy: {
    motion: { lean: 4, lift: 5, head: -8, headX: -2, headY: 10, arm: 6, breath: 0.55 }, face: "sleepy", hand: "idle",
  },
  greet: {
    motion: { lean: -2, lift: -4, head: 7, headX: -4, headY: -3, arm: -9, wave: 1 }, face: "smile", hand: "wave_greet",
  },
};

const NEUTRAL: Pose = {
  lean: 0, lift: 0, head: 0, headX: 0, headY: 0, arm: 0, book: 0, page: 0, breath: 1, talk: 0, wave: 0,
};
const POSE_CHANNELS = Object.keys(NEUTRAL) as (keyof Pose)[];

type Spring = { value: number; intermediate: number };
type Oscillator = { value: number; velocity: number };

const spring = (value = 0): Spring => ({ value, intermediate: value });
const oscillator = (): Oscillator => ({ value: 0, velocity: 0 });
const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const smoothstep = (t: number) => t * t * (3 - 2 * t);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Exact critically damped update. Retargeting keeps both position and velocity. */
export function approach(channel: Spring, target: number, dt: number, rate: number) {
  const decay = Math.exp(-rate * dt);
  const displacement = channel.intermediate - target;
  channel.value = target + ((channel.value - target) + rate * dt * displacement) * decay;
  channel.intermediate = target + displacement * decay;
  return channel.value;
}

/** Secondary motion is slightly underdamped so a joint's motion outlives its driver. */
export function swing(channel: Oscillator, target: number, dt: number, speed: number) {
  const damping = speed * 0.63;
  const frequency = Math.sqrt(speed * speed - damping * damping);
  const decay = Math.exp(-damping * dt);
  const a = channel.value - target;
  const b = (channel.velocity + damping * a) / frequency;
  const sine = Math.sin(frequency * dt);
  const cosine = Math.cos(frequency * dt);
  const offset = a * cosine + b * sine;
  channel.value = target + decay * offset;
  channel.velocity = decay * (frequency * (-a * sine + b * cosine) - damping * offset);
  return channel.value;
}

// Head lowers, the reaching hand pauses at the page, then she reads and looks up.
// The zero tangents between beats keep the pose and its first derivative continuous.
const PAGE_BEATS = [
  { at: 0, head: 0, reach: 0, page: 0, smile: 0 },
  { at: 0.56, head: -8, reach: 0.28, page: 0, smile: 0 },
  { at: 1.10, head: -8, reach: 1, page: 0.1, smile: 0 },
  { at: 1.55, head: -6, reach: 1, page: 1, smile: 0 },
  { at: 1.87, head: -8, reach: 0.84, page: 0, smile: 0 },
  { at: 2.40, head: -5, reach: 0.32, page: 0, smile: 0 },
  { at: 2.92, head: 4, reach: 0, page: 0, smile: 0.9 },
  { at: 3.6, head: 0, reach: 0, page: 0, smile: 0 },
];

export function samplePageTurn(time: number) {
  if (time <= 0) return PAGE_BEATS[0];
  for (let index = 1; index < PAGE_BEATS.length; index++) {
    const a = PAGE_BEATS[index - 1], b = PAGE_BEATS[index];
    if (time > b.at) continue;
    const t = smoothstep((time - a.at) / (b.at - a.at));
    return { at: time, head: mix(a.head, b.head, t), reach: mix(a.reach, b.reach, t), page: mix(a.page, b.page, t), smile: mix(a.smile, b.smile, t) };
  }
  return PAGE_BEATS[PAGE_BEATS.length - 1];
}

function threeFrames(intensity: number, weights: Float32Array) {
  const half = smoothstep(clamp(intensity * 2));
  const close = smoothstep(clamp(intensity * 2 - 1));
  weights[0] = 1 - half;
  weights[1] = half - close;
  weights[2] = close;
}

function blendFrames<T>(names: readonly T[], current: T, channels: Spring[], weights: Float32Array, dt: number, rate: number) {
  for (let index = 0; index < names.length; index++) {
    weights[index] = approach(channels[index], names[index] === current ? 1 : 0, dt, rate);
  }
}

export function createPuppetDirector(random = Math.random, scene: PuppetScene = "paper") {
  const channels = Object.fromEntries(POSE_CHANNELS.map((key) => [key, spring(NEUTRAL[key])])) as Record<keyof Pose, Spring>;
  const pose = {
    ...NEUTRAL, gazeX: 0, gazeY: 0, backHair: 0, bangs: 0, ornament: 0, silk: 0,
    pageRunning: false, storyRunning: false, bookCarry: 0, wristX: 0, wristY: 0, glow: 0,
  };
  const handChannels = HANDS.map((_, i) => spring(i === 0 ? 1 : 0));
  const faceChannels = EXPRESSIONS.map((_, i) => spring(i === 0 ? 1 : 0));
  const hand = new Float32Array(HANDS.length);
  const expression = new Float32Array(EXPRESSIONS.length);
  const blink = new Float32Array(BLINKS.length);
  const mouth = new Float32Array(MOUTHS.length);
  const gazeX = spring(), gazeY = spring(), storyWeight = spring();
  const toolStroke = spring();
  const backHair = oscillator(), bangs = oscillator(), ornament = oscillator(), silk = oscillator();
  let time = 0;
  let breathTime = 0;
  let idleSeconds = 0;
  let nextStory = 12 + random() * 12;
  let storyTime = Infinity;
  let forcedPageTurn = false;
  let nextBlink = 3.2 + random() * 3.3;
  let blinkTime = Infinity;

  return {
    playPageTurn() { forcedPageTurn = true; },
    step(dt: number, state: CharacterState, pointerX = 0, pointerY = 0) {
      const stance = STANCES[state];
      time += dt;
      if (state === "idle") idleSeconds += dt;
      if (state === "idle" && (forcedPageTurn || idleSeconds >= nextStory)) {
        forcedPageTurn = false;
        storyTime = 0;
        idleSeconds = 0;
        nextStory = 12 + random() * 12;
      }

      const vignette = scene === "paper" ? null : sampleVignette(scene, storyTime);
      const story = vignette?.motion ?? samplePageTurn(storyTime);
      const storyOn = vignette?.active ?? (storyTime < PAGE_BEATS[PAGE_BEATS.length - 1].at);
      const share = approach(storyWeight, state === "idle" ? 1 : 0, dt, 12);
      storyTime += dt;

      for (const key of POSE_CHANNELS) {
        pose[key] = approach(channels[key], stance.motion[key] ?? NEUTRAL[key], dt, 10);
      }
      blendFrames(HANDS, stance.hand, handChannels, hand, dt, 13);
      blendFrames(EXPRESSIONS, stance.face, faceChannels, expression, dt, 14);
      const reach = share * story.reach;
      const chin = share * (vignette?.motion.chin ?? 0);
      const otherHands = 1 - reach - chin;
      hand[0] *= otherHands;
      hand[1] = hand[1] * otherHands + reach;
      hand[2] = hand[2] * otherHands + chin;
      hand[3] *= otherHands;
      const smile = share * story.smile;
      for (let index = 0; index < expression.length; index++) {
        expression[index] = mix(expression[index], index === 1 ? 1 : 0, smile);
      }

      breathTime += pose.breath * dt;
      pose.lift += (1 - Math.cos(breathTime * 2 * Math.PI / 4.6)) * -1.65;
      pose.lean += Math.sin(time * 2 * Math.PI / 9) * 0.7 + reach * 1.9;
      pose.head += story.head * share + Math.sin(time * 3.1) * (pose.wave * 1.9 + pose.talk);
      pose.headY += reach * 3.5;
      pose.arm += reach * (scene === "lamp" ? 3 : -8) + pose.wave * Math.sin(time * 9.4) * 6.5;
      pose.page = clamp(story.page * share + pose.page * (0.5 - 0.5 * Math.cos(time * 2.85)));
      pose.bookCarry = share * (vignette?.motion.carry ?? 0);
      pose.book += pose.page * -3.4 - pose.bookCarry * 8;
      const toolWriting = approach(toolStroke, scene === "autumn" && state === "working_tools" ? 0.62 : 0, dt, 13);
      const writing = clamp(share * (vignette?.motion.write ?? 0) + toolWriting);
      pose.wristX = writing * Math.sin(time * 12) * 4;
      pose.wristY = writing * Math.cos(time * 12) * 2.4;
      pose.glow = share * (vignette?.motion.glow ?? 0);
      pose.storyRunning = storyOn;
      pose.pageRunning = scene === "paper" ? storyOn : storyOn && pose.page > 0.05;
      const storyX = share * (vignette?.motion.gazeX ?? 0);
      const storyY = share * (vignette?.motion.gazeY ?? 0);
      pose.gazeX = approach(gazeX, clamp(pointerX + storyX, -1, 1), dt, 8);
      pose.gazeY = approach(gazeY, clamp(pointerY + storyY, -1, 1), dt, 8);
      pose.backHair = swing(backHair, pose.head * 0.36 + Math.sin(time * 1.4) * 1.4, dt, 11);
      pose.bangs = swing(bangs, pose.head * -0.27 + pose.gazeX, dt, 16);
      pose.ornament = swing(ornament, pose.head * -0.22 + pose.wave * Math.sin(time * 7), dt, 20);
      pose.silk = swing(silk, pose.book * -0.46 + Math.sin(time * 2.5) * 2.4, dt, 19);

      if (time >= nextBlink) {
        blinkTime = 0;
        nextBlink = time + (random() < 0.09 ? 0.38 : 3.2 + random() * 3.3);
      }
      const blinkIntensity = Math.min(smoothstep(clamp(blinkTime / 0.105)), smoothstep(clamp((0.25 - blinkTime) / 0.13)));
      threeFrames(blinkIntensity, blink);
      blinkTime += dt;
      const syllable = (Math.sin(time * 17) + Math.sin(time * 9 + 1.7) * 0.44 + 1.44) / 2.88;
      threeFrames(pose.talk * syllable, mouth);
      return { pose, hand, expression, blink, mouth };
    },
  };
}

export type PuppetFrame = ReturnType<ReturnType<typeof createPuppetDirector>["step"]>;

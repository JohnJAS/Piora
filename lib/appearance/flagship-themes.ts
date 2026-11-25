import type { BackgroundPreset } from "../backgrounds";
import type { FlagshipPerformanceId } from "./flagship-performance-bus";

export type FlagshipThemeId = "piora-whale-day" | "piora-whale-night";
export type FlagshipVariant = "day" | "night";
export type FlagshipPerformanceTrigger = "completed" | "review" | "idle";

export interface FlagshipPerformanceClip {
  readonly id: FlagshipPerformanceId;
  readonly video: string;
  readonly stage?: string;
  readonly fps: 30 | 60;
  readonly settleSeconds: number;
  readonly triggers: readonly FlagshipPerformanceTrigger[];
  readonly cooldownSeconds: number;
  readonly maxPixels: number;
}

export interface FlagshipSignalBeacon {
  /** Center coordinates in original artwork pixels. */
  readonly center: readonly [x: number, y: number];
  /** Inner luminous orb radius in original artwork pixels. */
  readonly radius: number;
  /** Outer atmospheric glow radius in original artwork pixels. */
  readonly haloRadius: number;
}

export interface FlagshipThemeDefinition {
  readonly id: FlagshipThemeId;
  readonly variant: FlagshipVariant;
  readonly isDark: boolean;
  readonly asset: string;
  readonly rigId: string;
  readonly atlasAsset: string;
  readonly customArtworkTarget: {
    readonly artwork: string;
    readonly atlas: string;
  };
  readonly focusX: number;
  readonly beacon: FlagshipSignalBeacon;
  readonly overlay: number;
  readonly sidebarOverlay: number;
  readonly filePanelOverlay: number;
  readonly blur: number;
  readonly fallback: string;
  readonly colors: {
    readonly bg: string;
    readonly panel: string;
    readonly accent: string;
    readonly text: string;
  };
  readonly performances: readonly FlagshipPerformanceClip[];
}

export const FLAGSHIP_THEMES: readonly FlagshipThemeDefinition[] = Object.freeze([
  {
    id: "piora-whale-day",
    variant: "day",
    isDark: false,
    asset: "/themes/character-backgrounds/whale-tide.webp",
    rigId: "character-whale-tide",
    atlasAsset: "/themes/character-backgrounds/motion/whale-tide.png",
    customArtworkTarget: {
      artwork: "/themes/piora-flagship/whale-day.webp",
      atlas: "/themes/piora-flagship/motion/whale-day.png",
    },
    focusX: 0.8,
    beacon: {
      center: [1228, 325],
      radius: 56,
      haloRadius: 220,
    },
    overlay: 62,
    sidebarOverlay: 36,
    filePanelOverlay: 42,
    blur: 0,
    fallback: "linear-gradient(135deg, #EFF9FF, #FFFFFF)",
    colors: {
      bg: "#EFF9FF",
      panel: "#FFFFFF",
      accent: "#1E64A8",
      text: "#1B334B",
    },
    performances: [
      {
        id: "celebrate",
        video: "/themes/character-backgrounds/performances/whale-tide-actor.webm",
        stage: "/themes/character-backgrounds/performances/whale-tide-stage.webp",
        fps: 60,
        settleSeconds: 0.55,
        triggers: ["completed", "idle"],
        cooldownSeconds: 45,
        maxPixels: 2560 * 1440,
      },
      {
        id: "salute",
        video: "/themes/piora-flagship/performances/whale-day-salute.webm",
        fps: 30,
        settleSeconds: 0.4,
        triggers: ["review"],
        cooldownSeconds: 20,
        maxPixels: 1920 * 1080,
      },
    ],
  },
  {
    id: "piora-whale-night",
    variant: "night",
    isDark: true,
    asset: "/themes/character-backgrounds/whale-abyss.webp",
    rigId: "character-whale-abyss",
    atlasAsset: "/themes/character-backgrounds/motion/whale-abyss.png",
    customArtworkTarget: {
      artwork: "/themes/piora-flagship/whale-night.webp",
      atlas: "/themes/piora-flagship/motion/whale-night.png",
    },
    focusX: 0.8,
    beacon: {
      center: [1168, 378],
      radius: 64,
      haloRadius: 265,
    },
    overlay: 60,
    sidebarOverlay: 36,
    filePanelOverlay: 42,
    blur: 0,
    fallback: "linear-gradient(135deg, #081728, #10243B)",
    colors: {
      bg: "#081728",
      panel: "#10243B",
      accent: "#5ED0E6",
      text: "#E6F4FF",
    },
    performances: [
      {
        id: "celebrate",
        video: "/themes/piora-flagship/performances/whale-night-celebrate.webm",
        fps: 30,
        settleSeconds: 0.45,
        triggers: ["completed", "idle"],
        cooldownSeconds: 45,
        maxPixels: 1920 * 1080,
      },
      {
        id: "salute",
        video: "/themes/piora-flagship/performances/whale-night-salute.webm",
        fps: 30,
        settleSeconds: 0.4,
        triggers: ["review"],
        cooldownSeconds: 20,
        maxPixels: 1920 * 1080,
      },
    ],
  },
]);

const FLAGSHIP_BY_ID = new Map<string, FlagshipThemeDefinition>(
  FLAGSHIP_THEMES.map((theme) => [theme.id, theme]),
);

export function isFlagshipTheme(id: string | null | undefined): id is FlagshipThemeId {
  return typeof id === "string" && FLAGSHIP_BY_ID.has(id);
}

export function getFlagshipTheme(id: string | null | undefined): FlagshipThemeDefinition | undefined {
  return id ? FLAGSHIP_BY_ID.get(id) : undefined;
}

export function getFlagshipPerformanceClip(
  theme: FlagshipThemeDefinition,
  clipId: FlagshipPerformanceId,
): FlagshipPerformanceClip | undefined {
  return theme.performances.find((clip) => clip.id === clipId);
}

export const FLAGSHIP_BACKGROUND_PRESETS: readonly BackgroundPreset[] = Object.freeze(
  FLAGSHIP_THEMES.map((theme): BackgroundPreset => ({
    id: theme.id,
    nameKey: `background.preset.${theme.id}`,
    asset: theme.asset,
    artworkStatus: "available",
    appearance: theme.isDark ? "dark" : "light",
    fallback: theme.fallback,
  })),
);

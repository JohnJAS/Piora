"use client";

import { useBackground } from "@/hooks/useBackground";
import { useInterfaceTransparency } from "@/hooks/useInterfaceTransparency";
import { GLACIER_MOTION_BACKGROUND_ID } from "@/lib/backgrounds";
import { GlacierBackgroundMotion } from "./GlacierBackgroundMotion";

/** Mount once near the application root so saved backgrounds apply at startup. */
export function BackgroundBootstrap() {
  const { preference } = useBackground();
  useInterfaceTransparency();
  return preference.presetId === GLACIER_MOTION_BACKGROUND_ID && preference.motionEnabled !== false
    ? <GlacierBackgroundMotion />
    : null;
}

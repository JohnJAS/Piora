"use client";

import { useBackground } from "@/hooks/useBackground";
import { useInterfaceTransparency } from "@/hooks/useInterfaceTransparency";
import { getBackgroundMotionKind } from "@/lib/backgrounds";
import { BackgroundMotion } from "./BackgroundMotion";

/** Mount once near the application root so saved backgrounds apply at startup. */
export function BackgroundBootstrap() {
  const { preference } = useBackground();
  useInterfaceTransparency();
  const kind = getBackgroundMotionKind(preference.presetId);
  return preference.source === "builtin" && preference.motionEnabled !== false && kind
    ? <BackgroundMotion kind={kind} /> : null;
}

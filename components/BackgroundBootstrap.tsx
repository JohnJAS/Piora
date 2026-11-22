"use client";

import { useBackground } from "@/hooks/useBackground";
import { useInterfaceTransparency } from "@/hooks/useInterfaceTransparency";
import { getBackgroundMotionKind, getBackgroundPreset } from "@/lib/backgrounds";
import { BackgroundMotion } from "./BackgroundMotion";
import { CharacterBackgroundMotion } from "./CharacterBackgroundMotion";

/** Mount once near the application root so saved backgrounds apply at startup. */
export function BackgroundBootstrap() {
  const { preference } = useBackground();
  useInterfaceTransparency();
  if (preference.source !== "builtin" || preference.motionEnabled === false) return null;
  const kind = getBackgroundMotionKind(preference.presetId);
  if (kind === "glacier") return <BackgroundMotion />;
  const character = kind === "character" ? getBackgroundPreset(preference.presetId) : undefined;
  return character ? (
    <CharacterBackgroundMotion key={character.id} preset={character} live2dEnabled={preference.live2dEnabled === true} />
  ) : null;
}

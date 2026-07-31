"use client";

import { useBackground } from "@/hooks/useBackground";

/** Mount once near the application root so saved backgrounds apply at startup. */
export function BackgroundBootstrap() {
  useBackground();
  return null;
}

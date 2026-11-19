import { useEffect } from "react";
import type { BackgroundPreset } from "@/lib/backgrounds";
import { getCharacterWallpaperRig } from "@/lib/character-wallpaper-rigs";
import type { CharacterWallpaperRenderer } from "@/lib/character-wallpaper-renderer";

const FRAME_INTERVAL_MS = 1000 / 30;

function playCharacterWallpaper(canvas: HTMLCanvasElement, renderer: CharacterWallpaperRenderer) {
  let frame: number | null = null;
  let lastPaint: number | null = null;
  let elapsed = 0;

  function tick(now: number) {
    if (lastPaint === null || now - lastPaint >= FRAME_INTERVAL_MS - 1) {
      if (lastPaint !== null) elapsed += Math.min(now - lastPaint, 100) / 1000;
      lastPaint = now;
      renderer.draw(elapsed);
    }
    frame = requestAnimationFrame(tick);
  }

  function updatePlayback() {
    if (canvas.isConnected && canvas.dataset.ready === "true" && !document.hidden && document.hasFocus()) {
      frame ??= requestAnimationFrame(tick);
      return;
    }
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    lastPaint = null;
  }

  // The settings portal has its own opaque backdrop. Move the same canvas
  // there so it keeps the current pose and only one scene needs to render.
  function attachToVisibleSurface() {
    const body = document.body;
    const settings = body.querySelector(":scope > .settings-backdrop");
    const host = settings ?? (body.querySelector(":scope > .app-shell") ? body : null);
    if (host && canvas.parentElement !== host) host.prepend(canvas);
    if (!host) canvas.remove();
    updatePlayback();
  }

  const surfaceObserver = new MutationObserver(attachToVisibleSurface);
  const sizeObserver = new ResizeObserver(([{ contentRect }]) => {
    if (contentRect.width <= 0 || contentRect.height <= 0) return;
    renderer.resize(contentRect.width, contentRect.height);
    if (renderer.draw(elapsed)) canvas.dataset.ready = "true";
    updatePlayback();
  });
  const onContextLost = () => {
    delete canvas.dataset.ready;
    updatePlayback();
  };

  canvas.addEventListener("webglcontextlost", onContextLost);
  document.addEventListener("visibilitychange", updatePlayback);
  window.addEventListener("focus", updatePlayback);
  window.addEventListener("blur", updatePlayback);
  surfaceObserver.observe(document.body, { childList: true });
  sizeObserver.observe(canvas);
  attachToVisibleSurface();
  return () => {
    canvas.removeEventListener("webglcontextlost", onContextLost);
    document.removeEventListener("visibilitychange", updatePlayback);
    window.removeEventListener("focus", updatePlayback);
    window.removeEventListener("blur", updatePlayback);
    surfaceObserver.disconnect();
    sizeObserver.disconnect();
    canvas.remove();
    updatePlayback();
    renderer.dispose();
  };
}

export function CharacterBackgroundMotion({ preset }: { preset: BackgroundPreset }) {
  const { id, asset } = preset;
  useEffect(() => {
    const rig = getCharacterWallpaperRig(id);
    if (!rig || document.documentElement.classList.contains("desktop-pet-document")) return;
    const motion = window.matchMedia("(prefers-reduced-motion: no-preference)");
    let revision = 0;
    let stop: (() => void) | undefined;

    function updateMotion() {
      const current = ++revision;
      stop?.();
      stop = undefined;
      if (!motion.matches || !rig) return;
      const artwork = new Image();
      artwork.src = asset;
      void Promise.all([artwork.decode(), import("@/lib/character-wallpaper-renderer")]).then(([, module]) => {
        if (current !== revision) return;
        const canvas = document.createElement("canvas");
        canvas.className = "character-background-motion";
        canvas.dataset.characterBackground = id;
        canvas.setAttribute("aria-hidden", "true");
        const renderer = module.createCharacterWallpaperRenderer(canvas, artwork, rig);
        if (renderer) stop = playCharacterWallpaper(canvas, renderer);
      }).catch(() => {
        // The prepainted wallpaper is also the fallback for failed loads.
      });
    }

    motion.addEventListener("change", updateMotion);
    updateMotion();
    return () => {
      revision += 1;
      motion.removeEventListener("change", updateMotion);
      stop?.();
    };
  }, [asset, id]);
  return null;
}

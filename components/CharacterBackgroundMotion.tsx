import { useEffect } from "react";
import type { BackgroundPreset } from "@/lib/backgrounds";
import { createWallpaperFrameClock } from "@/lib/character-wallpaper-clock";
import { getCharacterWallpaperRig, type CharacterWallpaperRig } from "@/lib/character-wallpaper-rigs";
import type { CharacterWallpaperRenderer } from "@/lib/character-wallpaper-renderer";

const TIDE_PERFORMANCE = {
  actor: "/themes/character-backgrounds/performances/whale-tide-actor.webm",
  stage: "/themes/character-backgrounds/performances/whale-tide-stage.webp",
  view: { focusX: 0.8, maxPixels: 2560 * 1440 },
};

function playCharacterWallpaper(canvas: HTMLCanvasElement, renderer: CharacterWallpaperRenderer | null,
  artwork: HTMLImageElement, rig: CharacterWallpaperRig, clip?: typeof TIDE_PERFORMANCE) {
  let frame: number | null = null;
  const clock = createWallpaperFrameClock(clip ? 60 : 30);
  let elapsed = 0;
  let activeSeconds = 0;
  let nextPerformance = 3;
  let performing = false;
  let playRequest = 0;
  let stageReady = false;
  const focusX = clip?.view.focusX ?? 0.5;
  const film = clip ? document.createElement("video") : null;
  if (film && clip) {
    film.className = "character-background-performance";
    film.setAttribute("aria-hidden", "true");
    film.muted = true;
    film.playsInline = true;
    film.disablePictureInPicture = true;
    film.preload = "auto";
    const position = `${focusX * 100}% 50%`;
    film.style.objectPosition = position;
    film.style.backgroundPosition = position;
    film.src = clip.actor;
    const stage = new Image();
    stage.src = clip.stage;
    void stage.decode().then(() => {
      film.style.backgroundImage = `url("${clip.stage}")`;
      nextPerformance = Math.max(nextPerformance, activeSeconds + 0.55);
      stageReady = true;
    }, () => { /* The idle artwork stays visible if the stage cannot load. */ });
  }
  const gaze = { x: 0, y: 0, attention: 0 };
  let aimX = 0, aimY = 0, lastPointer = -Infinity;
  let greeting = -Infinity;

  function aimAtPortrait(event: PointerEvent) {
    const bounds = canvas.getBoundingClientRect();
    const scale = Math.max(bounds.width / artwork.naturalWidth, bounds.height / artwork.naturalHeight);
    if (scale <= 0) return false;
    const x = (event.clientX - bounds.left - bounds.width * focusX) / scale + artwork.naturalWidth * focusX;
    const y = (event.clientY - bounds.top - bounds.height / 2) / scale + artwork.naturalHeight / 2;
    aimX = Math.max(-1, Math.min(1, (x - rig.head[0]) / rig.head[2]));
    aimY = Math.max(-1, Math.min(1, (y - rig.head[1]) / rig.head[3]));
    return Math.hypot((x - rig.head[0]) / rig.head[2], (y - rig.head[1]) / rig.head[3]) < 2.8;
  }
  function trackPointer(event: PointerEvent) {
    if (event.pointerType !== "touch") lastPointer = aimAtPortrait(event) ? performance.now() : -Infinity;
  }
  function greet(event: PointerEvent) {
    if (event.button !== 0 || !event.isPrimary || elapsed - greeting < 5) return;
    if (event.target instanceof Element && event.target.closest(
      "button, a, input, textarea, select, [contenteditable=true], [role=button], [role=dialog], [role=menu]",
    )) return;
    if (aimAtPortrait(event)) {
      lastPointer = performance.now();
      greeting = elapsed;
    }
  }

  function clearPointer() { lastPointer = -Infinity; }

  function finishPerformance() {
    if (!performing || !film) return;
    performing = false;
    playRequest++;
    film.pause();
    if (!film.dataset.playing) return;
    // The final actor cel over the terrace matches the idle illustration.
    elapsed = 0;
    greeting = -Infinity;
    gaze.x = gaze.y = gaze.attention = 0;
    renderer?.draw(0);
    delete film.dataset.playing;
  }

  function playFilm() {
    if (!film || !performing || !film.paused) return;
    const request = ++playRequest;
    void film.play().catch(() => {
      if (request === playRequest) finishPerformance();
    });
  }

  function showFilm() {
    if (performing && film && !film.paused) film.dataset.playing = "true";
  }

  function drawIdle() {
    // Settle the idle teacup and face onto the first transparent actor cel.
    const remaining = stageReady ? nextPerformance - activeSeconds : Infinity;
    const t = performing ? 0 : Math.max(0, Math.min(1, remaining / 0.55));
    return renderer?.draw(elapsed, gaze, elapsed - greeting, t * t * (3 - 2 * t));
  }

  function tick(now: number) {
    const seconds = clock.sample(now);
    if (seconds !== null) {
      activeSeconds += seconds;
      const delta = Math.min(seconds, 0.1);
      elapsed += delta;
      const approach = 1 - Math.exp(-delta * 7);
      gaze.x += (aimX - gaze.x) * approach;
      gaze.y += (aimY - gaze.y) * approach;
      gaze.attention += ((now - lastPointer < 2300 ? 1 : 0) - gaze.attention) * approach;
      if (!film?.dataset.playing) drawIdle();
      if (film && stageReady && !performing && activeSeconds >= nextPerformance) {
        performing = true;
        nextPerformance = activeSeconds + 40;
        if (film.error) film.load();
        film.currentTime = 0;
        playFilm();
      }
    }
    frame = requestAnimationFrame(tick);
  }

  function updatePlayback() {
    if (canvas.isConnected && (canvas.dataset.ready === "true" || film) && !document.hidden && document.hasFocus()) {
      playFilm();
      frame ??= requestAnimationFrame(tick);
      return;
    }
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    clock.reset();
    playRequest++;
    film?.pause();
  }

  // Settings has an opaque backdrop. Move the existing layers together so
  // the same video timeline and character pose follow the visible surface.
  function attachToVisibleSurface() {
    const body = document.body;
    const settings = body.querySelector(":scope > .settings-backdrop");
    const host = settings ?? (body.querySelector(":scope > .app-shell") ? body : null);
    if (host && canvas.parentElement !== host) {
      host.prepend(canvas);
      if (film) canvas.after(film);
    } else if (!host) {
      canvas.remove();
      film?.remove();
    }
    updatePlayback();
  }

  const surfaceObserver = new MutationObserver(attachToVisibleSurface);
  const sizeObserver = new ResizeObserver(([{ contentRect }]) => {
    if (contentRect.width <= 0 || contentRect.height <= 0) return;
    renderer?.resize(contentRect.width, contentRect.height);
    if (drawIdle()) canvas.dataset.ready = "true";
    updatePlayback();
  });
  const onContextLost = () => {
    delete canvas.dataset.ready;
    updatePlayback();
  };

  canvas.addEventListener("webglcontextlost", onContextLost);
  film?.addEventListener("playing", showFilm);
  film?.addEventListener("ended", finishPerformance);
  film?.addEventListener("error", finishPerformance);
  document.addEventListener("visibilitychange", updatePlayback);
  window.addEventListener("focus", updatePlayback);
  window.addEventListener("blur", updatePlayback);
  window.addEventListener("pointermove", trackPointer, { passive: true });
  window.addEventListener("pointerup", greet, { passive: true });
  document.documentElement.addEventListener("pointerleave", clearPointer);
  surfaceObserver.observe(document.body, { childList: true });
  sizeObserver.observe(canvas);
  attachToVisibleSurface();
  return () => {
    canvas.removeEventListener("webglcontextlost", onContextLost);
    film?.removeEventListener("playing", showFilm);
    film?.removeEventListener("ended", finishPerformance);
    film?.removeEventListener("error", finishPerformance);
    document.removeEventListener("visibilitychange", updatePlayback);
    window.removeEventListener("focus", updatePlayback);
    window.removeEventListener("blur", updatePlayback);
    window.removeEventListener("pointermove", trackPointer);
    window.removeEventListener("pointerup", greet);
    document.documentElement.removeEventListener("pointerleave", clearPointer);
    surfaceObserver.disconnect();
    sizeObserver.disconnect();
    canvas.remove();
    updatePlayback();
    if (film) {
      film.remove();
      film.removeAttribute("src");
      film.load();
    }
    renderer?.dispose();
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
      const atlas = new Image();
      atlas.src = asset.replace(/([^/]+)\.webp$/, "motion/$1.png");
      void Promise.all([artwork.decode(), import("@/lib/character-wallpaper-renderer"),
        atlas.decode().then(() => true, () => false),
      ]).then(([, module, hasAtlas]) => {
        if (current !== revision) return;
        const canvas = document.createElement("canvas");
        canvas.className = "character-background-motion";
        canvas.dataset.characterBackground = id;
        canvas.setAttribute("aria-hidden", "true");
        const layers = hasAtlas ? { performance: module.getCharacterPerformance(id), atlas } : undefined;
        const clip = id === "character-whale-tide" ? TIDE_PERFORMANCE : undefined;
        const renderer = module.createCharacterWallpaperRenderer(canvas, artwork, rig, layers, clip?.view);
        if (renderer || clip) stop = playCharacterWallpaper(canvas, renderer, artwork, rig, clip);
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

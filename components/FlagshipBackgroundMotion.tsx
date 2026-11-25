"use client";

import { useEffect, useRef } from "react";
import {
  getAgentThemeMoodSnapshot,
  subscribeAgentThemeMood,
  type AgentThemeMoodSnapshot,
} from "@/lib/appearance/agent-mood-store";
import {
  createMoodMotionState,
  stepMoodMotionState,
} from "@/lib/appearance/flagship-mood-motion";
import {
  getFlagshipPerformanceBusSnapshot,
  setFlagshipPerformanceStatus,
  subscribeFlagshipPerformanceBus,
} from "@/lib/appearance/flagship-performance-bus";
import {
  getFlagshipPerformanceClip,
  type FlagshipPerformanceClip,
  type FlagshipThemeDefinition,
} from "@/lib/appearance/flagship-themes";
import { createWallpaperFrameClock } from "@/lib/character-wallpaper-clock";
import { getCharacterPerformance } from "@/lib/character-wallpaper-parts";
import type {
  CharacterWallpaperMoodFrame,
  CharacterWallpaperRenderer,
} from "@/lib/character-wallpaper-renderer";
import {
  getCharacterWallpaperRig,
  type CharacterWallpaperRig,
} from "@/lib/character-wallpaper-rigs";

const IDLE_SNAPSHOT: Pick<
  AgentThemeMoodSnapshot,
  "mood" | "isBackgroundOnly" | "runningSubagentCount"
> = {
  mood: "idle",
  isBackgroundOnly: false,
  runningSubagentCount: 0,
};

const AMBIENT_IDLE_SHOWCASE_SECONDS = 45;

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep01(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * (3 - 2 * clamped);
}

function playFlagshipWallpaper(
  canvas: HTMLCanvasElement,
  renderer: CharacterWallpaperRenderer | null,
  artwork: HTMLImageElement,
  rig: CharacterWallpaperRig,
  flagship: FlagshipThemeDefinition,
  getReactiveEnabled: () => boolean,
  getPerformanceEnabled: () => boolean,
  onBridgeReady: (sync: () => void, stopPerf: () => void) => void,
) {
  let frame: number | null = null;
  const clock = createWallpaperFrameClock(30);
  let elapsed = 0;
  let calmIdleSeconds = 0;
  let lastPointer = -Infinity;
  let greeting = -Infinity;
  let aimX = 0;
  let aimY = 0;
  const gaze = { x: 0, y: 0, attention: 0 };
  const motionState = createMoodMotionState(flagship.variant);

  let moodSnapshot = getAgentThemeMoodSnapshot();
  let lastPulseKey = moodSnapshot.pulseKey;
  let rippleActive = false;
  let rippleProgress = 0;

  // Tier 2 performance playback state
  const film = document.createElement("video");
  film.className = "character-background-performance";
  film.setAttribute("aria-hidden", "true");
  film.muted = true;
  film.playsInline = true;
  film.disablePictureInPicture = true;
  film.preload = "metadata";
  const focusPos = `${flagship.focusX * 100}% 50%`;
  film.style.objectPosition = focusPos;
  film.style.backgroundPosition = focusPos;

  type PerfPhase = "idle" | "settling" | "playing";
  let perfPhase: PerfPhase = "idle";
  let activeClip: FlagshipPerformanceClip | null = null;
  let activeManual = false;
  let settleRemaining = 0;
  let playRequest = 0;
  let stageReady = true;
  const lastPlayedAt = new Map<string, number>();
  let lastBusSeq = getFlagshipPerformanceBusSnapshot().lastRequest?.seq ?? 0;

  function syncDomMood() {
    if (!canvas.isConnected) return;
    document.documentElement.dataset.agentThemeMood = getReactiveEnabled()
      ? moodSnapshot.mood
      : "idle";
  }

  function buildMoodFrame(reactive: boolean): CharacterWallpaperMoodFrame {
    return {
      beacon: [
        flagship.beacon.center[0],
        flagship.beacon.center[1],
        flagship.beacon.radius,
        flagship.beacon.haloRadius,
      ],
      color: [
        motionState.colorR,
        motionState.colorG,
        motionState.colorB,
        reactive
          ? motionState.beaconStrength
          : flagship.variant === "day"
            ? 0.14
            : 0.28,
      ],
      time: motionState.pulsePhase,
      ripple: reactive && rippleActive ? rippleProgress : 0,
      particleEnergy: motionState.particleEnergy,
      ringCount: reactive ? motionState.ringCount : 0,
      squint: reactive ? motionState.squint : 0,
      tempoScale: motionState.tempo,
    };
  }

  function drawCurrent(amount = 1) {
    return renderer?.draw(
      elapsed,
      gaze,
      elapsed - greeting,
      amount,
      buildMoodFrame(getReactiveEnabled()),
    );
  }

  function playFilm() {
    if (!activeClip || perfPhase === "idle" || !film.paused) return;
    const request = ++playRequest;
    void film.play().catch(() => {
      if (request === playRequest) finishPerformance(false);
    });
  }

  function showFilm() {
    if (perfPhase !== "idle" && activeClip && !film.paused) {
      film.dataset.playing = "true";
      perfPhase = "playing";
      setFlagshipPerformanceStatus(activeClip.id, "playing");
    }
  }

  function finishPerformance(seamlessRest = true) {
    const hadActivity = perfPhase !== "idle" || Boolean(film.dataset.playing);
    playRequest += 1;
    film.pause();
    perfPhase = "idle";
    activeClip = null;
    activeManual = false;
    settleRemaining = 0;
    stageReady = true;
    setFlagshipPerformanceStatus(null, "idle");
    if (!hadActivity) return;

    if (seamlessRest) {
      elapsed = 0;
      greeting = -Infinity;
      gaze.x = 0;
      gaze.y = 0;
      gaze.attention = 0;
    }
    drawCurrent(1);
    delete film.dataset.playing;
  }

  function startPerformance(
    clip: FlagshipPerformanceClip,
    options: { manual: boolean; urgent: boolean },
  ) {
    if (!getPerformanceEnabled()) return;
    const nowMs = performance.now();
    if (!options.manual) {
      const last = lastPlayedAt.get(clip.id) ?? -Infinity;
      if (nowMs - last < clip.cooldownSeconds * 1000) return;
    }
    if (perfPhase !== "idle") {
      if (!options.urgent && !options.manual) return;
      playRequest += 1;
      film.pause();
      delete film.dataset.playing;
    }

    lastPlayedAt.set(clip.id, nowMs);
    activeClip = clip;
    activeManual = options.manual;
    perfPhase = "settling";
    settleRemaining = clip.settleSeconds;
    calmIdleSeconds = 0;
    setFlagshipPerformanceStatus(clip.id, "settling");

    const request = ++playRequest;
    if (clip.stage) {
      stageReady = false;
      const stageImg = new Image();
      stageImg.src = clip.stage;
      void stageImg.decode().then(
        () => {
          if (request !== playRequest) return;
          film.style.backgroundImage = `url("${clip.stage}")`;
          stageReady = true;
        },
        () => {
          if (request === playRequest) finishPerformance(false);
        },
      );
    } else {
      stageReady = true;
      film.style.backgroundImage = "";
    }

    if (film.getAttribute("src") !== clip.video) {
      film.src = clip.video;
    } else {
      if (film.error) film.load();
      film.currentTime = 0;
    }
  }

  function triggerByEvent(trigger: "completed" | "review" | "idle") {
    if (!getPerformanceEnabled()) return;
    const clip = flagship.performances.find((candidate) => candidate.triggers.includes(trigger));
    if (!clip) return;
    startPerformance(clip, {
      manual: false,
      urgent: trigger === "review",
    });
  }

  function handleMoodUpdate() {
    moodSnapshot = getAgentThemeMoodSnapshot();
    syncDomMood();
    const reactive = getReactiveEnabled();

    if (reactive && (moodSnapshot.mood === "running" || moodSnapshot.mood === "waiting") && perfPhase !== "idle" && !activeManual) {
      finishPerformance(false);
    }

    if (!reactive) return;
    if (moodSnapshot.pulseKey && moodSnapshot.pulseKey !== lastPulseKey) {
      lastPulseKey = moodSnapshot.pulseKey;
      if (moodSnapshot.pulseKind === "completed") {
        if (elapsed - greeting >= 2.2) greeting = elapsed;
        rippleActive = true;
        rippleProgress = 0;
        triggerByEvent("completed");
      } else if (moodSnapshot.pulseKind === "review") {
        if (elapsed - greeting >= 2.2) greeting = elapsed;
        rippleActive = true;
        rippleProgress = 0;
        triggerByEvent("review");
      } else if (moodSnapshot.pulseKind === "started" || moodSnapshot.pulseKind === "failed") {
        rippleActive = true;
        rippleProgress = 0;
      }
    }
  }

  function handleBusUpdate() {
    const bus = getFlagshipPerformanceBusSnapshot();
    if (!bus.lastRequest || bus.lastRequest.seq === lastBusSeq) return;
    lastBusSeq = bus.lastRequest.seq;
    if (bus.lastRequest.clipId === "stop") {
      finishPerformance(false);
      return;
    }
    const clip = getFlagshipPerformanceClip(flagship, bus.lastRequest.clipId);
    if (clip && getPerformanceEnabled()) {
      startPerformance(clip, { manual: true, urgent: true });
    }
  }

  const unsubscribeMood = subscribeAgentThemeMood(handleMoodUpdate);
  const unsubscribeBus = subscribeFlagshipPerformanceBus(handleBusUpdate);
  onBridgeReady(
    () => {
      syncDomMood();
      if (!getReactiveEnabled() && perfPhase !== "idle" && !activeManual) {
        finishPerformance(false);
      }
    },
    () => {
      if (!getPerformanceEnabled() && perfPhase !== "idle") {
        finishPerformance(false);
      }
    },
  );

  function aimAtPortrait(event: PointerEvent) {
    const bounds = canvas.getBoundingClientRect();
    const scale = Math.max(
      bounds.width / artwork.naturalWidth,
      bounds.height / artwork.naturalHeight,
    );
    if (scale <= 0) return false;
    const x = (event.clientX - bounds.left - bounds.width * flagship.focusX) / scale
      + artwork.naturalWidth * flagship.focusX;
    const y = (event.clientY - bounds.top - bounds.height / 2) / scale
      + artwork.naturalHeight / 2;
    aimX = Math.max(-1, Math.min(1, (x - rig.head[0]) / rig.head[2]));
    aimY = Math.max(-1, Math.min(1, (y - rig.head[1]) / rig.head[3]));
    return Math.hypot((x - rig.head[0]) / rig.head[2], (y - rig.head[1]) / rig.head[3]) < 2.8;
  }

  function trackPointer(event: PointerEvent) {
    if (event.pointerType !== "touch") {
      lastPointer = aimAtPortrait(event) ? performance.now() : -Infinity;
    }
  }

  function greet(event: PointerEvent) {
    if (perfPhase !== "idle") return;
    if (event.button !== 0 || !event.isPrimary || elapsed - greeting < 5) return;
    if (
      event.target instanceof Element
      && event.target.closest(
        "button, a, input, textarea, select, [contenteditable=true], [role=button], [role=dialog], [role=menu]",
      )
    ) {
      return;
    }
    if (aimAtPortrait(event)) {
      lastPointer = performance.now();
      greeting = elapsed;
      rippleActive = true;
      rippleProgress = 0;
    }
  }

  function clearPointer() {
    lastPointer = -Infinity;
  }

  function tick(now: number) {
    const seconds = clock.sample(now);
    if (seconds !== null) {
      const delta = Math.min(seconds, 0.1);
      const reactive = getReactiveEnabled();

      if (perfPhase === "settling" && activeClip) {
        settleRemaining = Math.max(0, settleRemaining - delta);
        const ratio = activeClip.settleSeconds > 0
          ? settleRemaining / activeClip.settleSeconds
          : 0;
        const amount = smoothstep01(ratio);
        drawCurrent(amount);
        if (settleRemaining <= 0 && stageReady && film.paused) {
          playFilm();
        }
      } else if (perfPhase === "playing" || film.dataset.playing === "true") {
        // Video layer covers the canvas while playing; avoid redundant WebGL draws.
      } else {
        const targetSnapshot = reactive ? moodSnapshot : IDLE_SNAPSHOT;
        stepMoodMotionState(motionState, targetSnapshot, flagship.variant, delta);
        elapsed += delta * motionState.tempo;

        if (rippleActive) {
          rippleProgress += delta / 1.6;
          if (rippleProgress >= 1) {
            rippleProgress = 0;
            rippleActive = false;
          }
        }

        const pointerActive = now - lastPointer < 2300;
        const pointerAttention = pointerActive ? 1 : 0;
        const targetX = pointerActive
          ? mix(aimX, motionState.gazeX, motionState.gazeLock * 0.65)
          : motionState.gazeX;
        const targetY = pointerActive
          ? mix(aimY, motionState.gazeY, motionState.gazeLock * 0.65)
          : motionState.gazeY;
        const targetAttention = Math.max(pointerAttention, motionState.gazeLock);
        const approach = 1 - Math.exp(-delta * 7);
        gaze.x += (targetX - gaze.x) * approach;
        gaze.y += (targetY - gaze.y) * approach;
        gaze.attention += (targetAttention - gaze.attention) * approach;

        drawCurrent(1);

        if (
          reactive
          && getPerformanceEnabled()
          && moodSnapshot.mood === "idle"
          && moodSnapshot.previewMood === null
        ) {
          calmIdleSeconds += delta;
          if (calmIdleSeconds >= AMBIENT_IDLE_SHOWCASE_SECONDS) {
            calmIdleSeconds = 0;
            triggerByEvent("idle");
          }
        } else {
          calmIdleSeconds = 0;
        }
      }
    }
    frame = requestAnimationFrame(tick);
  }

  function updatePlayback() {
    if (canvas.isConnected && canvas.dataset.ready === "true" && !document.hidden && document.hasFocus()) {
      if (perfPhase === "playing" && film.paused) playFilm();
      frame ??= requestAnimationFrame(tick);
      return;
    }
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    clock.reset();
    if (!film.paused) {
      playRequest += 1;
      film.pause();
    }
  }

  function attachToVisibleSurface() {
    const body = document.body;
    const settings = body.querySelector(":scope > .settings-backdrop");
    const host = settings ?? (body.querySelector(":scope > .app-shell") ? body : null);
    if (host && canvas.parentElement !== host) {
      host.prepend(canvas);
      canvas.after(film);
    } else if (host && film.parentElement !== host) {
      canvas.after(film);
    } else if (!host) {
      canvas.remove();
      film.remove();
    }
    syncDomMood();
    updatePlayback();
  }

  const surfaceObserver = new MutationObserver(attachToVisibleSurface);
  const sizeObserver = new ResizeObserver(([{ contentRect }]) => {
    if (contentRect.width <= 0 || contentRect.height <= 0) return;
    renderer?.resize(contentRect.width, contentRect.height);
    if (perfPhase === "idle" && drawCurrent(1)) canvas.dataset.ready = "true";
    updatePlayback();
  });
  const onContextLost = () => {
    delete canvas.dataset.ready;
    updatePlayback();
  };

  canvas.addEventListener("webglcontextlost", onContextLost);
  film.addEventListener("playing", showFilm);
  film.addEventListener("ended", () => finishPerformance(true));
  film.addEventListener("error", () => finishPerformance(false));
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
    unsubscribeMood();
    unsubscribeBus();
    onBridgeReady(() => {}, () => {});
    canvas.removeEventListener("webglcontextlost", onContextLost);
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
    playRequest += 1;
    film.pause();
    film.remove();
    film.removeAttribute("src");
    film.load();
    setFlagshipPerformanceStatus(null, "idle");
    delete document.documentElement.dataset.agentThemeMood;
    renderer?.dispose();
  };
}

export function FlagshipBackgroundMotion({
  flagship,
  agentReactiveEnabled,
  performanceEnabled,
}: {
  flagship: FlagshipThemeDefinition;
  agentReactiveEnabled: boolean;
  performanceEnabled: boolean;
}) {
  const reactiveRef = useRef(agentReactiveEnabled);
  reactiveRef.current = agentReactiveEnabled;
  const performanceRef = useRef(performanceEnabled);
  performanceRef.current = performanceEnabled;

  const syncDomMoodRef = useRef<() => void>(() => {});
  const syncPerfRef = useRef<() => void>(() => {});

  useEffect(() => {
    syncDomMoodRef.current();
  }, [agentReactiveEnabled]);

  useEffect(() => {
    syncPerfRef.current();
  }, [performanceEnabled]);

  useEffect(() => {
    const rig = getCharacterWallpaperRig(flagship.rigId);
    if (!rig || document.documentElement.classList.contains("desktop-pet-document")) return;

    const motion = window.matchMedia("(prefers-reduced-motion: no-preference)");
    let revision = 0;
    let stop: (() => void) | undefined;

    function updateMotion() {
      const current = ++revision;
      stop?.();
      stop = undefined;
      if (!motion.matches || !rig) {
        delete document.documentElement.dataset.agentThemeMood;
        return;
      }

      const artwork = new Image();
      artwork.src = flagship.asset;
      const atlas = new Image();
      atlas.src = flagship.atlasAsset;

      void Promise.all([
        artwork.decode(),
        import("@/lib/character-wallpaper-renderer"),
        atlas.decode().then(() => true, () => false),
      ])
        .then(([, module, hasAtlas]) => {
          if (current !== revision) return;
          const canvas = document.createElement("canvas");
          canvas.className = "character-background-motion";
          canvas.dataset.flagshipBackground = flagship.id;
          canvas.setAttribute("aria-hidden", "true");

          const layers = hasAtlas
            ? { performance: getCharacterPerformance(flagship.rigId), atlas }
            : undefined;
          const renderer = module.createCharacterWallpaperRenderer(
            canvas,
            artwork,
            rig,
            layers,
            { focusX: flagship.focusX, maxPixels: 1_920 * 1_080 },
          );
          if (renderer) {
            stop = playFlagshipWallpaper(
              canvas,
              renderer,
              artwork,
              rig,
              flagship,
              () => reactiveRef.current,
              () => performanceRef.current,
              (syncMood, syncPerf) => {
                syncDomMoodRef.current = syncMood;
                syncPerfRef.current = syncPerf;
              },
            );
          }
        })
        .catch(() => {
          // Prepainted static artwork remains visible if WebGL or decoding fails.
        });
    }

    motion.addEventListener("change", updateMotion);
    updateMotion();
    return () => {
      revision += 1;
      motion.removeEventListener("change", updateMotion);
      stop?.();
      setFlagshipPerformanceStatus(null, "idle");
      delete document.documentElement.dataset.agentThemeMood;
    };
  }, [flagship]);

  return null;
}

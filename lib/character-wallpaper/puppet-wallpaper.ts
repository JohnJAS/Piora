import { createWallpaperFrameClock } from "../character-wallpaper-clock.ts";
import { characterDirectorState, CHARACTER_STATES, type CharacterState } from "../character-director-state.ts";
import { createPuppetDirector } from "./puppet-director.ts";
import { createPuppetRenderer, type PuppetRenderer } from "./puppet-renderer.ts";
import { readPuppetRig } from "./puppet-rig.ts";

const AMBIENT_START = 0.62;
const INTERACTIVE = [
  "button", "a", "input", "textarea", "select", "[contenteditable=true]", "[role=button]",
  "[role=menu]", "[role=dialog]", "[role=separator]", "#file-panel", ".right-panel-container",
].join(",");
type FrameTiming = {
  until: number;
  raf: number[];
  draws: { raf: number; cpuMs: number; finished: number }[];
};

async function decode(url: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const image = new Image();
  const cancel = () => image.removeAttribute("src");
  signal.addEventListener("abort", cancel, { once: true });
  try {
    image.src = url;
    await image.decode();
    signal.throwIfAborted();
    return image;
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

export async function mountPuppetWallpaper(id: string, baseUrl: string, signal: AbortSignal) {
  const [data, stage, parts, face] = await Promise.all([
    fetch(baseUrl + "/rig.json", { signal }).then((response) => {
      if (!response.ok) throw new Error("Missing character wallpaper rig");
      return response.json() as Promise<unknown>;
    }),
    decode(baseUrl + "/stage.webp", signal),
    decode(baseUrl + "/parts-atlas.webp", signal),
    decode(baseUrl + "/face-atlas.webp", signal),
  ]);
  if (signal.aborted) return;

  const rig = readPuppetRig(data, stage, parts, face);
  if (id !== "character-claude-" + (rig.scene ?? "paper") || rig.focusX !== 0.8) {
    throw new Error("Puppet rig does not match the selected Claude wallpaper");
  }
  const canvas = document.createElement("canvas");
  canvas.className = "character-background-motion";
  canvas.dataset.characterBackground = id;
  canvas.dataset.puppetWallpaper = "true";
  canvas.setAttribute("aria-hidden", "true");

  let director = createPuppetDirector(Math.random, rig.scene);
  const clock = createWallpaperFrameClock(30);
  const images = { stage, parts, face };
  let renderer: PuppetRenderer | undefined = createPuppetRenderer(canvas, rig, images);
  let raf: number | null = null;
  let width = 0, height = 0;
  let ambientStart = 1;
  let pointerX = 0, pointerY = 0, lastPointerAt = -Infinity;
  let elapsed = 0;
  let dirty = true;
  let override: CharacterState | null = null;
  let frame = director.step(0, "idle");
  let visibleState: CharacterState = "idle";
  let framesDrawn = 0;
  let manualPlayback = false;
  let timing: FrameTiming | null = null;

  function canRun() {
    return !signal.aborted && !!renderer && width > 0 && height > 0 && canvas.isConnected
      && !document.hidden && document.hasFocus();
  }

  function updateAmbientBounds() {
    const bounds = canvas.getBoundingClientRect();
    const blur = parseFloat(getComputedStyle(canvas).getPropertyValue("--app-background-blur")) || 0;
    // The DOM layer has overscan, scale and optional blur. Keep the start
    // beyond the visible chat boundary even after the filter spreads the light.
    const left = document.documentElement.clientWidth * AMBIENT_START + Math.max(0, blur) * 4 + 2;
    ambientStart = bounds.width ? Math.max(0, Math.min(1, (left - bounds.left) / bounds.width)) : 1;
  }

  function advance(seconds: number, now: number) {
    const dt = Math.min(seconds, 0.15);
    elapsed += dt;
    const hasAim = now - lastPointerAt < 2_300;
    visibleState = override ?? characterDirectorState.state();
    frame = director.step(dt, visibleState, hasAim ? pointerX : 0, hasAim ? pointerY : 0);
  }

  function paint(seconds: number, now: number) {
    if (!renderer) return;
    const started = timing && now <= timing.until ? performance.now() : null;
    advance(seconds, now);
    if (renderer.draw(frame, elapsed, ambientStart)) {
      framesDrawn++;
      dirty = false;
      if (canvas.dataset.ready !== "true") canvas.dataset.ready = "true";
      if (started !== null && timing) {
        const finished = performance.now();
        timing.draws.push({ raf: now, cpuMs: finished - started, finished });
      }
    }
  }

  function tick(now: number) {
    raf = null;
    if (!canRun()) {
      clock.reset();
      return;
    }
    if (timing && now <= timing.until) timing.raf.push(now);
    const seconds = clock.sample(now);
    if (seconds !== null) paint(seconds, now);
    raf = requestAnimationFrame(tick);
  }

  function suspend() {
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null;
    clock.reset();
  }

  function syncPlayback() {
    if (manualPlayback || !canRun()) {
      suspend();
      return;
    }
    if (raf === null) {
      if (dirty) paint(0, performance.now());
      raf = requestAnimationFrame(tick);
    }
  }

  function attachToVisibleSurface() {
    const body = document.body;
    const settings = body.querySelector(":scope > .settings-backdrop");
    const host = settings ?? (body.querySelector(":scope > .app-shell") ? body : null);
    if (host && canvas.parentElement !== host) {
      host.prepend(canvas);
      updateAmbientBounds();
    } else if (!host) {
      canvas.remove();
    }
    syncPlayback();
  }

  function resize(w: number, h: number) {
    width = w;
    height = h;
    if (w > 0 && h > 0) renderer?.resize(w, h, window.devicePixelRatio);
    dirty = true;
    updateAmbientBounds();
    syncPlayback();
  }

  function lost(event: Event) {
    event.preventDefault();
    suspend();
    delete canvas.dataset.ready;
    renderer?.dispose();
    renderer = undefined;
  }

  function restore() {
    if (signal.aborted) return;
    try {
      renderer = createPuppetRenderer(canvas, rig, images);
      resize(width, height);
    } catch {
      // The CSS wallpaper is still visible on unsupported GPUs.
    }
  }

  function wake() { characterDirectorState.interact(); }
  function focus() { wake(); syncPlayback(); }
  function unpoint() { lastPointerAt = -Infinity; }
  function aim(event: PointerEvent) {
    wake();
    if (event.pointerType === "touch") return;
    const x = event.clientX / Math.max(1, document.documentElement.clientWidth);
    const y = event.clientY / Math.max(1, document.documentElement.clientHeight);
    pointerX = (x - 0.76) * 3;
    pointerY = (y - 0.28) * 2.5;
    lastPointerAt = performance.now();
  }
  function click(event: PointerEvent) {
    if (event.button !== 0 || !event.isPrimary || event.defaultPrevented || !canRun()) return;
    if (event.clientX < document.documentElement.clientWidth * AMBIENT_START) return;
    if (event.target instanceof Element && event.target.closest(INTERACTIVE)) return;
    aim(event);
    characterDirectorState.greet();
  }

  const surface = new MutationObserver(attachToVisibleSurface);
  const style = new MutationObserver(updateAmbientBounds);
  const size = new ResizeObserver(([entry]) => resize(entry.contentRect.width, entry.contentRect.height));
  const onWindowResize = () => resize(width, height);

  function snapshot() {
    return {
      state: visibleState, liveState: characterDirectorState.state(), pageTurning: frame.pose.pageRunning,
      scene: rig.scene ?? "paper", vignettePlaying: frame.pose.storyRunning,
      pageLift: frame.pose.page, carry: frame.pose.bookCarry, glow: frame.pose.glow,
      wrist: [frame.pose.wristX, frame.pose.wristY], gaze: [frame.pose.gazeX, frame.pose.gazeY],
      hand: Array.from(frame.hand), mouth: Array.from(frame.mouth), expression: Array.from(frame.expression),
      framesDrawn, running: raf !== null, width: canvas.width, height: canvas.height, ambientStart,
    };
  }
  function setState(state: CharacterState | null) {
    if (state !== null && !CHARACTER_STATES.includes(state)) throw new RangeError("Unknown character state");
    override = state;
  }
  const debug = {
    setState,
    snapshot,
    playPageTurn() { director.playPageTurn(); },
    stepFrames(state: CharacterState, count: number, reset = false) {
      if (!canRun() || !Number.isInteger(count) || count < 1 || count > 120) throw new RangeError("Invalid keyframe step");
      setState(state);
      manualPlayback = true;
      suspend();
      if (reset) {
        director = createPuppetDirector(() => 0.5, rig.scene);
        elapsed = 0;
      }
      const now = performance.now();
      for (let index = 1; index < count; index++) advance(1 / 30, now);
      paint(1 / 30, now);
      return snapshot();
    },
    resume() {
      manualPlayback = false;
      setState(null);
      syncPlayback();
    },
    startTiming() {
      timing = { until: performance.now() + 16_000, raf: [], draws: [] };
      return performance.now();
    },
    stopTiming() {
      const result = timing;
      timing = null;
      return result;
    },
  };
  const debugHost = window as Window & { __pioraPuppetDebug?: typeof debug };
  const debugging = process.env.NODE_ENV === "development"
    && (new URLSearchParams(location.search).get("claudeWallpaperDebug") === "1"
      || sessionStorage.getItem("piora-claude-wallpaper-debug") === "1");
  if (debugging) debugHost.__pioraPuppetDebug = debug;

  canvas.addEventListener("webglcontextlost", lost);
  canvas.addEventListener("webglcontextrestored", restore);
  window.addEventListener("focus", focus);
  window.addEventListener("blur", suspend);
  window.addEventListener("resize", onWindowResize);
  window.addEventListener("keydown", wake);
  window.addEventListener("pointerdown", wake, { passive: true });
  window.addEventListener("pointermove", aim, { passive: true });
  window.addEventListener("pointerup", click, { passive: true });
  document.addEventListener("visibilitychange", syncPlayback);
  document.documentElement.addEventListener("pointerleave", unpoint);
  surface.observe(document.body, { childList: true });
  style.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
  size.observe(canvas);
  attachToVisibleSurface();

  signal.addEventListener("abort", () => {
    suspend();
    surface.disconnect();
    style.disconnect();
    size.disconnect();
    canvas.removeEventListener("webglcontextlost", lost);
    canvas.removeEventListener("webglcontextrestored", restore);
    window.removeEventListener("focus", focus);
    window.removeEventListener("blur", suspend);
    window.removeEventListener("resize", onWindowResize);
    window.removeEventListener("keydown", wake);
    window.removeEventListener("pointerdown", wake);
    window.removeEventListener("pointermove", aim);
    window.removeEventListener("pointerup", click);
    document.removeEventListener("visibilitychange", syncPlayback);
    document.documentElement.removeEventListener("pointerleave", unpoint);
    canvas.remove();
    renderer?.dispose(true);
    if (debugHost.__pioraPuppetDebug === debug) delete debugHost.__pioraPuppetDebug;
  }, { once: true });
}

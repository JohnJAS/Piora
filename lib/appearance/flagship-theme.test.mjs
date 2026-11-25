import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const { FLAGSHIP_THEMES, getFlagshipPerformanceClip, getFlagshipTheme, isFlagshipTheme } = await jiti.import("./flagship-themes.ts");
const {
  getFlagshipPerformanceBusSnapshot,
  requestFlagshipPerformance,
  resetFlagshipPerformanceBus,
  setFlagshipPerformanceStatus,
  subscribeFlagshipPerformanceBus,
} = await jiti.import("./flagship-performance-bus.ts");
const {
  COMPLETED_HOLD_MS,
  FAILED_HOLD_MS,
  IDLE_SETTLE_DELAY_MS,
  MIN_WORK_DWELL_MS,
  WORK_SWITCH_DEBOUNCE_MS,
  createAgentMoodController,
  resolveRawAgentMood,
} = await jiti.import("./agent-mood-store.ts");
const {
  createMoodMotionState,
  getFlagshipMoodVisualProfile,
  stepMoodMotionState,
} = await jiti.import("./flagship-mood-motion.ts");
const themePreferences = await jiti.import("../theme-preferences.ts");
const backgrounds = await jiti.import("../backgrounds.ts");

function relativeLuminance(hex) {
  const channels = hex.slice(1).match(/../g).map((value) => {
    const channel = Number.parseInt(value, 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function createFakeScheduler() {
  let nowMs = 1_000;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => nowMs,
    setTimer: (callback, delayMs) => {
      const id = nextId++;
      timers.set(id, { at: nowMs + delayMs, callback });
      return id;
    },
    clearTimer: (id) => {
      timers.delete(id);
    },
    advance(ms) {
      const target = nowMs + ms;
      while (true) {
        let earliest = null;
        for (const [id, entry] of timers.entries()) {
          if (entry.at <= target && (!earliest || entry.at < earliest.entry.at)) {
            earliest = { id, entry };
          }
        }
        if (!earliest) break;
        nowMs = earliest.entry.at;
        timers.delete(earliest.id);
        earliest.entry.callback();
      }
      nowMs = target;
    },
  };
}

test("resolves all 6 Agent moods with expected multi-session priorities", () => {
  const idle = { status: "idle", cause: "" };
  const bgApproval = [{ id: "bg-1", runtime: "running", pendingApproval: true, lastPromptFailed: false }];
  assert.deepEqual(
    resolveRawAgentMood({ currentActivity: idle, runningTasks: bgApproval, now: 5000, lastCompletedAt: -Infinity, lastFailedAt: -Infinity }),
    { mood: "review", isBackgroundOnly: true, activeTaskCount: 1, runningSubagentCount: 0 },
  );

  // Current review beats background running/approval with isBackgroundOnly: false
  assert.deepEqual(
    resolveRawAgentMood({
      currentActivity: { status: "review", cause: "approval", sessionId: "cur" },
      runningTasks: bgApproval,
      activeSessionId: "cur",
      now: 5000,
      lastCompletedAt: -Infinity,
      lastFailedAt: -Infinity,
    }),
    { mood: "review", isBackgroundOnly: false, activeTaskCount: 2, runningSubagentCount: 0 },
  );

  // Recent failure holds within FAILED_HOLD_MS and releases afterwards
  assert.equal(
    resolveRawAgentMood({
      currentActivity: { status: "failed", cause: "boom" },
      runningTasks: [],
      now: 5000,
      lastCompletedAt: -Infinity,
      lastFailedAt: 2000,
    }).mood,
    "failed",
  );
  assert.equal(
    resolveRawAgentMood({
      currentActivity: { status: "failed", cause: "boom" },
      runningTasks: [],
      now: 2000 + FAILED_HOLD_MS,
      lastCompletedAt: -Infinity,
      lastFailedAt: 2000,
    }).mood,
    "idle",
  );

  // Current running / waiting
  assert.equal(
    resolveRawAgentMood({
      currentActivity: { status: "running", cause: "tool" },
      runningTasks: [{ id: "cur", runtime: "running", runningSubagentCount: 2, pendingApproval: false, lastPromptFailed: false }],
      activeSessionId: "cur",
      now: 5000,
      lastCompletedAt: -Infinity,
      lastFailedAt: -Infinity,
    }).runningSubagentCount,
    2,
  );
  assert.equal(
    resolveRawAgentMood({
      currentActivity: { status: "waiting", cause: "thinking" },
      runningTasks: [],
      now: 5000,
      lastCompletedAt: -Infinity,
      lastFailedAt: -Infinity,
    }).mood,
    "waiting",
  );

  // Recent completion window
  assert.equal(
    resolveRawAgentMood({
      currentActivity: idle,
      runningTasks: [],
      now: 5000,
      lastCompletedAt: 5000 - COMPLETED_HOLD_MS + 100,
      lastFailedAt: -Infinity,
    }).mood,
    "completed",
  );

  // Background thinking vs background tool execution
  assert.deepEqual(
    resolveRawAgentMood({
      currentActivity: idle,
      runningTasks: [{ id: "bg-2", runtime: "running", pendingApproval: false, lastPromptFailed: false, activity: { kind: "thinking", message: "Thinking", updatedAt: 4000 } }],
      activeSessionId: "cur",
      now: 5000,
      lastCompletedAt: -Infinity,
      lastFailedAt: -Infinity,
    }),
    { mood: "waiting", isBackgroundOnly: true, activeTaskCount: 1, runningSubagentCount: 0 },
  );
  assert.deepEqual(
    resolveRawAgentMood({
      currentActivity: idle,
      runningTasks: [{ id: "bg-3", runtime: "running", pendingApproval: false, lastPromptFailed: false, activity: { kind: "tool", message: "Read", updatedAt: 4000 } }],
      activeSessionId: "cur",
      now: 5000,
      lastCompletedAt: -Infinity,
      lastFailedAt: -Infinity,
    }),
    { mood: "running", isBackgroundOnly: true, activeTaskCount: 1, runningSubagentCount: 0 },
  );
});

test("mood controller applies hysteresis against rapid flicker, auto-settles holds, and supports preview overrides", () => {
  const clock = createFakeScheduler();
  const controller = createAgentMoodController({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  // Entering work from idle is immediate
  controller.publish({
    currentActivity: { status: "running", cause: "tool", event: { kind: "started", key: "k1", occurredAt: clock.now() } },
    runningTasks: [],
  });
  assert.equal(controller.getSnapshot().liveMood, "running");
  assert.equal(controller.getSnapshot().pulseKind, "started");

  // Rapid running -> waiting -> running within 200ms does not flicker
  clock.advance(150);
  controller.publish({ currentActivity: { status: "waiting", cause: "model" }, runningTasks: [] });
  assert.equal(controller.getSnapshot().liveMood, "running");
  clock.advance(200);
  controller.publish({ currentActivity: { status: "running", cause: "tool" }, runningTasks: [] });
  clock.advance(MIN_WORK_DWELL_MS);
  assert.equal(controller.getSnapshot().liveMood, "running");

  // Sustained waiting settles after dwell + debounce
  controller.publish({ currentActivity: { status: "waiting", cause: "model" }, runningTasks: [] });
  clock.advance(Math.max(WORK_SWITCH_DEBOUNCE_MS, MIN_WORK_DWELL_MS));
  assert.equal(controller.getSnapshot().liveMood, "waiting");

  // Review interrupts immediately
  controller.publish({ currentActivity: { status: "review", cause: "approval" }, runningTasks: [] });
  assert.equal(controller.getSnapshot().liveMood, "review");
  assert.equal(controller.getSnapshot().pulseKind, "review");

  // Completion holds for COMPLETED_HOLD_MS then settles to idle
  controller.publish({
    currentActivity: { status: "idle", cause: "", event: { kind: "completed", key: "k2", occurredAt: clock.now() } },
    runningTasks: [],
  });
  assert.equal(controller.getSnapshot().liveMood, "completed");
  assert.equal(controller.getSnapshot().pulseKind, "completed");
  clock.advance(COMPLETED_HOLD_MS - 10);
  assert.equal(controller.getSnapshot().liveMood, "completed");
  clock.advance(20);
  assert.equal(controller.getSnapshot().liveMood, "idle");

  // Failure holds for FAILED_HOLD_MS then settles to idle
  controller.publish({
    currentActivity: { status: "failed", cause: "err", event: { kind: "failed", key: "k3", occurredAt: clock.now() } },
    runningTasks: [],
  });
  assert.equal(controller.getSnapshot().liveMood, "failed");
  clock.advance(FAILED_HOLD_MS + 10);
  assert.equal(controller.getSnapshot().liveMood, "idle");

  // Running -> idle waits IDLE_SETTLE_DELAY_MS
  controller.publish({ currentActivity: { status: "running", cause: "tool" }, runningTasks: [] });
  assert.equal(controller.getSnapshot().liveMood, "running");
  controller.publish({ currentActivity: { status: "idle", cause: "" }, runningTasks: [] });
  clock.advance(IDLE_SETTLE_DELAY_MS - 50);
  assert.equal(controller.getSnapshot().liveMood, "running");
  clock.advance(60);
  assert.equal(controller.getSnapshot().liveMood, "idle");

  // Preview override preserves liveMood and clears cleanly
  controller.setPreviewMood("review");
  assert.equal(controller.getSnapshot().mood, "review");
  assert.equal(controller.getSnapshot().liveMood, "idle");
  controller.setPreviewMood(null);
  assert.equal(controller.getSnapshot().mood, "idle");
  controller.dispose();
});

test("motion profiles differentiate day/night, subagents, background tasks, and damp smoothly", () => {
  const dayReview = getFlagshipMoodVisualProfile({ mood: "review", isBackgroundOnly: false, runningSubagentCount: 0 }, "day");
  const nightReview = getFlagshipMoodVisualProfile({ mood: "review", isBackgroundOnly: false, runningSubagentCount: 0 }, "night");
  assert.ok(nightReview.beaconStrength > dayReview.beaconStrength);

  const runningSubagents = getFlagshipMoodVisualProfile({ mood: "running", isBackgroundOnly: false, runningSubagentCount: 2 }, "night");
  assert.equal(runningSubagents.ringCount, 2);

  const bgWaiting = getFlagshipMoodVisualProfile({ mood: "waiting", isBackgroundOnly: true, runningSubagentCount: 0 }, "night");
  const fgWaiting = getFlagshipMoodVisualProfile({ mood: "waiting", isBackgroundOnly: false, runningSubagentCount: 0 }, "night");
  assert.ok(bgWaiting.beaconStrength < fgWaiting.beaconStrength);
  assert.ok(bgWaiting.gazeLock < fgWaiting.gazeLock);

  const motion = createMoodMotionState("night");
  const targetSnap = { mood: "review", isBackgroundOnly: false, runningSubagentCount: 0 };
  for (let i = 0; i < 40; i++) stepMoodMotionState(motion, targetSnap, "night", 1 / 30);
  assert.ok(motion.colorR > 0.9 && motion.gazeLock > 0.75);
});

test("flagship themes satisfy WCAG AA contrast and pre-paint scripts", () => {
  const css = readFileSync(resolve(projectRoot, "app/flagship-themes.css"), "utf8");
  for (const theme of FLAGSHIP_THEMES) {
    assert.equal(isFlagshipTheme(theme.id), true);
    assert.equal(getFlagshipTheme(theme.id)?.variant, theme.variant);
    const block = css.match(new RegExp(`html\\[data-theme="${theme.id}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1];
    assert.ok(block, `missing CSS block for ${theme.id}`);
    const tokens = Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
    for (const fg of ["text", "text-muted", "text-dim", "accent"]) {
      for (const bg of ["bg", "bg-panel"]) {
        const ratio = contrastRatio(tokens[fg], tokens[bg]);
        assert.ok(ratio >= 4.5, `${theme.id} ${fg}/${bg} contrast ${ratio.toFixed(2)} < 4.5`);
      }
    }
    assert.ok(contrastRatio(tokens["btn-primary-fg"], tokens["btn-primary-bg"]) >= 4.5);
    assert.ok(contrastRatio(tokens["btn-primary-fg"], tokens["btn-primary-bg-hover"]) >= 4.5);

    // Pre-paint theme & background restoration
    const classes = new Set();
    const props = {};
    const root = {
      dataset: {},
      style: { setProperty: (name, value) => { props[name] = value; } },
      classList: {
        toggle(name, enabled) {
          if (enabled) classes.add(name);
          else classes.delete(name);
        },
      },
      setAttribute(name, value) {
        if (name === "data-theme") this.dataset.theme = value;
      },
    };
    const storageMap = new Map([
      [themePreferences.THEME_STORAGE_KEY, themePreferences.serializeThemePreference(theme.id)],
      [
        backgrounds.BACKGROUND_PREFERENCE_STORAGE_KEY,
        backgrounds.serializeBackgroundPreference({
          schemaVersion: 1,
          source: "builtin",
          presetId: theme.id,
          overlay: theme.overlay,
          blur: theme.blur,
          sidebarOverlay: theme.sidebarOverlay,
          filePanelOverlay: theme.filePanelOverlay,
        }),
      ],
    ]);
    const storage = { getItem: (key) => storageMap.get(key) ?? null };
    vm.runInNewContext(themePreferences.THEME_INITIALIZATION_SCRIPT, {
      document: { documentElement: root },
      localStorage: storage,
    });
    vm.runInNewContext(backgrounds.BACKGROUND_INITIALIZATION_SCRIPT, {
      document: { documentElement: root },
      localStorage: storage,
    });
    assert.equal(root.dataset.theme, theme.id);
    assert.equal(classes.has("dark"), theme.isDark);
    assert.equal(root.dataset.appBackgroundPreset, theme.id);
    assert.equal(props["--app-background-image"], `url("${theme.asset}")`);
  }
});

test("flagship performance bus sequences requests and status updates cleanly", () => {
  resetFlagshipPerformanceBus();
  const seen = [];
  const unsubscribe = subscribeFlagshipPerformanceBus(() => {
    seen.push(getFlagshipPerformanceBusSnapshot());
  });

  assert.deepEqual(getFlagshipPerformanceBusSnapshot(), {
    activeClipId: null,
    phase: "idle",
    lastRequest: null,
  });

  requestFlagshipPerformance("celebrate");
  assert.deepEqual(getFlagshipPerformanceBusSnapshot().lastRequest, { clipId: "celebrate", seq: 1 });

  setFlagshipPerformanceStatus("celebrate", "settling");
  assert.equal(getFlagshipPerformanceBusSnapshot().phase, "settling");
  assert.equal(getFlagshipPerformanceBusSnapshot().activeClipId, "celebrate");

  setFlagshipPerformanceStatus("celebrate", "playing");
  assert.equal(getFlagshipPerformanceBusSnapshot().phase, "playing");

  requestFlagshipPerformance("stop");
  assert.deepEqual(getFlagshipPerformanceBusSnapshot().lastRequest, { clipId: "stop", seq: 2 });

  setFlagshipPerformanceStatus(null, "idle");
  assert.equal(getFlagshipPerformanceBusSnapshot().phase, "idle");
  assert.equal(getFlagshipPerformanceBusSnapshot().activeClipId, null);
  assert.equal(seen.length, 5);

  unsubscribe();
  resetFlagshipPerformanceBus();
});

test("flagship day and night editions ship valid Tier 2 celebrate and salute performance clips", () => {
  for (const theme of FLAGSHIP_THEMES) {
    const celebrate = getFlagshipPerformanceClip(theme, "celebrate");
    const salute = getFlagshipPerformanceClip(theme, "salute");
    assert.ok(celebrate, `${theme.id}: missing celebrate clip`);
    assert.ok(salute, `${theme.id}: missing salute clip`);

    for (const clip of [celebrate, salute]) {
      assert.match(clip.video, /^\/themes\/(?:character-backgrounds|piora-flagship)\/performances\/[a-z0-9-]+\.webm$/);
      const videoFile = resolve(projectRoot, "public", clip.video.slice(1));
      assert.equal(existsSync(videoFile), true, `missing video asset ${clip.video}`);
      if (clip.stage) {
        const stageFile = resolve(projectRoot, "public", clip.stage.slice(1));
        assert.equal(existsSync(stageFile), true, `missing stage asset ${clip.stage}`);
      }
      if (clip.video.startsWith("/themes/piora-flagship/")) {
        const sizeBytes = statSync(videoFile).size;
        assert.ok(sizeBytes > 50_000, `${clip.video} unexpectedly small (${sizeBytes} bytes)`);
        assert.ok(sizeBytes < 8 * 1024 * 1024, `${clip.video} exceeds 8 MiB (${sizeBytes} bytes)`);
      }
    }
  }
});


import { resolve } from "node:path";
import { runDesktopScenario } from "./desktop-e2e/harness.mjs";
import { claudePaperScenario, claudeWallpaperFocusScenario, runClaudePaperBrowser } from "./desktop-e2e/scenarios/claude-paper.mjs";

const [mode = "--all", only] = process.argv.slice(2);
if (!["--all", "--desktop-only", "--browser-only", "--focus-only"].includes(mode)
  || (only && (mode === "--focus-only" || !["lamp", "autumn"].includes(only)))) {
  throw new Error("Usage: node scripts/verify-claude-series.mjs [--all|--desktop-only|--browser-only] [lamp|autumn] or --focus-only");
}
const controller = new AbortController();
for (const event of ["SIGINT", "SIGTERM"]) {
  process.once(event, () => controller.abort(new Error("Claude series verification cancelled")));
}
const signal = controller.signal;
const root = resolve(import.meta.dirname, "..");
const checked = (scene, mode, result) => {
  const { status, failedStep, error } = result.report;
  console.log(JSON.stringify({ scene, mode, directory: result.directory, status, failedStep, error: error?.message ?? error }));
  if (status !== "passed") process.exitCode = 1;
};

if (mode === "--focus-only") {
  checked("series", "focus", await runDesktopScenario({
    root, scenario: claudeWallpaperFocusScenario, timeoutMs: 180_000, stepTimeoutMs: 90_000, signal,
  }));
}
for (const scene of mode === "--focus-only" ? [] : only ? [only] : ["lamp", "autumn"]) {
  signal.throwIfAborted();
  if (mode !== "--browser-only") {
    checked(scene, "desktop", await runDesktopScenario({
      root, scenario: claudePaperScenario({ scene, orderedPreview: true, hotSwitch: scene === "autumn" }),
      timeoutMs: 540_000, stepTimeoutMs: 90_000, signal,
    }));
  }
  if (mode !== "--desktop-only" && !signal.aborted) {
    checked(scene, "browser", await runClaudePaperBrowser(root, signal, "character-claude-" + scene));
  }
}

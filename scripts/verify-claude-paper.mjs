import { resolve } from "node:path";
import { runDesktopScenario } from "./desktop-e2e/harness.mjs";
import { claudePaperScenario, runClaudePaperBrowser } from "./desktop-e2e/scenarios/claude-paper.mjs";

const controller = new AbortController();
for (const event of ["SIGINT", "SIGTERM"]) {
  process.once(event, () => controller.abort(new Error("Claude Paper verification cancelled")));
}
const root = resolve(import.meta.dirname, "..");
const mode = process.argv[2] ?? "--all";
if (!["--all", "--desktop-only", "--browser-only", "--gate-preview"].includes(mode)) throw new Error("Unknown Claude Paper verification mode");
if (mode !== "--browser-only") {
  const desktop = await runDesktopScenario({
    root, scenario: claudePaperScenario({ orderedPreview: mode === "--gate-preview" }),
    timeoutMs: 540_000, stepTimeoutMs: 60_000, signal: controller.signal,
  });
  console.log(JSON.stringify({
    status: desktop.report.status, directory: desktop.directory, failedStep: desktop.report.failedStep, error: desktop.report.error?.message,
  }));
  if (desktop.report.status !== "passed") process.exitCode = 1;
}
if (["--all", "--browser-only"].includes(mode) && !controller.signal.aborted) {
  const browser = await runClaudePaperBrowser(root, controller.signal);
  console.log(JSON.stringify({ status: browser.report.status, directory: browser.directory, error: browser.report.error }));
  if (browser.report.status !== "passed") process.exitCode = 1;
}

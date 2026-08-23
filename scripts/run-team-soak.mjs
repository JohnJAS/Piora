import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const durationMs = Math.max(1_000, Number(process.env.PIORA_TEAM_SOAK_DURATION_MS ?? 60 * 60_000) || 60 * 60_000);
const minimumRuns = Math.max(1, Number(process.env.PIORA_TEAM_SOAK_MIN_RUNS ?? 500) || 500);
// The coordinator suite contains exactly one full golden-path TeamRun that
// reaches completed; its other cases exercise retries, waiting and recovery.
const completedRunsPerIteration = 1;
const startedAt = performance.now();
let completedRuns = 0;
let iteration = 0;
let peakRss = process.memoryUsage().rss;

while (performance.now() - startedAt < durationMs || completedRuns < minimumRuns) {
  iteration += 1;
  const seed = `team-soak-${iteration}`;
  const result = spawnSync(process.execPath, ["--test", "--test-reporter=dot", "lib/team-coordinator-service.test.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, PIORA_TEAM_TEST_SEED: seed },
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
  });
  if (result.status !== 0) {
    process.stderr.write(`${JSON.stringify({
      status: "failed",
      iteration,
      seed,
      childStatus: result.status,
      childSignal: result.signal,
      childError: result.error instanceof Error ? result.error.message : null,
      elapsedMs: Math.round(performance.now() - startedAt),
    })}\n${result.stdout}${result.stderr}`);
    process.exit(result.status ?? 1);
  }
  completedRuns += completedRunsPerIteration;
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  if (iteration % 10 === 0) {
    const elapsedMinutes = (performance.now() - startedAt) / 60_000;
    process.stdout.write(`Team soak: ${completedRuns} runs, ${elapsedMinutes.toFixed(1)} minutes, parent peak RSS ${(peakRss / 1024 / 1024).toFixed(1)} MiB.\n`);
  }
}

const elapsedMs = performance.now() - startedAt;
process.stdout.write(`${JSON.stringify({
  status: "passed",
  iterations: iteration,
  completedRuns,
  elapsedMs: Math.round(elapsedMs),
  peakRssBytes: peakRss,
})}\n`);

import { performance } from "node:perf_hooks";
import { getVisibleRenderWindow } from "../lib/chat-lazy-load.ts";
import { getDiffRenderWindow, DIFF_RENDER_BATCH } from "../lib/diff-progressive.ts";
import { buildEntriesFromFiles, filterFileEntries } from "../lib/file-fuzzy.ts";
import { filterSessions } from "../lib/session-search.ts";
import { getReviewListWindow } from "../lib/review-progressive.ts";
import { getTreeRenderWindow, TREE_INITIAL_RENDER_COUNT } from "../lib/tree-progressive.ts";

function median(values) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.floor(ordered.length / 2)];
}

function measure(name, budgetMs, run) {
  run();
  const samples = [];
  for (let index = 0; index < 5; index += 1) {
    const started = performance.now();
    run();
    samples.push(performance.now() - started);
  }
  const elapsed = median(samples);
  const passed = elapsed <= budgetMs;
  console.log(`${passed ? "PASS" : "FAIL"} ${name}: ${elapsed.toFixed(2)}ms / ${budgetMs}ms`);
  return passed;
}

const sessions = Array.from({ length: 500 }, (_, index) => ({
  id: `session-${index}`,
  path: `C:/sessions/session-${index}.jsonl`,
  cwd: `C:/workspace/project-${index % 20}`,
  name: `Task ${index}`,
  created: new Date(Date.UTC(2026, 7, 9, 0, index)).toISOString(),
  modified: new Date(Date.UTC(2026, 7, 9, 0, index)).toISOString(),
  messageCount: 2,
  firstMessage: `Task ${index}`,
}));
const files = Array.from({ length: 5_000 }, (_, index) => `src/feature-${index % 100}/file-${index}.ts`);
const fileEntries = buildEntriesFromFiles(files);

const checks = [
  measure("filter 500 tasks", 50, () => filterSessions(sessions, "Piora", "task 49")),
  measure("search a 5,000-file index", 800, () => filterFileEntries(fileEntries, "file-4999", 1_000)),
  measure("select a 2,000-item chat window", 50, () => getVisibleRenderWindow(2_000, 50)),
  measure("bound the first 5,000-file tree render", 50, () => getTreeRenderWindow(5_000, TREE_INITIAL_RENDER_COUNT)),
  measure("bound the first 12,000-line diff render", 50, () => getDiffRenderWindow(12_000, DIFF_RENDER_BATCH)),
  measure("window a 10,000-change Review list", 50, () => getReviewListWindow(10_000, 9_999)),
];

if (checks.some((passed) => !passed)) process.exitCode = 1;

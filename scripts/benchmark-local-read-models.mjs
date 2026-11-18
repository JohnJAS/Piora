import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { createJiti } from "jiti";
import { buildEntriesFromFiles, filterFileEntries } from "../lib/read-runtime/file-ranking.mjs";

const root = await mkdtemp(join(tmpdir(), "piora-local-read-benchmark-"));
assert.equal(dirname(root), resolve(tmpdir()));
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
process.env.PIORA_SESSION_CONTROL_ROOT = join(root, "control");
const jiti = createJiti(import.meta.url, { alias: { "@": resolve(".") } });
const { GET } = await jiti.import("../app/api/sessions/[id]/route.ts");
const { GET: readSubmissions } = await jiti.import("../app/api/sessions/[id]/submissions/route.ts");
const { cacheSessionPath } = await jiti.import("../lib/session-reader.ts");
const { SessionControlStore } = await jiti.import("../lib/session-control-store.ts");
const { HISTORY_PAGE_BYTES } = await jiti.import("../lib/session-read-repository.ts");
const { SessionCatalogIndex, readSessionCatalogEntry } = await jiti.import("../lib/session-catalog-index.ts");
const store = new SessionControlStore();
const report = { node: process.version, platform: process.platform, sessions: [], fileSearch: [], catalog: {} };

const rounded = value => Number(value.toFixed(2));
const percentile = (samples, ratio) => rounded(samples.slice().sort((left, right) => left - right)[Math.ceil(samples.length * ratio) - 1]);
const serialized = values => values.map(value => JSON.stringify(value)).join("\n") + "\n";
const timestamp = "2026-01-01T00:00:00.000Z";

async function timed(operation) {
  const started = performance.now();
  const result = await operation();
  return { result, ms: performance.now() - started };
}

try {
  for (const size of [1000, 10_000, 30_000]) {
    const entries = Array.from({ length: size }, (_, index) => ({
      type: "message", id: (index + 1).toString(16).padStart(8, "0"),
      parentId: index ? index.toString(16).padStart(8, "0") : null, timestamp,
      message: index % 2 ? { role: "assistant", content: [{ type: "text", text: "a".repeat(1024) }],
        stopReason: "stop", model: "fixture", provider: "fixture" } : { role: "user", content: "a".repeat(1024) },
    }));
    const id = "benchmark-" + size;
    const file = join(root, id + ".jsonl");
    await writeFile(file, serialized([{ type: "session", version: 3, id, cwd: root, timestamp }, ...entries]));
    cacheSessionPath(id, file);
    const get = (paged, etag) => GET(new Request("http://local/api/sessions/" + id + "?deferThinking=1&deferMedia=1" + (paged ? "&view=chat" : ""), {
      headers: etag ? { "if-none-match": etag } : {},
    }), { params: Promise.resolve({ id }) });

    const fullTimer = timed(() => new Promise(resolveTimer => setTimeout(resolveTimer, 0)));
    const readFull = await timed(() => get(false));
    const fullTimerMs = (await fullTimer).ms;
    assert.equal(readFull.result.status, 200);
    const raw = await readFull.result.arrayBuffer();
    const timer = timed(() => new Promise(resolveTimer => setTimeout(resolveTimer, 0)));
    const cold = await timed(() => get(true));
    const eventLoopDelay = (await timer).ms;
    assert.equal(cold.result.status, 200);
    const etag = cold.result.headers.get("etag");
    const text = await cold.result.text();
    assert.ok(Buffer.byteLength(text) <= HISTORY_PAGE_BYTES + 8192, "chat payload must stay bounded");
    const page = JSON.parse(text);
    assert.equal(page.context.entryIds.at(-1), entries.at(-1).id);
    assert.ok(page.context.entryIds.length <= 80);
    const warm = [], revalidated = [];
    for (let index = 0; index < 21; index++) {
      const hit = await timed(() => get(true));
      warm.push(hit.ms);
      await hit.result.arrayBuffer();
      const notModified = await timed(() => get(true, etag));
      assert.equal(notModified.result.status, 304);
      revalidated.push(notModified.ms);
    }
    report.sessions.push({ messages: size, fullBytes: raw.byteLength, fullColdMs: rounded(readFull.ms), fullTimerMs: rounded(fullTimerMs), pageBytes: Buffer.byteLength(text),
      pageColdMs: rounded(cold.ms), coldTimerMs: rounded(eventLoopDelay), pageP50: percentile(warm, 0.5), pageP95: percentile(warm, 0.95),
      revalidateP50: percentile(revalidated, 0.5), revalidateP95: percentile(revalidated, 0.95) });
  }

  const journal = store.commandsPath("benchmark-journal");
  await mkdir(dirname(journal), { recursive: true });
  const rows = Array.from({ length: 10_000 }, (_, index) => {
    const command = { commandId: "cmd-" + index, targetSessionId: "benchmark-journal", source: "ui", idempotencyKey: "receipt-" + index,
      delivery: "next_turn", status: "accepted", content: index === 0 ? "/fixture" : "text".repeat(256), acceptedAt: index,
      taskTiming: { commandId: "cmd-" + index, sessionId: "benchmark-journal", startedAt: index, finishedAt: index + 1, outcome: "completed" } };
    return [{ kind: "command", command }, { kind: "status", commandId: command.commandId, status: "completed" }];
  }).flat();
  await writeFile(journal, serialized(rows));
  const receipt = () => store.queryCompletedSlashPromptIds("benchmark-journal", new Set(["receipt-0", "missing"]));
  const journalTimer = timed(() => new Promise(resolveTimer => setTimeout(resolveTimer, 0)));
  const cold = await timed(receipt);
  const journalTimerMs = (await journalTimer).ms;
  assert.deepEqual(cold.result, ["receipt-0"]);
  const warm = [];
  for (let index = 0; index < 21; index++) {
    const hit = await timed(receipt);
    assert.deepEqual(hit.result, cold.result);
    warm.push(hit.ms);
  }
  const operations = await readSubmissions(new Request("http://local/api/sessions/benchmark-journal/submissions?view=operations&scope=chat&timingPromptId=receipt-0"), {
    params: Promise.resolve({ id: "benchmark-journal" }),
  });
  assert.equal(operations.status, 200);
  const operationsText = await operations.text();
  const scoped = JSON.parse(operationsText);
  assert.deepEqual(scoped.items, []);
  assert.equal(scoped.taskTiming.commandId, "cmd-9999");
  assert.deepEqual(scoped.taskTimings.map(item => item.idempotencyKey), ["receipt-0"]);
  assert.ok(Buffer.byteLength(operationsText) < 2048, "operation polling must not transfer every historical timer");
  report.journal = { commands: 10_000, coldIndexMs: rounded(cold.ms), coldTimerMs: rounded(journalTimerMs),
    receiptP50: percentile(warm, 0.5), receiptP95: percentile(warm, 0.95), operationsBytes: Buffer.byteLength(operationsText) };

  for (const count of [50_000, 200_000]) {
    const files = Array.from({ length: count }, (_, index) => "packages/package-" + String(index % 240).padStart(3, "0")
      + "/src/" + ["components", "hooks", "local", "desktop"][Math.floor(index / 240) % 4]
      + "/" + (index % 13 === 0 ? "StatusPanel" : "Module") + String(index).padStart(6, "0") + ".tsx");
    const build = await timed(() => buildEntriesFromFiles(files));
    const hits = [], misses = [];
    for (let index = 0; index < 11; index++) {
      const hit = await timed(() => filterFileEntries(build.result, "statuspanel"));
      assert.equal(hit.result.length, 20);
      hits.push(hit.ms);
      const miss = await timed(() => filterFileEntries(build.result, "xxnohitzz"));
      assert.deepEqual(miss.result, []);
      misses.push(miss.ms);
    }
    report.fileSearch.push({ paths: count, buildMs: rounded(build.ms), matchedP50: percentile(hits, 0.5), matchedP95: percentile(hits, 0.95),
      unmatchedP50: percentile(misses, 0.5), unmatchedP95: percentile(misses, 0.95) });
  }

  const catalogRoot = join(root, "catalog");
  const catalogFolder = join(catalogRoot, "project");
  await mkdir(catalogFolder, { recursive: true });
  for (let start = 0; start < 2500; start += 32) {
    await Promise.all(Array.from({ length: Math.min(32, 2500 - start) }, (_, index) => {
      const id = String(start + index);
      return writeFile(join(catalogFolder, id + ".jsonl"), serialized([{ type: "session", id, cwd: root, timestamp }]));
    }));
  }
  let parses = 0;
  const index = new SessionCatalogIndex(async (...args) => { parses++; return readSessionCatalogEntry(...args); });
  const coldList = await timed(() => index.list(catalogRoot));
  const count = parses;
  const warmList = await timed(() => index.list(catalogRoot));
  assert.equal(coldList.result.length, 2500);
  assert.equal(warmList.result.length, 2500);
  assert.equal(parses, count, "revalidating unchanged files must not parse them again");
  report.catalog = { files: 2500, initialMs: rounded(coldList.ms), repeatMs: rounded(warmList.ms), repeatedParses: parses - count };
  report.rssMiBAtEnd = rounded(process.memoryUsage().rss / 1024 / 1024);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}

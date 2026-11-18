import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as promises from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));

function loadWithoutHeavyImports(file, dependencies = {}, globals = {}) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } });
  const context = { ...globals, exports: {}, require: (name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected startup dependency: ${name}`);
    return dependencies[name];
  } };
  runInNewContext(outputText, context);
  return context;
}

test("ordinary Node startup skips archive code and an actual restore still precedes instrumentation", async () => {
  for (const pending of [false, true]) {
    const order = [];
    const { exports } = loadWithoutHeavyImports("instrumentation.ts", {
      "./lib/app-backup-state": { hasPendingApplicationRestore: () => pending },
      ...(pending ? { "./lib/app-backup": { applyPendingApplicationRestore: async () => { await Promise.resolve(); order.push("restore"); } } } : {}),
      "./instrumentation-node": { registerNodeInstrumentation: () => order.push("instrumentation") },
    }, { process: { env: { NEXT_RUNTIME: "nodejs" } } });
    await exports.register();
    assert.deepEqual(order, pending ? ["restore", "instrumentation"] : ["instrumentation"]);
  }
});

test("the restore gate can read an authenticated client snapshot without loading backup or agent services", async (testContext) => {
  const agent = await promises.mkdtemp(path.join(tmpdir(), "piora-client-restore-"));
  testContext.after(() => promises.rm(agent, { recursive: true, force: true }));
  const { exports } = loadWithoutHeavyImports("app/api/settings/backup/route.ts", {
    "node:fs": fs,
    "node:fs/promises": promises,
    "node:path": path,
    "node:stream": {},
    "@/lib/app-backup-state": {},
    "@/lib/runtime-home": { getRuntimeAgentDataDirectory: () => agent },
    "@/lib/request-security": { isApiRequestAllowed: (request) => request.headers.get("X-Fixture-Auth") === "allowed" },
    "@/lib/bounded-json": {},
  }, { Response, URL });
  const client = "http://127.0.0.1/api/settings/backup?action=client";
  const request = new Request(client, { headers: { "X-Fixture-Auth": "allowed" } });
  const empty = await exports.GET(request);
  assert.equal(empty.headers.get("Cache-Control"), "no-store");
  assert.equal(await empty.json(), null);
  const snapshot = { id: "fixture", state: { local: { "pi-theme:v1": "dark" } }, mappings: [] };
  await promises.mkdir(path.join(agent, "piora"));
  await promises.writeFile(path.join(agent, "piora/import-client.json"), JSON.stringify(snapshot));
  assert.equal((await exports.GET(new Request(client))).status, 403);
  assert.deepEqual(await (await exports.GET(request)).json(), snapshot);
});

test("running status consumes the live registry but does not initialize the Agent SDK", async () => {
  const context = loadWithoutHeavyImports("lib/rpc-running-status.ts");
  const status = context.exports;
  const { exports } = loadWithoutHeavyImports("app/api/agent/running/route.ts", {
    "next/server": { NextResponse: Response },
    "@/lib/rpc-running-status": status,
    "@/lib/task-status": loadWithoutHeavyImports("lib/task-status.ts").exports,
  });
  assert.deepEqual(await (await exports.GET()).json(), { runningSessionIds: [], runningSessions: [] });
  assert.equal(context.__piSessions, undefined);

  const wrapper = (id, runtime, overrides = {}) => ({
    isAlive: () => true,
    getTaskRuntimeSnapshot: () => ({ id, runtime, pendingApproval: false, lastPromptFailed: false, ...overrides }),
  });
  context.__piSessions = new Map([
    ["running", wrapper("running", "running")],
    ["hidden", { ...wrapper("hidden", "running"), isSubagentSession: () => true }],
    ["dead", { ...wrapper("dead", "running"), isAlive: () => false }],
    ["quiet", wrapper("quiet", "idle")],
    ["approval", wrapper("approval", "idle", { pendingApproval: true })],
    ["legacy", { sessionId: "legacy", isAlive: () => true, inner: { isCompacting: true } }],
  ]);
  const payload = await (await exports.GET()).json();
  assert.deepEqual(payload.runningSessionIds, ["legacy", "running"]);
  assert.deepEqual(payload.runningSessions.map(({ id }) => id), ["approval", "legacy", "running"]);
  assert.ok(payload.runningSessions[0].pendingApproval);

  const snapshots = [];
  const unsubscribe = status.subscribeRunningSessions((entries) => snapshots.push(Array.from(entries, ({ id }) => id)));
  status.notifyRunningChange();
  status.notifyRunningChange();
  context.__piSessions.delete("running");
  status.notifyRunningChange();
  unsubscribe();
  assert.deepEqual(snapshots, [["approval", "legacy", "running"], ["approval", "legacy"]]);
});

test("Tailwind emits interface utilities without watching tests, docs or other packages", async () => {
  const from = path.join(root, "app/globals.css");
  const result = await postcss([tailwind({ base: root, optimize: false })]).process(await promises.readFile(from, "utf8"), { from });
  const files = result.messages.filter(({ type }) => type === "dependency").map(({ file }) => path.relative(root, file).replaceAll("\\", "/"));
  assert.ok(files.includes("components/ChatWindow.tsx"));
  assert.ok(files.includes("app/layout.tsx"));
  assert.ok(files.includes("lib/initial-navigation.ts"));
  assert.ok(files.every((file) => !/^(?:docs|tests|scripts|third_party|website)\/|\.(?:test|spec)\.[^.]+$/.test(file)));
  for (const selector of [".flex", ".items-center", ".overflow-hidden", ".sr-only"]) assert.ok(result.css.includes(`${selector} {`), selector);
});

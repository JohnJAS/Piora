import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createJiti } from "jiti";

test("movement preference PATCH persists without overwriting other runtime state", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "piora-movement-route-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  t.after(async () => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(root, { recursive: true, force: true });
  });
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  const runtime = await jiti.import("./companion-runtime.ts");
  const { PATCH, GET } = await jiti.import("../app/api/companion/state/route.ts");
  const current = runtime.createDefaultCompanionRuntimeState(10);
  current.settings.movementArea = "bottom-right";
  current.settings.personality = "Keep this preference";
  runtime.writeCompanionRuntimeState(current);
  const request = body => new Request("http://localhost/api/companion/state", { method: "PATCH", headers: { host: "localhost", "Content-Type": "application/json" }, body: JSON.stringify(body) });
  for (const body of [null, {}, { movementArea: "invalid" }]) assert.equal((await PATCH(request(body))).status, 400);
  const response = await PATCH(request({ movementArea: "screen", settings: { personality: "overwrite" }, todos: [] }));
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal(saved.settings.movementArea, "screen");
  assert.equal(saved.settings.personality, current.settings.personality);
  assert.deepEqual(saved.mind, current.mind);
  const reloaded = await GET(new Request("http://localhost/api/companion/state", { headers: { host: "localhost" } }));
  assert.equal((await reloaded.json()).settings.movementArea, "screen");
});

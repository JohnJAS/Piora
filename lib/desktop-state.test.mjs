import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("../desktop/src/desktop-state.ts");
  } catch {
    return import("../desktop/src/desktop-state.ts");
  }
}

const {
  readPiAgentDirectory,
  writeMainWindowState,
  writePiAgentDirectory,
  writePreferredServerPort,
} = await loadSubject();

const logger = { warn() {} };

test("the migrated Pi path survives later desktop-state updates", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "piora-desktop-state-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const migratedDirectory = "D:\\PioraData";

  writePreferredServerPort(root, 8252, logger);
  assert.equal(writePiAgentDirectory(root, migratedDirectory, logger), true);
  writeMainWindowState(root, {
    x: 20,
    y: 30,
    width: 1200,
    height: 800,
    maximized: false,
  }, logger);

  assert.equal(readPiAgentDirectory(root, logger), migratedDirectory);
  const stored = JSON.parse(await readFile(path.join(root, "desktop-state.json"), "utf8"));
  assert.equal(stored.piAgentDirectory, migratedDirectory);
  assert.equal(stored.serverPort, 8252);
  assert.equal(stored.mainWindowState.width, 1200);
});

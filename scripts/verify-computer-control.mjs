// Read-only protocol smoke test. Does not inspect or manipulate desktop contents.
import assert from "node:assert/strict";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { getComputerControl, WINDOWS_COMPUTER_TOOLS, WINDOWS_MCP_VERSION } = await jiti.import("../lib/computer-control.ts");
const { WINAPP_UIA_OPERATIONS, WINAPP_VERSION } = await jiti.import("../lib/winapp-uia.ts");
const runtime = getComputerControl();
try {
  runtime.resume();
  const inventory = await runtime.help();
  assert.deepEqual(inventory.operations.map((tool) => tool.name).sort(), [...WINDOWS_COMPUTER_TOOLS, ...Object.keys(WINAPP_UIA_OPERATIONS)].sort());
  const snapshot = await runtime.help("Snapshot");
  assert.equal(snapshot.inputSchema.type, "object");
  const inspect = await runtime.help("uia_inspect");
  assert.equal(inspect.inputSchema.type, "object");
  assert.equal(runtime.state().uia.connected, true);
  console.log(JSON.stringify({ connected: true, windowsMcpVersion: WINDOWS_MCP_VERSION, uiaVersion: WINAPP_VERSION, operations: inventory.operations.length, schemas: ["Snapshot", "uia_inspect"], desktopActions: 0 }));
} finally {
  await runtime.stop();
  assert.equal(runtime.state().connected, false);
  assert.equal(runtime.state().stopped, true);
}

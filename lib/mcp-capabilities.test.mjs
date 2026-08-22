import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": path.resolve(".") } });
const { inspectMcpCapabilities, stripJsonComments } = await jiti.import("./mcp-capabilities.ts");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "piora-mcp-capabilities-"));
  const cwd = path.join(root, "project");
  const agentDir = path.join(root, "agent");
  const homeDirectory = path.join(root, "home");
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(agentDir, { recursive: true });
  fs.mkdirSync(homeDirectory, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { cwd, agentDir, homeDirectory };
}

test("strips JSON comments without changing comment-like string contents", () => {
  const parsed = JSON.parse(stripJsonComments(`{
    // comment
    "url": "https://example.test/a/*literal*/", /* comment */
    "value": "// literal"
  }`));
  assert.equal(parsed.url, "https://example.test/a/*literal*/");
  assert.equal(parsed.value, "// literal");
});

test("reports configured servers and only sanitized cached capability metadata", (t) => {
  const { cwd, agentDir, homeDirectory } = fixture(t);
  const now = Date.UTC(2026, 7, 22, 3, 0, 0);
  fs.writeFileSync(path.join(cwd, ".mcp.json"), JSON.stringify({
    mcpServers: {
      harmony: {
        command: "node",
        args: ["server.js"],
        env: { SECRET_TOKEN: "must-not-leak" },
      },
      remote: { url: "https://mcp.example.test", headers: { Authorization: "secret" } },
      disabled: { socket: "pipe", disabled: true },
    },
  }));
  fs.writeFileSync(path.join(agentDir, "mcp-cache.json"), JSON.stringify({
    version: 1,
    servers: {
      harmony: {
        configHash: "ignored-by-inventory",
        cachedAt: now - 60_000,
        tools: [{ name: "device_list", description: "List available devices", inputSchema: { secret: true } }],
        resources: [{ uri: "device://one" }],
        prompts: [{ name: "debug" }],
        instructions: "must-not-leak",
      },
      removed: { cachedAt: now, tools: [{ name: "not_callable" }] },
    },
  }));

  const result = inspectMcpCapabilities(cwd, agentDir, now, homeDirectory);
  assert.equal(result.serverCount, 3);
  assert.equal(result.enabledServerCount, 2);
  assert.equal(result.discoveredToolCount, 1);
  assert.equal(result.servers.find((server) => server.name === "harmony").status, "cached");
  assert.equal(result.servers.find((server) => server.name === "harmony").transport, "stdio");
  assert.equal(result.servers.find((server) => server.name === "remote").transport, "http");
  assert.equal(result.servers.find((server) => server.name === "disabled").status, "disabled");
  assert.equal(result.servers.some((server) => server.name === "removed"), false);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /must-not-leak|SECRET_TOKEN|Authorization|inputSchema/);
});

test("marks old metadata stale and diagnoses malformed configuration", (t) => {
  const { cwd, agentDir, homeDirectory } = fixture(t);
  const now = Date.UTC(2026, 7, 22, 3, 0, 0);
  fs.writeFileSync(path.join(cwd, ".mcp.json"), "{ invalid json");
  fs.writeFileSync(path.join(agentDir, "mcp.json"), JSON.stringify({
    mcpServers: { old: { command: "old-server" } },
  }));
  fs.writeFileSync(path.join(agentDir, "mcp-cache.json"), JSON.stringify({
    version: 1,
    servers: {
      old: { cachedAt: now - 8 * 24 * 60 * 60 * 1000, tools: [{ name: "old_tool" }] },
    },
  }));

  const result = inspectMcpCapabilities(cwd, agentDir, now, homeDirectory);
  assert.equal(result.servers[0].status, "stale");
  assert.equal(result.discoveredToolCount, 0);
  assert.equal(result.diagnostics.length, 1);
  assert.match(result.diagnostics[0], /project \.mcp\.json/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, isAbsolute } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": resolve(import.meta.dirname, "..") } });
const { createSSHSession, closeSSHSession } = await jiti.import("./ssh/session-manager.ts");
const { changeSSHBinding } = await jiti.import("./ssh/binding.ts");
const { default: registerSSHTool } = await jiti.import("../extensions/piora-ssh.ts");

test("task SSH tool reads, writes, uploads, and downloads through real SFTP with workspace path isolation", { timeout: 90_000 }, async t => {
  const fixture = spawn(process.execPath, ["scripts/ssh-ui-fixture.mjs"], { cwd: resolve(import.meta.dirname, ".."), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const info = await new Promise((resolveInfo, rejectInfo) => {
    let pending = "";
    const timer = setTimeout(() => rejectInfo(new Error("SSH fixture startup timed out")), 30_000);
    fixture.stdout.on("data", chunk => {
      pending += chunk.toString();
      const line = pending.split(/\r?\n/)[0];
      if (!line.startsWith("{") || !line.endsWith("}")) return;
      try { const value = JSON.parse(line); if (value.port && value.directory) { clearTimeout(timer); resolveInfo(value); } } catch { /* wait for full line */ }
    });
    fixture.once("error", error => { clearTimeout(timer); rejectInfo(error); });
    fixture.once("exit", code => { clearTimeout(timer); rejectInfo(new Error("SSH fixture exited: " + code)); });
  });
  const sub = relative(tmpdir(), info.directory);
  assert.ok(sub.startsWith("piora-ssh-ui-") && !sub.includes("..") && !isAbsolute(sub), "fixture directory must be under system temp");
  const owner = "ssh-files-test";
  const session = createSSHSession({ host: info.host, port: info.port, username: info.username, auth: { type: "password", password: info.password } }, { ownerSessionId: owner, hostName: "fixture" });
  t.after(async () => {
    closeSSHSession(session.id);
    fixture.kill();
    await Promise.race([once(fixture, "exit").catch(() => undefined), new Promise(resolveDelay => setTimeout(resolveDelay, 2_000))]);
    await rm(info.directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  await session.connect(); changeSSHBinding(session, owner);
  let tool;
  registerSSHTool({ registerTool(value) { tool = value; }, on() {} });
  const invoke = (params, task = owner) => tool.execute("call", { sessionId: session.id, ...params }, new AbortController().signal, () => {}, { sessionManager: { getSessionId: () => task, getCwd: () => info.directory } });
  const listed = await invoke({ action: "list", path: "/home/deploy" });
  assert.ok(listed.details.entries.some(item => item.name === "README.md"));
  assert.match((await invoke({ action: "read", path: "/home/deploy/README.md" })).content[0].text, /SSH workbench/);
  await invoke({ action: "write", path: "/home/deploy/agent-note.txt", text: "remote write from agent" });
  assert.match((await invoke({ action: "read", path: "/home/deploy/agent-note.txt" })).content[0].text, /remote write/);
  await writeFile(join(info.directory, "local-upload.txt"), "local transfer");
  await invoke({ action: "upload", path: "/home/deploy/agent-upload.txt", localPath: "local-upload.txt" });
  assert.match((await invoke({ action: "read", path: "/home/deploy/agent-upload.txt" })).content[0].text, /local transfer/);
  await invoke({ action: "download", path: "/home/deploy/README.md", localPath: "agent-download.md" });
  assert.match(await readFile(join(info.directory, "agent-download.md"), "utf8"), /SSH workbench/);
  await assert.rejects(invoke({ action: "upload", path: "/home/deploy/blocked.txt", localPath: "../outside.txt" }), /workspace/);
  await assert.rejects(invoke({ action: "read", path: "/home/deploy/README.md" }, "other-task"), /not linked/);
});

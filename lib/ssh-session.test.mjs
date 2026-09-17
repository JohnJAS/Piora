import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import ssh2 from "ssh2";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": resolve(import.meta.dirname, "..") } });
const { Server } = ssh2;
const { SSHSession, listSSHSessions, listSSHSessionSummariesForAgent, createSSHSession, closeSSHSession } = await jiti.import("./ssh/session-manager.ts");
const { changeSSHBinding } = await jiti.import("./ssh/binding.ts");
const { default: registerSSHTool } = await jiti.import("../extensions/piora-ssh.ts");
const { testSSHConnection, parseSSHConnection } = await jiti.import("./ssh/connection.ts");
const { POST: createRoute } = await jiti.import("../app/api/ssh/sessions/route.ts");
const { discoverWindowsBash } = await jiti.import("./windows-bash.ts");
const bash = process.platform === "win32" ? discoverWindowsBash() : "/bin/bash";
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs1", format: "pem" }, publicKeyEncoding: { type: "pkcs1", format: "pem" } });

async function fixture(t) {
  assert.ok(bash, "A Bash executable is required for the real SSH shell fixture");
  const directory = await mkdtemp(join(tmpdir(), "piora-ssh-test-"));
  const clients = new Set(), children = new Set();
  let shells = 0, execs = 0;
  const server = new Server({ hostKeys: [privateKey] }, client => {
    clients.add(client);
    client.on("error", () => {});
    client.on("close", () => clients.delete(client));
    client.on("authentication", context => context.method === "password" && context.password === "test-only-password" ? context.accept() : context.reject());
    client.on("ready", () => client.on("session", accept => {
      const session = accept();
      session.on("pty", acceptPty => acceptPty());
      session.on("window-change", acceptWindow => acceptWindow?.());
      session.on("exec", (_accept, reject) => { execs++; reject(); });
      session.on("shell", acceptShell => {
        shells++;
        const stream = acceptShell();
        const child = spawn(bash, ["--noprofile", "--norc"], { cwd: directory, windowsHide: true, env: { ...process.env, BASH_ENV: "" } });
        children.add(child);
        stream.pipe(child.stdin); child.stdout.pipe(stream, { end: false }); child.stderr.pipe(stream.stderr, { end: false });
        child.stdin.on("error", () => {});
        child.on("close", code => { children.delete(child); if (!stream.destroyed) { stream.exit(code ?? 1); stream.end(); } });
        stream.on("close", () => child.kill());
      });
    }));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const options = { host: "127.0.0.1", port: server.address().port, username: "test", auth: { type: "password", password: "test-only-password" } };
  const session = new SSHSession(options);
  t.after(async () => {
    session.close(); for (const client of clients) client.end();
    for (const child of children) child.kill();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  await session.connect();
  return { session, options, directory, clients, counts: () => ({ shells, execs }) };
}

test("SSH agent tool enumerates multiple linked hosts and rejects another task's session ID", { timeout: 30000 }, async t => {
  const { options, directory } = await fixture(t);
  const owner = "tool-owner";
  const first = createSSHSession(options, { ownerSessionId: owner, hostName: "alpha" });
  const second = createSSHSession(options, { ownerSessionId: owner, hostName: "beta" });
  t.after(() => { closeSSHSession(first.id); closeSSHSession(second.id); });
  await Promise.all([first.connect(), second.connect()]);
  changeSSHBinding(first, owner); changeSSHBinding(second, owner);
  let tool, beforeAgentStart;
  registerSSHTool({ registerTool(value) { tool = value; }, on(event, callback) { if (event === "before_agent_start") beforeAgentStart = callback; } });
  const context = id => ({ sessionManager: { getSessionId: () => id, getCwd: () => directory } });
  const invoke = (params, id = owner) => tool.execute("call", params, new AbortController().signal, () => {}, context(id));
  const prompt = beforeAgentStart({ systemPrompt: "base", systemPromptOptions: { selectedTools: ["ssh"] } }, context(owner)).systemPrompt;
  assert.match(prompt, /alpha/);
  assert.match(prompt, /beta/);
  assert.ok(!prompt.includes("test-only-password"));
  const sessions = await invoke({ action: "sessions" });
  assert.match(sessions.content[0].text, /alpha/);
  assert.match(sessions.content[0].text, /beta/);
  assert.equal(sessions.details.sessions.length, 2);
  assert.deepEqual((await invoke({ action: "sessions" }, "different-task")).details.sessions, []);
  await assert.rejects(invoke({ action: "exec", sessionId: first.id, command: "pwd" }, "different-task"), /not linked/);
  assert.throws(() => first.write("printf unsafe-manual\n"), /Unlink/);
  const command = await invoke({ action: "exec", sessionId: second.id, command: "printf beta-host" });
  assert.equal(command.details.hostName, "beta");
  assert.match(command.content[0].text, /beta-host/);
  const blocked = invoke({ action: "exec", sessionId: first.id, command: "sleep 2; printf interrupted" });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(first.snapshot().busy, true);
  assert.throws(() => changeSSHBinding(first), error => error.code === "busy");
  first.stopExecution();
  await assert.rejects(blocked, /closed/);
  assert.equal(first.snapshot().connected, false);
  assert.match((await invoke({ action: "exec", sessionId: second.id, command: "printf still-running" })).content[0].text, /still-running/);
});

test("SSH model execution shares the human shell's cwd and environment and streams output", { timeout: 60000 }, async t => {
  const { session, counts } = await fixture(t);
  session.write("export PIORA_HUMAN_VALUE=human\n");
  const events = []; const chunks = [];
  const unsubscribe = session.subscribe(event => events.push(event)); t.after(unsubscribe);
  const first = await session.exec("mkdir child && cd child && export PIORA_MODEL_VALUE=model && printf '%s' \"$PIORA_HUMAN_VALUE\"", { onData: data => chunks.push(data.toString()) });
  assert.equal(first.exitCode, 0); assert.match(first.output, /human/);
  assert.match(session.snapshot().cwd, /\/child$/);
  const second = await session.exec("printf '%s:%s' \"$PIORA_MODEL_VALUE\" \"$PWD\"; false");
  assert.equal(second.exitCode, 1); assert.match(second.output, /model:.*\/child/);
  assert.ok(events.some(event => event.type === "cwd" && event.cwd.endsWith("/child")));
  assert.match(chunks.join(""), /human/);
  assert.match(session.snapshot().output, /model:/);
  assert.deepEqual(counts(), { shells: 1, execs: 0 });
});

test("SSH tests authenticate without creating a shell or a registered session, and failed connections leave no session", { timeout: 30000 }, async t => {
  const { options, counts } = await fixture(t);
  const before = listSSHSessions().length;
  const request = value => new Request("http://localhost/api/ssh/sessions", { method: "POST", headers: { Host: "localhost", "Content-Type": "application/json" }, body: JSON.stringify(value) });
  const response = await createRoute(request({ ...options, testOnly: true }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { tested: true });
  assert.equal(listSSHSessions().length, before);
  assert.deepEqual(counts(), { shells: 1, execs: 0 });
  const rejected = await createRoute(request({ ...options, auth: { type: "password", password: "incorrect" } }));
  assert.equal(rejected.status, 502);
  assert.equal((await rejected.json()).code, "auth");
  assert.equal(listSSHSessions().length, before);
  assert.deepEqual(counts(), { shells: 1, execs: 0 });
  const badPort = await createRoute(request({ ...options, port: 65536, testOnly: true }));
  assert.equal(badPort.status, 400);
  assert.equal((await badPort.json()).code, "invalid");
});

test("SSH reconnect is single-flight, reports shell exit, preserves output, and never reconnects implicitly for files", { timeout: 30000 }, async t => {
  const { session, counts } = await fixture(t);
  await session.exec("printf retained-output; printf error-output >&2");
  assert.match(session.snapshot().output, /error-output/);
  session.close();
  await assert.rejects(session.sftp(), /disconnected/);
  assert.deepEqual(counts(), { shells: 1, execs: 0 });
  await Promise.all([session.connect(), session.connect(), session.connect()]);
  assert.deepEqual(counts(), { shells: 2, execs: 0 });
  assert.match(session.snapshot().output, /retained-output/);
  const closed = new Promise(resolve => { const stop = session.subscribe(event => { if (event.type === "status" && !event.connected) { stop(); resolve(); } }); });
  session.write("exit\n");
  await closed;
  assert.equal(session.snapshot().connected, false);
  assert.match(session.snapshot().output, /retained-output/);
  session.clearOutput();
  assert.equal(session.snapshot().output, "");
});

test("SSH validation rejects malformed credentials and aborting an authentication probe releases its socket", { timeout: 10000 }, async t => {
  assert.throws(() => parseSSHConnection({ host: "localhost", username: "test", port: 0, auth: { type: "password", password: "" } }), /Port/);
  assert.throws(() => parseSSHConnection({ host: "localhost", username: "test", auth: { type: "privateKey", privateKey: {} } }), /Private key/);
  const clients = new Set();
  const server = new Server({ hostKeys: [privateKey] }, client => { clients.add(client); client.on("error", () => {}); client.on("close", () => clients.delete(client)); client.on("authentication", () => {}); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(async () => { for (const client of clients) client.end(); await new Promise(resolve => server.close(resolve)); });
  const abort = new AbortController();
  const running = testSSHConnection({ host: "127.0.0.1", port: server.address().port, username: "test", auth: { type: "password", password: "test" } }, abort.signal);
  const rejected = assert.rejects(running, /cancelled/);
  abort.abort(); await rejected;
});

test("multiple SSH hosts bind to one task without replacing its local runtime or leaking to another task", { timeout: 120000 }, async t => {
  const { session, options } = await fixture(t);
  const id = "ssh-binding-test-" + session.id;
  const registry = globalThis.__piSessions ??= new Map();
  let destroyed = 0;
  const idle = { getRuntime: () => "idle", destroy: () => { destroyed++; registry.delete(id); } };
  t.after(() => { registry.delete(id); globalThis.__piStartLocks?.delete(id); });
  registry.set(id, idle);
  changeSSHBinding(session, id);
  assert.equal(session.snapshot().agentSessionId, id);
  assert.equal(destroyed, 0);
  const other = createSSHSession(options, { ownerSessionId: id, hostName: "second" });
  t.after(() => closeSSHSession(other.id));
  await other.connect();
  changeSSHBinding(other, id);
  assert.deepEqual(listSSHSessionSummariesForAgent(id).map(item => item.id), [other.id]);
  assert.deepEqual(listSSHSessionSummariesForAgent("another-task"), []);
  assert.throws(() => changeSSHBinding(other, "another-task"), error => error.code === "alreadyBound");
  changeSSHBinding(session);
  assert.equal(session.snapshot().mode, "independent");
  assert.equal(destroyed, 0, "binding does not rebuild the runtime or replace local Bash");
});

test("SSH connection test supports an encrypted private key and rejects the wrong passphrase without opening a shell", { timeout: 15000 }, async t => {
  const passphrase = "fixture-key-passphrase";
  const key = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs1", format: "pem", cipher: "aes-256-cbc", passphrase }, publicKeyEncoding: { type: "spki", format: "pem" } }).privateKey;
  const parsed = ssh2.utils.parseKey(key, passphrase);
  assert.ok(!(parsed instanceof Error));
  const allowed = parsed.getPublicSSH();
  const clients = new Set(); let shells = 0;
  const server = new Server({ hostKeys: [privateKey] }, client => {
    clients.add(client); client.on("error", () => {}); client.on("close", () => clients.delete(client));
    client.on("authentication", context => {
      if (context.method !== "publickey" || !context.key.data.equals(allowed)) return context.reject();
      if (!context.signature || parsed.verify(context.blob, context.signature, context.hashAlgo) === true) context.accept();
      else context.reject();
    });
    client.on("ready", () => client.on("session", (_accept, reject) => { shells++; reject(); }));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(async () => { for (const client of clients) client.end(); await new Promise(resolve => server.close(resolve)); });
  const options = { host: "127.0.0.1", port: server.address().port, username: "test", auth: { type: "privateKey", privateKey: key, passphrase } };
  await testSSHConnection(parseSSHConnection(options));
  await assert.rejects(testSSHConnection({ ...options, auth: { ...options.auth, passphrase: "wrong" } }), /privateKey|private key|decrypt/i);
  assert.equal(shells, 0);
});

test("SSH rejects concurrent commands and cancellation never replays a command", { timeout: 20000 }, async t => {
  const { session, counts } = await fixture(t);
  const controller = new AbortController();
  const running = session.exec("sleep 3; printf should-not-replay", { signal: controller.signal });
  const rejected = assert.rejects(running, /interrupted/);
  await assert.rejects(session.exec("printf concurrent"), /busy/);
  assert.throws(() => session.write("printf manual\n"), /model command/);
  controller.abort(); await rejected;
  await assert.rejects(session.exec("printf another"), /disconnected/);
  await session.connect();
  assert.equal((await session.exec("printf reconnected")).output.includes("reconnected"), true);
  assert.deepEqual(counts(), { shells: 2, execs: 0 });
});

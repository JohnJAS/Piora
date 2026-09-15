import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import ssh2 from "ssh2";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { Server } = ssh2;
const { SSHSession } = await jiti.import("./ssh/session-manager.ts");
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
  const session = new SSHSession({ host: "127.0.0.1", port: server.address().port, username: "test", auth: { type: "password", password: "test-only-password" } });
  t.after(async () => {
    session.close(); for (const client of clients) client.end();
    for (const child of children) child.kill();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  await session.connect();
  return { session, counts: () => ({ shells, execs }) };
}

test("SSH model execution shares the human shell's cwd and environment and streams output", { timeout: 20000 }, async t => {
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

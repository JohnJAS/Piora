// Local-only SSH/SFTP fixture for exercising the real SSH UI without a remote host.
// Run: node scripts/ssh-ui-fixture.mjs. Stop with Ctrl+C.
import { generateKeyPairSync } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readdir, stat, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import ssh2 from "ssh2";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { discoverWindowsBash } = await jiti.import("../lib/windows-bash.ts");
const bash = process.platform === "win32" ? discoverWindowsBash() : "/bin/bash";
if (!bash) throw new Error("Bash is required for the SSH UI fixture");
const directory = await mkdtemp(path.join(tmpdir(), "piora-ssh-ui-"));
for (const dir of ["apps", "backups", "logs"]) await mkdir(path.join(directory, dir));
await writeFile(path.join(directory, "README.md"), "# SSH workbench\nLocal test fixture.\n");
await writeFile(path.join(directory, "deploy.sh"), "echo 'Deployment fixture'\n");
await writeFile(path.join(directory, "docker-compose.yml"), "services:\n  web:\n    image: nginx\n");
await writeFile(path.join(directory, "apps", "very-long-configuration-file-name-for-checking-narrow-layout-中文.yaml"), "fixture: true\n");
const hostKey = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs1", format: "pem" }, publicKeyEncoding: { type: "pkcs1", format: "pem" } }).privateKey;
const clients = new Set(), children = new Set();
const counters = { shells: 0, probes: 0, uploads: 0 };
const server = new ssh2.Server({ hostKeys: [hostKey] }, client => {
  clients.add(client); client.on("error", () => {}); client.on("close", () => clients.delete(client));
  client.on("authentication", context => context.method === "password" && context.username === "deploy" && context.password === "piora-ui-fixture" ? context.accept() : context.reject());
  client.on("ready", () => {
    counters.probes++;
    client.on("session", accept => {
      const session = accept();
      session.on("pty", yes => yes()); session.on("window-change", yes => yes?.());
      session.on("shell", yes => {
        counters.shells++; console.log(JSON.stringify(counters));
        const stream = yes();
        const child = spawn(bash, ["--noprofile", "--norc", "-i"], { cwd: directory, windowsHide: true, env: { ...process.env, BASH_ENV: "", PS1: "\\[\\e[32m\\]deploy@server\\[\\e[0m\\]:\\[\\e[34m\\]\\W\\[\\e[0m\\]$ " } });
        children.add(child);
        stream.on("data", data => { child.stdin.write(data.toString().replaceAll("\r", "\n")); });
        child.stdout.on("data", data => stream.write(data.toString().replaceAll("\n", "\r\n")));
        child.stderr.on("data", data => stream.write(data.toString().replaceAll("\n", "\r\n")));
        child.stdin.on("error", () => {});
        child.on("close", code => { children.delete(child); if (!stream.destroyed) { stream.exit(code || 0); stream.end(); } });
        stream.on("close", () => child.kill());
      });
      session.on("sftp", yes => {
        const sftp = yes(), handles = new Map(); let serial = 0;
        const normalized = value => path.posix.resolve("/home/deploy", value);
        const local = value => {
          const remote = normalized(value);
          if (remote !== "/home/deploy" && !remote.startsWith("/home/deploy/")) throw new Error("Fixture path not found");
          return path.join(directory, remote.slice("/home/deploy".length));
        };
        const attrs = value => ({ mode: value.mode, uid: 1000, gid: 1000, size: value.size, atime: Math.floor(value.atimeMs / 1000), mtime: Math.floor(value.mtimeMs / 1000) });
        const status = (id, code = 0) => sftp.status(id, code);
        const wrap = fn => async (...args) => { try { await fn(...args); } catch (error) { status(args[0], error.code === "EACCES" ? 3 : 2); } };
        const handle = value => { const buffer = Buffer.alloc(4); buffer.writeUInt32BE(++serial); handles.set(serial, value); return buffer; };
        const get = value => handles.get(value.readUInt32BE());
        sftp.on("REALPATH", wrap(async (id, value) => { await stat(local(value)); sftp.name(id, [{ filename: normalized(value), longname: normalized(value), attrs: {} }]); }));
        sftp.on("OPENDIR", wrap(async (id, value) => { const names = await readdir(local(value)); sftp.handle(id, handle({ directory: value, names, read: false })); }));
        sftp.on("READDIR", wrap(async (id, h) => { const state = get(h); if (state.read) return status(id, 1); state.read = true; const list = await Promise.all(state.names.map(async name => ({ filename: name, longname: name, attrs: attrs(await stat(local(path.posix.join(state.directory, name)))) }))); if (list.length) sftp.name(id, list); else status(id, 1); }));
        for (const operation of ["STAT", "LSTAT"]) sftp.on(operation, wrap(async (id, value) => sftp.attrs(id, attrs(await stat(local(value))))));
        sftp.on("OPEN", wrap(async (id, value, flags) => { const writable = !!(flags & 2); const file = await open(local(value), writable ? "w" : "r"); if (writable) counters.uploads++; sftp.handle(id, handle({ file })); }));
        sftp.on("FSTAT", wrap(async (id, h) => sftp.attrs(id, attrs(await get(h).file.stat()))));
        sftp.on("READ", wrap(async (id, h, offset, length) => { const buffer = Buffer.alloc(length); const { bytesRead } = await get(h).file.read(buffer, 0, length, offset); if (bytesRead) sftp.data(id, buffer.subarray(0, bytesRead)); else status(id, 1); }));
        sftp.on("WRITE", wrap(async (id, h, offset, data) => { await get(h).file.write(data, 0, data.length, offset); status(id); }));
        sftp.on("CLOSE", wrap(async (id, h) => { const value = get(h); if (value?.file) await value.file.close(); handles.delete(h.readUInt32BE()); status(id); }));
        sftp.on("close", () => { for (const value of handles.values()) value.file?.close().catch(() => {}); });
      });
    });
  });
});
server.listen(0, "127.0.0.1"); await once(server, "listening");
console.log(JSON.stringify({ host: "127.0.0.1", port: server.address().port, username: "deploy", password: "piora-ui-fixture", directory }));
let closing = false;
async function close() {
  if (closing) return; closing = true;
  for (const client of clients) client.end(); for (const child of children) child.kill();
  await new Promise(resolve => server.close(resolve));
  // directory is the exact path returned by mkdtemp above, never a user path.
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  process.exit(0);
}
process.on("SIGINT", close); process.on("SIGTERM", close);

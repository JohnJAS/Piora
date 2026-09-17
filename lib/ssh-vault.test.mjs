import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createJiti } from "jiti";

const home = await mkdtemp(join(tmpdir(), "piora-ssh-vault-test-"));
process.env.PIORA_HOME = home;
process.env.PI_CODING_AGENT_DIR = join(home, "agent");
delete process.env.PI_DESKTOP_TOKEN;
const jiti = createJiti(import.meta.url, { alias: { "@": resolve(import.meta.dirname, "..") } });
const vault = await jiti.import("./ssh/vault.ts");
const hosts = await jiti.import("./ssh/host-store.ts");

test("web vault encrypts persisted SSH credentials, locks them, and preserves host metadata without secrets", async t => {
  t.after(async () => { vault.lockSSHVault(); await rm(home, { recursive: true, force: true }); });
  assert.deepEqual(await vault.sshVaultStatus(), { mode: "master-password", configured: false, unlocked: false });
  await vault.setSSHMasterPassword("test-master-password-123");
  const item = await hosts.createSSHHost({ name: "Production", host: "example.com", port: 22, username: "deploy", auth: { type: "password", password: "s3cr3t-credential" } });
  assert.equal(item.hasCredential, true);
  assert.equal(item.name, "Production");
  assert.equal(Object.hasOwn(item, "credentialId"), false);
  const metadata = await readFile(join(home, "agent", "piora", "ssh", "hosts.json"), "utf8");
  assert.ok(!metadata.includes("s3cr3t-credential"));
  const options = await hosts.connectionForSSHHost(item.id);
  assert.equal(options.auth.password, "s3cr3t-credential");
  assert.equal((await hosts.listSSHHosts()).length, 1);
  vault.lockSSHVault();
  await assert.rejects(hosts.connectionForSSHHost(item.id), error => error.code === "locked");
  await assert.rejects(vault.unlockSSHVault("wrong-master-password"), error => error.code === "invalid");
  await vault.unlockSSHVault("test-master-password-123");
  assert.equal((await hosts.connectionForSSHHost(item.id)).auth.password, "s3cr3t-credential");
  await assert.rejects(hosts.createSSHHost({ name: "production", host: "another.example.com", username: "deploy", auth: { type: "password", password: "x" } }), /already exists/);
  await hosts.updateSSHHost(item.id, { name: "Production 2" });
  assert.equal((await hosts.connectionForSSHHost(item.id)).auth.password, "s3cr3t-credential");
  await hosts.deleteSSHHost(item.id);
  assert.deepEqual(hosts.listSSHHosts(), []);
});

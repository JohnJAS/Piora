import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const store = await jiti.import("./remote-control-store.ts");
const auth = await jiti.import("./remote-control-auth.ts");

test("remote capability tokens are scoped, revocable, and never persisted in plaintext", { concurrency: false }, async () => {
  const root = mkdtempSync(join(tmpdir(), "piora-remote-auth-"));
  const path = join(root, "tokens.json");
  const previousRoot = process.env.PIORA_REMOTE_CONTROL_ROOT;
  process.env.PIORA_REMOTE_CONTROL_ROOT = root;
  try {
    const created = await store.createRemoteCapabilityToken({
      name: "test device",
      scopes: ["session.state.read"],
      allowedSessionIds: ["session-a"],
    }, path);
    assert.ok(created.token.length > 20);
    assert.equal(readFileSync(path, "utf8").includes(created.token), false);

    const request = new Request("http://localhost/api/remote/v1/sessions/session-a/state", {
      headers: { Authorization: `Bearer ${created.token}` },
    });
    const principal = auth.requireRemotePrincipal(request, "session.state.read", "session-a");
    assert.equal(principal.tokenId, created.record.id);
    assert.throws(() => auth.requireRemotePrincipal(request, "session.abort", "session-a"), (error) => error.code === "REMOTE_SCOPE_DENIED");
    assert.throws(() => auth.requireRemotePrincipal(request, "session.state.read", "session-b"), (error) => error.code === "SESSION_NOT_ALLOWED");

    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(await store.revokeRemoteCapabilityToken(created.record.id, path), true);
    assert.throws(() => auth.requireRemotePrincipal(request, "session.state.read", "session-a"), (error) => error.code === "REMOTE_TOKEN_EXPIRED");
  } finally {
    if (previousRoot === undefined) delete process.env.PIORA_REMOTE_CONTROL_ROOT;
    else process.env.PIORA_REMOTE_CONTROL_ROOT = previousRoot;
    await new Promise((resolve) => setTimeout(resolve, 20));
    rmSync(root, { recursive: true, force: true });
  }
});

test("a creation capability atomically owns its new Session and preserves idempotency", { concurrency: false }, async () => {
  const root = mkdtempSync(join(tmpdir(), "piora-remote-create-"));
  const path = join(root, "tokens.json");
  try {
    const created = await store.createRemoteCapabilityToken({
      name: "session creator",
      scopes: ["session.create", "session.state.read"],
    }, path);

    await store.grantRemoteCapabilitySession(created.record.id, "session-new", "create-001", path);
    await store.grantRemoteCapabilitySession(created.record.id, "session-new", "create-001", path);

    assert.equal(store.findRemoteSessionCreation(created.record.id, "create-001", path), "session-new");
    const authenticated = store.authenticateRemoteCapabilityToken(created.token, path);
    assert.deepEqual(authenticated.allowedSessionIds, ["session-new"]);
    assert.equal(JSON.parse(readFileSync(path, "utf8")).sessionCreations.length, 1);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 20));
    rmSync(root, { recursive: true, force: true });
  }
});

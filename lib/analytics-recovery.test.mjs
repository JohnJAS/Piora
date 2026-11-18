import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createJiti } from "jiti";
import { AnalyticsStore } from "../desktop/src/analytics-store.mts";
const { AnalyticsUploader } = await createJiti(import.meta.url).import(
  "../desktop/src/analytics-uploader.mts",
);
async function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "piora-recovery-test-"));
  const store = new AnalyticsStore(root),
    uploaders = [],
    calls = [];
  const credential = {
    credential_id: randomUUID(),
    secret: "old-device-secret",
    expires_at: new Date(Date.now() - 86400000).toISOString(),
  };
  const vaultFile = join(root, "credentials.dpapi");
  writeFileSync(
    vaultFile,
    JSON.stringify({
      current: credential,
      registration: { installation_id: store.installationId },
    }),
  );
  store.set("registered", true);
  let config = {
    enabled: true,
    backend_url: "https://analytics.test",
    enrollment_key: "new-enrollment",
  };
  let rotationWorks = false;
  let recoveryError,
    loseReply = false,
    failSave = false,
    failConfirm = false;
  const secure = {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (text) => {
      if (
        failSave ||
        (failConfirm &&
          Date.parse(JSON.parse(text).current.expires_at) > Date.now())
      )
        throw Error("disk");
      return Buffer.from(text);
    },
    decryptStringAsync: async (value) => ({
      result: value.toString(),
      shouldReEncrypt: false,
    }),
  };
  const fetcher = async (url, options) => {
    const path = new URL(url).pathname,
      body = options.body && JSON.parse(options.body);
    calls.push({ path, body, headers: options.headers });
    if (path.endsWith("/rotate")) {
      if (rotationWorks)
        return Response.json({
          data: {
            expires_at: new Date(Date.now() + 90 * 86400000).toISOString(),
          },
        });
      return Response.json(
        { error: { code: "CREDENTIAL_EXPIRED" } },
        { status: 401 },
      );
    }
    if (path.endsWith("/recover")) {
      assert.deepEqual(
        JSON.parse(readFileSync(vaultFile)).recovery_pending.body,
        body,
      );
      if (recoveryError)
        return Response.json(
          { error: { code: recoveryError.code } },
          { status: recoveryError.status },
        );
      if (loseReply) {
        loseReply = false;
        throw Error("lost response");
      }
      return Response.json({
        data: {
          installation_id: store.installationId,
          credential_id: body.next_credential.credential_id,
          expires_at: new Date(Date.now() + 90 * 86400000).toISOString(),
        },
      });
    }
    if (path.endsWith("/capabilities"))
      return new Response("", { status: 404 });
    if (path.endsWith("/batches"))
      return Response.json({
        data: {
          accepted_event_ids: body.events.map((e) => e.event_id),
          duplicate_event_ids: [],
          rejected_events: [],
        },
      });
    throw Error("Unexpected route " + path);
  };
  const create = async () => {
    const u = await AnalyticsUploader.create(
      store,
      config,
      secure,
      fetcher,
      undefined,
      () => config,
    );
    uploaders.push(u);
    return u;
  };
  try {
    await run({
      store,
      calls,
      credential,
      create,
      vault: () => JSON.parse(readFileSync(vaultFile)),
      rotationWorks: () => {
        rotationWorks = true;
      },
      config: (value) => {
        config = value;
      },
      lose: () => {
        loseReply = true;
      },
      error: (value) => {
        recoveryError = value;
      },
      failSave: (value) => {
        failSave = value;
      },
      failConfirm: (value) => {
        failConfirm = value;
      },
    });
  } finally {
    uploaders.forEach((u) => u.stop());
    store.close();
    assert.ok(root.startsWith(join(tmpdir(), "piora-recovery-test-")));
    rmSync(root, { recursive: true, force: true });
  }
}
test("expired device recovers using current config and keeps identity, concurrent flush is single-flight", () =>
  fixture(async (f) => {
    const u = await f.create(),
      id = f.store.installationId;
    f.config({
      enabled: true,
      backend_url: "https://analytics.test",
      enrollment_key: "updated-config",
    });
    await Promise.all([u.flush(), u.flush()]);
    const recover = f.calls.filter((c) => c.path.endsWith("/recover"));
    assert.equal(recover.length, 1);
    assert.equal(recover[0].headers.Authorization, "Bearer updated-config");
    assert.deepEqual(recover[0].body.previous_credential, {
      credential_id: f.credential.credential_id,
      secret: f.credential.secret,
    });
    assert.equal(f.store.installationId, id);
    assert.equal(f.vault().recovery_pending, undefined);
    assert.equal(f.store.get("recovery_status"), "recovered");
    assert.equal(f.store.get("upload_paused"), false);
    const batch = f.calls.find((c) => c.path.endsWith("/batches"));
    assert.equal(
      batch.headers.Authorization,
      `Bearer pa1.${f.vault().current.credential_id}.${f.vault().current.secret}`,
    );
  }));
test("lost response survives restart with identical body and authorization despite config change", () =>
  fixture(async (f) => {
    f.lose();
    const u = await f.create();
    await u.flush();
    u.stop();
    const pending = f.vault().recovery_pending;
    f.config({
      enabled: true,
      backend_url: "https://analytics.test",
      enrollment_key: "another-key",
    });
    await (await f.create()).flush();
    const calls = f.calls.filter((c) => c.path.endsWith("/recover"));
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], calls[1]);
    assert.equal(
      f.vault().current.credential_id,
      pending.body.next_credential.credential_id,
    );
  }));
test("failed pending persistence sends no recovery and failed confirmation retries original request", () =>
  fixture(async (f) => {
    const u = await f.create();
    f.failSave(true);
    await u.flush();
    assert.equal(f.calls.length, 0);
    f.failSave(false);
    f.failConfirm(true);
    await u.flush();
    const pending = f.vault().recovery_pending;
    assert.ok(pending);
    f.failConfirm(false);
    await u.flush();
    assert.equal(
      f.vault().current.credential_id,
      pending.body.next_credential.credential_id,
    );
    const calls = f.calls.filter((c) => c.path.endsWith("/recover"));
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], calls[1]);
  }));
for (const error of [
  { status: 403, code: "INSTALLATION_REVOKED" },
  { status: 403, code: "ENROLLMENT_INVALID" },
  { status: 409, code: "CREDENTIAL_RECOVERY_NOT_ALLOWED" },
  { status: 404, code: "NOT_FOUND" },
]) {
  test(`recovery rejection ${error.code} preserves identity and prevents uploads`, () =>
    fixture(async (f) => {
      f.error(error);
      await (await f.create()).flush();
      assert.equal(f.vault().current.credential_id, f.credential.credential_id);
      assert.equal(
        f.calls.some((c) => c.path.endsWith("/batches")),
        false,
      );
      assert.equal(
        f.calls.some((c) => c.path.endsWith("/register")),
        false,
      );
      assert.equal(
        f.store.get("recovery_status"),
        error.status === 404 ? "HTTP_404" : error.code,
      );
    }));
}

test("successful pending rotation takes precedence over recovery", () =>
  fixture(async (f) => {
    f.rotationWorks();
    await (await f.create()).flush();
    assert.equal(
      f.calls.some((c) => c.path.endsWith("/recover")),
      false,
    );
    assert.equal(
      f.calls.some((c) => c.path.endsWith("/batches")),
      true,
    );
  }));
test("missing enrollment leaves original identity and queue intact", () =>
  fixture(async (f) => {
    f.config({ enabled: true, backend_url: "https://analytics.test" });
    await (await f.create()).flush();
    assert.equal(
      f.calls.some((c) => c.path.endsWith("/recover")),
      false,
    );
    assert.equal(f.vault().current.credential_id, f.credential.credential_id);
  }));

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { createJiti } from "jiti";
import { AnalyticsStore } from "../desktop/src/analytics-store.mts";
import {
  parseWindowsIdentity,
  collectWindowsIdentity,
  unknownIdentity,
} from "../desktop/src/analytics-windows-identity.mts";
const { AnalyticsUploader } = await createJiti(import.meta.url).import(
  "../desktop/src/analytics-uploader.mts",
);
const sid = "S-1-5-21-111-222-333-1001";
const sample = {
  name: "CHINA\\001234",
  sid,
  account_sid: sid,
  domain: "CHINA",
  login: "001234",
  local: false,
};
const domain = parseWindowsIdentity(JSON.stringify(sample));
const secure = {
  isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async (s) => Buffer.from(s),
  decryptStringAsync: async (b) => ({
    result: b.toString(),
    shouldReEncrypt: false,
  }),
};
test("token and SID-resolved account preserve domain login and leading zeroes", () => {
  assert.deepEqual(domain, {
    account_type: "domain",
    domain: "CHINA",
    account_name: "001234",
    source: "windows_logon",
    status: "available",
  });
  assert.equal(
    parseWindowsIdentity(
      JSON.stringify({
        ...sample,
        profile: "C:\\Users\\different",
        display_name: "Different Name",
      }),
    ).account_name,
    "001234",
  );
});
test("local, mismatched, missing and malformed observations cannot become domain employees", () => {
  const local = parseWindowsIdentity(
    JSON.stringify({ ...sample, local: true }),
  );
  assert.equal(local.account_type, "local");
  assert.equal(local.domain, null);
  assert.equal(local.account_name, null);
  for (const change of [
    { account_sid: "other" },
    { name: "OTHER\\001234" },
    { local: null },
    { domain: "" },
    { sid: "S-1-5-18", account_sid: "S-1-5-18" },
  ]) {
    assert.equal(
      parseWindowsIdentity(JSON.stringify({ ...sample, ...change }))
        .account_type,
      "unknown",
    );
  }
  assert.equal(parseWindowsIdentity("bad json").status, "read_failed");
});
test("disabled/non-Windows collection never executes a probe; failures stay explicit", async () => {
  const run = async () => {
    throw Error("must not run");
  };
  let calls = 0;
  await collectWindowsIdentity(false, "win32", async () => {
    calls++;
    return "";
  });
  await collectWindowsIdentity(true, "linux", async () => {
    calls++;
    return "";
  });
  assert.equal(calls, 0);
  assert.equal(
    (await collectWindowsIdentity(true, "win32", run)).status,
    "read_failed",
  );
});

async function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "piora-domain-test-"));
  const store = new AnalyticsStore(root);
  const uploaders = [];
  const calls = [];
  let displayNames = false,
    supported = true,
    failIdentity = false,
    loseRegistration = false,
    collected = 0;
  const config = {
    enabled: true,
    backend_url: "https://analytics.test",
    enrollment_key: "fixture",
  };
  const fetcher = async (url, options) => {
    const path = new URL(url).pathname;
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ path, body, headers: options.headers });
    if (path === "/v1/capabilities") {
      assert.equal(options.method, "GET");
      assert.equal(options.headers, undefined);
      return supported
        ? Response.json({
            data: {
              capabilities: [
                "windows-domain-identity-v1",
                ...(displayNames ? ["windows-display-name-v1"] : []),
              ],
            },
          })
        : new Response("", { status: 404 });
    }
    if (path.endsWith("/register")) {
      assert.equal(body.windows_identity, undefined);
      if (loseRegistration) {
        loseRegistration = false;
        throw Error("lost reply");
      }
      return Response.json({
        data: {
          organization_name: "Fixture",
          credential_expires_at: new Date(
            Date.now() + 90 * 86400000,
          ).toISOString(),
        },
      });
    }
    if (path.endsWith("/identity")) {
      assert.deepEqual(Object.keys(body), ["identity"]);
      assert.deepEqual(Object.keys(body.identity).sort(), [
        "account_name",
        "account_type",
        ...(displayNames && body.identity.display_name ? ["display_name"] : []),
        "domain",
        "source",
      ]);
      assert.match(options.headers.Authorization, /^Bearer pa1\./);
      if (failIdentity) return new Response("", { status: 503 });
      return Response.json({
        data: {
          state:
            body.identity.account_type === "domain"
              ? "matched"
              : body.identity.account_type,
        },
      });
    }
    assert.equal(path, "/v1/telemetry/batches");
    return Response.json({
      data: {
        accepted_event_ids: body.events.map((e) => e.event_id),
        duplicate_event_ids: [],
        rejected_events: [],
      },
    });
  };
  const create = async (observation = domain) => {
    const uploader = await AnalyticsUploader.create(
      store,
      config,
      secure,
      fetcher,
      async () => {
        collected++;
        return observation;
      },
    );
    uploaders.push(uploader);
    return uploader;
  };
  try {
    await run({
      store,
      calls,
      create,
      config,
      root,
      enableDisplayNames: () => (displayNames = true),
      setSupported: (v) => (supported = v),
      setFail: (v) => (failIdentity = v),
      loseRegistration: () => (loseRegistration = true),
      collected: () => collected,
    });
  } finally {
    uploaders.forEach((u) => u.stop());
    store.close();
    assert.match(
      relative(resolve(tmpdir()), resolve(root)),
      /^piora-domain-test-[\w-]+$/,
    );
    rmSync(root, { recursive: true, force: true });
  }
}
test("domain FullName follows server capability on first sync", async () => {
  for (const supported of [false, true]) {
    await fixture(async (f) => {
      if (supported) f.enableDisplayNames();
      const observation = parseWindowsIdentity(
        JSON.stringify({ ...sample, display_name: "  合成 Li  " }),
      );
      assert.equal(observation.display_name, "合成 Li");
      const uploader = await f.create(observation);
      await uploader.flush();
      const claim = f.calls.find((c) => c.path.endsWith("/identity")).body
        .identity;
      assert.equal(claim.account_name, "001234");
      assert.equal(claim.display_name, supported ? "合成 Li" : undefined);
    });
  }
});
test("first registration reports identity with installation credentials and keeps uploads working", () =>
  fixture(async (f) => {
    const u = await f.create();
    await u.flush();
    assert.equal(f.store.get("identity_status"), "matched");
    assert.equal(f.store.health().events, 0);
    assert.equal(f.collected(), 1);
    await u.flush();
    assert.equal(f.calls.filter((c) => c.path.endsWith("/identity")).length, 1);
  }));
test("lost registration reply repeats identical registration id and body", () =>
  fixture(async (f) => {
    f.loseRegistration();
    const u = await f.create();
    await u.flush();
    await u.flush();
    const calls = f.calls.filter((c) => c.path.endsWith("/register"));
    assert.deepEqual(calls[0], calls[1]);
    assert.equal(f.store.get("registered"), true);
  }));
test("already registered installation upgrades without enrollment key or identity reset", () =>
  fixture(async (f) => {
    const old = await f.create();
    const installation = f.store.installationId;
    f.store.set("registered", true);
    delete f.config.enrollment_key;
    old.stop();
    const u = await f.create();
    await u.flush();
    assert.equal(f.calls.filter((c) => c.path.endsWith("/register")).length, 0);
    assert.equal(f.store.installationId, installation);
    assert.equal(f.store.get("identity_status"), "matched");
  }));
test("strict old backend receives legacy registration only; identity probe never runs", () =>
  fixture(async (f) => {
    f.setSupported(false);
    const u = await f.create();
    await u.flush();
    assert.equal(f.collected(), 0);
    assert.equal(f.store.get("registered"), true);
    assert.equal(f.store.health().events, 0);
    assert.equal(f.store.get("identity_status"), "unsupported_backend");
    assert.equal(f.calls.filter((c) => c.path.endsWith("/identity")).length, 0);
  }));
test("failed identity update does not block ACK and retries exact persisted payload after restart", () =>
  fixture(async (f) => {
    f.setFail(true);
    const u = await f.create();
    await u.flush();
    u.stop();
    assert.equal(f.store.health().events, 0);
    assert.equal(f.store.get("identity_status"), "retry_pending");
    assert.ok(
      JSON.parse(readFileSync(join(f.root, "credentials.dpapi"), "utf8"))
        .identity_pending,
    );
    f.setFail(false);
    const next = await f.create(unknownIdentity("read_failed"));
    await next.flush();
    const calls = f.calls.filter((c) => c.path.endsWith("/identity"));
    assert.deepEqual(calls[0], calls[1]);
    assert.equal(f.collected(), 1);
    assert.equal(f.store.get("identity_status"), "matched");
  }));
test("unknown/local accounts report empty identity fields and continue uploading", async () => {
  for (const observation of [
    unknownIdentity("read_failed"),
    parseWindowsIdentity(JSON.stringify({ ...sample, local: true })),
  ])
    await fixture(async (f) => {
      const u = await f.create(observation);
      await u.flush();
      assert.equal(f.store.health().events, 0);
      const c = f.calls.find((c) => c.path.endsWith("/identity"));
      assert.equal(c.body.identity.domain, null);
      assert.equal(c.body.identity.account_name, null);
    });
});
test("old backend can upgrade without resetting registration or consuming enrollment again", () =>
  fixture(async (f) => {
    f.setSupported(false);
    const old = await f.create();
    await old.flush();
    old.stop();
    f.setSupported(true);
    delete f.config.enrollment_key;
    const upgraded = await f.create();
    await upgraded.flush();
    assert.equal(f.calls.filter((c) => c.path.endsWith("/register")).length, 1);
    assert.equal(f.store.get("identity_status"), "matched");
  }));
test("disabled analytics never discovers or collects identity", () =>
  fixture(async (f) => {
    f.config.enabled = false;
    const u = await f.create();
    await u.flush();
    assert.equal(f.collected(), 0);
    assert.equal(
      f.calls.filter(
        (c) => c.path === "/v1/capabilities" || c.path.endsWith("/identity"),
      ).length,
      0,
    );
  }));
test("daily refresh re-reads identity so backend policies and account changes can be reconciled", () =>
  fixture(async (f) => {
    const u = await f.create();
    await u.flush();
    f.store.set("identity_synced_at", Date.now() - 86400001);
    await u.flush();
    const calls = f.calls.filter((c) => c.path.endsWith("/identity"));
    assert.equal(f.collected(), 2);
    assert.equal(calls.length, 2);
    assert.notEqual(
      calls[0].headers["Idempotency-Key"],
      calls[1].headers["Idempotency-Key"],
    );
  }));

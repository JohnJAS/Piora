import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";

function listen(server) { return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port))); }
function close(server) { return new Promise((resolve) => server.close(resolve)); }

test("OAuth broker binds the browser callback to one claim and never puts a token in the callback", async () => {
  let oauthChallenge = "";
  const providerServer = createServer(async (request, response) => {
    if (request.url === "/oauth/token" && request.method === "POST") {
      let content = "";
      for await (const chunk of request) content += chunk;
      const params = new URLSearchParams(content);
      assert.equal(params.get("client_secret"), "test-secret");
      assert.equal(createHash("sha256").update(params.get("code_verifier")).digest("base64url"), oauthChallenge);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ access_token: "secret-test-token", refresh_token: "refresh-test-token", expires_in: 3600 }));
      return;
    }
    response.writeHead(404); response.end();
  });
  const providerPort = await listen(providerServer);
  const probe = createServer();
  const brokerPort = await listen(probe); await close(probe);
  const site = `http://127.0.0.1:${providerPort}`;
  const base = `http://127.0.0.1:${brokerPort}`;
  const child = spawn(process.execPath, [fileURLToPath(new URL("./server.mjs", import.meta.url))], {
    env: { ...process.env, PORT: String(brokerPort), PI_GIT_OAUTH_PUBLIC_URL: base,
      PI_GIT_OAUTH_PROVIDERS_JSON: JSON.stringify([{ id: "gitlab", site, clientId: "test-client", clientSecret: "test-secret" }]) },
    stdio: "pipe", windowsHide: true,
  });
  try {
    let live = false;
    for (let i = 0; i < 50; i++) {
      try { live = (await fetch(`${base}/health`)).ok; if (live) break; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(live, true);
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const flowResponse = await fetch(`${base}/v1/flows`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "gitlab", site, challenge }) });
    assert.equal(flowResponse.status, 200);
    const flow = await flowResponse.json();
    const authorizationUrl = new URL(flow.authorizationUrl);
    oauthChallenge = authorizationUrl.searchParams.get("code_challenge");
    assert.notEqual(oauthChallenge, challenge);
    const pending = await fetch(`${base}/v1/flows/${flow.flowId}/claim`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verifier }) });
    assert.equal(pending.status, 202);
    const callback = await fetch(`${base}/v1/callback?state=${flow.flowId}&code=test-code`);
    assert.equal(callback.status, 200);
    assert.doesNotMatch(await callback.text(), /secret-test-token/);
    const claim = await fetch(`${base}/v1/flows/${flow.flowId}/claim`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verifier }) });
    assert.equal(claim.status, 200);
    assert.equal((await claim.json()).token.accessToken, "secret-test-token");
    const replay = await fetch(`${base}/v1/flows/${flow.flowId}/claim`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verifier }) });
    assert.equal(replay.status, 410);
  } finally { child.kill(); await close(providerServer); }
});

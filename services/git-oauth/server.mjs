import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.env.PORT || 34142);
const publicUrl = new URL(process.env.PI_GIT_OAUTH_PUBLIC_URL || `http://127.0.0.1:${port}`);
if (publicUrl.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(publicUrl.hostname)) {
  throw new Error("PI_GIT_OAUTH_PUBLIC_URL must use HTTPS");
}
const configured = JSON.parse(process.env.PI_GIT_OAUTH_PROVIDERS_JSON || "[]");
if (!Array.isArray(configured)) throw new Error("PI_GIT_OAUTH_PROVIDERS_JSON must be an array");
const providers = configured.map((item) => {
  if (!["github", "gitlab", "gitee"].includes(item.id) || !item.clientId || !item.site || !item.clientSecret) {
    throw new Error("Each provider needs id, site, clientId and clientSecret");
  }
  const site = new URL(item.site);
  if (site.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(site.hostname)) {
    throw new Error("Provider sites must use HTTPS");
  }
  return { ...item, site: site.origin };
});
const flows = new Map();
const requestWindows = new Map();
const MAX_BODY = 16 * 1024;
const FLOW_TTL = 10 * 60_000;

function json(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  response.end(JSON.stringify(value));
}

async function body(request) {
  let text = "";
  for await (const part of request) {
    text += part;
    if (Buffer.byteLength(text) > MAX_BODY) throw new Error("Request too large");
  }
  const parsed = JSON.parse(text || "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected JSON object");
  return parsed;
}

function providerFor(id, site) {
  const target = new URL(site);
  return providers.find((item) => item.id === id && item.site === target.origin);
}

function callbackUrl() { return new URL("/v1/callback", publicUrl).toString(); }

function authorizationUrl(provider, flowId, challenge) {
  const pathname = provider.id === "github" ? "/login/oauth/authorize" : "/oauth/authorize";
  const url = new URL(pathname, provider.site);
  url.searchParams.set("client_id", provider.clientId);
  url.searchParams.set("redirect_uri", callbackUrl());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", provider.scope || (provider.id === "github" ? "repo read:org" : provider.id === "gitlab" ? "api read_user write_repository" : "user_info projects"));
  url.searchParams.set("state", flowId);
  if (provider.id !== "gitee") {
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  return url.toString();
}

async function exchange(provider, params) {
  const endpoint = provider.id === "github" ? "/login/oauth/access_token" : "/oauth/token";
  const response = await fetch(new URL(endpoint, provider.site), {
    method: "POST",
    headers: { "Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error(data.error_description || data.error || `Token exchange failed (${response.status})`);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresAt: Number.isFinite(Number(data.expires_in)) ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString() : null,
  };
}

function rateLimit(request) {
  const address = request.socket.remoteAddress || "unknown";
  const now = Date.now();
  const record = requestWindows.get(address);
  const next = !record || now - record.start > 60_000 ? { start: now, count: 1 } : { start: record.start, count: record.count + 1 };
  requestWindows.set(address, next);
  return next.count <= 120;
}

const server = createServer(async (request, response) => {
  try {
    if (!rateLimit(request)) return json(response, 429, { error: "Too many requests" });
    const url = new URL(request.url || "/", publicUrl);
    if (request.method === "GET" && url.pathname === "/health") return json(response, 200, { ok: true });
    if (request.method === "GET" && url.pathname === "/v1/providers") {
      return json(response, 200, { providers: providers.map(({ id, site }) => ({ id, site })) });
    }
    if (request.method === "POST" && url.pathname === "/v1/flows") {
      const input = await body(request);
      const provider = providerFor(input.provider, input.site);
      if (!provider || typeof input.challenge !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(input.challenge)) {
        return json(response, 400, { error: "Invalid provider or challenge" });
      }
      const id = randomUUID();
      const verifier = randomBytes(32).toString("base64url");
      const oauthChallenge = createHash("sha256").update(verifier).digest("base64url");
      flows.set(id, { provider, claimChallenge: input.challenge, verifier, expiresAt: Date.now() + FLOW_TTL, status: "pending" });
      return json(response, 200, { flowId: id, authorizationUrl: authorizationUrl(provider, id, oauthChallenge), expiresIn: 600 });
    }
    if (request.method === "GET" && url.pathname === "/v1/callback") {
      const flow = flows.get(url.searchParams.get("state"));
      if (!flow || flow.expiresAt < Date.now() || flow.status !== "pending") return json(response, 400, { error: "Authorization expired" });
      try {
        if (url.searchParams.get("error")) throw new Error("Authorization declined");
        const code = url.searchParams.get("code");
        if (!code) throw new Error("Authorization code missing");
        flow.token = await exchange(flow.provider, {
          grant_type: "authorization_code", code,
          client_id: flow.provider.clientId, client_secret: flow.provider.clientSecret,
          redirect_uri: callbackUrl(),
          ...(flow.provider.id !== "gitee" ? { code_verifier: flow.verifier || "" } : {}),
        });
        flow.status = "ready";
      } catch (error) { flow.status = "failed"; flow.error = error instanceof Error ? error.message : "Authorization failed"; }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" });
      response.end(`<html><meta charset="utf-8"><body style="font:16px system-ui;padding:32px">${flow.status === "ready" ? "授权完成，请返回 Piora。" : "授权失败，请返回 Piora 重试。"}</body></html>`);
      return;
    }
    const claimMatch = /^\/v1\/flows\/([a-f0-9-]{36})\/claim$/.exec(url.pathname);
    if (request.method === "POST" && claimMatch) {
      const input = await body(request);
      const flow = flows.get(claimMatch[1]);
      if (!flow || flow.expiresAt < Date.now()) { flows.delete(claimMatch[1]); return json(response, 410, { error: "Authorization expired" }); }
      if (typeof input.verifier !== "string" || !/^[A-Za-z0-9_-]{43,128}$/.test(input.verifier)) return json(response, 403, { error: "Invalid verifier" });
      const actual = createHash("sha256").update(input.verifier).digest("base64url");
      if (!timingSafeEqual(Buffer.from(actual), Buffer.from(flow.claimChallenge))) return json(response, 403, { error: "Invalid verifier" });
      if (flow.status === "pending") return json(response, 202, { status: "pending" });
      flows.delete(claimMatch[1]);
      if (flow.status === "failed") return json(response, 400, { error: flow.error });
      return json(response, 200, { status: "ready", token: flow.token, provider: flow.provider.id, site: flow.provider.site });
    }
    if (request.method === "POST" && url.pathname === "/v1/refresh") {
      const input = await body(request);
      const provider = providerFor(input.provider, input.site);
      if (!provider || typeof input.refreshToken !== "string" || input.refreshToken.length > 8192) return json(response, 400, { error: "Invalid refresh request" });
      return json(response, 200, { token: await exchange(provider, {
        grant_type: "refresh_token", refresh_token: input.refreshToken,
        client_id: provider.clientId, client_secret: provider.clientSecret,
      }) });
    }
    json(response, 404, { error: "Not found" });
  } catch (error) { json(response, 400, { error: error instanceof Error ? error.message : "Request failed" }); }
});

const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [id, flow] of flows) if (flow.expiresAt < now) flows.delete(id);
  for (const [address, record] of requestWindows) if (now - record.start > 60_000) requestWindows.delete(address);
}, 60_000);
cleanup.unref();
server.listen(port, "0.0.0.0");

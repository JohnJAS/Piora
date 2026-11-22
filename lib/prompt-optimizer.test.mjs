import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": resolve(import.meta.dirname, "..") } });
const {
  PROMPT_OPTIMIZER_MAX_OUTPUT_LENGTH,
  PROMPT_OPTIMIZER_MAX_SYSTEM_PROMPT_LENGTH,
  PROMPT_OPTIMIZER_SYSTEM_PROMPT,
  parseOptimizedPrompt,
} = await jiti.import("./prompt-optimizer.ts");

test("cleans common optimized prompt response wrappers", () => {
  assert.equal(parseOptimizedPrompt("```text\nBuild the settings page.\n```"), "Build the settings page.");
  assert.equal(parseOptimizedPrompt('{"optimizedPrompt":"Keep the API stable."}'), "Keep the API stable.");
  assert.equal(parseOptimizedPrompt('“保留现有接口并补充测试。”'), "保留现有接口并补充测试。");
});

test("rejects an empty optimized prompt and caps oversized output", () => {
  assert.throws(() => parseOptimizedPrompt("   "), /没有返回优化后的内容/);
  assert.equal(parseOptimizedPrompt("a".repeat(PROMPT_OPTIMIZER_MAX_OUTPUT_LENGTH + 50)).length, PROMPT_OPTIMIZER_MAX_OUTPUT_LENGTH);
});

test("optimizer instructions preserve user intent and prohibit invented requirements", () => {
  assert.match(PROMPT_OPTIMIZER_SYSTEM_PROMPT, /保留用户的意图/);
  assert.match(PROMPT_OPTIMIZER_SYSTEM_PROMPT, /不得编造要求/);
  assert.match(PROMPT_OPTIMIZER_SYSTEM_PROMPT, /只返回优化后的纯文本/);
});

async function startOptimizerProvider(t, optimizedPrompt, toolOutput) {
  const requests = [];
  const server = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      requests.push({ path: request.url, method: request.method, body });
      if (requests.length > 1) {
        response.writeHead(400).end("Unexpected extra model request");
        return;
      }

      const delta = {
        role: "assistant",
        content: "```text\n" + optimizedPrompt + "\n```",
        tool_calls: [{
          index: 0,
          id: "optimizer-write-probe",
          type: "function",
          function: { name: "write", arguments: JSON.stringify({ path: toolOutput, content: "Unexpected tool execution" }) },
        }],
      };
      const events = [
        { id: "optimizer-reply", model: body.model, choices: [{ index: 0, delta, finish_reason: null }] },
        { id: "optimizer-reply", model: body.model, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
      ];
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.end(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n");
    } catch (error) {
      response.destroy(error);
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  return { requests, baseUrl: `http://127.0.0.1:${server.address().port}/v1` };
}

test("POST /api/prompts/optimize validates requests and runs a standalone model completion", { timeout: 90_000 }, async (t) => {
  const tempRoot = await realpath(tmpdir());
  const directory = await mkdtemp(join(tempRoot, "piora-prompt-optimizer-"));
  const workspace = join(directory, "workspace");
  const outsideWorkspace = join(directory, "outside-workspace");
  const agentDir = join(directory, "agent");
  const sessionsDir = join(agentDir, "sessions");
  const env = { PI_CODING_AGENT_DIR: agentDir, PI_CODING_AGENT_SESSION_DIR: sessionsDir, PI_OFFLINE: "1" };
  const previousEnv = Object.keys(env).map((name) => [name, process.env[name]]);
  const previousRoots = globalThis.__piAdditionalAllowedRoots;
  const previousRootsCache = globalThis.__piAllowedRootsCache;
  const previousSessions = globalThis.__piSessions;
  const liveSessions = new Map();
  t.after(async () => {
    try {
      for (const session of liveSessions.values()) {
        session.destroy();
        await session.shutdownForFileMutation();
      }
    } finally {
      for (const [name, value] of previousEnv) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      globalThis.__piAdditionalAllowedRoots = previousRoots;
      globalThis.__piAllowedRootsCache = previousRootsCache;
      globalThis.__piSessions = previousSessions;
      const resolvedDirectory = await realpath(directory);
      assert.equal(resolvedDirectory, directory);
      assert.equal(dirname(resolvedDirectory), tempRoot);
      await rm(directory, { recursive: true, force: true });
    }
  });
  Object.assign(process.env, env);
  globalThis.__piAdditionalAllowedRoots = new Set();
  globalThis.__piAllowedRootsCache = { roots: new Set([workspace]), expiresAt: Infinity };
  globalThis.__piSessions = liveSessions;

  await Promise.all([mkdir(workspace), mkdir(outsideWorkspace), mkdir(agentDir)]);
  const { POST } = await jiti.import("../app/api/prompts/optimize/route.ts");
  const { persistLazySessionManager } = await jiti.import("./session-persistence.ts");
  const session = SessionManager.create(workspace, join(sessionsDir, "fixture"));
  session.appendMessage({ role: "user", content: "Existing conversation content", timestamp: Date.now() });
  const sessionFile = persistLazySessionManager(session);
  assert.ok(sessionFile);
  const sessionEntries = (await readdir(sessionsDir, { recursive: true })).sort();
  const originalHistory = await readFile(sessionFile);

  const toolOutput = join(workspace, "unexpected-tool-write.txt");
  const optimizedPrompt = "检查安装流程，并记录每一步的失败原因。";
  const { requests, baseUrl } = await startOptimizerProvider(t, optimizedPrompt, toolOutput);
  const provider = "optimizer-fixture";
  const modelId = "selected-optimizer";
  await writeFile(join(agentDir, "models.json"), JSON.stringify({
    providers: {
      [provider]: {
        api: "openai-completions",
        baseUrl,
        apiKey: "local-fixture",
        models: [
          { id: "chat-model", name: "Chat model" },
          { id: modelId, name: "Selected optimizer" },
        ],
      },
    },
  }));
  const input = { cwd: workspace, provider, modelId, prompt: "优化安装说明", systemPrompt: "保留原意，只改进提示词。" };
  const post = (body, headers = {}) => POST(new Request("http://localhost/api/prompts/optimize", {
    method: "POST",
    headers: { Host: "localhost", Origin: "http://localhost", "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: t.signal,
  }));

  await t.test("returns optimized text from the selected model without running tools or writing session history", async () => {
    const response = await post(input);
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.deepEqual(body, { optimizedPrompt });
    assert.equal(requests.length, 1, "the tool call must not trigger a follow-up completion");
    const [request] = requests;
    assert.equal(request.method, "POST");
    assert.equal(request.path, "/v1/chat/completions");
    assert.equal(request.body.model, modelId);
    assert.deepEqual(request.body.messages, [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: input.prompt },
    ]);
    assert.deepEqual(request.body.tools ?? [], [], "the optimizer must not advertise any tools");
    await assert.rejects(stat(toolOutput), { code: "ENOENT" });
    assert.equal(liveSessions.size, 0, "the optimizer must not start a live session");
    assert.deepEqual((await readdir(sessionsDir, { recursive: true })).sort(), sessionEntries, "the optimizer must not create session files");
    assert.deepEqual(await readFile(sessionFile), originalHistory, "existing session history must stay byte-for-byte intact");
  });

  await t.test("rejects untrusted origins and workspaces, oversized bodies and long instructions", async () => {
    const beforeRequests = requests.length;
    const cases = [
      { body: input, headers: { Origin: "https://other.invalid" }, status: 403, error: "Untrusted API request" },
      { body: { ...input, cwd: outsideWorkspace }, status: 403, error: "Access denied", code: "access_denied" },
      { body: { ...input, padding: "x".repeat(64 * 1024) }, status: 413, error: "Request body is too large" },
      {
        body: { ...input, systemPrompt: "x".repeat(PROMPT_OPTIMIZER_MAX_SYSTEM_PROMPT_LENGTH + 1) },
        status: 400,
        error: `Prompt optimizer system prompt must not exceed ${PROMPT_OPTIMIZER_MAX_SYSTEM_PROMPT_LENGTH} characters`,
      },
    ];
    for (const { body, headers, status, error, code } of cases) {
      const response = await post(body, headers);
      assert.equal(response.status, status, error);
      assert.deepEqual(await response.json(), code ? { error, code } : { error });
      assert.equal(requests.length, beforeRequests, "rejected requests must not reach the provider");
    }
  });
});

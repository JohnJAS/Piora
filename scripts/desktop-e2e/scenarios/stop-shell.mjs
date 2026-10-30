import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const exec = promisify(execFile);
const provider = 'desktop-stop-fixture';
const model = 'stop-shell';
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
const read = path => readFile(path, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });

function createStopShell(shell) { return {
  id: shell === 'powershell' ? 'stop-shell' : 'stop-bash',
  mode: 'local-model-fixture',
  scope: 'real Electron chat send and Stop; local deterministic model; real SDK shell process',
  coverage: ['UI send and Stop', 'cancellation HTTP receipt', 'OS process liveness before harness cleanup', 'server idle and composer state'],
  limits: ['real model providers', 'packaged builds', 'non-Windows platforms', 'manual bang-command cancellation'],
  async prepare({ paths, directory, registerCleanup, report }) {
    assert.equal(process.platform, 'win32', 'This scenario currently exercises Windows shell cancellation');
    const pidPath = join(directory, 'shell.pid');
    const endPath = join(directory, 'shell.completed');
    const quote = value => `'${value.replaceAll("'", "''")}'`;
    const command = shell === 'powershell' ? `[System.IO.File]::WriteAllText(${quote(pidPath)}, [string]$PID); Write-Output 'SLEEP_STARTED'; Start-Sleep -Seconds 30; [System.IO.File]::WriteAllText(${quote(endPath)}, 'completed'); Write-Output 'SLEEP_COMPLETED'` : `cat /proc/$$/winpid > ${quote(pidPath.replaceAll('\\', '/'))}; echo SLEEP_STARTED; sleep 30; printf completed > ${quote(endPath.replaceAll('\\', '/'))}; echo SLEEP_COMPLETED`;
    const requests = [];
    report.credentials = 'synthetic-local-fixture-only; no user credentials';
    report.fixture = { provider, model, shell, requests, commandDurationSeconds: 30 };
    const server = createServer(async (req, res) => {
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString());
        const tools = (body.tools ?? []).map(tool => tool.function?.name);
        requests.push({ at: Date.now(), path: req.url, tools, roles: (body.messages ?? []).map(message => message.role) });
        assert.ok(requests.length <= 4, 'Unexpected model request loop');
        const finished = body.messages?.some(message => message.role === 'tool');
        if (!finished) assert.ok(tools.includes(shell), `The real session must expose the ${shell} tool`);
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        const emit = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'stop-fixture', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
        emit({ role: 'assistant', ...(finished ? { content: 'Fixture finished.' } : { tool_calls: [{ index: 0, id: 'stop-shell-call', type: 'function', function: { name: shell, arguments: JSON.stringify({ command, timeout: 45 }) } }] }) });
        emit({}, finished ? 'stop' : 'tool_calls');
        res.end('data: [DONE]\n\n');
      } catch (error) {
        requests.push({ error: error.message });
        if (!res.headersSent) res.writeHead(500);
        res.end(JSON.stringify({ error: { message: error.message } }));
      }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    registerCleanup(() => new Promise((resolve, reject) => { server.closeAllConnections(); server.close(error => error ? reject(error) : resolve()); }));
    await writeFile(join(paths.agent, 'models.json'), JSON.stringify({ providers: { [provider]: {
      api: 'openai-completions', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'local-test-only',
      models: [{ id: model, name: 'Stop Shell Fixture', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    } } }));
    const settingsPath = join(paths.agent, 'settings.json');
    const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
    await writeFile(settingsPath, JSON.stringify({ ...settings, defaultProvider: provider, defaultModel: model, enabledModels: [`${provider}/${model}`] }));
  },
  async run({ page, directory, step, waitUntil, screenshot, signal }) {
    const evidence = { requests: [], responses: [], observations: [] };
    let sid;
    page.on('request', request => {
      if (request.method() !== 'POST' || !new URL(request.url()).pathname.startsWith('/api/agent/')) return;
      const body = request.postDataJSON();
      evidence.requests.push({ at: Date.now(), path: new URL(request.url()).pathname, type: body?.type });
      if (['prompt', 'submit_input'].includes(body?.type)) sid = new URL(request.url()).pathname.split('/').at(-1);
    });
    page.on('response', async response => {
      const request = response.request();
      if (request.method() !== 'POST' || !new URL(request.url()).pathname.startsWith('/api/agent/')) return;
      try { evidence.responses.push({ at: Date.now(), type: request.postDataJSON()?.type, status: response.status(), body: await response.json() }); } catch { /* A disconnected response is observable in desktop.log. */ }
    });
    const stop = page.getByRole('button', { name: /^(Stop agent|停止智能体)$/ });
    const send = page.getByRole('button', { name: /^(Send|发送)$/ });
    let pid;
    let trackedPids = [];
    let priorSleepPids = new Set();
    const sleepProcesses = async () => {
      const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Get-CimInstance Win32_Process -Filter \"Name = 'sleep.exe'\" | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress"], { windowsHide: true, timeout: 10000 });
      const rows = JSON.parse(stdout || '[]');
      return Array.isArray(rows) ? rows : [rows];
    };
    try {
      await step('send-sleep-prompt', async () => {
        if (shell === 'bash') priorSleepPids = new Set((await sleepProcesses()).map(row => row.ProcessId));
        const composer = page.locator('textarea').first();
        await composer.fill(`Run the 30-second ${shell} sleep command now.`);
        await send.click();
      });
      await step('confirm-shell-running', async () => {
        const value = await waitUntil(() => read(join(directory, 'shell.pid')), 'real shell PID marker');
        pid = Number(value.trim());
        assert.ok(Number.isInteger(pid) && pid > 0 && alive(pid));
        assert.equal(await read(join(directory, 'shell.completed')), null);
        await stop.waitFor({ state: 'visible' });
        evidence.pid = pid;
        trackedPids = [pid];
        if (shell === 'bash') {
          // MSYS may create sleep through an already-exited fork helper, so its
          // Windows ParentProcessId need not equal the Bash PID. Require exactly
          // one newly created sleep process; fail rather than guess if ambiguous.
          const sleepers = (await sleepProcesses()).filter(child => !priorSleepPids.has(child.ProcessId));
          evidence.sleepProcesses = sleepers;
          assert.equal(sleepers.length, 1, 'Identify exactly one new sleep.exe for this isolated run');
          trackedPids.push(sleepers[0].ProcessId);
        }
        evidence.trackedPids = trackedPids;
        await screenshot('sleep-running.png');
      });
      await step('click-stop-and-observe', async () => {
        assert.ok(alive(pid), 'Process must still be running at click');
        evidence.stopClickedAt = Date.now();
        await stop.click();
        // Keep the desktop and runner alive through the original command deadline.
        // This prevents launcher cleanup from masquerading as successful Stop.
        const deadline = Date.now() + 32000;
        do {
          signal.throwIfAborted();
          const sample = { at: Date.now(), processAlive: trackedPids.some(alive), alivePids: trackedPids.filter(alive), sendVisible: await send.isVisible(), stopVisible: await stop.isVisible() };
          evidence.observations.push(sample);
          if (!evidence.falseIdle && sample.processAlive && sample.sendVisible && sample.at - evidence.stopClickedAt > 3000) {
            evidence.falseIdle = sample;
            if (sid) evidence.falseIdleServer = await page.evaluate(async id => (await fetch(`/api/agent/${encodeURIComponent(id)}`)).json(), sid);
            await screenshot('false-idle.png');
          }
          if (!sample.processAlive) { evidence.processExitedAt = sample.at; break; }
          await delay(100, undefined, { signal });
        } while (Date.now() < deadline);
        evidence.completedMarker = await read(join(directory, 'shell.completed'));
        if (sid) evidence.server = await page.evaluate(async id => (await fetch(`/api/agent/${encodeURIComponent(id)}`)).json(), sid);
        await screenshot('after-stop.png');
        assert.ok(evidence.requests.some(request => ['abort', 'cancel_prompt_submission'].includes(request.type)), 'UI must issue cancellation');
        assert.ok(evidence.processExitedAt, 'Shell must exit before test cleanup');
        assert.ok(evidence.processExitedAt - evidence.stopClickedAt < 3000, 'Shell must exit within 3 seconds of Stop');
        assert.equal(evidence.completedMarker, null, 'Sleep must be interrupted before normal completion');
      });
      await step('confirm-session-idle', async () => {
        assert.ok(sid);
        await waitUntil(async () => {
          const state = await page.evaluate(async id => (await fetch(`/api/agent/${encodeURIComponent(id)}`)).json(), sid);
          evidence.server = state;
          return !state.running || state.state?.runtime === 'idle';
        }, 'server to become idle');
        await waitUntil(() => send.isVisible(), 'composer send button');
      });
    } finally {
      await writeFile(join(directory, 'stop-evidence.json'), JSON.stringify(evidence, null, 2));
    }
  },
}; }

export const stopShell = createStopShell('powershell');
export const stopBash = createStopShell('bash');

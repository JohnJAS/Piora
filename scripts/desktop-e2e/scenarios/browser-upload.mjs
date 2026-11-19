import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const form = `<!doctype html><title>Upload fixture</title>
<form method="post" enctype="multipart/form-data">
  <input id="primary" name="primary" type="file" hidden>
  <button id="extras" type="button">Choose extra files</button>
  <button id="submit">Submit files</button>
</form>
<script>
  document.querySelector('#extras').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.name = 'extras';
    input.multiple = true;
    input.hidden = true;
    document.querySelector('form').append(input);
    input.click();
  });
</script>`;
const receivedTitle = 'Fixture files received';
let fixture;

export const browserUpload = {
  id: 'browser-upload',
  mode: 'local-model-fixture',
  scope: 'Real Electron chat and browser tool, using a deterministic local model and a loopback upload form.',
  coverage: ['built-in Electron and background Chromium', 'hidden input and dynamic file picker button', 'multiple files, Unicode and space in paths', 'destination mismatch rejection', 'multipart file names and contents received by server'],
  limits: ['real model providers', 'external websites', 'packaged releases', 'settings UI for browser mode'],
  async prepare({ paths, directory, registerCleanup, report }) {
    const samples = [
      { field: 'primary', name: '主 文件.txt', bytes: Buffer.from('本地上传验证\n') },
      { field: 'extras', name: 'extra bytes.bin', bytes: Buffer.from([0, 1, 128, 255]) },
      { field: 'extras', name: 'extra.txt', bytes: Buffer.from('another file') },
    ];
    const files = samples.map(sample => join(directory, sample.name));
    await Promise.all(samples.map((sample, index) => writeFile(files[index], sample.bytes)));
    const uploads = [], actions = [], errors = [];
    const server = createServer(async (req, res) => {
      try {
        if (req.method === 'GET' && req.url.startsWith('/upload/')) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(form);
          return;
        }
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const bytes = Buffer.concat(chunks);
        if (req.method === 'POST' && req.url.startsWith('/upload/')) {
          const payload = await new Response(bytes, { headers: { 'Content-Type': req.headers['content-type'] } }).formData();
          const received = [];
          for (const [field, file] of payload) {
            assert.ok(file instanceof File);
            received.push({ field, name: file.name, bytes: Buffer.from(await file.arrayBuffer()).toString('hex') });
          }
          uploads.push({ path: req.url, received });
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<title>${receivedTitle}</title><h1>${receivedTitle}</h1>`);
          return;
        }
        if (!req.url.startsWith('/v1/')) { res.writeHead(404).end(); return; }
        const body = JSON.parse(bytes.toString());
        const turn = body.messages.slice(body.messages.findLastIndex(message => message.role === 'user'));
        const mode = /\/upload\/(builtin|background)/.exec(JSON.stringify(turn[0]?.content))?.[1];
        const active = mode && body.tools?.some(tool => tool.function?.name === 'browser');
        const tools = turn.filter(message => message.role === 'tool');
        let action;
        if (active) {
          const url = `${fixture.origin}/upload/${mode}`;
          const moreRef = /\[(e\d+)\] button — Choose extra files/.exec(JSON.stringify(tools[1]?.content))?.[1];
          const latest = JSON.stringify(tools.at(-1)?.content);
          if (tools.length === 3) assert.match(latest, /upload page changed/i);
          if (tools.length === 4) assert.match(latest, /Selected 1 file for upload/);
          if (tools.length === 5) assert.match(latest, /Selected 2 files for upload/);
          if (tools.length === 4) assert.ok(moreRef, 'Snapshot exposes the upload button ref');
          action = [
            { action: 'open', url },
            { action: 'snapshot' },
            { action: 'upload', url: `${url}?different-page`, selector: '#primary', files: files.slice(0, 1) },
            { action: 'upload', url, selector: '#primary', files: files.slice(0, 1) },
            { action: 'upload', url, ref: moreRef, files: files.slice(1) },
            { action: 'click', selector: '#submit' },
          ][tools.length];
          if (tools.length >= 6 && !latest.includes(receivedTitle)) {
            assert.ok(tools.length < 10, 'Upload receipt is visible after submitting the form');
            action = { action: 'snapshot' };
          }
          actions.push({ mode, action: action?.action ?? 'complete' });
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        const emit = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({
          id: 'upload-fixture', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000),
          model: 'browser-upload', choices: [{ index: 0, delta, finish_reason }],
        })}\n\n`);
        emit({ role: 'assistant', ...(action ? { tool_calls: [{ index: 0, id: `upload-${mode}-${tools.length}`,
          type: 'function', function: { name: 'browser', arguments: JSON.stringify(action) } }] }
          : { content: active ? `UPLOAD_VERIFIED_${mode}` : 'Browser upload fixture' }) });
        emit({}, action ? 'tool_calls' : 'stop');
        res.end('data: [DONE]\n\n');
      } catch (error) {
        errors.push(error.message);
        if (!res.headersSent) res.writeHead(500);
        res.end(JSON.stringify({ error: { message: error.message } }));
      }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    registerCleanup(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const sessionId = randomUUID();
    const timestamp = new Date().toISOString();
    const sessions = join(paths.agent, 'sessions', '--browser-upload-fixture--');
    const cwd = join(directory, 'workspace');
    await Promise.all([mkdir(sessions, { recursive: true }), mkdir(cwd)]);
    await writeFile(join(sessions, `${sessionId}.jsonl`), [
      { type: 'session', version: 3, id: sessionId, timestamp, cwd },
      { type: 'model_change', id: '10000001', parentId: null, provider: 'desktop-upload-fixture', modelId: 'browser-upload', timestamp },
      { type: 'message', id: '10000002', parentId: '10000001', timestamp, message: { role: 'user', content: '本地上传验收会话', timestamp: Date.parse(timestamp) } },
      { type: 'session_info', id: '10000003', parentId: '10000002', name: 'Browser upload fixture', timestamp },
    ].map(row => JSON.stringify(row)).join('\n') + '\n');
    fixture = { origin: `http://127.0.0.1:${server.address().port}`, sessionId, paths, files, uploads, actions, errors,
      expected: samples.map(({ field, name, bytes }) => ({ field, name, bytes: bytes.toString('hex') })) };
    report.fixture = { origin: fixture.origin, sessionId, uploads, actions, errors, toolApproval: 'disabled in the isolated test profile' };
    fixture.evidence = report.fixture;
    await writeFile(join(paths.agent, 'models.json'), JSON.stringify({ providers: { 'desktop-upload-fixture': {
      api: 'openai-completions', baseUrl: fixture.origin + '/v1', apiKey: 'local-test-only',
      models: [{ id: 'browser-upload', name: 'Browser Upload Fixture', reasoning: false, input: ['text'],
        contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    } } }));
    const settings = JSON.parse(await readFile(join(paths.agent, 'settings.json'), 'utf8'));
    await writeFile(join(paths.agent, 'settings.json'), JSON.stringify({ ...settings, enabledModels: ['desktop-upload-fixture/browser-upload'] }));
    await mkdir(join(paths.agent, 'piora'), { recursive: true });
    await writeFile(join(paths.agent, 'piora', 'tool-approval.json'), JSON.stringify({ enabled: false, revision: 1 }));
  },
  async run({ page, getBrowser, step, waitUntil }) {
    await step('prepare-chat-and-event-stream', async () => {
      // Dev compilation and initial extension loading may exceed the chat's
      // event connection deadline. Prepare the existing fixture chat before sending.
      fixture.evidence.eventStreamPreparationMs = await page.evaluate(async id => {
        const started = performance.now();
        const signal = AbortSignal.timeout(240_000);
        const history = await fetch(`/api/sessions/${id}?deferThinking=1&deferMedia=1`, { signal });
        if (!history.ok) throw new Error(`Fixture history request failed: ${history.status}`);
        await history.json();
        const events = await fetch(`/api/agent/${id}/events?transport=delta`, { signal });
        if (!events.ok || !events.body) throw new Error(`Fixture event stream request failed: ${events.status}`);
        const reader = events.body.getReader();
        try {
          const decoder = new TextDecoder();
          let received = '';
          while (!received.includes('\n\n')) {
            const chunk = await reader.read();
            if (chunk.done) throw new Error('Fixture event stream closed before the handshake');
            received += decoder.decode(chunk.value, { stream: true });
          }
          const firstEvent = received.split('\n').find(line => line.startsWith('data: '));
          const handshake = JSON.parse(firstEvent?.slice(6) ?? 'null');
          if (handshake?.type !== 'connected' || handshake.sessionId !== id) {
            throw new Error('Fixture event stream did not connect to the prepared chat');
          }
        } finally {
          await reader.cancel();
        }
        return Math.round(performance.now() - started);
      }, fixture.sessionId);
      await page.locator(`[data-session-drag-id="${fixture.sessionId}"]`).click();
      await page.getByText('本地上传验收会话', { exact: true }).waitFor();
    });
    const send = page.getByRole('button', { name: /^(Send|发送)$/ });
    const stop = page.getByRole('button', { name: /^(Stop agent|停止智能体)$/ });
    for (const mode of ['builtin', 'background']) {
      await step(`upload-through-${mode}-browser`, async () => {
        await writeFile(join(fixture.paths.agent, 'piora', 'browser.json'), JSON.stringify({ mode }));
        const url = `${fixture.origin}/upload/${mode}`;
        await page.locator('textarea').first().fill(`请在 ${url} 上传这三份本地文件并确认网站收到。\n${fixture.files.join('\n')}`);
        await send.click();
        await waitUntil(async () => {
          assert.deepEqual(fixture.errors, []);
          return await page.getByText(`UPLOAD_VERIFIED_${mode}`, { exact: true }).isVisible();
        }, `confirmed upload through ${mode}`);
        await waitUntil(async () => await send.isVisible() && !await stop.isVisible(), 'session idle');
        const path = `/upload/${mode}`;
        assert.deepEqual(fixture.uploads.filter(upload => upload.path === path), [{ path, received: fixture.expected }]);
        const electronTab = getBrowser().contexts().flatMap(context => context.pages()).some(tab => tab.url() === fixture.origin + path);
        assert.equal(electronTab, mode === 'builtin', `Expected guest WebContents only in built-in mode`);
      });
    }
  },
};

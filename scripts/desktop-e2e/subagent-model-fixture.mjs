import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export async function prepareSubagentModel({ paths, registerCleanup, report }) {
  const workspace = await mkdtemp(join(tmpdir(), 'piora-subagent-workspace-'));
  const fixture = { workspace, requests: [], holds: [], failures: [], files: { A: join(workspace, 'child-a.txt'), B: join(workspace, 'child-b.txt') } };
  await writeFile(fixture.files.A, 'ALPHA_ISOLATED_RESULT'); await writeFile(fixture.files.B, 'BETA_ISOLATED_RESULT');
  function respond(res, calls, content) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const emit = (delta, finish_reason = null, usage) => res.write(`data: ${JSON.stringify({ id: 'subagent-fixture', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'subagent', choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}) })}\n\n`);
    emit({ role: 'assistant', ...(calls?.length ? { tool_calls: calls.map((call, index) => ({ index, id: `sa-${fixture.requests.length}-${index}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } })) } : { content }) });
    emit({}, calls?.length ? 'tool_calls' : 'stop', { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 }); res.end('data: [DONE]\n\n');
  }
  const text = message => typeof message?.content === 'string' ? message.content : (message?.content ?? []).map(block => block.text ?? '').join('\n');
  const server = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks)), messages = body.messages ?? [];
      const user = [...messages].reverse().find(message => message.role === 'user'), task = text(user);
      const tools = (body.tools ?? []).map(tool => tool.function?.name);
      const isChild = /CHILD_(A|B|HOLD|FOLLOWUP|BACKGROUND|FAIL)/.test(task);
      const last = messages.at(-1), toolReply = last?.role === 'tool';
      const observation = { task, isChild, tools, at: Date.now(), model: body.model, parentSecretLeaked: isChild && JSON.stringify(messages).includes('PARENT_PRIVATE_CONTEXT') };
      fixture.requests.push(observation);
      if (isChild) {
        if (tools.some(name => ['Agent', 'SendMessage', 'TaskOutput', 'TaskStop'].includes(name))) throw new Error('Nested subagent tools leaked');
        if (observation.parentSecretLeaked) throw new Error('Parent conversation leaked to child');
        if (/CHILD_FAIL/.test(task)) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Intentional subagent provider failure' } })); return;
        }
        if (/CHILD_HOLD/.test(task)) {
          const hold = { at: Date.now(), closed: false }; fixture.holds.push(hold);
          const timer = setTimeout(() => { fixture.failures.push('Held child request outlived cancellation'); res.writeHead(504); res.end(); }, 60_000);
          res.once('close', () => { hold.closed = true; hold.closedAt = Date.now(); clearTimeout(timer); }); return;
        }
        if (/CHILD_FOLLOWUP/.test(task)) return respond(res, null, 'FOLLOWUP_CONTEXT_RETAINED');
        if (/CHILD_BACKGROUND/.test(task)) {
          const timer = setTimeout(() => respond(res, null, 'BACKGROUND_TASK_FINISHED'), 1500);
          res.once('close', () => clearTimeout(timer)); return;
        }
        const key = /CHILD_A/.test(task) ? 'A' : 'B';
        if (!toolReply) return respond(res, [{ name: 'read', args: { path: fixture.files[key] } }]);
        return respond(res, null, key === 'A' ? 'ALPHA_ISOLATED_RESULT' : 'BETA_ISOLATED_RESULT');
      }
      // Non-task requests (title generation, suggestions) stay harmless.
      if (!/SUBAGENT_E2E_/.test(task)) return respond(res, null, 'Subagent fixture');
      const afterAgent = messages.slice(messages.indexOf(user) + 1).some(message => message.role === 'tool');
      if (/SUBAGENT_E2E_OFF/.test(task)) return respond(res, null, tools.includes('Agent') ? 'OFF_TOOLS_LEAKED' : 'SUBAGENTS_OFF_OK');
      if (/SUBAGENT_E2E_PARALLEL/.test(task)) {
        if (!afterAgent) return respond(res, ['A', 'B'].map(key => ({ name: 'Agent', args: { description: `Explore ${key}`, prompt: `CHILD_${key}: Read the assigned fixture and return its evidence.`, subagent_type: 'Explore' } })));
        return respond(res, null, 'PARALLEL_TASKS_SUMMARIZED');
      }
      if (/SUBAGENT_E2E_BACKGROUND/.test(task)) {
        if (!afterAgent) return respond(res, [{ name: 'Agent', args: { description: 'Background fixture', prompt: 'CHILD_BACKGROUND: Return when ready.', run_in_background: true } }]);
        return respond(res, null, 'BACKGROUND_MAIN_CONTINUES');
      }
      if (/SUBAGENT_E2E_FOLLOWUP/.test(task)) {
        if (!afterAgent) return respond(res, [{ name: 'SendMessage', args: { to: task.split(' ').at(-1), message: 'CHILD_FOLLOWUP: Continue the earlier exploration.' } }]);
        return respond(res, null, 'FOLLOWUP_SUMMARIZED');
      }
      if (/SUBAGENT_E2E_ERROR/.test(task)) {
        if (!afterAgent) return respond(res, [{ name: 'Agent', args: { description: 'Failing subagent', prompt: 'CHILD_FAIL: Return the actual provider failure.', subagent_type: 'Explore' } }]);
        return respond(res, null, 'CHILD_FAILURE_REPORTED');
      }
      if (/SUBAGENT_E2E_(STOP|DISABLE|RESTART|TIMEOUT|ESCAPE)/.test(task)) {
        if (!afterAgent) return respond(res, (/SUBAGENT_E2E_STOP/.test(task) ? ['A', 'B'] : ['A']).map(key => ({ name: 'Agent', args: { description: `Held subagent ${key}`, prompt: 'CHILD_HOLD: Wait for cancellation.', subagent_type: 'Explore' } })));
        return respond(res, null, 'HELD_TASK_SETTLED');
      }
      throw new Error('Unhandled subagent fixture task');
    } catch (error) { fixture.failures.push(error.message); if (!res.headersSent) res.writeHead(500); res.end(JSON.stringify({ error: { message: error.message } })); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  registerCleanup(() => new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }));
  const provider = 'desktop-subagent-fixture';
  await writeFile(join(paths.agent, 'models.json'), JSON.stringify({ providers: { [provider]: { api: 'openai-completions', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'local-test-only',
    models: [{ id: 'subagent', name: 'Subagent Fixture', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
  const settingsPath = join(paths.agent, 'settings.json'), settings = JSON.parse(await readFile(settingsPath, 'utf8'));
  await writeFile(settingsPath, JSON.stringify({ ...settings, enabledModels: [`${provider}/subagent`] }));
  report.fixture = { ...fixture, provider, credentials: 'synthetic-local-only' };
  return fixture;
}

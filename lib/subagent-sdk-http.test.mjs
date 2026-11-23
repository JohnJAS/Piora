import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { createJiti } from 'jiti';
import { prepareSubagentModel } from '../scripts/desktop-e2e/subagent-model-fixture.mjs';
import { waitUntil } from '../scripts/desktop-e2e/lifecycle.mjs';

function isolateLoopbackModel(t) {
  const proxyKeys = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'];
  const keys = [...proxyKeys, 'NO_PROXY', 'no_proxy', 'PI_OFFLINE'];
  const previous = new Map(keys.map(key => [key, process.env[key]]));
  for (const key of proxyKeys) delete process.env[key];
  process.env.NO_PROXY = '*';
  process.env.no_proxy = '*';
  process.env.PI_OFFLINE = '1';
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
}

test('actual SDK sessions delegate through HTTP, continue, notify, cancel parallel work and retain provider failures', { timeout: 360_000 }, async t => {
  isolateLoopbackModel(t);
  const directory = await mkdtemp(join(tmpdir(), 'piora-subagent-http-test-'));
  const paths = { agent: join(directory, 'agent'), profile: join(directory, 'profile') };
  const keys = ['PI_CODING_AGENT_DIR', 'PIORA_DESKTOP_USER_DATA'];
  const previous = new Map(keys.map(key => [key, process.env[key]]));
  process.env.PI_CODING_AGENT_DIR = paths.agent; process.env.PIORA_DESKTOP_USER_DATA = paths.profile;
  const cleanup = []; let session;
  t.after(async () => {
    await session?.shutdownForFileMutation();
    for (const close of cleanup.reverse()) await close();
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    assert.equal(dirname(directory), tmpdir()); await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
  await mkdir(paths.agent); await mkdir(paths.profile);
  // The first request can load the provider adapter from disk before reaching
  // the loopback server. Cancellation and provider failure are asserted below.
  await writeFile(join(paths.agent, 'settings.json'), JSON.stringify({ packages: [], extensions: [], skills: [], retry: { enabled: false }, httpIdleTimeoutMs: 90_000 }));
  const fixture = await prepareSubagentModel({ paths, directory, report: {}, registerCleanup: close => cleanup.push(close) });
  t.diagnostic('Loading the real host and first-party extensions');
  const jiti = createJiti(import.meta.url, { alias: { '@': resolve(import.meta.dirname, '..') } });
  const { startRpcSession, getUnpersistedSessionInfos, getRunningRpcSessionStatuses } = await jiti.import('./rpc-manager.ts');
  const { getSubagentRuntime } = await jiti.import('./subagent-runtime.ts');
  const { DEFAULT_SUBAGENT_SETTINGS, writeSubagentSettings } = await jiti.import('./subagent-settings.ts');
  const { PUT } = await jiti.import('../app/api/settings/subagents/route.ts');
  const { getSessionMessageRouter } = await jiti.import('./session-message-router.ts');
  ({ session } = await startRpcSession('new', '', fixture.workspace, { initialModel: { provider: 'desktop-subagent-fixture', modelId: 'subagent' } }));
  await session.waitUntilReady();
  t.diagnostic('Host ready; exercising HTTP delegation');
  const runtime = getSubagentRuntime(session.sessionId);
  const prompt = async message => {
    let detach;
    const done = new Promise((resolve, reject) => { detach = session.onEvent(event => {
      if (event.type === 'prompt_error') reject(new Error(event.errorMessage));
      if (event.type === 'prompt_done') resolve();
    }); });
    done.catch(() => {});
    try {
      await session.send({ type: 'prompt', message });
      await done;
    } catch (error) {
      t.diagnostic(`Failed fixture prompt: ${message}`);
      t.diagnostic(`Recent fixture requests: ${JSON.stringify(fixture.requests.slice(-8).map(({ task, isChild }) => ({ task, isChild })))}`);
      t.diagnostic(`Fixture failures: ${JSON.stringify(fixture.failures)}`);
      throw error;
    } finally { detach(); }
  };
  await prompt('SUBAGENT_E2E_OFF: PARENT_PRIVATE_CONTEXT');
  assert.ok(!fixture.requests[0].tools.includes('Agent'));
  writeSubagentSettings({ ...DEFAULT_SUBAGENT_SETTINGS, enabled: true });
  fixture.explorationToolRounds = 22;
  await prompt('SUBAGENT_E2E_PARALLEL: PARENT_PRIVATE_CONTEXT');
  const records = runtime.list();
  assert.equal(records.length, 2);
  assert.ok(records.every(record => record.status === 'completed' && record.totalToolUseCount === 22 && record.totalTokens > 200_000));
  assert.deepEqual(records.map(record => record.result).sort(), ['ALPHA_ISOLATED_RESULT', 'BETA_ISOLATED_RESULT']);
  assert.ok(fixture.requests.filter(request => request.isChild).every(request => !request.parentSecretLeaked && !request.tools.some(name => ['write', 'Agent', 'powershell', 'bash'].includes(name))));
  await prompt(`SUBAGENT_E2E_FOLLOWUP ${records[0].agentId}`);
  assert.equal(runtime.get(records[0].agentId).result, 'FOLLOWUP_CONTEXT_RETAINED');
  const uniqueToken = `RAND_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await prompt(`SUBAGENT_E2E_TOKEN_SEED ${uniqueToken}`);
  const seeded = runtime.list().find(record => record.description === 'Token holder');
  assert.ok(seeded && seeded.status === 'completed');
  await prompt(`SUBAGENT_E2E_TOKEN_ECHO ${seeded.agentId}`);
  assert.equal(runtime.get(seeded.agentId).result, `RECALLED:${uniqueToken}`, 'SendMessage must actually read back the prior child turn token');
  await prompt(`SUBAGENT_E2E_TOKEN_ECHO ${records[1].agentId}`);
  assert.equal(runtime.get(records[1].agentId).result, 'MISSING_CONTEXT_TOKEN', 'A sibling child context must not see another child token');
  fixture.backgroundDelayMs = 5000;
  await prompt('SUBAGENT_E2E_BACKGROUND');
  await waitUntil(() => fixture.requests.some(request => request.task.includes('CHILD_BACKGROUND')), { timeoutMs: 3000 });
  assert.equal(runtime.running, true); assert.equal(session.isRunning(), true);
  const childIds = new Set(runtime.list().map(record => record.childSessionId));
  assert.ok(!getUnpersistedSessionInfos().some(info => childIds.has(info.id)), 'child sessions must stay out of ordinary chat listings');
  assert.ok(!getRunningRpcSessionStatuses(true).some(info => childIds.has(info.id)), 'child sessions must stay out of global task listings');
  assert.ok(getRunningRpcSessionStatuses().some(info => info.id === session.sessionId), 'parent aggregates its background work');
  assert.equal((await session.send({ type: 'get_state' })).runtime, 'idle');
  const independent = await getSessionMessageRouter().dispatchSessionMessage({ targetSessionId: session.sessionId, content: 'SUBAGENT_E2E_INDEPENDENT', source: 'ui', idempotencyKey: 'background-independent-input' });
  assert.equal(independent.accepted, true);
  await waitUntil(() => fixture.requests.some(request => request.task === 'SUBAGENT_E2E_INDEPENDENT'), { timeoutMs: 3000 });
  assert.equal(runtime.running, true, 'new parent input must reach the model before the background child completes');
  await waitUntil(() => runtime.list().some(record => record.background && record.status === 'completed'), { timeoutMs: 10_000 });
  await waitUntil(() => session.getRuntime() === 'idle', { timeoutMs: 10_000 });
  assert.ok(session.inner.sessionManager.getEntries().some(entry => entry.type === 'custom_message' && entry.customType === 'piora-subagent-completion' && entry.content.includes('BACKGROUND_TASK_FINISHED')));
  await prompt('SUBAGENT_E2E_ERROR');
  const failed = runtime.list().find(record => record.description === 'Failing subagent');
  assert.equal(failed.status, 'failed'); assert.match(failed.error, /Intentional subagent provider failure/);
  const before = fixture.holds.length, pending = prompt('SUBAGENT_E2E_STOP');
  await waitUntil(() => fixture.holds.length === before + 2, { timeoutMs: 10_000 });
  await session.send({ type: 'abort' }); await pending;
  await waitUntil(() => fixture.holds.slice(before).every(hold => hold.closed), { timeoutMs: 10_000 });
  assert.equal(runtime.list().filter(record => record.description.startsWith('Held subagent') && record.status === 'cancelled').length, 2);
  const heldBeforeDisable = fixture.holds.length, disabling = prompt('SUBAGENT_E2E_DISABLE');
  await waitUntil(() => fixture.holds.length > heldBeforeDisable, { timeoutMs: 10_000 });
  const disabled = await PUT(new Request('http://localhost/api/settings/subagents', { method: 'PUT', body: JSON.stringify({ ...DEFAULT_SUBAGENT_SETTINGS, enabled: false }) }));
  assert.equal(disabled.status, 200); await disabling;
  await waitUntil(() => fixture.holds.at(-1).closed, { timeoutMs: 10_000 });
  assert.equal(runtime.running, false); assert.deepEqual(fixture.failures, []);
});

test('N1: continuing a saved child after profile rename + display-name reuse keeps original profileId, role prompt and tools', { timeout: 240_000 }, async t => {
  isolateLoopbackModel(t);
  const directory = await mkdtemp(join(tmpdir(), 'piora-subagent-n1-test-'));
  const paths = { agent: join(directory, 'agent'), profile: join(directory, 'profile') };
  const keys = ['PI_CODING_AGENT_DIR', 'PIORA_DESKTOP_USER_DATA'];
  const previous = new Map(keys.map(key => [key, process.env[key]]));
  process.env.PI_CODING_AGENT_DIR = paths.agent; process.env.PIORA_DESKTOP_USER_DATA = paths.profile;
  const cleanup = []; let session;
  t.after(async () => {
    await session?.shutdownForFileMutation();
    for (const close of cleanup.reverse()) await close();
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    assert.equal(dirname(directory), tmpdir()); await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
  await mkdir(paths.agent); await mkdir(paths.profile);
  await writeFile(join(paths.agent, 'settings.json'), JSON.stringify({ packages: [], extensions: [], skills: [], retry: { enabled: false }, httpIdleTimeoutMs: 20_000 }));
  const fixture = await prepareSubagentModel({ paths, directory, report: {}, registerCleanup: close => cleanup.push(close) });
  const jiti = createJiti(import.meta.url, { alias: { '@': resolve(import.meta.dirname, '..') } });
  const { startRpcSession } = await jiti.import('./rpc-manager.ts');
  const { getSubagentRuntime } = await jiti.import('./subagent-runtime.ts');
  const { DEFAULT_SUBAGENT_SETTINGS, writeSubagentSettings } = await jiti.import('./subagent-settings.ts');
  const { saveCustomSubagentProfile, deleteCustomSubagentProfile } = await jiti.import('./subagents/profile-manager.ts');
  writeSubagentSettings({ ...DEFAULT_SUBAGENT_SETTINGS, enabled: true });

  const originalProfile = saveCustomSubagentProfile({
    scope: 'project',
    name: 'reader',
    description: 'Original reader',
    systemPrompt: 'ROLE_ORIGINAL: Inspect files carefully.',
    tools: ['read', 'grep'],
  }, fixture.workspace);

  ({ session } = await startRpcSession('new', '', fixture.workspace, { initialModel: { provider: 'desktop-subagent-fixture', modelId: 'subagent' } }));
  await session.waitUntilReady();
  const runtime = getSubagentRuntime(session.sessionId);

  const token = `N1_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const launched = await runtime.launch({
    description: 'Initial N1 reader run',
    prompt: `CHILD_TOKEN_SEED CTX_TOKEN:${token}`,
    subagent_type: 'reader',
  }, 'tc-n1-launch');
  assert.equal(launched.status, 'completed');
  assert.equal(launched.profileId, originalProfile.id);
  const firstChildRequest = fixture.requests.filter(r => r.isChild && r.task.includes(token)).at(-1);
  assert.ok(firstChildRequest);
  assert.match(firstChildRequest.systemPrompt, /ROLE_ORIGINAL/);

  // Rename reader -> reader-v2 with tightened tools, then create a NEW profile named reader
  const renamedProfile = saveCustomSubagentProfile({
    scope: 'project',
    previousName: 'reader',
    name: 'reader-v2',
    description: 'Renamed reader v2',
    systemPrompt: 'ROLE_RENAMED: Updated reader instructions.',
    tools: ['read'],
  }, fixture.workspace);
  assert.equal(renamedProfile.id, originalProfile.id);

  const recycledProfile = saveCustomSubagentProfile({
    scope: 'project',
    name: 'reader',
    description: 'Recycled name reader',
    systemPrompt: 'ROLE_RECYCLED: Brand new unrelated role.',
    tools: ['read', 'grep', 'ls'],
  }, fixture.workspace);
  assert.notEqual(recycledProfile.id, originalProfile.id);

  const reqCountBeforeContinue = fixture.requests.length;
  const continued = await runtime.continue(launched.agentId, 'CHILD_FOLLOWUP_ECHO: Recall the earlier token.');
  assert.equal(continued.status, 'completed');
  assert.equal(continued.childSessionId, launched.childSessionId, 'must continue the exact same child session');
  assert.equal(continued.profileId, originalProfile.id, 'must keep original profileId rather than rebinding to recycled name');
  assert.equal(continued.agentType, 'reader-v2', 'agentType reflects the renamed profile');
  assert.equal(continued.result, `RECALLED:${token}`, 'must retain child session history');

  const continueRequest = fixture.requests.slice(reqCountBeforeContinue).find(r => r.isChild);
  assert.ok(continueRequest);
  assert.match(continueRequest.systemPrompt, /ROLE_RENAMED/, 'HTTP request must receive renamed profile role');
  assert.doesNotMatch(continueRequest.systemPrompt, /ROLE_RECYCLED/, 'must never use recycled profile role');
  assert.ok(continueRequest.tools.includes('read'));
  assert.ok(!continueRequest.tools.includes('grep'), 'narrowed renamed tool set must apply');
  assert.ok(!continueRequest.tools.includes('ls'), 'recycled profile tools must not leak');

  // Deleting original profile ID while recycled `reader` exists must fail clearly rather than falling back to recycled `reader`
  assert.equal(deleteCustomSubagentProfile('reader-v2', 'project', fixture.workspace), true);
  await assert.rejects(
    runtime.continue(launched.agentId, 'CHILD_FOLLOWUP_ECHO: Should fail after ID deleted'),
    /no longer available/i,
  );
  assert.deepEqual(fixture.failures, []);
});

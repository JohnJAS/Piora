import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { prepareSubagentModel } from '../subagent-model-fixture.mjs';

let fixture;
export const subagents = {
  id: 'subagents', mode: 'local-model-fixture',
  scope: 'Real Electron UI, SDK child sessions, independent tool execution, cancellation and disk recovery with a deterministic loopback model.',
  coverage: ['default-off toggle and reload', 'profile model selection and inherited model restoration', 'isolated parallel child contexts', 'read-only Explore', 'transcript and usage', 'background notification', 'SendMessage continuation', 'provider failure and timeout', 'parallel Stop and Escape cancellation', 'disable cancellation', 'restart interruption and saved continuation'],
  limits: ['Model responses are scripted; not real-provider semantic acceptance.', 'Parent runtime creation is fixture preparation; task submissions and feature changes use the UI.', 'No other platforms or external accounts are exercised.'],
  async prepare(context) { fixture = await prepareSubagentModel(context); fixture.backgroundDelayMs = 15_000; },
  async run(context) {
    let { page } = context;
    const { step, waitUntil, reload, restart, directory } = context;
    let sessionId; const observed = [];
    const observe = page => page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (request.method() === 'POST' && /^\/api\/agent\/[^/]+$/.test(path)) { const body = request.postDataJSON(); if (['submit_input', 'prompt'].includes(body?.type)) sessionId = path.split('/').at(-1); }
    }); observe(page);
    const read = async () => {
      assert.ok(sessionId);
      const result = await page.evaluate(async id => { const response = await fetch(`/api/agent/${id}/subagents`); return { status: response.status, data: await response.json() }; }, sessionId);
      assert.equal(result.status, 200); observed.push(result.data.records); return result.data.records;
    };
    const toggle = async enabled => {
      await page.getByRole('button', { name: /^(Settings|设置)$/ }).click();
      const dialog = page.getByRole('dialog', { name: /^(Settings|设置)$/ });
      await dialog.getByTestId('settings-laboratory').click();
      const control = dialog.getByTestId('subagent-toggle');
      await waitUntil(() => control.isEnabled(), 'subagent settings loaded');
      if (await control.isChecked() !== enabled) await control.click();
      await waitUntil(async () => await control.isEnabled() && await control.isChecked() === enabled, 'subagent setting saved');
      await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    };
    const send = async message => { await page.locator('textarea').first().fill(message); await page.getByRole('button', { name: /^(Send|发送)$/ }).click(); };
    const timeoutSeconds = async seconds => {
      await page.getByRole('button', { name: /^(Settings|设置)$/ }).click();
      const dialog = page.getByRole('dialog', { name: /^(Settings|设置)$/ });
      await dialog.getByTestId('settings-laboratory').click();
      await waitUntil(() => dialog.getByTestId('subagent-toggle').isEnabled(), 'subagent settings loaded');
      await dialog.locator('[data-settings-id="laboratory.subagents"] summary').click();
      const input = dialog.getByRole('spinbutton', { name: /timeout|超时/i });
      await input.fill(String(seconds)); await input.press('Tab');
      await waitUntil(async () => (await page.evaluate(async () => (await fetch('/api/settings/subagents')).json())).settings.timeoutSeconds === seconds, 'timeout setting saved');
      await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    };
    const idle = () => waitUntil(async () => {
      if (!sessionId) return false;
      const result = await page.evaluate(async id => (await fetch(`/api/agent/${id}`)).json(), sessionId);
      return result.state?.runtime === 'idle';
    }, 'parent and child SDKs to become idle');
    try {
      await step('prepare-isolated-parent-runtime', async () => {
        // Fixture preparation only: cold development route compilation must
        // finish before the UI's bounded SSE connection handshake is exercised.
        const prepared = await page.evaluate(async cwd => {
          const response = await fetch('/api/agent/new', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'ensure_session', cwd, provider: 'desktop-subagent-fixture', modelId: 'subagent' }) });
          return { status: response.status, data: await response.json() };
        }, fixture.workspace);
        assert.equal(prepared.status, 200); sessionId = prepared.data.sessionId;
        await page.evaluate(async id => {
          await fetch(`/api/agent/${id}`);
          const response = await fetch(`/api/agent/${id}/events`);
          const reader = response.body.getReader();
          await reader.read(); await reader.cancel();
        }, sessionId);
        await page.goto(`${context.origin}/?session=${sessionId}`, { waitUntil: 'domcontentloaded' });
        await page.locator('textarea').first().waitFor();
      });
      await step('default-off-and-opt-in', async () => {
        await send('SUBAGENT_E2E_OFF: PARENT_PRIVATE_CONTEXT');
        await waitUntil(() => fixture.requests.some(request => request.task.includes('SUBAGENT_E2E_OFF')), 'first UI prompt to reach the model');
        await idle();
        assert.ok(fixture.requests.some(request => request.task.includes('SUBAGENT_E2E_OFF') && !request.tools.includes('Agent')));
        await toggle(true); await reload();
      });
      const readerModel = 'desktop-subagent-fixture/subagent-reader';
      const modelPicker = async () => {
        await page.getByRole('button', { name: /^(Settings|设置)$/ }).click();
        const dialog = page.getByRole('dialog', { name: /^(Settings|设置)$/ });
        await dialog.getByTestId('settings-laboratory').click();
        const card = dialog.locator('[data-settings-id="laboratory.subagents"]');
        await waitUntil(() => card.getByRole('switch').isEnabled(), 'subagent settings loaded');
        if (await card.locator('details').getAttribute('open') === null) await card.locator('summary').click();
        const picker = card.getByRole('combobox', { name: /Explore/ });
        await waitUntil(async () => await picker.getAttribute('aria-busy') === 'false' && await picker.isEnabled(), 'subagent model catalog');
        return picker;
      };
      const chooseModel = async value => {
        const picker = await modelPicker();
        await picker.selectOption(value);
        await waitUntil(async () => {
          const data = await page.evaluate(async () => (await fetch('/api/settings/subagents')).json());
          return data.settings.modelOverrides.Explore === value;
        }, 'subagent model selection saved');
        await page.keyboard.press('Escape');
        await page.getByRole('dialog', { name: /^(Settings|设置)$/ }).waitFor({ state: 'hidden' });
      };
      await step('select-profile-model-and-persist-after-reload', async () => {
        await chooseModel(readerModel); await reload();
        const picker = await modelPicker();
        assert.equal(await picker.inputValue(), readerModel);
        await page.screenshot({ path: join(directory, 'subagent-model-selected.png'), animations: 'disabled' });
        await page.keyboard.press('Escape');
        await page.getByRole('dialog', { name: /^(Settings|设置)$/ }).waitFor({ state: 'hidden' });
      });
      await step('parallel-isolated-read-only-subagents', async () => {
        await send('SUBAGENT_E2E_PARALLEL: PARENT_PRIVATE_CONTEXT must remain in the parent.');
        await waitUntil(async () => (await read()).filter(record => record.status === 'completed').length === 2, 'both child results'); await idle();
        const records = await read(); assert.deepEqual(records.map(record => record.result).sort(), ['ALPHA_ISOLATED_RESULT', 'BETA_ISOLATED_RESULT']);
        assert.ok(records.every(record => record.totalToolUseCount === 1 && record.totalTokens > 0));
        assert.ok(records.every(record => record.model === readerModel), 'Both Explore sessions use the selected model');
        assert.ok(fixture.requests.filter(request => request.isChild).every(request => request.model === 'subagent-reader'), 'Selected model reaches the provider request');
        assert.ok(fixture.requests.filter(request => !request.isChild).every(request => request.model === 'subagent'), 'Primary model remains independent');
        assert.ok(fixture.requests.filter(request => request.isChild).every(request => !request.parentSecretLeaked && !request.tools.some(name => ['write', 'edit', 'bash', 'powershell', 'Agent'].includes(name))));
        const card = page.locator(`[data-subagent-id="${records[0].agentId}"]`).first();
        await card.getByRole('button').first().click(); await card.locator('[data-subagent-role="toolResult"]').waitFor();
        await page.screenshot({ path: join(directory, 'subagent-transcript.png'), animations: 'disabled' });
      });
      await step('continue-child-context', async () => {
        const id = (await read())[0].agentId; await send(`SUBAGENT_E2E_FOLLOWUP ${id}`);
        await waitUntil(async () => (await read()).some(record => record.agentId === id && record.result === 'FOLLOWUP_CONTEXT_RETAINED'), 'SendMessage result'); await idle();
        assert.ok(fixture.requests.some(request => request.task.includes('CHILD_FOLLOWUP')));
      });
      await step('background-completion-notification', async () => {
        await send('SUBAGENT_E2E_BACKGROUND');
        await waitUntil(async () => (await read()).some(record => record.background && record.status === 'running'), 'background task while parent continues');
        await waitUntil(() => fixture.requests.some(request => request.task.includes('CHILD_BACKGROUND')), 'background provider started');
        const childIds = (await read()).map(record => record.childSessionId).filter(Boolean);
        const listing = await page.evaluate(async () => (await fetch('/api/sessions')).json());
        assert.ok(!listing.sessions.some(session => childIds.includes(session.id)), 'child sessions stay out of the sidebar');
        await reload();
        await send('SUBAGENT_E2E_INDEPENDENT');
        await waitUntil(() => fixture.requests.some(request => request.task.includes('SUBAGENT_E2E_INDEPENDENT')), 'independent parent prompt while child runs');
        assert.ok((await read()).some(record => record.background && record.status === 'running'));
        await waitUntil(async () => (await read()).some(record => record.background && record.status === 'completed'), 'background task completion'); await idle();
        assert.equal((await read()).find(record => record.background).model, 'desktop-subagent-fixture/subagent', 'Default general-purpose profile inherits the primary model');
        assert.ok(fixture.requests.some(request => request.task.includes('CHILD_BACKGROUND')));
        await page.getByText('BACKGROUND_TASK_FINISHED', { exact: false }).first().waitFor();
      });
      await step('provider-failure-retains-real-error', async () => {
        await send('SUBAGENT_E2E_ERROR');
        await waitUntil(async () => (await read()).some(record => record.description === 'Failing subagent' && record.status === 'failed'), 'failed provider record'); await idle();
        const failed = (await read()).find(record => record.description === 'Failing subagent');
        assert.match(failed.error, /Intentional subagent provider failure/);
        const card = page.locator(`[data-subagent-id="${failed.agentId}"]`).first();
        await card.locator('[aria-expanded]').click();
        await card.getByRole('alert').filter({ hasText: 'Intentional subagent provider failure' }).waitFor();
      });
      await step('timeout-cancels-provider-and-allows-recovery', async () => {
        await timeoutSeconds(1); const count = fixture.holds.length;
        await send('SUBAGENT_E2E_TIMEOUT');
        await waitUntil(async () => (await read()).some(record => record.status === 'failed' && /timed out/.test(record.error)), 'failed timeout record'); await idle();
        assert.equal(fixture.holds.length, count + 1);
        await waitUntil(() => fixture.holds[count].closed, 'timed-out child provider connection closed');
        await timeoutSeconds(300);
      });
      await step('stop-cancels-active-child-provider', async () => {
        const count = fixture.holds.length; await send('SUBAGENT_E2E_STOP');
        await waitUntil(() => fixture.holds.length === count + 2, 'two concurrent held child model requests');
        await page.getByRole('button', { name: /^(Stop agent|停止智能体)$/ }).click();
        await waitUntil(() => fixture.holds.slice(count).every(hold => hold.closed), 'both child provider connections closed');
        await waitUntil(async () => (await read()).filter(record => record.description.startsWith('Held subagent') && record.status === 'cancelled').length >= 2, 'cancelled durable child state'); await idle();
      });
      await step('escape-cancels-active-child', async () => {
        const count = fixture.holds.length; await send('SUBAGENT_E2E_ESCAPE');
        await waitUntil(() => fixture.holds.length > count, 'child request before Escape');
        await page.keyboard.press('Escape');
        await waitUntil(() => fixture.holds[count].closed, 'Escape closes child provider connection'); await idle();
      });
      await step('disable-cancels-active-child', async () => {
        const count = fixture.holds.length; await send('SUBAGENT_E2E_DISABLE');
        await waitUntil(() => fixture.holds.length > count, 'second child request'); await toggle(false);
        await waitUntil(() => fixture.holds[count].closed, 'disabled child provider connection closed'); await idle();
        await toggle(true);
      });
      await step('restart-records-interruption-without-replay', async () => {
        const count = fixture.holds.length; await send('SUBAGENT_E2E_RESTART');
        await waitUntil(() => fixture.holds.length > count, 'child request before restart');
        page = await restart(); observe(page);
        await page.goto(`${context.origin}/?session=${sessionId}`, { waitUntil: 'domcontentloaded' });
        await page.locator('textarea').first().waitFor();
        await waitUntil(async () => (await read()).some(record => record.status === 'interrupted'), 'interrupted record after restart');
        assert.equal(fixture.holds.length, count + 1, 'restart must not automatically repeat the child request');
        await page.screenshot({ path: join(directory, 'subagent-restarted.png'), animations: 'disabled' });
      });
      await step('continue-saved-child-after-application-restart', async () => {
        const id = (await read()).find(record => record.description === 'Explore A').agentId;
        const tokens = (await read()).find(record => record.agentId === id).totalTokens;
        await send(`SUBAGENT_E2E_FOLLOWUP ${id}`);
        await waitUntil(async () => (await read()).some(record => record.agentId === id && record.status === 'completed' && record.totalTokens > tokens), 'saved child context continuation'); await idle();
        assert.equal((await read()).find(record => record.agentId === id).result, 'FOLLOWUP_CONTEXT_RETAINED');
      });
      await step('restore-primary-model-for-new-child-sessions', async () => {
        await chooseModel('');
        const previous = new Set((await read()).map(record => record.agentId));
        const requestCount = fixture.requests.length;
        await send('SUBAGENT_E2E_PARALLEL: Verify the inherited primary model.');
        await waitUntil(async () => (await read()).filter(record => !previous.has(record.agentId) && record.status === 'completed').length === 2, 'new children with inherited model'); await idle();
        assert.ok((await read()).filter(record => !previous.has(record.agentId)).every(record => record.model === 'desktop-subagent-fixture/subagent'));
        assert.ok(fixture.requests.slice(requestCount).filter(request => request.isChild).every(request => request.model === 'subagent'));
      });
      assert.deepEqual(fixture.failures, []);
    } finally { await writeFile(join(directory, 'subagent-evidence.json'), JSON.stringify({ observed, fixture }, null, 2)); }
  },
};

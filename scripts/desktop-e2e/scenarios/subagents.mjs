import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { prepareSubagentModel } from '../subagent-model-fixture.mjs';

let fixture;
export const subagents = {
  id: 'subagents', mode: 'local-model-fixture',
  scope: 'Real Electron UI, SDK child sessions, independent tool execution, cancellation and disk recovery with a deterministic loopback model.',
  coverage: ['default-off toggle and reload', 'profile model selection and inherited model restoration', 'isolated parallel child contexts', 'read-only Explore', 'transcript and usage', 'sidebar discovery and parent draft', 'workspace panel restoration and narrow modal focus', 'English dark mode and Chinese light mode', 'background notification', 'SendMessage continuation', 'provider failure and timeout', 'parallel Stop and Escape cancellation', 'disable cancellation', 'restart interruption and saved continuation'],
  limits: ['Model responses are scripted; not real-provider semantic acceptance.', 'Parent runtime creation is fixture preparation; task submissions and feature changes use the UI.', 'No other platforms or external accounts are exercised.'],
  async prepare(context) { fixture = await prepareSubagentModel(context); fixture.backgroundDelayMs = 15_000; },
  async run(context) {
    let { page } = context;
    const { step, waitUntil, reload, restart, directory, paths } = context;
    let sessionId; const observed = [];
    const rendererErrors = [];
    const observe = page => {
      page.on('console', message => { if (message.type() === 'error' && /same key|hydration/i.test(message.text())) rendererErrors.push(message.text()); });
      page.on('request', request => {
        const path = new URL(request.url()).pathname;
        if (request.method() === 'POST' && /^\/api\/agent\/[^/]+$/.test(path)) { const body = request.postDataJSON(); if (['submit_input', 'prompt'].includes(body?.type)) sessionId = path.split('/').at(-1); }
      });
    }; observe(page);
    const read = async () => {
      assert.ok(sessionId);
      const result = await page.evaluate(async id => { const response = await fetch(`/api/agent/${id}/subagents`); return { status: response.status, data: await response.json() }; }, sessionId);
      assert.equal(result.status, 200); observed.push(result.data.records); return result.data.records;
    };
    const openLaboratory = async () => {
      await page.locator('[data-app-hydrated]').waitFor();
      const dialog = page.getByRole('dialog', { name: /^(Settings|设置)$/ });
      await waitUntil(async () => {
        if (await dialog.isVisible()) return true;
        try {
          await page.getByRole('button', { name: /^(Settings|设置)$/ }).click({ timeout: 2000 });
          await dialog.waitFor({ state: 'visible', timeout: 2000 });
          return true;
        } catch (error) {
          if (error.name !== 'TimeoutError') throw error;
          return dialog.isVisible();
        }
      }, 'settings to hydrate and open');
      await dialog.getByTestId('settings-laboratory').click();
      return dialog;
    };
    const toggle = async enabled => {
      const dialog = await openLaboratory();
      const control = dialog.getByTestId('subagent-toggle');
      await waitUntil(() => control.isEnabled(), 'subagent settings loaded');
      if (await control.isChecked() !== enabled) await control.click();
      await waitUntil(async () => await control.isEnabled() && await control.isChecked() === enabled, 'subagent setting saved');
      await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    };
    const reloadInitialParent = async () => {
      await reload();
      // The restored conversation can close Settings while being activated.
      // Wait for its disk-backed answer before opening Settings again.
      await page.getByText('SUBAGENTS_OFF_OK', { exact: true }).waitFor();
    };
    const send = async message => {
      await page.locator('[data-app-hydrated]').waitFor();
      const previousCount = fixture.requests.length;
      const composer = page.locator('textarea').first();
      await composer.fill(message);
      assert.equal(await composer.inputValue(), message);
      await page.getByRole('button', { name: /^(Send|发送)$/ }).click();
      await waitUntil(() => fixture.requests.slice(previousCount).some(request => !request.isChild && request.task.includes(message)), 'submitted prompt to reach the fixture: ' + message);
    };
    const timeoutSeconds = async seconds => {
      const dialog = await openLaboratory();
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
        await toggle(true); await reloadInitialParent();
      });
      const readerModel = 'desktop-subagent-fixture/subagent-reader';
      const modelPicker = async () => {
        const dialog = await openLaboratory();
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
        await chooseModel(readerModel); await reloadInitialParent();
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
        assert.ok(records.every(record => !Object.hasOwn(record, 'prompt') && !Object.hasOwn(record, 'childSessionFile')));
        assert.ok(records.every(record => record.totalToolUseCount === 1 && record.totalTokens > 0));
        assert.ok(records.every(record => record.model === readerModel), 'Both Explore sessions use the selected model');
        assert.ok(fixture.requests.filter(request => request.isChild).every(request => request.model === 'subagent-reader'), 'Selected model reaches the provider request');
        assert.ok(fixture.requests.filter(request => !request.isChild).every(request => request.model === 'subagent'), 'Primary model remains independent');
        assert.ok(fixture.requests.filter(request => request.isChild).every(request => !request.parentSecretLeaked && !request.tools.some(name => ['write', 'edit', 'bash', 'powershell', 'Agent'].includes(name))));
        const card = page.locator(`[data-subagent-id="${records[0].agentId}"]`).first();
        await card.getByRole('button').first().click(); await card.locator('[data-subagent-role="toolResult"]').waitFor();
        await page.screenshot({ path: join(directory, 'subagent-transcript.png'), animations: 'disabled' });
      });
      await step('sidebar-discovers-persisted-children-without-replacing-the-parent', async () => {
        const records = await read();
        const group = page.locator(`[data-subagent-group="${sessionId}"]`);
        await group.waitFor();
        assert.equal(await group.getAttribute('aria-expanded'), 'false');
        const oldViewport = page.viewportSize();
        await page.setViewportSize({ width: 1600, height: 900 });
        try {
          const composer = page.locator('textarea').first();
          await composer.fill('Keep this independent parent draft');
          await group.focus();
          await page.keyboard.press('ArrowRight');
          const row = page.locator(`[data-subagent-row="${records[0].agentId}"]`);
          await row.waitFor();
          assert.equal(await row.getAttribute('data-status'), 'completed');
          await row.focus();
          await page.keyboard.press('Enter');
          const details = page.locator(`[data-subagent-inspector="${records[0].agentId}"]`);
          await details.locator('[data-subagent-role="toolResult"]').waitFor();
          assert.equal(await details.locator('textarea').count(), 0);
          assert.equal(await composer.inputValue(), 'Keep this independent parent draft');
          assert.equal(new URL(page.url()).searchParams.get('session'), sessionId);
          await page.screenshot({ path: join(directory, 'subagent-sidebar-and-detail.png'), animations: 'disabled' });
          await page.keyboard.press('Escape');
          await details.waitFor({ state: 'hidden' });
          await waitUntil(() => row.evaluate(element => element === document.activeElement), 'focus returned to child row');
          await composer.fill('');
        } finally { if (oldViewport) await page.setViewportSize(oldViewport); }
      });
      await step('continue-child-context', async () => {
        const id = (await read())[0].agentId; await send(`SUBAGENT_E2E_FOLLOWUP ${id}`);
        await waitUntil(async () => (await read()).some(record => record.agentId === id && record.result === 'FOLLOWUP_CONTEXT_RETAINED'), 'SendMessage result'); await idle();
        assert.ok(fixture.requests.some(request => request.task.includes('CHILD_FOLLOWUP')));
      });
      await step('keep-workspace-panel-and-trap-narrow-inspector-focus', async () => {
        const group = page.locator(`[data-subagent-group="${sessionId}"]`);
        const row = group.locator('..').locator('[data-subagent-row]').first();
        const inspector = page.locator('[data-subagent-inspector]');
        const panel = page.locator('.right-panel-surface');
        const togglePanel = page.locator('.right-panel-toggle');
        const close = inspector.getByRole('button', { name: /^(Close subagent details|关闭子代理详情)$/ });
        const oldViewport = page.viewportSize();
        try {
          await page.setViewportSize({ width: 1600, height: 900 });
          await togglePanel.click();
          await panel.waitFor();
          const originalPanel = await panel.elementHandle();
          if (await group.getAttribute('aria-expanded') !== 'true') await group.click();
          await row.click();
          await close.waitFor();
          assert.equal(await panel.isVisible(), false);
          assert.equal(await togglePanel.getAttribute('aria-expanded'), 'true');
          await waitUntil(async () => {
            const bounds = await inspector.boundingBox();
            return bounds && bounds.width >= 340 && bounds.width <= 380;
          }, 'inspector uses its own compact width instead of the file panel minimum');
          await close.click();
          await panel.waitFor();
          assert.equal(await panel.evaluate((current, original) => current === original, originalPanel), true, 'the original workspace remains mounted');
          await originalPanel.dispose();
          await togglePanel.click();
          await waitUntil(() => page.locator('#file-panel').getAttribute('aria-hidden').then(value => value === 'true'), 'the preserved workspace is closed and inert');

          await page.setViewportSize({ width: 1050, height: 780 });
          await row.click();
          const output = inspector.locator('summary').last();
          await output.waitFor();
          assert.equal(await inspector.getAttribute('role'), 'dialog');
          assert.equal(await inspector.getAttribute('aria-modal'), 'true');
          await waitUntil(() => close.evaluate(element => element === document.activeElement), 'narrow inspector gets initial focus');
          await page.keyboard.press('Shift+Tab');
          assert.equal(await output.evaluate(element => element === document.activeElement), true);
          await page.keyboard.press('Tab');
          assert.equal(await close.evaluate(element => element === document.activeElement), true);
          const chromeBounds = await page.locator('.desktop-titlebar').boundingBox();
          const closeBounds = await close.boundingBox();
          assert.ok(chromeBounds && closeBounds && closeBounds.y >= chromeBounds.y + chromeBounds.height, 'window chrome must not cover the detail controls');
          await page.screenshot({ path: join(directory, 'subagent-narrow.png'), animations: 'disabled' });
          await page.keyboard.press('Escape');
          await inspector.waitFor({ state: 'hidden' });
          await waitUntil(() => row.evaluate(element => element === document.activeElement), 'narrow inspector returns focus');
          await row.click();
          await close.click();
          await inspector.waitFor({ state: 'hidden' });
          await group.click();
        } finally { if (oldViewport) await page.setViewportSize(oldViewport); }
      });
      await step('localize-subagent-inspector-in-light-and-dark-themes', async () => {
        const oldViewport = page.viewportSize();
        try {
          await page.setViewportSize({ width: 1600, height: 900 });
          for (const view of [
            { locale: 'English', theme: 'dark', title: 'Subagent details', group: /^Subagents( \d+)?$/, readOnly: 'Read only' },
            { locale: '简体中文', theme: 'light', title: '子代理详情', group: /^子代理( \d+)?$/, readOnly: '只读' },
          ]) {
            await page.getByRole('button', { name: /^(Settings|设置)$/ }).click();
            const dialog = page.getByRole('dialog', { name: /^(Settings|设置)$/ });
            await dialog.getByRole('button', { name: /^(Appearance & Language|外观与界面)$/ }).click();
            const appearance = dialog.locator('[data-settings-id="language"]');
            await appearance.getByRole('radio', { name: view.locale, exact: true }).click();
            await waitUntil(() => appearance.getByRole('radio', { name: view.locale, exact: true }).getAttribute('aria-checked').then(value => value === 'true'), 'language applied');
            await dialog.locator(`[role="radio"][data-theme-id="${view.theme}"]`).click();
            await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, view.theme);
            await dialog.getByRole('button', { name: /^(Back to Piora|返回 Piora)$/ }).click();
            await dialog.waitFor({ state: 'hidden' });
            const group = page.locator(`[data-subagent-group="${sessionId}"]`);
            assert.match((await group.innerText()).trim(), view.group);
            if (await group.getAttribute('aria-expanded') !== 'true') await group.click();
            await group.locator('..').locator('[data-subagent-row]').first().click();
            const inspector = page.getByRole('region', { name: view.title, exact: true });
            await inspector.getByText(view.readOnly, { exact: true }).waitFor();
            await page.screenshot({ path: join(directory, `subagent-${view.theme}.png`), animations: 'disabled' });
            await inspector.getByRole('button', { name: /^(Close subagent details|关闭子代理详情)$/ }).click();
            await inspector.waitFor({ state: 'hidden' });
            await group.click();
          }
        } finally { if (oldViewport) await page.setViewportSize(oldViewport); }
      });
      await step('background-completion-notification', async () => {
        await send('SUBAGENT_E2E_BACKGROUND');
        await waitUntil(async () => (await read()).some(record => record.background && record.status === 'running'), 'background task while parent continues');
        await waitUntil(() => fixture.requests.some(request => request.task.includes('CHILD_BACKGROUND')), 'background provider started');
        const childIds = [];
        for (const entry of await read()) {
          const privateRecord = JSON.parse(await readFile(join(paths.agent, 'piora', 'subagent-runs', sessionId, entry.agentId + '.json'), 'utf8'));
          if (privateRecord.childSessionId) childIds.push(privateRecord.childSessionId);
        }
        assert.ok(childIds.length >= 2, 'the fixture must have actual private child session IDs');
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
        const group = page.locator(`[data-subagent-group="${sessionId}"]`);
        assert.equal(await group.getAttribute('aria-expanded'), 'false', 'failure must not auto-expand the sidebar');
        const card = page.locator(`[data-subagent-id="${failed.agentId}"]`).first();
        await card.locator('[aria-expanded]').click();
        await card.getByRole('alert').filter({ hasText: 'Intentional subagent provider failure' }).waitFor();
      });
      await step('timeout-cancels-provider-and-allows-recovery', async () => {
        await timeoutSeconds(5); const count = fixture.holds.length;
        await send('SUBAGENT_E2E_TIMEOUT');
        await waitUntil(() => fixture.holds.length === count + 1, 'provider request started before the subagent timeout');
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
      await step('closing-detail-does-not-stop-and-the-stop-button-affects-only-one-child', async () => {
        const baseline = fixture.holds.length;
        await send('SUBAGENT_E2E_STOP');
        await waitUntil(() => fixture.holds.length === baseline + 2, 'two held children before one-child stop');
        const children = (await read()).filter(record => record.status === 'running');
        assert.equal(children.length, 2);
        const card = page.locator(`[data-subagent-id="${children[0].agentId}"]`).first();
        const open = card.getByRole('button', { name: /^(View details|查看详情)$/ });
        await open.click();
        const panel = page.locator(`[data-subagent-inspector="${children[0].agentId}"]`);
        await panel.waitFor();
        await page.keyboard.press('Escape');
        await panel.waitFor({ state: 'hidden' });
        assert.equal(fixture.holds.slice(baseline).filter(hold => hold.closed).length, 0);
        await open.click();
        await panel.locator('[data-subagent-stop]').click();
        await waitUntil(async () => (await read()).find(record => record.agentId === children[0].agentId)?.status === 'cancelled', 'only the selected attempt cancelled');
        assert.equal((await read()).find(record => record.agentId === children[1].agentId)?.status, 'running');
        await waitUntil(() => fixture.holds.slice(baseline).filter(hold => hold.closed).length === 1, 'exactly one held provider request closed');
        await panel.getByRole('button', { name: /Close subagent details|关闭子代理详情/ }).click();
        await page.getByRole('button', { name: /^(Stop agent|停止智能体)$/ }).click();
        await waitUntil(() => fixture.holds.slice(baseline).every(hold => hold.closed), 'parent stop settles remaining children');
        await idle();
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
        const group = page.locator(`[data-subagent-group="${sessionId}"]`);
        await group.click();
        await group.locator('xpath=..').locator('[data-subagent-row][data-status="interrupted"]').waitFor();
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
      assert.deepEqual(rendererErrors, [], 'no duplicate React keys or hydration errors');
    } finally { await writeFile(join(directory, 'subagent-evidence.json'), JSON.stringify({ observed, fixture }, null, 2)); }
  },
};

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { prepareSubagentModel } from '../subagent-model-fixture.mjs';

let fixture;
export const subagents = {
  id: 'subagents', mode: 'local-model-fixture',
  scope: 'Real Electron UI, SDK child sessions, independent tool execution, cancellation and disk recovery with a deterministic loopback model.',
  coverage: ['default-off toggle and reload', 'profile model selection without manual execution limits', 'parallel child contexts beyond the former token budget', 'read-only Explore', 'collapsed task, reply and tool details', 'running-only sidebar and parent draft', 'independent inspector resizing with workspace restoration', 'narrow modal focus', 'English dark mode and Chinese light mode', 'background notification', 'SendMessage continuation', 'provider failure', 'parallel Stop and Escape cancellation', 'disable cancellation', 'restart interruption and saved continuation'],
  limits: ['Model responses are scripted; not real-provider semantic acceptance.', 'Parent runtime creation is fixture preparation; task submissions and feature changes use the UI.', 'No other platforms or external accounts are exercised.'],
  async prepare(context) { fixture = await prepareSubagentModel(context); fixture.backgroundDelayMs = 30_000; },
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
    const taskCard = agentId => page.locator(`[data-subagent-id="${agentId}"]`).first();
    const detailButton = agentId => taskCard(agentId).getByRole('button', { name: /^(View details|查看详情)$/ });
    const inspectorFor = agentId => page.locator(`[data-subagent-inspector="${agentId}"]`);
    const openTools = async parent => {
      const tools = parent.locator('[data-subagent-tools]').first();
      await tools.locator(':scope > summary').click();
      return tools.locator('[data-subagent-role="toolResult"]').first();
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
        const chatReady = page.waitForResponse(response => {
          const url = new URL(response.url());
          return url.pathname === `/api/sessions/${sessionId}/state` && response.ok();
        });
        chatReady.catch(() => {});
        await page.goto(`${context.origin}/?session=${sessionId}`, { waitUntil: 'domcontentloaded' });
        await chatReady;
        await page.locator('textarea').first().waitFor();
        await page.evaluate(async id => {
          await fetch(`/api/agent/${id}`);
          await new Promise((resolve, reject) => {
            const source = new EventSource(`/api/agent/${id}/events?transport=delta`);
            const finish = error => {
              source.close();
              clearTimeout(timeout);
              if (error) reject(error); else resolve();
            };
            const timeout = setTimeout(() => finish(new Error('Fixture event stream did not become ready')), 90_000);
            source.onmessage = ({ data }) => {
              if (JSON.parse(data).type === 'connected') finish();
            };
            source.onerror = () => {
              if (source.readyState === EventSource.CLOSED) finish(new Error('Fixture event stream closed during preparation'));
            };
          });
        }, sessionId);
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
        assert.equal(await card.locator('input[type="number"]').count(), 0, 'No manual subagent run limits');
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
        assert.ok(records.reduce((sum, record) => sum + record.totalTokens, 0) > 200_000);
        assert.ok(records.every(record => record.model === readerModel), 'Both Explore sessions use the selected model');
        assert.ok(fixture.requests.filter(request => request.isChild).every(request => request.model === 'subagent-reader'), 'Selected model reaches the provider request');
        assert.ok(fixture.requests.filter(request => !request.isChild).every(request => request.model === 'subagent'), 'Primary model remains independent');
        assert.ok(fixture.requests.filter(request => request.isChild).every(request => !request.parentSecretLeaked && !request.tools.some(name => ['write', 'edit', 'bash', 'powershell', 'Agent'].includes(name))));
        const card = taskCard(records[0].agentId);
        await card.locator('[aria-expanded]').click();
        const result = await openTools(card);
        await result.waitFor();
        assert.equal(await result.locator('pre').isVisible(), false, 'Tool payload starts collapsed');
        await page.screenshot({ path: join(directory, 'subagent-transcript.png'), animations: 'disabled' });
      });
      await step('finished-children-are-opened-from-chat-with-a-compact-overview', async () => {
        const [record] = await read();
        const group = page.locator(`[data-subagent-group="${sessionId}"]`);
        await group.waitFor({ state: 'hidden' });
        const oldViewport = page.viewportSize();
        await page.setViewportSize({ width: 1600, height: 900 });
        try {
          const composer = page.locator('textarea').first();
          await composer.fill('Keep this independent parent draft');
          const opener = detailButton(record.agentId);
          const openerId = await opener.getAttribute('id');
          assert.ok(openerId, 'The details button has an identity that survives a chat history refresh');
          await opener.focus();
          await page.keyboard.press('Enter');
          const details = inspectorFor(record.agentId);
          await details.getByText(record.result, { exact: true }).waitFor();
          const activity = details.locator('[data-subagent-activity]');
          const runInfo = details.locator('[data-subagent-run-info]');
          assert.equal(await activity.getAttribute('open'), null);
          assert.equal(await runInfo.getAttribute('open'), null);
          assert.equal(await activity.locator('[data-subagent-transcript]').count(), 0);
          assert.equal(await details.locator('textarea').count(), 0);
          assert.equal(await composer.inputValue(), 'Keep this independent parent draft');
          assert.equal(new URL(page.url()).searchParams.get('session'), sessionId);
          await page.screenshot({ path: join(directory, 'subagent-overview.png'), animations: 'disabled' });
          await activity.locator(':scope > summary').click();
          const instructions = activity.locator('[data-subagent-role="user"]').first();
          const reply = activity.locator('[data-subagent-role="assistant"]').first();
          await instructions.waitFor(); await reply.waitFor();
          assert.equal(await instructions.locator('details').getAttribute('open'), null);
          assert.equal(await reply.locator('details').getAttribute('open'), null);
          await instructions.locator('summary').click();
          await instructions.locator('p').filter({ hasText: 'Read the assigned fixture' }).waitFor();
          const result = await openTools(activity);
          await result.waitFor();
          await result.locator('summary').click();
          await result.locator('pre').filter({ hasText: record.result }).waitFor();
          await runInfo.locator(':scope > summary').click();
          await runInfo.getByText(record.model, { exact: true }).waitFor();
          await page.screenshot({ path: join(directory, 'subagent-expanded-activity.png'), animations: 'disabled' });
          await page.keyboard.press('Escape');
          await details.waitFor({ state: 'hidden' });
          await waitUntil(() => opener.evaluate((element, id) => element.id === id && element === document.activeElement, openerId), 'focus returned to chat card');
          await composer.fill('');
        } finally { if (oldViewport) await page.setViewportSize(oldViewport); }
      });
      await step('continue-child-context', async () => {
        const id = (await read())[0].agentId; await send(`SUBAGENT_E2E_FOLLOWUP ${id}`);
        await waitUntil(async () => (await read()).some(record => record.agentId === id && record.result === 'FOLLOWUP_CONTEXT_RETAINED'), 'SendMessage result'); await idle();
        assert.ok(fixture.requests.some(request => request.task.includes('CHILD_FOLLOWUP')));
      });
      await step('resize-details-without-changing-the-workspace-and-trap-narrow-focus', async () => {
        const [record] = await read();
        const opener = detailButton(record.agentId);
        const inspector = page.locator('[data-subagent-inspector]');
        const panel = page.locator('.right-panel-surface');
        const togglePanel = page.locator('.right-panel-toggle');
        const close = inspector.getByRole('button', { name: /^(Close subagent details|关闭子代理详情)$/ });
        const resize = inspector.getByRole('separator', { name: /^(Resize subagent details|调整子代理详情宽度)$/ });
        const readWidth = async () => (await inspector.boundingBox())?.width;
        const drag = async amount => {
          const bounds = await resize.boundingBox();
          assert.ok(bounds, 'the resize grip is visible');
          const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
          await page.mouse.move(x, y);
          await page.mouse.down();
          try {
            const before = await readWidth();
            await page.mouse.move(x - amount, y, { steps: 6 });
            await waitUntil(async () => (await readWidth()) >= before + amount - 3, 'panel resizes while dragging');
          } finally { await page.mouse.up(); }
        };
        const oldViewport = page.viewportSize();
        try {
          await page.setViewportSize({ width: 1600, height: 900 });
          await togglePanel.click();
          await panel.waitFor();
          const originalPanel = await panel.elementHandle();
          const originalWidth = (await panel.boundingBox()).width;
          await opener.click();
          await close.waitFor();
          assert.equal(await panel.isVisible(), false);
          assert.equal(await togglePanel.getAttribute('aria-expanded'), 'true');
          await waitUntil(async () => {
            const bounds = await inspector.boundingBox();
            return bounds && bounds.width >= 518 && bounds.width <= 522;
          }, 'inspector uses its own readable default width');
          await drag(110);
          assert.ok((await readWidth()) >= 627);
          await close.click();
          await panel.waitFor();
          assert.equal(await panel.evaluate((current, original) => current === original, originalPanel), true, 'the original workspace remains mounted');
          await waitUntil(async () => Math.abs((await panel.boundingBox())?.width - originalWidth) <= 2, 'resizing details leaves the file workspace width');
          await originalPanel.dispose();
          await togglePanel.click();
          await waitUntil(() => page.locator('#file-panel').getAttribute('aria-hidden').then(value => value === 'true'), 'the preserved workspace is closed and inert');

          await page.setViewportSize({ width: 1050, height: 780 });
          await reload();
          await opener.click();
          const output = inspector.locator('[data-subagent-run-info] > summary');
          await output.waitFor();
          await waitUntil(async () => (await readWidth()) >= 627, 'detail width restored after reload');
          assert.equal(await inspector.getAttribute('role'), 'dialog');
          assert.equal(await inspector.getAttribute('aria-modal'), 'true');
          await waitUntil(() => close.evaluate(element => element === document.activeElement), 'narrow inspector gets initial focus');
          await page.keyboard.press('Shift+Tab');
          assert.equal(await output.evaluate(element => element === document.activeElement), true);
          await page.keyboard.press('Tab');
          assert.equal(await close.evaluate(element => element === document.activeElement), true);
          await drag(60);
          await resize.press('ArrowRight');
          const keyboardWidth = await readWidth();
          await resize.press('ArrowLeft');
          await waitUntil(async () => (await readWidth()) >= keyboardWidth + 9, 'keyboard resizing works inside the modal');
          const chromeBounds = await page.locator('.desktop-titlebar').boundingBox();
          const closeBounds = await close.boundingBox();
          assert.ok(chromeBounds && closeBounds && closeBounds.y >= chromeBounds.y + chromeBounds.height, 'window chrome must not cover the detail controls');
          await page.screenshot({ path: join(directory, 'subagent-narrow.png'), animations: 'disabled' });
          await page.keyboard.press('Escape');
          await inspector.waitFor({ state: 'hidden' });
          await waitUntil(() => opener.evaluate(element => element === document.activeElement), 'narrow inspector returns focus');
          await page.setViewportSize({ width: 590, height: 780 });
          await opener.click();
          await waitUntil(async () => (await readWidth()) >= 585, 'phone-width details fill the screen');
          assert.equal(await resize.isVisible(), false);
          await close.click();
          await inspector.waitFor({ state: 'hidden' });
          await page.setViewportSize({ width: 1600, height: 900 });
          await page.locator('.desktop-titlebar-sidebar-toggle').click();
          await waitUntil(() => page.locator('#session-sidebar.sidebar-open').isVisible(), 'sidebar restored after the phone-width check');
        } finally { if (oldViewport) await page.setViewportSize(oldViewport); }
      });
      await step('localize-subagent-inspector-in-light-and-dark-themes', async () => {
        const oldViewport = page.viewportSize();
        try {
          await page.setViewportSize({ width: 1600, height: 900 });
          for (const view of [
            { locale: 'English', theme: 'dark', title: 'Subagent details', activity: 'Activity', outcome: 'Result' },
            { locale: '简体中文', theme: 'light', title: '子代理详情', activity: '执行记录', outcome: '任务结果' },
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
            const [record] = await read();
            await detailButton(record.agentId).click();
            const inspector = page.getByRole('region', { name: view.title, exact: true });
            await inspector.getByRole('heading', { name: view.outcome }).waitFor();
            await inspector.getByText(view.activity, { exact: true }).click();
            await inspector.locator('[data-subagent-role="user"]').first().waitFor();
            await page.screenshot({ path: join(directory, `subagent-${view.theme}.png`), animations: 'disabled' });
            await inspector.getByRole('button', { name: /^(Close subagent details|关闭子代理详情)$/ }).click();
            await inspector.waitFor({ state: 'hidden' });
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
        await group.waitFor({ state: 'hidden' });
        const card = taskCard(failed.agentId);
        await card.locator('[aria-expanded]').click();
        await card.getByRole('alert').filter({ hasText: 'Intentional subagent provider failure' }).waitFor();
        await detailButton(failed.agentId).click();
        const inspector = inspectorFor(failed.agentId);
        await inspector.getByRole('alert').filter({ hasText: 'Intentional subagent provider failure' }).waitFor();
        await page.screenshot({ path: join(directory, 'subagent-failure.png'), animations: 'disabled' });
        await inspector.getByRole('button', { name: /Close subagent details|关闭子代理详情/ }).click();
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
        const group = page.locator(`[data-subagent-group="${sessionId}"]`);
        await group.waitFor();
        assert.equal(await group.getAttribute('aria-expanded'), 'false');
        await group.focus();
        await page.keyboard.press('ArrowRight');
        const rows = group.locator('..').locator('[data-subagent-row]');
        const row = rows.and(page.locator(`[data-subagent-row="${children[0].agentId}"]`));
        await row.waitFor();
        assert.equal(await rows.count(), 2, 'Only the live child tasks appear below the chat');
        await row.focus();
        await page.keyboard.press('Enter');
        const panel = inspectorFor(children[0].agentId);
        await panel.waitFor();
        await page.keyboard.press('Escape');
        await panel.waitFor({ state: 'hidden' });
        await waitUntil(() => row.evaluate(element => element === document.activeElement), 'focus returns to the live sidebar item');
        assert.equal(fixture.holds.slice(baseline).filter(hold => hold.closed).length, 0);
        await detailButton(children[0].agentId).click();
        await panel.locator('[data-subagent-stop]').click();
        await waitUntil(async () => (await read()).find(record => record.agentId === children[0].agentId)?.status === 'cancelled', 'only the selected attempt cancelled');
        assert.equal((await read()).find(record => record.agentId === children[1].agentId)?.status, 'running');
        await waitUntil(() => fixture.holds.slice(baseline).filter(hold => hold.closed).length === 1, 'exactly one held provider request closed');
        await row.waitFor({ state: 'hidden' });
        assert.equal(await rows.count(), 1, 'The stopped child disappears while its sibling stays visible');
        assert.equal(await panel.isVisible(), true);
        await panel.getByRole('button', { name: /Close subagent details|关闭子代理详情/ }).click();
        await page.getByRole('button', { name: /^(Stop agent|停止智能体)$/ }).click();
        await waitUntil(() => fixture.holds.slice(baseline).every(hold => hold.closed), 'parent stop settles remaining children');
        await idle();
        await group.waitFor({ state: 'hidden' });
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
        const interrupted = await waitUntil(async () => (await read()).find(record => record.status === 'interrupted'), 'interrupted record after restart');
        assert.equal(fixture.holds.length, count + 1, 'restart must not automatically repeat the child request');
        const group = page.locator(`[data-subagent-group="${sessionId}"]`);
        await group.waitFor({ state: 'hidden' });
        await detailButton(interrupted.agentId).click();
        const inspector = inspectorFor(interrupted.agentId);
        await inspector.locator('[data-status="interrupted"]').waitFor();
        await page.screenshot({ path: join(directory, 'subagent-restarted.png'), animations: 'disabled' });
        await inspector.getByRole('button', { name: /Close subagent details|关闭子代理详情/ }).click();
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

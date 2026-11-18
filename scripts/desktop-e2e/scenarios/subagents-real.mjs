import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, unlink } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

let workspace;
const parentModel = process.env.PIORA_SUBAGENT_REAL_PARENT_MODEL ?? 'deepseek/deepseek-flash';
const readerModel = process.env.PIORA_SUBAGENT_REAL_READER_MODEL ?? 'new-provider/qwen3.8-max';
function selection(value) {
  const separator = value.indexOf('/');
  assert.ok(separator > 0 && separator < value.length - 1 && !/\s/.test(value), 'Models must use provider/modelId');
  return { provider: value.slice(0, separator), modelId: value.slice(separator + 1) };
}
const parentSelection = selection(parentModel), readerSelection = selection(readerModel);
export const subagentsReal = {
  id: 'subagents-real', mode: 'real-provider',
  scope: 'Real configured providers, Electron UI delegation, independent read/write/verification and retained child context.',
  coverage: ['real parent and child model requests', 'two independent delegated tasks', 'read-only child with a different model', 'child write and command verification', 'continuation with saved context', 'full child transcript and usage'],
  limits: ['Requires local credentials; PIORA_SUBAGENT_REAL_AGENT_DIR selects their directory, PIORA_SUBAGENT_REAL_PARENT_MODEL and PIORA_SUBAGENT_REAL_READER_MODEL select provider/modelId.', 'Provider responses are nondeterministic; failure is recorded without substituting scripted responses.', 'Parent runtime creation is test preparation; all task submissions and settings changes use the UI.'],
  async prepare({ paths, registerCleanup, report }) {
    const source = process.env.PIORA_SUBAGENT_REAL_AGENT_DIR ?? join(homedir(), '.pi', 'agent');
    const auth = JSON.parse(await readFile(join(source, 'auth.json'), 'utf8'));
    const config = JSON.parse(await readFile(join(source, 'models.json'), 'utf8'));
    const selectedAuth = {}, providers = {};
    for (const { provider, modelId } of [parentSelection, readerSelection]) {
      if (auth[provider]) selectedAuth[provider] = auth[provider];
      const configured = config.providers?.[provider];
      assert.ok(auth[provider] || configured?.apiKey, `Credential for ${provider} is required`);
      if (configured) {
        assert.ok(configured.models?.some(model => model.id === modelId), `Configured model ${provider}/${modelId} is required`);
        providers[provider] = configured;
      }
    }
    for (const name of ['auth.json', 'models.json']) registerCleanup(() => unlink(join(paths.agent, name)).catch(error => { if (error.code !== 'ENOENT') throw error; }));
    await writeFile(join(paths.agent, 'auth.json'), JSON.stringify(selectedAuth), { mode: 0o600 });
    await writeFile(join(paths.agent, 'models.json'), JSON.stringify({ providers }), { mode: 0o600 });
    const settingsPath = join(paths.agent, 'settings.json'), settings = JSON.parse(await readFile(settingsPath, 'utf8'));
    await writeFile(settingsPath, JSON.stringify({ ...settings, enabledModels: [...new Set([parentModel, readerModel])], defaultProvider: parentSelection.provider, defaultModel: parentSelection.modelId, defaultThinkingLevel: 'off' }));
    workspace = await mkdtemp(join(tmpdir(), 'piora-subagent-real-'));
    await writeFile(join(workspace, 'source.json'), JSON.stringify({ alpha: [3, 5, 8], beta: [13, 21] }));
    report.credentials = 'selected existing credentials copied to isolated runtime and removed during cleanup';
    report.models = { parent: parentModel, reader: readerModel };
  },
  async run({ page, origin, directory, paths, step, waitUntil }) {
    let sessionId;
    const observations = [];
    const readJson = async path => {
      for (let attempt = 0; ; attempt++) {
        try { return await page.evaluate(async path => { const response = await fetch(path); return { status: response.status, body: await response.json() }; }, path); }
        catch (error) {
          // Cold dev-route compilation can replace the page while a read-only
          // assertion is pending. Never replay submissions or settings writes.
          if (attempt >= 2 || !/Execution context was destroyed|Cannot find context with specified id/.test(error.message)) throw error;
          await page.waitForLoadState('domcontentloaded'); await page.locator('.app-shell').waitFor();
        }
      }
    };
    const records = async () => {
      const data = await readJson(`/api/agent/${sessionId}/subagents`);
      assert.equal(data.status, 200); observations.push(data.body.records); return data.body.records;
    };
    const assertParentHealthy = async () => {
      const response = await readJson(`/api/agent/${sessionId}`);
      assert.equal(response.status, 200); const state = response.body;
      assert.ok(!state.state?.lastPromptFailed, state.state?.lastPromptErrorSummary || 'Real parent model failed');
      return state.state;
    };
    const send = async text => { await page.locator('textarea').first().fill(text); await page.getByRole('button', { name: /^(Send|发送)$/ }).click(); };
    const idle = () => waitUntil(async () => {
      return (await assertParentHealthy())?.runtime === 'idle';
    }, 'real parent and child models to settle');
    try {
      await step('prepare-real-parent-runtime', async () => {
        const prepared = await page.evaluate(async ({ cwd, provider, modelId }) => {
          const response = await fetch('/api/agent/new', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'ensure_session', cwd, provider, modelId, thinkingLevel: 'off' }) });
          return { status: response.status, body: await response.json() };
        }, { cwd: workspace, ...parentSelection });
        assert.equal(prepared.status, 200); sessionId = prepared.body.sessionId;
        await page.evaluate(async id => {
          await fetch(`/api/agent/${id}`); const events = await fetch(`/api/agent/${id}/events`);
          const reader = events.body.getReader(); await reader.read(); await reader.cancel();
        }, sessionId);
        await page.goto(`${origin}/?session=${sessionId}`, { waitUntil: 'domcontentloaded' });
        await page.locator('textarea').first().waitFor({ state: 'visible' });
        const dialog = page.getByRole('dialog', { name: /^(Settings|设置)$/ });
        // A visible server-rendered button can precede hydration after navigation.
        // Opening settings is idempotent; never retry toggles or task submissions.
        await waitUntil(async () => {
          if (await dialog.isVisible()) return true;
          try {
            await page.getByRole('button', { name: /^(Settings|设置)$/ }).click({ timeout: 2000 });
            await dialog.waitFor({ state: 'visible', timeout: 2000 });
            return true;
          } catch (error) {
            if (error.name !== 'TimeoutError') throw error;
            // A late-opened dialog may cover the original settings button.
            return dialog.isVisible();
          }
        }, 'settings dialog after session navigation');
        await dialog.getByTestId('settings-laboratory').click();
        const toggle = dialog.getByTestId('subagent-toggle'); await waitUntil(() => toggle.isEnabled(), 'subagent switch');
        if (!await toggle.isChecked()) await toggle.click();
        await waitUntil(() => toggle.isEnabled(), 'subagent enable save');
        await dialog.locator('[data-settings-id="laboratory.subagents"] summary').click();
        // Accessible label contains the profile identity in either supported locale.
        const reader = dialog.getByRole('combobox', { name: /Explore/ });
        await waitUntil(() => reader.locator('option').evaluateAll((options, model) => options.some(option => option.value === model && !option.disabled), readerModel), 'reader model available');
        await reader.selectOption(readerModel);
        await waitUntil(async () => {
          const data = await page.evaluate(async () => (await fetch('/api/settings/subagents')).json());
          return data.settings.modelOverrides.Explore === readerModel;
        }, 'reader model override saved');
        await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
        // The parent was provisioned through the API and has no message yet.
        // Explicitly reopen that prepared chat before submitting its first turn.
        await page.goto(`${origin}/?session=${sessionId}`, { waitUntil: 'domcontentloaded' });
        await page.locator('textarea').first().waitFor({ state: 'visible' });
      });
      await step('real-model-delegation-read-write-and-verification', async () => {
        await send(`这是 Subagent 安装验收。父上下文私密标记 PARENT_ONLY_REAL_9461，不要向子代理传递这个标记。\n请在同一轮并行调用两次 Agent，父代理不要自己读写文件或执行命令。任务A使用 general-purpose：在 ${workspace} 新建 sum.cjs，定义 sum 数字数组求和函数，最后必须使用 module.exports = sum 直接导出函数，严禁导出 { sum } 对象；验收会检查 typeof require(文件路径) === 'function'。通过终端运行 node 验证 [3,5,8] 得 16、[13,21] 得 34，报告真实结果。任务B使用 Explore：只允许读取 ${join(workspace, 'source.json')} 这一份文件，不得读取 sum.cjs 或其他文件，计算 alpha 和 beta 各自的总和，返回文件证据。两个子任务的 prompt 应独立完整，必须完整传递文件范围、函数导出形状和执行验证要求。完成后汇总两个实际结果，不要代替子任务执行，不要再创建额外代理。`);
        await waitUntil(async () => { await assertParentHealthy(); const list = await records(); return list.length === 2 && list.every(record => record.status !== 'running'); }, 'two real child results');
        await idle();
        const list = await records(); assert.ok(list.every(record => record.status === 'completed'), JSON.stringify(list.map(record => ({ status: record.status, error: record.error }))));
        const reader = list.find(record => record.agentType === 'Explore'), writer = list.find(record => record.agentType === 'general-purpose');
        assert.ok(reader && writer); assert.equal(reader.model, readerModel);
        assert.ok(reader.totalToolUseCount > 0 && writer.totalToolUseCount >= 2);
        assert.ok(list.every(record => record.totalTokens > 0 && !Object.hasOwn(record, 'prompt') && !Object.hasOwn(record, 'childSessionFile')));
        assert.match(reader.result, /16/); assert.match(reader.result, /34/);
        const response = await readJson(`/api/sessions/${sessionId}`);
        assert.equal(response.status, 200); const history = response.body;
        const parentTools = history.context.messages.filter(message => message.role === 'assistant')
          .flatMap(message => message.content.filter(block => block.type === 'toolCall').map(block => block.toolName));
        assert.equal(parentTools.filter(name => name === 'Agent').length, 2);
        assert.ok(parentTools.every(name => ['Agent', 'SendMessage', 'TaskOutput', 'TaskStop'].includes(name)), 'parent must delegate instead of executing child work itself');
        const probe = execFileSync(process.execPath, ['-e', 'const sum=require(process.argv[1]);if(sum([3,5,8])!==16||sum([13,21])!==34)process.exit(1);console.log("16,34")', join(workspace, 'sum.cjs')], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
        assert.equal(probe.trim(), '16,34');
        for (const record of list) {
          const folder = join(paths.agent, 'piora', 'subagent-sessions', sessionId, record.agentId);
          const privateRecord = JSON.parse(await readFile(join(paths.agent, 'piora', 'subagent-runs', sessionId, record.agentId + '.json'), 'utf8'));
          assert.ok(!privateRecord.prompt.includes('PARENT_ONLY_REAL_9461'), 'parent private history must not be placed in the delegated prompt');
          const files = (await readdir(folder)).filter(file => file.endsWith('.jsonl'));
          assert.equal(files.length, 1);
          const transcript = await readFile(join(folder, files[0]), 'utf8');
          assert.ok(!transcript.includes('PARENT_ONLY_REAL_9461'), 'parent private history must remain isolated');
          const card = page.locator(`[data-subagent-id="${record.agentId}"]`).first();
          await card.locator('[aria-expanded]').click();
          await card.locator('[data-subagent-role="toolResult"]').first().waitFor();
        }
        const group = page.locator(`[data-subagent-group="${sessionId}"]`);
        await group.click();
        await page.locator(`[data-subagent-row="${reader.agentId}"]`).click();
        const details = page.locator(`[data-subagent-inspector="${reader.agentId}"]`);
        await details.locator('[data-subagent-role="toolResult"]').first().waitFor();
        await details.getByRole('button', { name: /Close subagent details|关闭子代理详情/ }).click();
        await page.screenshot({ path: join(directory, 'real-subagents.png'), animations: 'disabled' });
      });
      await step('real-model-continues-owned-child-context', async () => {
        const reader = (await records()).find(record => record.agentType === 'Explore');
        await send(`请使用 SendMessage 继续子代理 ${reader.agentId}，问它：结合你刚才读到的两个数组，全部数字的总和是多少？父代理不要自行计算，不要重新创建 Agent。汇总其回答。`);
        await waitUntil(async () => { await assertParentHealthy(); const current = (await records()).find(record => record.agentId === reader.agentId); return current.totalTokens > reader.totalTokens && current.status !== 'running'; }, 'continued real child response');
        await idle();
        const current = (await records()).find(record => record.agentId === reader.agentId);
        assert.equal(current.status, 'completed'); assert.match(current.result, /50/);
        assert.equal((await records()).length, 2);
      });
    } finally { await writeFile(join(directory, 'real-subagent-evidence.json'), JSON.stringify({ sessionId, observations }, null, 2)); }
  },
};

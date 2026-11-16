import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, unlink } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

let workspace;
const readerModel = 'new-provider/qwen3.8-max';
export const subagentsReal = {
  id: 'subagents-real', mode: 'real-provider',
  scope: 'Real configured DeepSeek and Qwen providers, Electron UI delegation, independent read/write/verification and retained child context.',
  coverage: ['real parent and child model requests', 'two independent delegated tasks', 'read-only child with a different model', 'child write and command verification', 'continuation with saved context', 'full child transcript and usage'],
  limits: ['Requires the local DeepSeek and configured Qwen credentials.', 'Provider responses are nondeterministic; failure is recorded without substituting scripted responses.', 'Parent runtime creation is test preparation; all task submissions and settings changes use the UI.'],
  async prepare({ paths, registerCleanup, report }) {
    const source = join(homedir(), '.pi', 'agent');
    const auth = JSON.parse(await readFile(join(source, 'auth.json'), 'utf8'));
    const config = JSON.parse(await readFile(join(source, 'models.json'), 'utf8'));
    assert.ok(auth.deepseek, 'DeepSeek credential is required');
    assert.ok(config.providers?.['new-provider']?.models?.some(model => model.id === 'qwen3.8-max'), 'Configured Qwen model is required');
    for (const name of ['auth.json', 'models.json']) registerCleanup(() => unlink(join(paths.agent, name)).catch(error => { if (error.code !== 'ENOENT') throw error; }));
    await writeFile(join(paths.agent, 'auth.json'), JSON.stringify({ deepseek: auth.deepseek }), { mode: 0o600 });
    await writeFile(join(paths.agent, 'models.json'), JSON.stringify({ providers: { 'new-provider': config.providers['new-provider'] } }), { mode: 0o600 });
    const settingsPath = join(paths.agent, 'settings.json'), settings = JSON.parse(await readFile(settingsPath, 'utf8'));
    await writeFile(settingsPath, JSON.stringify({ ...settings, enabledModels: ['deepseek/deepseek-flash', readerModel], defaultProvider: 'deepseek', defaultModel: 'deepseek-flash', defaultThinkingLevel: 'off' }));
    workspace = await mkdtemp(join(tmpdir(), 'piora-subagent-real-'));
    await writeFile(join(workspace, 'source.json'), JSON.stringify({ alpha: [3, 5, 8], beta: [13, 21] }));
    report.credentials = 'selected existing credentials copied to isolated runtime and removed during cleanup';
    report.models = { parent: 'deepseek/deepseek-flash', reader: readerModel };
  },
  async run({ page, origin, directory, step, waitUntil }) {
    let sessionId;
    const observations = [];
    const records = async () => {
      const data = await page.evaluate(async id => {
        const response = await fetch(`/api/agent/${id}/subagents?transcript=true`);
        return { status: response.status, body: await response.json() };
      }, sessionId);
      assert.equal(data.status, 200); observations.push(data.body.records); return data.body.records;
    };
    const send = async text => { await page.locator('textarea').first().fill(text); await page.getByRole('button', { name: /^(Send|发送)$/ }).click(); };
    const idle = () => waitUntil(async () => {
      const state = await page.evaluate(async id => (await fetch(`/api/agent/${id}`)).json(), sessionId);
      return state.state?.runtime === 'idle';
    }, 'real parent and child models to settle');
    try {
      await step('prepare-real-parent-runtime', async () => {
        const prepared = await page.evaluate(async cwd => {
          const response = await fetch('/api/agent/new', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'ensure_session', cwd, provider: 'deepseek', modelId: 'deepseek-flash', thinkingLevel: 'off' }) });
          return { status: response.status, body: await response.json() };
        }, workspace);
        assert.equal(prepared.status, 200); sessionId = prepared.body.sessionId;
        await page.evaluate(async id => {
          await fetch(`/api/agent/${id}`); const events = await fetch(`/api/agent/${id}/events`);
          const reader = events.body.getReader(); await reader.read(); await reader.cancel();
        }, sessionId);
        await page.goto(`${origin}/?session=${sessionId}`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: /^(Settings|设置)$/ }).click();
        const dialog = page.getByRole('dialog', { name: /^(Settings|设置)$/ });
        await dialog.getByTestId('settings-laboratory').click();
        const toggle = dialog.getByTestId('subagent-toggle'); await waitUntil(() => toggle.isEnabled(), 'subagent switch');
        if (!await toggle.isChecked()) await toggle.click();
        await waitUntil(() => toggle.isEnabled(), 'subagent enable save');
        await dialog.locator('[data-settings-id="laboratory.subagents"] summary').click();
        // Accessible label contains the profile identity in either supported locale.
        const reader = dialog.getByRole('textbox', { name: /Explore/ });
        await reader.fill(readerModel); await reader.press('Tab');
        await waitUntil(async () => {
          const data = await page.evaluate(async () => (await fetch('/api/settings/subagents')).json());
          return data.settings.modelOverrides.Explore === readerModel;
        }, 'reader model override saved');
        await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
      });
      await step('real-model-delegation-read-write-and-verification', async () => {
        await send(`这是 Subagent 安装验收。父上下文私密标记 PARENT_ONLY_REAL_9461，不要向子代理传递这个标记。\n请在同一轮并行调用两次 Agent，父代理不要自己读写文件或执行命令。任务A使用 general-purpose：在 ${workspace} 新建 sum.cjs，使用 module.exports 导出一个对数字数组求和的函数，并通过终端运行 node 验证 [3,5,8] 得 16，报告真实结果。任务B使用 Explore：读取 ${join(workspace, 'source.json')}，计算 alpha 和 beta 各自的总和，返回文件证据。两个子任务的 prompt 应独立完整，A 只写 sum.cjs，B 只读 source.json。完成后汇总两个实际结果，不要代替子任务执行，不要再创建额外代理。`);
        await waitUntil(async () => { const list = await records(); return list.length === 2 && list.every(record => record.status !== 'running'); }, 'two real child results');
        await idle();
        const list = await records(); assert.ok(list.every(record => record.status === 'completed'), JSON.stringify(list.map(record => ({ status: record.status, error: record.error }))));
        const reader = list.find(record => record.agentType === 'Explore'), writer = list.find(record => record.agentType === 'general-purpose');
        assert.ok(reader && writer); assert.equal(reader.model, readerModel);
        assert.ok(reader.totalToolUseCount > 0 && writer.totalToolUseCount >= 2);
        assert.ok(list.every(record => record.totalTokens > 0 && !record.prompt.includes('PARENT_ONLY_REAL_9461')));
        assert.match(reader.result, /16/); assert.match(reader.result, /34/);
        const probe = execFileSync(process.execPath, ['-e', 'const sum=require(process.argv[1]);if(sum([3,5,8])!==16||sum([13,21])!==34)process.exit(1);console.log("16,34")', join(workspace, 'sum.cjs')], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
        assert.equal(probe.trim(), '16,34');
        for (const record of list) {
          const transcript = await readFile(record.childSessionFile, 'utf8');
          assert.ok(!transcript.includes('PARENT_ONLY_REAL_9461'), 'parent private history must remain isolated');
          const card = page.locator(`[data-subagent-id="${record.agentId}"]`).first();
          await card.locator('[aria-expanded]').click();
          await card.locator('[data-subagent-role="toolResult"]').waitFor();
        }
        await page.screenshot({ path: join(directory, 'real-subagents.png'), animations: 'disabled' });
      });
      await step('real-model-continues-owned-child-context', async () => {
        const reader = (await records()).find(record => record.agentType === 'Explore');
        await send(`请使用 SendMessage 继续子代理 ${reader.agentId}，问它：结合你刚才读到的两个数组，全部数字的总和是多少？父代理不要自行计算，不要重新创建 Agent。汇总其回答。`);
        await waitUntil(async () => { const current = (await records()).find(record => record.agentId === reader.agentId); return current.totalTokens > reader.totalTokens && current.status !== 'running'; }, 'continued real child response');
        await idle();
        const current = (await records()).find(record => record.agentId === reader.agentId);
        assert.equal(current.status, 'completed'); assert.match(current.result, /50/);
        assert.equal((await records()).length, 2);
      });
    } finally { await writeFile(join(directory, 'real-subagent-evidence.json'), JSON.stringify({ sessionId, observations }, null, 2)); }
  },
};

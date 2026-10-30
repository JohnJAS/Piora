import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJiti } from 'jiti';
const { createGlobalModelServices } = await createJiti(import.meta.url).import('./global-model-services.ts');
test('global models ignore project settings and persist only global changes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'piora-global-models-'));
  try {
    mkdirSync(join(dir, '.pi'));
    const project = join(dir, '.pi', 'settings.json');
    writeFileSync(project, '{broken project settings');
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ enabledModels: ['deepseek/*'] }));
    const { settingsManager, modelRuntime } = await createGlobalModelServices(dir);
    assert.deepEqual(settingsManager.getEnabledModels(), ['deepseek/*']);
    assert.deepEqual(settingsManager.getProjectSettings(), {});
    assert.deepEqual(settingsManager.drainErrors(), []);
    assert.ok(modelRuntime.getProviders().some(p => p.id === 'deepseek'));
    settingsManager.setEnabledModels(['openai/*']);
    await settingsManager.flush();
    assert.deepEqual(settingsManager.drainErrors(), []);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).enabledModels, ['openai/*']);
    assert.equal(readFileSync(project, 'utf8'), '{broken project settings');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

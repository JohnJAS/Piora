import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('homepage exposes every product capability group and primary journey', async () => {
  const [page, data] = await Promise.all([
    readFile(new URL('app/page.tsx', root), 'utf8'),
    readFile(new URL('app/site-data.ts', root), 'utf8'),
  ]);
  for (const anchor of ['features', 'quickstart', 'download', 'ai-ready']) assert.match(page, new RegExp(`id=\"${anchor}\"`));
  for (const title of ['AI 会话与任务执行', '文件与代码工作区', 'Git、审阅与 Worktree', '内置浏览器', 'HarmonyOS NEXT 真机自动化', '多智能体房间与 Agent Team', '计划任务与持续跟进', '桌面交付、更新与本地安全']) assert.match(data, new RegExp(title));
  assert.equal((data.match(/number: '\d{2}'/g) ?? []).length, 12);
});

test('downloads always retain canonical GitHub latest-release fallback', async () => {
  const [release, data] = await Promise.all([
    readFile(new URL('app/LatestRelease.tsx', root), 'utf8'),
    readFile(new URL('app/site-data.ts', root), 'utf8'),
  ]);
  assert.match(data, /github\.com\/kexijiang\/Piora/);
  assert.match(data, /releases\/latest/);
  for (const artifact of ['win-x64-setup.exe', 'win-x64-portable.exe', 'win-x64.zip', 'linux-x64-portable.AppImage']) assert.match(release, new RegExp(artifact.replaceAll('.', '\\.')));
});

test('machine-readable discovery files are complete', async () => {
  const [llms, manifest, route] = await Promise.all([
    readFile(new URL('public/llms.txt', root), 'utf8'),
    readFile(new URL('public/manifest.webmanifest', root), 'utf8'),
    readFile(new URL('app/features.json/route.ts', root), 'utf8'),
  ]);
  assert.ok(llms.length > 5000);
  assert.match(llms, /Complete capability index/);
  assert.equal(JSON.parse(manifest).name, 'Piora — AI Desktop Workspace');
  assert.match(route, /capabilityGroups/);
});

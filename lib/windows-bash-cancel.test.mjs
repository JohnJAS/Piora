import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { createLocalBashOperations } from '@earendil-works/pi-coding-agent';
import { discoverWindowsBash } from './windows-bash.ts';
import { originalBashSource } from '../scripts/pi-windows-bash-patch.mjs';

const shellPath = discoverWindowsBash();
const windows = process.platform === 'win32' && Boolean(shellPath);
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };

test('reviewed SDK patch is reversible and rejects altered original or cleanup code', async () => {
  const source = await readFile('node_modules/@earendil-works/pi-coding-agent/dist/core/tools/bash.js', 'utf8');
  assert.match(source, /Piora #243/);
  assert.doesNotMatch(originalBashSource(source), /Piora #243/);
  assert.throws(() => originalBashSource(source.replace('const MAX_TIMEOUT_MS', 'const ALTERED_TIMEOUT_MS')), /Unexpected Pi Bash source/);
  assert.throws(() => originalBashSource(source.replace("'ps.exe'", "'bad.exe'")), /Unexpected Piora Bash cleanup helper/);
});

for (const mode of ['abort', 'timeout', 'nested-pipeline', 'exec', 'exec-nested']) {
  test(`Windows Bash ${mode} stops actual descendants without killing unrelated sleep`, { skip: !windows, timeout: 15000 }, async t => {
    // This process is outside the command's MSYS ancestry and must survive.
    const unrelated = spawn(shellPath.replace(/bin[\\/]bash.exe$/i, 'usr/bin/sleep.exe'), ['30'], { windowsHide: true, stdio: 'ignore' });
    t.after(() => { if (unrelated.pid && alive(unrelated.pid)) unrelated.kill(); });
    await new Promise((resolve, reject) => { unrelated.once('spawn', resolve); unrelated.once('error', reject); });
    const controller = new AbortController();
    let output = '';
    let ready;
    const started = new Promise(resolve => { ready = resolve; });
    const pids = [];
    t.after(() => { for (const pid of pids) if (alive(pid)) process.kill(pid); });
    const body = 'sleep 30 & sleeper=$!; printf "CHILD="; /usr/bin/cat /proc/$sleeper/winpid; printf "\\n"; wait; echo COMPLETED';
    const command = mode === 'exec' ? 'echo MSYS=$$; printf "CHILD="; /usr/bin/cat /proc/$$/winpid; printf "\\n"; exec sleep 30' : mode === 'nested-pipeline' ? `bash -c '${body}' | cat` : mode === 'exec-nested' ? `exec bash -c '${body}'` : body;
    const execution = createLocalBashOperations({ shellPath }).exec(command, process.cwd(), {
      signal: controller.signal, timeout: mode === 'timeout' ? 2 : 10,
      onData: data => {
        output += data.toString();
        const match = output.match(/CHILD=(\d+)\r?\n/);
        if (match && !pids.length) { pids.push(Number(match[1])); ready(); }
      },
    });
    const rejection = assert.rejects(execution, mode === 'timeout' ? /timeout:2/ : /aborted/);
    await Promise.race([started, delay(5000).then(() => { throw new Error('Sleep PID was not reported'); })]);
    if (mode === 'exec') {
      // MSYS exec preserves its POSIX PID but replaces its Windows PID.
      await delay(150);
      const msysPid = Number(output.match(/MSYS=(\d+)/)[1]);
      const result = await promisify(execFile)(shellPath, ['-c', `cat /proc/${msysPid}/winpid`], { windowsHide: true });
      pids.splice(0, pids.length, Number(result.stdout.trim()));
    }
    assert.ok(alive(pids[0]));
    const cancellingAt = Date.now();
    if (mode !== 'timeout') controller.abort();
    await rejection;
    assert.ok(Date.now() - cancellingAt < 3000, 'Cancellation must finish promptly');
    assert.equal(alive(pids[0]), false, 'Descendant must be gone when execution settles');
    assert.ok(alive(unrelated.pid), 'Unrelated sleep must remain alive');
    assert.doesNotMatch(output, /COMPLETED/);
  });
}

test('Windows Bash preserves ordinary output and exit status; pre-aborted work never starts', { skip: !windows }, async () => {
  const operations = createLocalBashOperations({ shellPath });
  let output = '';
  assert.deepEqual(await operations.exec('printf hello; exit 7', process.cwd(), { onData: data => { output += data; } }), { exitCode: 7 });
  assert.equal(output, 'hello');
  await assert.rejects(operations.exec('echo SHOULD_NOT_RUN', process.cwd(), { signal: AbortSignal.abort(), onData: () => assert.fail() }), /aborted/);
});

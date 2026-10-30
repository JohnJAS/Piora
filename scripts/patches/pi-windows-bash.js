// Piora #243: Windows ancestry loses MSYS fork/exec descendants. Use the
// selected shell's own process table, never a global process-name kill.
import { existsSync as pioraExists } from 'node:fs';
import { mkdtemp as pioraMkdtemp, readFile as pioraRead, rm as pioraRm } from 'node:fs/promises';
import { tmpdir as pioraTmpdir } from 'node:os';
import { dirname as pioraDirname, join as pioraJoin } from 'node:path';
import { execFile as pioraExecFile } from 'node:child_process';
import { promisify as pioraPromisify } from 'node:util';
import { setTimeout as pioraDelay } from 'node:timers/promises';
const pioraExec = pioraPromisify(pioraExecFile);

export async function pioraPrepareBashCancellation(shellName, config, command, killNative) {
    if (process.platform !== 'win32' || shellName !== 'bash' || config.commandTransport === 'stdin') return;
    const directory = [pioraDirname(config.shell), pioraJoin(pioraDirname(config.shell), '../usr/bin')]
        .find(dir => pioraExists(pioraJoin(dir, 'ps.exe')) &&
            (pioraExists(pioraJoin(dir, 'msys-2.0.dll')) || pioraExists(pioraJoin(dir, 'cygwin1.dll'))));
    if (!directory) return; // WSL and other shells retain their native backend.
    const temporary = await pioraMkdtemp(pioraJoin(pioraTmpdir(), 'piora-bash-'));
    const marker = pioraJoin(temporary, 'pid');
    const quoted = "'" + marker.replaceAll('\\', '/').replaceAll("'", "'\\''") + "'";
    return {
        command: `printf '%s ' "$$" > ${quoted}; /usr/bin/cat /proc/$$/winpid >> ${quoted}\n${command}`,
        dispose: () => pioraRm(temporary, { recursive: true, force: true }),
        async kill(childPid) {
            try {
                // Cancel may arrive while Bash is still creating the marker.
                // Wait briefly so a fast-starting descendant cannot escape the
                // native-only fallback. No user command runs before this marker.
                let identity = [];
                for (let attempt = 0; attempt < 11; attempt++) {
                    const contents = await pioraRead(marker, 'utf8').catch(error => {
                        if (error.code === 'ENOENT') return '';
                        throw error;
                    });
                    identity = contents.trim().split(/\s+/).map(Number);
                    if (identity.length === 2 && identity.every(pid => Number.isInteger(pid) && pid > 0)) break;
                    await pioraDelay(10);
                }
                // The launcher must still belong to this active invocation.
                process.kill(childPid, 0);
                const { stdout } = await pioraExec(pioraJoin(directory, 'ps.exe'), ['-e'], {
                    encoding: 'utf8', windowsHide: true, timeout: 1000, maxBuffer: 4 * 1024 * 1024,
                });
                const rows = stdout.split(/\r?\n/).map(line => line.trim().replace(/^I\s+/, '').split(/\s+/))
                    .filter(fields => fields.length >= 4 && fields.slice(0, 4).every(value => /^\d+$/.test(value)))
                    .map(fields => ({ pid: Number(fields[0]), parent: Number(fields[1]), winpid: Number(fields[3]) }));
                // MSYS exec replaces WINPID while preserving the POSIX PID. The
                // private marker and live launcher bind that identity to our run.
                const root = identity.length === 2 && rows.find(row => row.pid === identity[0]);
                if (root) {
                    const descendants = new Set([root.pid]);
                    for (let size = -1; size !== descendants.size;) {
                        size = descendants.size;
                        for (const row of rows) if (descendants.has(row.parent)) descendants.add(row.pid);
                    }
                    const pids = [...new Set(rows.filter(row => descendants.has(row.pid)).map(row => row.winpid))];
                    // Include the Git bin/bash.exe launcher as well as every MSYS
                    // descendant. /T also covers native children of these processes.
                    pids.push(childPid);
                    await pioraExec(pioraJoin(process.env.SystemRoot || 'C:\\Windows', 'System32/taskkill.exe'),
                        ['/F', '/T', ...[...new Set(pids)].flatMap(pid => ['/PID', String(pid)])],
                        { windowsHide: true, timeout: 2000 }).catch(error => {
                            // taskkill reports failure for PIDs already removed by /T.
                            if (error.killed || error.code === 'ENOENT') throw error;
                        });
                }
            } catch (error) {
                // Immediate cancellation can precede the marker. Always terminate
                // the launcher in finally, even when process-table discovery fails.
                if (error.code !== 'ENOENT') console.warn('Piora Bash descendant cleanup:', error.message);
            } finally {
                killNative(childPid);
            }
        },
    };
}

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runDesktopScenario } from './desktop-e2e/harness.mjs';
import { settingsTheme } from './desktop-e2e/scenarios/settings-theme.mjs';

export function parseOptions(args) {
  const options = { scenario: 'settings-theme' };
  const names = { '--scenario': 'scenario', '--timeout-ms': 'timeoutMs', '--step-timeout-ms': 'stepTimeoutMs',
    '--port': 'port', '--debug-port': 'debugPort', '--fail-at': 'failAt' };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--help' || arg === '--list') { options[arg.slice(2)] = true; continue; }
    if (!names[arg] || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Invalid option: ${arg}`);
    const value = args[++index], key = names[arg];
    if (['port', 'debugPort', 'timeoutMs', 'stepTimeoutMs'].includes(key)) {
      const number = Number(value), isPort = key.endsWith('Port') || key === 'port';
      if (!Number.isInteger(number) || number < (isPort ? 1024 : 1) || number > (isPort ? 65535 : 3_600_000)) throw new Error(`Invalid ${arg}: ${value}`);
      options[key] = number;
    } else options[key] = value;
  }
  if (options.port && options.port === options.debugPort) throw new Error('Application and CDP ports must differ');
  if (options.scenario !== settingsTheme.id) throw new Error(`Unknown scenario: ${options.scenario}`);
  return options;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help || options.list) {
    console.log('Usage: npm run test:desktop:e2e -- [--scenario settings-theme] [--timeout-ms 600000] [--step-timeout-ms 30000] [--port N] [--debug-port N] [--fail-at STEP]\nScenario: settings-theme (real desktop; no model credentials)');
    return;
  }
  const controller = new AbortController();
  const stop = () => controller.abort(new Error('Desktop test interrupted'));
  for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(name, stop);
  try {
    const result = await runDesktopScenario({ ...options, root: resolve(import.meta.dirname, '..'), scenario: settingsTheme, signal: controller.signal });
    console.log(JSON.stringify({ status: result.report.status, directory: result.directory, failedStep: result.report.failedStep }));
    process.exitCode = result.report.status === 'passed' ? 0 : result.report.status === 'cancelled' ? 130 : 1;
  } finally {
    for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.removeListener(name, stop);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

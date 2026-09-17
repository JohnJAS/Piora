import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { load } from "js-yaml";
import { extractFile } from "@electron/asar";
import { compare } from "semver";
import { UUID } from "builder-util-runtime";
import { createIsolatedProcessEnvironment, prepareIsolatedEnvironment } from "./isolated-process-env.mjs";
import { getPackagedRuntimeStartupBudget, smokeTestPortableExecutable } from "./smoke-test-portable.mjs";

const execFileAsync = promisify(execFile);
export const EXPECTED_INSTALLER_GUID = UUID.v5("io.github.kexijiang.piora", UUID.parse("50e065bc-3134-11e6-9bab-38c9862bdaf3"));

export function validateInstallerRegistration(records, directory, version, displayName) {
  if (!Array.isArray(records) || records.length === 0) throw new Error("Shared AppId installer registration is missing");
  for (const record of records) {
    if (typeof record.installLocation !== "string" || resolve(record.installLocation).toLowerCase() !== resolve(directory).toLowerCase()
      || record.version !== version || record.displayName !== displayName) throw new Error("Installer registration changed identity, path, name or version");
  }
  return records;
}

async function readInstallerRegistration(directory, version, displayName) {
  const script = `
    $records = @()
    foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
      $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
      $install = $base.OpenSubKey("Software\\$env:PIORA_TEST_INSTALL_GUID")
      $uninstall = $base.OpenSubKey("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\$env:PIORA_TEST_INSTALL_GUID")
      try {
        if ($install -and $uninstall) {
          $records += @{ view = $view.ToString(); installLocation = $install.GetValue('InstallLocation'); version = $uninstall.GetValue('DisplayVersion'); displayName = $uninstall.GetValue('DisplayName') }
        }
      } finally {
        if ($install) { $install.Dispose() }; if ($uninstall) { $uninstall.Dispose() }; $base.Dispose()
      }
    }
    ConvertTo-Json -InputObject @($records) -Compress
  `;
  const result = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    env: { ...process.env, PIORA_TEST_INSTALL_GUID: EXPECTED_INSTALLER_GUID }, windowsHide: true, timeout: 30_000,
  });
  return validateInstallerRegistration(JSON.parse(result.stdout.trim()), directory, version, displayName);
}
export function installerVersion(path) {
  const match = /^XiaoYiHarness-(\d+\.\d+\.\d+(?:-beta\.\d+)?)-win-x64-setup\.exe$/.exec(basename(path));
  if (!match) throw new Error("Upgrade verification requires canonical XiaoYiHarness NSIS installers");
  return match[1];
}

export async function verifyInstalledBrand(directory, version) {
  const resources = resolve(directory, "resources");
  const brand = JSON.parse(await readFile(resolve(resources, "brand.json"), "utf8"));
  if (brand.id !== "xiaoyi-harness" || brand.artifactPrefix !== "XiaoYiHarness") throw new Error("Installed brand is not XiaoYiHarness");
  const config = load(await readFile(resolve(resources, "app-update-xiaoyi.yml"), "utf8"));
  const channel = version.includes("-beta.") ? "xiaoyi-beta" : "xiaoyi-latest";
  if (config.provider !== "github" || config.owner !== "kexijiang" || config.repo !== "Piora"
    || config.channel !== channel || config.updaterCacheDirName !== "xiaoyi-harness-updater") throw new Error("Installed updater config is not isolated");
  const manifest = JSON.parse(extractFile(resolve(resources, "app.asar"), "package.json").toString("utf8"));
  if (manifest.version !== version || manifest.productName !== brand.displayName) throw new Error("Installed package name/version mismatch");
  return { brand, channel, version };
}

export async function verifyBrandInstallUpgrade(previousInstaller, nextInstaller) {
  // Silent installers modify HKCU registration. This gate is intentionally only
  // executable on a disposable hosted Windows Actions runner, never a developer PC.
  if (process.platform !== "win32" || process.env.GITHUB_ACTIONS !== "true" || process.env.RUNNER_ENVIRONMENT !== "github-hosted") {
    throw new Error("Actual installation upgrade verification requires a GitHub-hosted Windows Actions runner");
  }
  const previous = resolve(previousInstaller);
  const next = resolve(nextInstaller);
  const beforeVersion = installerVersion(previous);
  const afterVersion = installerVersion(next);
  if (compare(afterVersion, beforeVersion) <= 0) throw new Error("Upgrade target must be a newer version");
  const root = await mkdtemp(resolve(tmpdir(), "piora-brand-upgrade-"));
  const profileRoot = resolve(root, "profile");
  const installed = resolve(root, "installed");
  await mkdir(profileRoot);
  const paths = await prepareIsolatedEnvironment(profileRoot);
  const sessionId = randomUUID();
  const timestamp = new Date().toISOString();
  const preserved = new Map([
    [resolve(profileRoot, "agent/settings.json"), JSON.stringify({ theme: "dark", thinkingLevel: "medium" })],
    [resolve(profileRoot, `agent/sessions/upgrade-fixture/${sessionId}.jsonl`), JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp, cwd: paths.home }) + "\n"
      + JSON.stringify({ type: "message", id: "1234abcd", parentId: null, timestamp, message: { role: "user", content: [{ type: "text", text: "保留升级前会话" }], timestamp: Date.now() } }) + "\n"],
    [resolve(paths.userData, "brand-upgrade-sentinel.txt"), randomUUID()],
  ]);
  const observations = [];
  try {
    for (const [installer, version] of [[previous, beforeVersion], [next, afterVersion]]) {
      await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        '$p = Start-Process -FilePath $env:PIORA_TEST_INSTALLER -ArgumentList @(\'/S\', "/D=$env:PIORA_TEST_INSTALL_DIR") -WindowStyle Hidden -Wait -PassThru; if ($p.ExitCode -ne 0) { throw "NSIS failed: $($p.ExitCode)" }'], {
        env: createIsolatedProcessEnvironment(profileRoot, { PIORA_TEST_INSTALLER: installer, PIORA_TEST_INSTALL_DIR: installed }),
        windowsHide: true, timeout: 600_000,
      });
      const packageState = await verifyInstalledBrand(installed, version);
      const registration = await readInstallerRegistration(installed, version, packageState.brand.displayName);
      if (version === beforeVersion) {
        for (const [file, bytes] of preserved) {
          await mkdir(dirname(file), { recursive: true });
          await writeFile(file, bytes, { flag: "wx" });
        }
      }
      const runtime = await smokeTestPortableExecutable(resolve(installed, "Piora.exe"), {
        expectedVersion: version, expectedBrand: "xiaoyi-harness", profileRoot,
        expectedSession: { id: sessionId, text: "保留升级前会话" },
        verifySingleInstance: true,
        preparePortableCache: false, startupBudgetMs: getPackagedRuntimeStartupBudget(),
      });
      for (const [file, bytes] of preserved) {
        if (await readFile(file, "utf8") !== bytes) throw new Error(`Upgrade changed preserved data: ${basename(file)}`);
      }
      observations.push({ packageState, registration, installerGuid: EXPECTED_INSTALLER_GUID, runtime });
    }
    return { beforeVersion, afterVersion, sessionId, preservedFiles: preserved.size, observations };
  } finally {
    // root was created here with mkdtemp, not supplied by the caller.
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [previous, next] = process.argv.slice(2);
  if (!previous || !next) throw new Error("Usage: verify-brand-install-upgrade.mjs <previous-setup.exe> <next-setup.exe>");
  console.log(JSON.stringify(await verifyBrandInstallUpgrade(previous, next), null, 2));
}

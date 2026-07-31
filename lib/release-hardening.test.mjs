import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  createIsolatedProcessEnvironment,
  getIsolatedEnvironmentPaths,
} from "../scripts/isolated-process-env.mjs";
import { verifyReleaseMetadata } from "../scripts/verify-release-metadata.mjs";
import {
  findPortableExecutable,
  normalizeExpectedVersion,
  validatePortableSmokeMarker,
} from "../scripts/smoke-test-portable.mjs";
import { findSymbolicLinks } from "../scripts/stage-standalone.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

test("release metadata requires an exact tag, matching package versions, and changelog heading", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pigui-release-metadata-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "desktop"), { recursive: true });
  await Promise.all([
    writeFile(join(root, "package.json"), '{"version":"1.2.3"}\n', "utf8"),
    writeFile(join(root, "desktop", "package.json"), '{"version":"1.2.3"}\n', "utf8"),
    writeFile(
      join(root, "package-lock.json"),
      '{"version":"1.2.3","packages":{"":{"version":"1.2.3"},"desktop":{"version":"1.2.3"}}}\n',
      "utf8",
    ),
    writeFile(join(root, "CHANGELOG.md"), "# Changelog\n\n## [1.2.3] - 2026-08-01\n", "utf8"),
  ]);

  assert.deepEqual(
    await verifyReleaseMetadata({ projectRoot: root, tagName: "v1.2.3" }),
    {
      tagName: "v1.2.3",
      version: "1.2.3",
      rootVersion: "1.2.3",
      desktopVersion: "1.2.3",
      commit: null,
    },
  );
  await assert.rejects(
    verifyReleaseMetadata({ projectRoot: root, tagName: "v1.2.3-beta.1" }),
    /exactly match vX\.Y\.Z/,
  );
  await writeFile(join(root, "desktop", "package.json"), '{"version":"1.2.4"}\n', "utf8");
  await assert.rejects(
    verifyReleaseMetadata({ projectRoot: root, tagName: "v1.2.3" }),
    /must match both package versions/,
  );
  await writeFile(join(root, "desktop", "package.json"), '{"version":"1.2.3"}\n', "utf8");
  await writeFile(
    join(root, "package-lock.json"),
    '{"version":"1.2.3","packages":{"":{"version":"1.2.3"},"desktop":{"version":"1.2.4"}}}\n',
    "utf8",
  );
  await assert.rejects(
    verifyReleaseMetadata({ projectRoot: root, tagName: "v1.2.3" }),
    /must match package-lock versions/,
  );
});

test("release metadata requires the checked-out tag commit to belong to origin/main", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pigui-release-git-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "desktop"), { recursive: true });
  await Promise.all([
    writeFile(join(root, "package.json"), '{"version":"2.0.0"}\n', "utf8"),
    writeFile(join(root, "desktop", "package.json"), '{"version":"2.0.0"}\n', "utf8"),
    writeFile(
      join(root, "package-lock.json"),
      '{"version":"2.0.0","packages":{"":{"version":"2.0.0"},"desktop":{"version":"2.0.0"}}}\n',
      "utf8",
    ),
    writeFile(join(root, "CHANGELOG.md"), "# Changelog\n\n## [2.0.0]\n", "utf8"),
  ]);
  const git = (...arguments_) => {
    const result = spawnSync("git", arguments_, { cwd: root, encoding: "utf8", shell: false });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  };
  git("init", "--initial-branch=main");
  git("-c", "user.name=piGUI tests", "-c", "user.email=tests@example.invalid", "add", ".");
  git(
    "-c",
    "user.name=piGUI tests",
    "-c",
    "user.email=tests@example.invalid",
    "commit",
    "-m",
    "release",
  );
  git("tag", "v2.0.0");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  await verifyReleaseMetadata({ projectRoot: root, tagName: "v2.0.0", requireOriginMain: true });

  await writeFile(join(root, "after-main.txt"), "not on origin/main\n", "utf8");
  git("add", "after-main.txt");
  git(
    "-c",
    "user.name=piGUI tests",
    "-c",
    "user.email=tests@example.invalid",
    "commit",
    "-m",
    "not on main",
  );
  git("tag", "--force", "v2.0.0");
  await assert.rejects(
    verifyReleaseMetadata({ projectRoot: root, tagName: "v2.0.0", requireOriginMain: true }),
    /does not point to a commit contained in origin\/main/,
  );
});

test("isolated verification environment does not inherit credentials, proxies, Codex, or npm state", () => {
  const root = join(tmpdir(), "pigui-isolated-env-test");
  const environment = createIsolatedProcessEnvironment(
    root,
    { NODE_ENV: "production" },
    {
      Path: "C:\\Windows\\System32",
      SystemRoot: "C:\\Windows",
      SECRET_TOKEN: "do-not-copy",
      GH_TOKEN: "do-not-copy",
      HTTPS_PROXY: "http://secret-proxy.invalid",
      CODEX_HOME: "C:\\private-codex",
      NODE_OPTIONS: "--require C:\\private.js",
      NPM_CONFIG_USERCONFIG: "C:\\private.npmrc",
    },
  );
  const paths = getIsolatedEnvironmentPaths(root);

  assert.equal(environment.PATH, "C:\\Windows\\System32");
  assert.equal(environment.SystemRoot, "C:\\Windows");
  assert.equal(environment.NODE_ENV, "production");
  assert.equal(environment.HOME, paths.home);
  assert.equal(environment.APPDATA, paths.appData);
  assert.equal(environment.NPM_CONFIG_USERCONFIG, paths.npmUserConfig);
  for (const forbidden of [
    "SECRET_TOKEN",
    "GH_TOKEN",
    "HTTPS_PROXY",
    "CODEX_HOME",
    "NODE_OPTIONS",
  ]) {
    assert.equal(environment[forbidden], undefined, `${forbidden} must not be inherited`);
  }
});

test("standalone staging detects symbolic links in public assets", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pigui-public-symlink-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, "target.txt");
  const linked = join(root, "linked.txt");
  await writeFile(target, "safe target\n", "utf8");
  try {
    await symlink(target, linked, "file");
  } catch (error) {
    if (error?.code === "EPERM" || error?.code === "EACCES") {
      t.skip("Creating symbolic links is not permitted for this Windows account");
      return;
    }
    throw error;
  }
  assert.deepEqual(await findSymbolicLinks(root), [linked]);
});

test("portable smoke-test selector accepts exactly one named portable executable", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pigui-portable-selector-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executable = join(root, "piGUI-0.1.0-win-x64-portable.exe");
  await writeFile(executable, "fixture", "utf8");
  assert.equal(await findPortableExecutable(root), executable);
  await writeFile(join(root, "piGUI-0.1.1-win-x64-portable.exe"), "fixture", "utf8");
  await assert.rejects(findPortableExecutable(root), /Expected exactly one portable EXE/);
});

test("portable smoke marker requires the expected version and a ready renderer shell", () => {
  const validMarker = JSON.stringify({
    schema: "pigui-portable-smoke-v1",
    ok: true,
    appVersion: "0.1.0",
    rendererLoaded: true,
    preloadBridgeReady: true,
    appShellReady: true,
  });
  assert.equal(normalizeExpectedVersion("v0.1.0"), "0.1.0");
  assert.equal(validatePortableSmokeMarker(validMarker, "v0.1.0").appVersion, "0.1.0");
  assert.throws(
    () => validatePortableSmokeMarker(validMarker, "0.1.1"),
    /does not match expected version/,
  );
  assert.throws(
    () => validatePortableSmokeMarker(JSON.stringify({
      ...JSON.parse(validMarker),
      preloadBridgeReady: false,
    }), "0.1.0"),
    /invalid smoke-test marker/,
  );
  assert.throws(() => normalizeExpectedVersion("0.1"), /must match X\.Y\.Z/);
});

test("release workflows use immutable actions and gate the packaged runtime before draft publication", async () => {
  const [
    releaseWorkflow,
    ciWorkflow,
    rootPackage,
    desktopPackage,
    desktopMain,
    packagedVerifier,
    serviceWorker,
  ] = await Promise.all([
    readFile(join(repositoryRoot, ".github", "workflows", "release.yml"), "utf8"),
    readFile(join(repositoryRoot, ".github", "workflows", "ci.yml"), "utf8"),
    readFile(join(repositoryRoot, "package.json"), "utf8").then(JSON.parse),
    readFile(join(repositoryRoot, "desktop", "package.json"), "utf8").then(JSON.parse),
    readFile(join(repositoryRoot, "desktop", "src", "main.ts"), "utf8"),
    readFile(join(repositoryRoot, "scripts", "verify-packaged-web.mjs"), "utf8"),
    readFile(join(repositoryRoot, "public", "sw.js"), "utf8"),
  ]);

  for (const workflow of [releaseWorkflow, ciWorkflow]) {
    const actionReferences = [...workflow.matchAll(/^\s*uses:\s*[^\s@]+@([^\s#]+)/gm)];
    assert.ok(actionReferences.length > 0);
    for (const reference of actionReferences) assert.match(reference[1], /^[0-9a-f]{40}$/);
  }

  assert.match(releaseWorkflow, /windows-build:[\s\S]*?permissions:\s*\n\s+contents: read/);
  assert.match(releaseWorkflow, /source-gate:[\s\S]*?runs-on: ubuntu-latest/);
  assert.match(releaseWorkflow, /windows-build:[\s\S]*?needs: source-gate/);
  assert.match(releaseWorkflow, /fetch-depth: 0/);
  assert.match(releaseWorkflow, /persist-credentials: false/);
  assert.match(releaseWorkflow, /--require-origin-main/);
  assert.match(releaseWorkflow, /smoke:portable/);
  assert.match(releaseWorkflow, /--expected-version/);
  const windowsBuildJob = releaseWorkflow.slice(
    releaseWorkflow.indexOf("  windows-build:"),
    releaseWorkflow.indexOf("  publish-draft:"),
  );
  for (const command of [
    "npm run licenses:check",
    "npm run lint",
    "npm run typecheck",
    "npm test",
    "npm run verify:backgrounds",
  ]) {
    const escapedCommand = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      windowsBuildJob,
      new RegExp(`- name: [^\\n]+\\n\\s+run: ${escapedCommand}(?:\\r?\\n|$)`),
      `${command} must be a separate fail-fast Windows workflow step`,
    );
  }
  assert.match(releaseWorkflow, /publish-draft:[\s\S]*?permissions:\s*\n\s+contents: write/);
  const publishJob = releaseWorkflow.slice(releaseWorkflow.indexOf("  publish-draft:"));
  assert.doesNotMatch(publishJob, /actions\/checkout|npm (?:ci|install|run)/);
  assert.match(publishJob, /--prerelease/);
  assert.match(publishJob, /--draft/);
  assert.match(ciWorkflow, /persist-credentials: false/);

  assert.equal(rootPackage.author.name, "piGUI contributors");
  assert.equal(desktopPackage.author.name, "piGUI contributors");
  assert.equal(rootPackage.publisher, "piGUI");
  assert.equal(desktopPackage.publisher, "piGUI");
  assert.equal(desktopPackage.productName, "piGUI");
  assert.equal(rootPackage.version, desktopPackage.version);
  assert.match(desktopPackage.scripts.pack, /--publish never$/);
  assert.match(desktopPackage.scripts.dist, /--publish never$/);
  assert.match(desktopMain, /setAppUserModelId\("io\.github\.kexijiang\.pigui"\)/);
  assert.match(desktopMain, /pigui-portable-smoke-v1/);
  assert.match(packagedVerifier, /electronShell\.executablePath \?\? process\.execPath/);
  assert.match(packagedVerifier, /ELECTRON_RUN_AS_NODE: "1"/);
  assert.match(serviceWorker, /CACHE_PREFIX = "pigui"/);
});

test("release lockfile uses the official npm registry with integrity-pinned artifacts", async () => {
  const lock = JSON.parse(await readFile(join(repositoryRoot, "package-lock.json"), "utf8"));
  const packages = Object.entries(lock.packages ?? {});
  assert.ok(packages.length > 1_000, "the release lockfile must contain the complete dependency graph");

  const integrityProtectedByShrinkwrapParent = (installPath) => {
    const segments = installPath.split("/node_modules/");
    for (let index = segments.length - 1; index > 0; index -= 1) {
      const parentPath = segments.slice(0, index).join("/node_modules/");
      const parent = lock.packages[parentPath];
      if (parent?.hasShrinkwrap === true) {
        return /^https:\/\/registry\.npmjs\.org\//.test(parent.resolved ?? "")
          && /^sha512-/.test(parent.integrity ?? "");
      }
    }
    return false;
  };

  for (const [installPath, metadata] of packages) {
    if (typeof metadata.resolved !== "string" || !metadata.resolved.startsWith("https://")) continue;
    assert.match(
      metadata.resolved,
      /^https:\/\/registry\.npmjs\.org\//,
      `${installPath} must not depend on an alternate registry`,
    );
    assert.ok(
      /^sha512-/.test(metadata.integrity ?? "") || integrityProtectedByShrinkwrapParent(installPath),
      `${installPath} must be integrity-pinned directly or by its shrinkwrapped parent artifact`,
    );
  }

  assert.equal(lock.packages["node_modules/postcss"]?.version, "8.5.25");
  assert.equal(lock.packages["node_modules/mermaid"]?.version, "11.16.0");
  assert.equal(lock.packages["node_modules/dompurify"]?.version, "3.4.12");
  assert.notEqual(lock.packages["node_modules/mermaid"]?.dev, true);
});

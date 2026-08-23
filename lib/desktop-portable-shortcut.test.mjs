import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  comparePortableVersions,
  ensurePortableDesktopShortcut,
  parseDesktopVersion,
  portableVersionFromPath,
} = await jiti.import("../desktop/src/portable-shortcut.ts");
const desktopMain = readFileSync(new URL("../desktop/src/main.ts", import.meta.url), "utf8");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "piora-shortcut-test-"));
  const desktopDirectory = join(root, "Desktop");
  const iconPath = join(root, "tray-icon.ico");
  mkdirSync(desktopDirectory);
  writeFileSync(iconPath, "icon");
  const links = new Map();
  const shell = {
    readShortcutLink(path) {
      const details = links.get(path);
      if (!details) throw new Error("missing shortcut");
      return details;
    },
    writeShortcutLink(path, operation, details) {
      links.set(path, { ...details, operation });
      writeFileSync(path, "shortcut");
      return true;
    },
  };
  return {
    root,
    desktopDirectory,
    iconPath,
    links,
    shell,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function options(state, version, executable) {
  return {
    platform: "win32",
    isPackaged: true,
    isSmokeTest: false,
    appVersion: version,
    portableExecutablePath: executable,
    packagedExecutablePath: executable,
    desktopDirectory: state.desktopDirectory,
    iconPath: state.iconPath,
    description: "Piora latest",
    shell: state.shell,
  };
}

test("portable versions are derived only from canonical Windows release artifacts", () => {
  assert.deepEqual(portableVersionFromPath("C:\\Apps\\Piora-0.3.2-win-x64-portable.exe"), [0n, 3n, 2n]);
  assert.equal(portableVersionFromPath("C:\\Apps\\renamed.exe"), undefined);
  assert.deepEqual(parseDesktopVersion("12.34.56"), [12n, 34n, 56n]);
  assert.equal(parseDesktopVersion("12.34"), undefined);
  assert.equal(comparePortableVersions([0n, 4n, 0n], [0n, 3n, 99n]), 1);
  assert.equal(comparePortableVersions([0n, 3n, 2n], [0n, 3n, 2n]), 0);
});

test("a portable launch creates the desktop shortcut with the packaged icon", (t) => {
  const state = fixture();
  t.after(state.cleanup);
  const executable = join(state.root, "Piora-0.3.2-win-x64-portable.exe");
  writeFileSync(executable, "portable");

  const result = ensurePortableDesktopShortcut(options(state, "0.3.2", executable));
  assert.equal(result.status, "created");
  const shortcut = state.links.get(join(state.desktopDirectory, "Piora.lnk"));
  assert.equal(shortcut.target, executable);
  assert.equal(shortcut.icon, state.iconPath);
  assert.equal(shortcut.appUserModelId, "io.github.kexijiang.piora");
  assert.match(shortcut.description, /^Piora 0\.3\.2 — /);
});

test("ZIP-extracted Piora.exe releases use shortcut metadata for latest-version selection", (t) => {
  const state = fixture();
  t.after(state.cleanup);
  const olderDirectory = join(state.root, "0.3.1");
  const newerDirectory = join(state.root, "0.3.2");
  mkdirSync(olderDirectory);
  mkdirSync(newerDirectory);
  const older = join(olderDirectory, "Piora.exe");
  const newer = join(newerDirectory, "Piora.exe");
  writeFileSync(older, "older");
  writeFileSync(newer, "newer");
  const unpackedOptions = (version, executable) => {
    const result = options(state, version, executable);
    delete result.portableExecutablePath;
    return result;
  };

  assert.equal(ensurePortableDesktopShortcut(unpackedOptions("0.3.1", older)).status, "created");
  assert.equal(ensurePortableDesktopShortcut(unpackedOptions("0.3.2", newer)).status, "updated");
  const downgrade = ensurePortableDesktopShortcut(unpackedOptions("0.3.1", older));
  assert.equal(downgrade.status, "kept-newer");
  assert.equal(downgrade.target, newer);
});

test("new launches advance the shortcut and older launches cannot downgrade it", (t) => {
  const state = fixture();
  t.after(state.cleanup);
  const older = join(state.root, "Piora-0.3.1-win-x64-portable.exe");
  const newer = join(state.root, "Piora-0.3.2-win-x64-portable.exe");
  writeFileSync(older, "older");
  writeFileSync(newer, "newer");

  assert.equal(ensurePortableDesktopShortcut(options(state, "0.3.1", older)).status, "created");
  assert.equal(ensurePortableDesktopShortcut(options(state, "0.3.2", newer)).status, "updated");
  const downgrade = ensurePortableDesktopShortcut(options(state, "0.3.1", older));
  assert.equal(downgrade.status, "kept-newer");
  assert.equal(downgrade.target, newer);
});

test("a missing latest target is repaired to the current available portable", (t) => {
  const state = fixture();
  t.after(state.cleanup);
  const older = join(state.root, "Piora-0.3.1-win-x64-portable.exe");
  const newer = join(state.root, "Piora-0.3.2-win-x64-portable.exe");
  writeFileSync(older, "older");
  writeFileSync(newer, "newer");
  ensurePortableDesktopShortcut(options(state, "0.3.2", newer));
  unlinkSync(newer);

  const repaired = ensurePortableDesktopShortcut(options(state, "0.3.1", older));
  assert.equal(repaired.status, "updated");
  assert.equal(state.links.get(join(state.desktopDirectory, "Piora.lnk")).target, older);
});

test("development, smoke tests, renamed files, and mismatched versions never touch Desktop", (t) => {
  const state = fixture();
  t.after(state.cleanup);
  const renamed = join(state.root, "Piora.exe");
  writeFileSync(renamed, "portable");

  assert.equal(ensurePortableDesktopShortcut({ ...options(state, "0.3.2", renamed), isPackaged: false }).status, "skipped");
  assert.equal(ensurePortableDesktopShortcut({ ...options(state, "0.3.2", renamed), isSmokeTest: true }).status, "skipped");
  assert.equal(ensurePortableDesktopShortcut(options(state, "0.3.2", renamed)).status, "skipped");
  const canonical = join(state.root, "Piora-0.3.1-win-x64-portable.exe");
  writeFileSync(canonical, "portable");
  assert.equal(ensurePortableDesktopShortcut(options(state, "0.3.2", canonical)).status, "skipped");
  assert.equal(state.links.size, 0);
});

test("a newer portable opened beside a running tray instance still advances the shortcut", () => {
  assert.match(
    desktopMain,
    /if \(!hasSingleInstanceLock\) \{[\s\S]*?app\.whenReady\(\)[\s\S]*?installPortableDesktopShortcut\(secondaryLogger\)[\s\S]*?app\.quit\(\)/,
  );
  assert.match(
    desktopMain,
    /logger\.info\("Starting Piora"[\s\S]*?installPortableDesktopShortcut\(logger\)/,
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { withSymbolicMenuShortcuts } = await jiti.import("../desktop/src/menu-shortcuts.ts");

test("Windows punctuation hints preserve clicks and native accelerator registration", () => {
  let clicks = 0;
  const item = { id: "settings", label: "Settings", accelerator: "CmdOrCtrl+,", click: () => clicks++ };
  const [menu] = withSymbolicMenuShortcuts([{ label: "Edit", submenu: [item] }], "win32");
  const [visible, binding] = menu.submenu;
  assert.equal(visible.label, "Settings (Ctrl+,)");
  assert.equal(visible.id, "settings");
  assert.equal(visible.accelerator, undefined);
  assert.equal(binding.visible, false);
  assert.equal(binding.accelerator, "CmdOrCtrl+,");
  assert.equal(binding.id, undefined);
  visible.click();
  binding.click();
  assert.equal(clicks, 2);
  assert.equal(item.label, "Settings");
});

test("custom punctuation shortcuts retain modifiers and disabled state", () => {
  for (const key of [",", ".", "/", ";", "'", "[", "]", "\\", "-", "=", "`"] ) {
    const [visible, binding] = withSymbolicMenuShortcuts([
      { label: "设置", accelerator: `CmdOrCtrl+Shift+${key}`, enabled: false },
    ], "win32");
    assert.equal(visible.label, `设置 (Ctrl+Shift+${key})`);
    assert.equal(visible.enabled, false);
    assert.equal(binding.enabled, false);
    assert.equal(binding.accelerator, `CmdOrCtrl+Shift+${key}`);
  }
});

test("other platforms, native roles, ordinary and unbound shortcuts stay unchanged", () => {
  const template = [
    { label: "Settings", accelerator: "CmdOrCtrl+," },
  ];
  for (const platform of ["darwin", "linux"]) assert.equal(withSymbolicMenuShortcuts(template, platform), template);
  const ordinary = [
    { label: "Settings" },
    { label: "New chat", accelerator: "CmdOrCtrl+Alt+N" },
    { role: "copy", label: "Copy" },
    { label: "Hidden", accelerator: "CmdOrCtrl+,", visible: false },
  ];
  assert.deepEqual(withSymbolicMenuShortcuts(ordinary, "win32"), ordinary);
});

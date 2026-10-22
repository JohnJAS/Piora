import assert from "node:assert/strict";
import test from "node:test";
import { glibSymbolMap, patchSharpElectronLinux } from "../scripts/patch-sharp-electron-linux.mjs";

test("GLib isolation maps only defined GLib symbols and reverses diagnostic fixtures", () => {
  const entries = [["g_object_ref", "T"], ["g_free", "T"], ["malloc", "U"], ["vips_image_new", "T"], ["g_missing", "U"]];
  assert.deepEqual(glibSymbolMap(entries), [["g_object_ref", "piora_g_object_ref"], ["g_free", "piora_g_free"]]);
  assert.deepEqual(glibSymbolMap([["piora_g_object_ref", "T"], ["g_free", "T"]], true), [["piora_g_object_ref", "g_object_ref"]]);
});

test("non-Linux installation never reads or changes native dependencies", async () => {
  if (process.platform !== "linux") assert.deepEqual(await patchSharpElectronLinux("nonexistent-root"), { patched: [] });
});

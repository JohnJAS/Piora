import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { buildWinAppArgs, parseWinAppResult, WinAppUiaRuntime, WINAPP_UIA_OPERATIONS, winAppPath } = await jiti.import("./winapp-uia.ts");

test("UIA operations expose only scoped, semantic CLI commands", () => {
  assert.deepEqual(Object.keys(WINAPP_UIA_OPERATIONS), [
    "uia_list_windows", "uia_inspect", "uia_find", "uia_invoke", "uia_set_value",
    "uia_get_value", "uia_get_property", "uia_wait_for", "uia_scroll",
  ]);
  assert.deepEqual(buildWinAppArgs("uia_invoke", { hwnd: "0x123", selector: "btn-save-1234", action: "invoke" }),
    ["ui", "invoke", "--json", "--window", "0x123", "--action", "invoke", "--", "btn-save-1234"]);
  assert.deepEqual(buildWinAppArgs("uia_inspect", { hwnd: 42 }), ["ui", "inspect", "--json", "--window", "42"]);
  assert.deepEqual(buildWinAppArgs("uia_set_value", { hwnd: "42", selector: "txt-name", value: "--unsafe ; $(calc)" }),
    ["ui", "set-value", "--json", "--window", "42", "--", "txt-name", "--unsafe ; $(calc)"]);
  assert.deepEqual(buildWinAppArgs("uia_set_value", { hwnd: "42", selector: "txt-name", value: "" }).at(-1), "");
  assert.deepEqual(buildWinAppArgs("uia_wait_for", { hwnd: 42, selector: "txt-name", value: "" }).slice(-4), ["--value", "", "--", "txt-name"]);
  assert.ok(!Object.keys(WINAPP_UIA_OPERATIONS).some((name) => /click|wheel|send.keys|shell/.test(name)));
});

test("UIA input rejects extra flags, unsafe targets and ambiguous scroll requests", () => {
  assert.throws(() => buildWinAppArgs("uia_list_windows", { hwnd: "1" }), /Unexpected/);
  assert.throws(() => buildWinAppArgs("uia_invoke", { hwnd: "1", selector: "Save", action: "click" }), /action must be/);
  assert.throws(() => buildWinAppArgs("uia_invoke", { hwnd: "1; calc", selector: "Save", action: "invoke" }), /hwnd/);
  assert.throws(() => buildWinAppArgs("uia_scroll", { hwnd: "1", selector: "List", direction: "down", to: "bottom" }), /exactly one/);
  assert.throws(() => buildWinAppArgs("uia_find", { hwnd: "1", query: "Save", shell: "cmd" }), /Unexpected/);
});

test("UIA JSON errors remain errors, and output stays bounded", () => {
  const ambiguous = parseWinAppResult('{"error":{"code":"ambiguous_selector"}}', "", 1);
  assert.equal(ambiguous.isError, true);
  assert.match(ambiguous.content[0].text, /ambiguous_selector/);
  const large = parseWinAppResult(JSON.stringify({ nodes: "x".repeat(20_000) }), "", 0);
  assert.ok(large.content[0].text.length < 13_000);
  assert.doesNotThrow(() => JSON.parse(large.content[0].text));
  assert.equal(large.details.truncated, true);
  const windows = parseWinAppResult(JSON.stringify(Array.from({ length: 100 }, (_, hwnd) => ({ hwnd, title: "长窗口标题".repeat(500) }))), "", 0);
  assert.ok(Array.isArray(JSON.parse(windows.content[0].text)));
  assert.ok(windows.content[0].text.length <= 12000);
  assert.throws(() => parseWinAppResult("not JSON", "", 0), /invalid JSON/);
});

test("a timed-out UIA child is stopped without replaying its command", async () => {
  const runtime = new WinAppUiaRuntime(process.execPath);
  await assert.rejects(() => runtime.execute(["-e", "setInterval(() => {}, 1000)"], 100), /timed out/);
  assert.equal(runtime.state().busy, false);
});

test("cancelling a UIA child stops the pending operation", async () => {
  const runtime = new WinAppUiaRuntime(process.execPath);
  const controller = new AbortController();
  const pending = runtime.execute(["-e", "setInterval(() => {}, 1000)"], 5_000, controller.signal);
  controller.abort();
  await assert.rejects(() => pending, /cancelled/);
  assert.equal(runtime.state().busy, false);
});

test("the pinned Windows UIA binary responds to the read-only protocol", { skip: process.platform !== "win32" || !existsSync(winAppPath()) }, async () => {
  const runtime = new WinAppUiaRuntime();
  await runtime.check();
  const result = await runtime.call("uia_list_windows", {});
  assert.equal(result.isError, false);
  assert.ok(Array.isArray(JSON.parse(result.content[0].text)));
});

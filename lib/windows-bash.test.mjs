import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { discoverWindowsBash, ensureWindowsBashShellPath, getWindowsBashCandidates } from "./windows-bash.ts";

test("derives Git Bash from a non-standard git.exe installation", () => {
  const candidates = getWindowsBashCandidates({}, ["D:\\Git\\cmd\\git.exe"]);
  assert.deepEqual(candidates, ["D:\\Git\\bin\\bash.exe", "D:\\Git\\usr\\bin\\bash.exe"]);
  assert.equal(discoverWindowsBash({
    platform: "win32",
    env: {},
    gitExecutables: ["D:\\Git\\cmd\\git.exe"],
    exists: (path) => path === "D:\\Git\\bin\\bash.exe",
  }), "D:\\Git\\bin\\bash.exe");
});

test("keeps an explicit shellPath and only persists an automatic Windows discovery", () => {
  const explicitWrites = [];
  const explicit = ensureWindowsBashShellPath({
    getShellPath: () => "E:\\MSYS2\\usr\\bin\\bash.exe",
    setShellPath: (path) => explicitWrites.push(path),
  }, { platform: "win32", env: {}, gitExecutables: [] });
  assert.equal(explicit, "E:\\MSYS2\\usr\\bin\\bash.exe");
  assert.deepEqual(explicitWrites, []);

  const automaticWrites = [];
  const automatic = ensureWindowsBashShellPath({
    getShellPath: () => undefined,
    setShellPath: (path) => automaticWrites.push(path),
  }, {
    platform: "win32",
    env: {},
    gitExecutables: ["D:\\Git\\cmd\\git.exe"],
    exists: (path) => path === "D:\\Git\\bin\\bash.exe",
  });
  assert.equal(automatic, "D:\\Git\\bin\\bash.exe");
  assert.deepEqual(automaticWrites, ["D:\\Git\\bin\\bash.exe"]);
});

test("does nothing outside Windows and wires discovery before session construction", () => {
  assert.equal(discoverWindowsBash({ platform: "linux", env: {}, gitExecutables: [], exists: () => true }), undefined);
  const rpcManager = fs.readFileSync(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  assert.match(rpcManager, /ensureWindowsBashShellPath\(services\.settingsManager\)/);
  assert.ok(rpcManager.indexOf("ensureWindowsBashShellPath(services.settingsManager)") < rpcManager.indexOf("createAgentSessionFromServices({"));
});

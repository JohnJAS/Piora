/* eslint-disable @typescript-eslint/no-require-imports -- Patch CommonJS fork before loading the Next CLI. */
// Next CLI owns worker restarts and Fast Refresh. Bridge only its server worker,
// leaving Next's own control messages and all other child processes untouched.
const childProcess = require("node:child_process");
const { syncBuiltinESMExports } = require("node:module");
const workerPath = require.resolve("next/dist/server/lib/start-server");
const originalFork = childProcess.fork;
const isDesktopMessage = (message) => typeof message?.type === "string" && message.type.startsWith("pi-desktop:");
childProcess.fork = function (modulePath, ...args) {
  const child = originalFork.call(this, modulePath, ...args);
  if (modulePath !== workerPath) return child;
  const send = (target, message) => {
    if (target.connected) target.send(message, () => {});
  };
  const fromParent = (message) => { if (isDesktopMessage(message)) send(child, message); };
  process.on("message", fromParent);
  child.on("message", (message) => { if (isDesktopMessage(message)) send(process, message); });
  child.once("exit", () => process.removeListener("message", fromParent));
  return child;
};
syncBuiltinESMExports();
require("next/dist/bin/next");

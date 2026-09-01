import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { TerminalSession } = await jiti.import("./terminal-session.ts");

function waitForOutput(read, marker, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (read().includes(marker)) return resolve();
      if (Date.now() - started >= timeoutMs) return reject(new Error(`Timed out waiting for ${marker}`));
      setTimeout(poll, 25);
    };
    poll();
  });
}

test("terminal session keeps shell state and streams output across commands", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "piora-terminal-"));
  const child = path.join(root, "child");
  fs.mkdirSync(child);
  const terminal = new TerminalSession(root);
  t.after(() => {
    terminal.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  });

  terminal.start();
  terminal.run(`cd ${process.platform === "win32" ? '"child"' : "child"}`);
  terminal.run(process.platform === "win32" ? "echo PIORA_TERMINAL_OK & cd" : "printf 'PIORA_TERMINAL_OK\\n'; pwd");
  await waitForOutput(
    () => terminal.snapshot().output.replace(/\\/g, "/").toLocaleLowerCase(),
    child.replace(/\\/g, "/").toLocaleLowerCase(),
  );

  const output = terminal.snapshot().output.replace(/\\/g, "/").toLocaleLowerCase();
  assert.equal(terminal.snapshot().connected, true);
  assert.match(output, /piora_terminal_ok/);
  assert.ok(output.includes(child.replace(/\\/g, "/").toLocaleLowerCase()), output);
});

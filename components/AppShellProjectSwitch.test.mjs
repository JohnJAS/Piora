import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const cwdHandler = source.slice(
  source.indexOf("const handleCwdChange"),
  source.indexOf("const handleSelectSession"),
);

test("selecting a session in another project survives cwd synchronization", () => {
  assert.match(cwdHandler, /const cwdBelongsToSelectedSession = selectedSession\?\.cwd === cwd/);
  assert.match(
    cwdHandler,
    /if \(!cwdBelongsToSelectedSession\) \{[\s\S]*?setSelectedSession\(null\);[\s\S]*?setSessionKey/,
  );
  assert.match(
    cwdHandler,
    /if \(!cwdBelongsToSelectedSession\) \{\s*router\.replace\("\/", \{ scroll: false \}\);\s*\}/,
  );
});

test("session selection restores focus to the remounted composer", () => {
  const selectionHandler = source.slice(
    source.indexOf("const handleSelectSession"),
    source.indexOf("const handleNewSession"),
  );
  assert.match(selectionHandler, /requestAnimationFrame[^]*chatInputRef\.current\?\.focus\(\)/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./workspace/HarmonyPanel.tsx", import.meta.url), "utf8");

test("device actions keep the existing Harmony video connection alive", () => {
  const actionSource = source.slice(
    source.indexOf("  const action ="),
    source.indexOf("  const mediaAction ="),
  );

  assert.match(actionSource, /jsonRequest\("\/api\/harmony\/action"/);
  assert.doesNotMatch(actionSource, /requestFrame/);
  assert.match(source, /onClick=\{requestFrame\}/);
});

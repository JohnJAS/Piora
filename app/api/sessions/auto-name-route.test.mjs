import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(new URL("./[id]/auto-name/route.ts", import.meta.url), "utf8");

test("automatic session naming never overwrites a manual title", () => {
  assert.match(route, /onlyIfUnnamed/);
  assert.match(route, /manager\.getSessionName\(\)\?\.trim\(\)/);
  assert.match(route, /SessionManager\.open\(filePath\)\.getSessionName\(\)\?\.trim\(\)/);
  assert.match(route, /skipped: true/);
});

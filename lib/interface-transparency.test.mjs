import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { parseInterfaceTransparency, serializeInterfaceTransparency, INTERFACE_TRANSPARENCY_INITIALIZATION_SCRIPT, INTERFACE_TRANSPARENCY_STORAGE_KEY } = await jiti.import("./interface-transparency.ts");
const { createPortableSettingsBundle, serializePortableSettings, parsePortableSettings, applyPortableSettings } = await jiti.import("./settings-portability.ts");

test("saved transparency and pre-paint initialization agree on defaults, bounds and malformed data", () => {
  for (const [raw, expected] of [[null, 80], ["invalid", 80], ['{"schemaVersion":2,"transparency":20}', 80], ['{"schemaVersion":1,"transparency":"20"}', 80], ...[-5, 0, 25.6, 80, 100, 120].map(n => [JSON.stringify({ schemaVersion: 1, transparency: n }), Math.min(100, Math.max(0, Math.round(n)))])]) {
    assert.equal(parseInterfaceTransparency(raw), expected);
    const root = { dataset: {}, style: { setProperty(key, value) { this[key] = value; } } };
    runInNewContext(INTERFACE_TRANSPARENCY_INITIALIZATION_SCRIPT, { localStorage: { getItem: () => raw }, document: { documentElement: root } });
    // A malformed JSON value leaves the CSS default in effect.
    assert.equal(Number(root.dataset.interfaceTransparency ?? 80), expected);
  }
  assert.equal(parseInterfaceTransparency(serializeInterfaceTransparency(0)), 0);
});

test("settings export round-trips transparency and old imports preserve the current value", () => {
  const values = new Map([[INTERFACE_TRANSPARENCY_STORAGE_KEY, serializeInterfaceTransparency(37)]]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const bundle = createPortableSettingsBundle(storage, "zh-CN");
  // Background portability has a legacy shape; this test concerns transparency only.
  delete bundle.preferences.background;
  const restored = parsePortableSettings(serializePortableSettings(bundle));
  assert.equal(restored.preferences.interfaceTransparency, 37);
  values.clear();
  applyPortableSettings(storage, restored);
  assert.equal(parseInterfaceTransparency(storage.getItem(INTERFACE_TRANSPARENCY_STORAGE_KEY)), 37);
  delete restored.preferences.interfaceTransparency;
  applyPortableSettings(storage, restored);
  assert.equal(parseInterfaceTransparency(storage.getItem(INTERFACE_TRANSPARENCY_STORAGE_KEY)), 37);
  restored.preferences.interfaceTransparency = 101;
  assert.throws(() => parsePortableSettings(serializePortableSettings(restored)));
});

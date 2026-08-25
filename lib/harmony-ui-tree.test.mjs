import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { flattenUiTree } = await jiti.import("./harmony/ui-tree.ts");

test("parses real UiTest attribute names into actionable nodes", () => {
  const nodes = flattenUiTree({
    attributes: {
      accessibilityId: "root",
      type: "Window",
      bounds: "[0,0][1260,2720]",
      visible: "true",
    },
    children: [{
      attributes: {
        accessibilityId: "settings_button",
        type: "Button",
        text: "设置",
        bounds: "[900,300][1180,420]",
        clickable: "true",
        enabled: "true",
        visible: "true",
      },
    }],
  });

  assert.equal(nodes.length, 2);
  assert.equal(nodes[1].id, "settings_button");
  assert.equal(nodes[1].text, "设置");
  assert.equal(nodes[1].clickable, true);
  assert.deepEqual(nodes[1].bounds, { left: 900, top: 300, right: 1180, bottom: 420 });
  assert.equal(nodes[1].parentIndex, 0);
});

test("finds nodes nested under unknown UiTest wrapper keys", () => {
  const nodes = flattenUiTree({
    page: {
      windowPayload: {
        componentTree: [{
          attributes: {
            componentId: 42,
            componentName: "TextInput",
            placeholderText: "Search settings",
            boundsInScreen: { left: 10, top: 20, right: 300, bottom: 80 },
            enabled: 1,
            visibleToUser: 1,
          },
        }],
      },
    },
  });

  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].id, "42");
  assert.equal(nodes[0].type, "TextInput");
  assert.equal(nodes[0].hint, "Search settings");
  assert.equal(nodes[0].visible, true);
});

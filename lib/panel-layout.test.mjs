import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  clampPanelWidth,
  getDefaultRightPanelWidth,
  getRightPanelMaxWidth,
  getSidebarMaxWidth,
} = await jiti.import("./panel-layout.ts");
const globalCss = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("clamps panel widths to finite bounds", () => {
  assert.equal(clampPanelWidth(420.4, 180, 480), 420);
  assert.equal(clampPanelWidth(120, 180, 480), 180);
  assert.equal(clampPanelWidth(600, 180, 480), 480);
  assert.equal(clampPanelWidth(Number.NaN, 180, 480), 180);
  assert.equal(clampPanelWidth(200, 300, 250), 300);
});

test("keeps the responsive right panel default within useful limits", () => {
  assert.equal(getDefaultRightPanelWidth(700), 360);
  assert.equal(getDefaultRightPanelWidth(1366), 574);
  assert.equal(getDefaultRightPanelWidth(1920), 640);
});

test("reserves chat space while split panels are visible", () => {
  assert.equal(getSidebarMaxWidth({
    viewportWidth: 700,
    rightPanelOpen: true,
    rightPanelWidth: 560,
  }), 380);
  assert.equal(getSidebarMaxWidth({
    viewportWidth: 1366,
    rightPanelOpen: true,
    rightPanelWidth: 686,
  }), 260);
  assert.equal(getRightPanelMaxWidth({
    viewportWidth: 1024,
    sidebarOpen: true,
    sidebarWidth: 260,
  }), 344);
  assert.equal(getRightPanelMaxWidth({
    viewportWidth: 1366,
    sidebarOpen: true,
    sidebarWidth: 260,
  }), 686);
});

test("does not rewrite desktop widths while the file panel is in overlay mode", () => {
  assert.equal(getRightPanelMaxWidth({
    viewportWidth: 900,
    sidebarOpen: true,
    sidebarWidth: 480,
  }), 1200);
});

test("closed side panels leave no edge chrome", () => {
  assert.match(
    globalCss,
    /\.sidebar-container\.sidebar-closed,\s*\.right-panel-container\.right-panel-closed\s*\{[^}]*border:\s*0\s*!important;[^}]*box-shadow:\s*none\s*!important;/s,
  );
  assert.match(
    globalCss,
    /\.app-shell:has\(>\s*\.sidebar-container\.sidebar-closed\)\s*>\s*\.workspace-main\s*\{[^}]*border-left:\s*0\s*!important;/s,
  );
  assert.match(
    globalCss,
    /\.app-shell:has\(>\s*\.right-panel-container\.right-panel-closed\)\s*>\s*\.workspace-main\s*\{[^}]*border-right:\s*0\s*!important;/s,
  );
});

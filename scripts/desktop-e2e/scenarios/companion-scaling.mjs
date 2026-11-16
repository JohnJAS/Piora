import assert from "node:assert/strict";
import { join } from "node:path";
export const companionScaling = {
  id: "companion-scaling",
  scope: "development Electron pet selection and resize handles",
  coverage: ["click to select", "rounded continuous resize border", "Escape dismisses selection", "selection replaces keyboard focus ring", "activity area setting persists"],
  limits: ["native cursor drag and multi-monitor DPI", "release packages", "OS restart persistence"],
  async run({ page, getBrowser, waitUntil, step, directory }) {
    // Preparation only: open the pet surface without changing scale or selection.
    await page.evaluate(() => window.piDesktop.setCompanionWindowVisible(true));
    const pet = await waitUntil(() => getBrowser().contexts().flatMap(c => c.pages()).find(p => p.url().includes("/desktop-pet")), "pet window");
    await step("select-pet", async () => {
      await pet.getByTestId("companion-pet-viewport").click();
      await pet.getByTestId("companion-selection").waitFor();
      assert.equal(await pet.locator("[data-corner]").count(), 0);
      assert.equal(await pet.getByTestId("companion-resize-border").getAttribute("rx"), "16");
      await pet.keyboard.press("ArrowRight");
      const focus = await pet.getByTestId("companion-pet-viewport").evaluate(element => ({
        visible: element.matches(":focus-visible"), outline: getComputedStyle(element).outlineStyle,
      }));
      assert.equal(focus.visible, true);
      assert.equal(focus.outline, "none", "selection must not show a second focus ring");
      await pet.screenshot({ path: join(directory, "pet-selected.png") });
    });
    await step("activity-area-setting", async () => {
      await pet.getByTestId("companion-pet-viewport").dblclick();
      const panel = await waitUntil(() => getBrowser().contexts().flatMap(c => c.pages()).find(p => p.url().includes("/desktop-companion-panel")), "companion settings window");
      await panel.getByRole("tab", { name: "设置", exact: true }).click();
      const area = panel.getByRole("combobox", { name: "自主活动区域", exact: true });
      assert.equal(await area.inputValue(), "screen");
      const saved = panel.waitForResponse(response => response.url().includes("/api/companion/state") && response.request().method() === "PUT" && response.ok());
      await area.selectOption("bottom-right");
      await saved;
      await panel.reload();
      await panel.getByRole("tab", { name: "设置", exact: true }).click();
      assert.equal(await panel.getByRole("combobox", { name: "自主活动区域", exact: true }).inputValue(), "bottom-right");
      await panel.screenshot({ path: join(directory, "movement-area-settings.png") });
      await pet.getByTestId("companion-pet-viewport").click();
      await pet.keyboard.press("ArrowRight");
    });
    await step("dismiss-selection", async () => {
      await pet.keyboard.press("Escape");
      await pet.getByTestId("companion-selection").waitFor({ state: "detached" });
      assert.equal(await pet.getByTestId("companion-pet-viewport").evaluate(element => getComputedStyle(element).outlineStyle), "solid", "keyboard focus remains visible when unselected");
    });
  },
};

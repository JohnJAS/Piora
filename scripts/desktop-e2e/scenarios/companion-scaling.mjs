import assert from "node:assert/strict";
import { join } from "node:path";
export const companionScaling = {
  id: "companion-scaling",
  scope: "development Electron pet selection and resize handles",
  coverage: ["click to select", "rounded continuous resize border", "Escape dismisses selection", "selection replaces keyboard focus ring"],
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
    await step("dismiss-selection", async () => {
      await pet.keyboard.press("Escape");
      await pet.getByTestId("companion-selection").waitFor({ state: "detached" });
      assert.equal(await pet.getByTestId("companion-pet-viewport").evaluate(element => getComputedStyle(element).outlineStyle), "solid", "keyboard focus remains visible when unselected");
    });
  },
};

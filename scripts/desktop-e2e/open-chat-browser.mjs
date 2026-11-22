/** Open the selected chat's workspace browser using the same controls as a user. */
export async function openChatBrowser(page, sessionId, waitUntil, { useLauncher = false } = {}) {
  const chat = page.locator(`[data-chat-surface][data-session-id="${sessionId}"]`);
  if (!await chat.isVisible()) {
    const row = page.locator(`[data-session-drag-id="${sessionId}"]`);
    const showSidebar = page.getByRole("button", { name: /^(显示侧边栏|Show sidebar)$/ });
    if (!await row.isVisible() && await showSidebar.isVisible()) await showSidebar.click();
    await row.click();
    await chat.waitFor();
  }
  const reveal = page.getByRole("button", { name: /^(显示文件面板|Show file panel)$/ });
  if (await reveal.isVisible()) await reveal.click();
  const address = page.getByRole("combobox", { name: /^(地址|Address)$/ });
  if (!await address.isVisible()) {
    const tools = page.getByRole("button", { name: /^(打开工具|Open tool)$/ });
    await tools.waitFor();
    const tab = page.locator("#workspace-browser-tab");
    const launcher = page.locator(".right-panel-surface").getByRole("button", { name: /^(浏览器|Browser)\s*(Ctrl\+T)?$/ });
    if (await tab.isVisible()) await tab.click();
    else if (useLauncher && await launcher.isVisible()) await launcher.click();
    else {
      if (await tools.getAttribute("aria-expanded") !== "true") await tools.click();
      // The accessible name also includes the displayed keyboard shortcut.
      const browser = page.getByRole("menuitem").filter({ has: page.getByText(/^(浏览器|Browser)$/) });
      await browser.click();
    }
  }
  await address.waitFor();
  await waitUntil(
    async () => (await page.evaluate(() => window.piDesktop.browser.getState())).sessionId === sessionId,
    "the workspace browser is bound to the selected chat",
  );
  return address;
}

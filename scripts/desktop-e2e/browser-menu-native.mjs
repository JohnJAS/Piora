import assert from "node:assert/strict";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { fixtureBrowserPid, menuDialog } from "./browser-menu-dialog.mjs";

const run = promisify(execFile);
export async function nativeMenuAcceptance({ fixture, ui, step, waitUntil, directory, getBrowser }) {
  if (process.platform !== "win32") throw new Error("This acceptance scenario requires Windows.");
  const pdf = join(directory, "page-output.pdf"),
    csv = join(directory, "synthetic-passwords.csv");
  const backupDir = join(directory, "owned-snapshot"),
    cookieFile = join(backupDir, "browser-session-cookies.enc");
  await mkdir(backupDir);
  await writeFile(
    csv,
    "name,url,username,password\r\nFixture account," +
      fixture.origin +
      "/signin-form,fixture-person,synthetic-only-pass\r\n",
    "utf8",
  );
  let currentBrowserPid = await fixtureBrowserPid(getBrowser());
  const dialog = () => ui.page().getByRole("dialog", { name: /^(Settings|设置)$/ });
  const file = async (action, path) => {
    await menuDialog(currentBrowserPid, action, directory, path);
  };
  const pick = async (button, path) => {
    await Promise.all([button.click(), file("open", path)]);
  };
  await ui.openPanel();
  await ui.navigate("/book");
  await step("unlock-fixture-vault-and-allow-the-isolated-loopback-form", async () => {
    await ui.choose("vault", "autofill");
    const vault = dialog().locator('[data-settings-id="data.websiteAccounts"]');
    await vault.getByRole("tab", { name: /^(设置|Settings)$/ }).click();
    await vault.locator('details[data-settings-id="data.credentialVault"] summary').click();
    await vault.getByLabel(/主密码（导入时|Master password \(backup/).fill("isolated-view-master");
    await vault.getByRole("button", { name: /^(创建凭据库|Create vault)$/ }).click();
    await vault.getByRole("button", { name: /^(锁定|Lock)$/ }).waitFor();
    await vault
      .getByRole("checkbox", {
        name: /自动保存网页登录账户并自动登录|Remember website accounts and sign in automatically/,
      })
      .uncheck();
    await vault
      .locator("summary")
      .filter({ hasText: /HTTP 站点白名单|HTTP site allowlist/ })
      .click();
    await vault.getByLabel(/允许保存凭据的 HTTP origin|HTTP origin allowed for credentials/).fill(fixture.origin);
    await vault.getByRole("button", { name: /允许此 HTTP 站点保存和填写账户|Allow credential saving/ }).click();
    await vault.getByRole("button", { name: /移除 HTTP 站点|Remove HTTP site/ }).waitFor();
    await ui.page().keyboard.press("Escape");
  });
  const importPane = () => ui.sheet("import");
  const selectSource = async (id) => {
    await importPane().getByRole("combobox").click();
    await importPane()
      .getByRole("listbox")
      .locator('[data-source-id="' + id + '"]')
      .click();
  };
  const select = () => importPane().getByRole("button", { name: /选择文件并预览|Choose files and preview/ });
  const confirm = () => importPane().getByRole("button", { name: /确认导入|Confirm import/ });
  await step("native-file-import-add-deduplicate-and-fill-a-real-test-form", async () => {
    await ui.choose("import");
    await selectSource("chrome/Default");
    await pick(select(), csv);
    await importPane().getByText("synthetic-passwords.csv", { exact: false }).waitFor();
    assert.ok(!(await importPane().innerText()).includes("synthetic-only-pass"));
    await confirm().click();
    await importPane()
      .getByRole("status")
      .filter({ hasText: /已导入 1|Imported 1/ })
      .waitFor();
    await selectSource("edge/Default");
    await pick(select(), csv);
    await confirm().click();
    await importPane()
      .getByRole("status")
      .filter({ hasText: /已跳过 1|Skipped 1/ })
      .waitFor();
    await ui.close();
    await ui.navigate("/signin-form");
    await ui.choose("vault", "autofill");
    const row = dialog().getByRole("listitem").filter({ hasText: "Fixture account" });
    await row.getByRole("button", { name: /填入当前浏览器|Fill current browser/ }).click();
    await ui.page().keyboard.press("Escape");
    await waitUntil(
      async () => (await ui.guest().locator("[name=username]").inputValue()) === "fixture-person",
      "the manual fill reached the selected fixture form",
    );
    assert.equal(
      await ui
        .guest()
        .locator("[name=password]")
        .evaluate((el) => el.value === "synthetic-only-pass"),
      true,
    );
    await ui.guest().getByRole("button", { name: "Sign in to fixture" }).click();
    await ui.guest().getByText("Signed in", { exact: true }).waitFor();
  });
  await step("only-the-isolated-piora-session-backup-restores-the-fixture-login", async () => {
    await waitUntil(async () => {
      try {
        return (await stat(join(fixture.profile, "browser-session-cookies.enc"))).size > 200;
      } catch {
        return false;
      }
    }, "fixture snapshot saved");
    await copyFile(join(fixture.profile, "browser-session-cookies.enc"), cookieFile);
    await ui.choose("privacy");
    const pane = ui.sheet("privacy");
    await pane.getByRole("checkbox", { name: /浏览历史|Browsing history/ }).uncheck();
    await pane.getByRole("checkbox", { name: /Cookie.*站点|Cookies and site data/ }).check();
    await pane.getByRole("combobox").selectOption("all");
    await pane.getByRole("button", { name: /预览清理范围|Preview data to clear/ }).click();
    await pane.getByRole("button", { name: /确认清除|Confirm clear/ }).click();
    await pane
      .getByRole("status")
      .filter({ hasText: /已清除|Cleared/ })
      .waitFor();
    await ui.close();
    await ui.guest().reload();
    await ui.guest().getByText("Signed out", { exact: true }).waitFor();
    await ui.choose("import");
    await selectSource("piora");
    await pick(select(), cookieFile);
    await confirm().click();
    await importPane()
      .getByRole("status")
      .filter({ hasText: /已导入 1|Imported 1/ })
      .waitFor();
    await ui.close();
    await ui.guest().reload();
    await ui.guest().getByText("Signed in", { exact: true }).waitFor();
    await ui.restart();
    currentBrowserPid = await fixtureBrowserPid(getBrowser());
    await ui.openPanel();
    await ui.navigate("/book");
    await ui.guest().getByText("Signed in", { exact: true }).waitFor();
  });
  await step("real-print-dialog-cancel-and-print-styled-page-to-pdf", async () => {
    await ui.navigate("/book");
    await ui.choose("print");
    await file("cancel-print");
    assert.ok((await ui.state()).url.endsWith("/book"));
    await ui.choose("print");
    await file("print-pdf");
    await file("save-pdf", pdf);
    await waitUntil(async () => {
      try {
        return (await stat(pdf)).size > 200;
      } catch {
        return false;
      }
    }, "native printer produced a PDF file");
    assert.ok((await readFile(pdf)).subarray(0, 5).equals(Buffer.from("%PDF-")));
    const raster = join(directory, "printed-page.png");
    const renderer = fileURLToPath(new URL("./render-fixture-pdf.ps1", import.meta.url));
    await run("powershell.exe", ["-NoProfile", "-File", renderer, pdf, raster], {
      windowsHide: true,
      timeout: 30000,
    });
    const pixels = await sharp(raster).removeAlpha().raw().toBuffer();
    let markerPixels = 0;
    for (let i = 0; i < pixels.length; i += 3)
      if (pixels[i] > 160 && pixels[i + 1] < 70 && pixels[i + 2] > 100 && pixels[i + 2] < 205) markerPixels++;
    assert.ok(markerPixels > 90, "printed the guest's print-only vector marker");
  });
}

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { nativeMenuAcceptance } from "../browser-menu-native.mjs";

let fixture;
const word = "纸上星河";
const siteTitle = "测试书架归档";
const content = Buffer.alloc(1048576, 97);
function serve(request, response) {
  const url = new URL(request.url, "http://fixture.invalid");
  if (url.pathname.startsWith("/file/")) {
    const slow = url.pathname.includes("slow"),
      filename = slow
        ? "slow-notes.txt"
        : url.pathname.endsWith("/unknown")
          ? "unknown-size.txt"
          : "fast-notes.txt";
    const start = Number(/^bytes=(\d+)-/.exec(request.headers.range ?? "")?.[1] ?? 0);
    response.writeHead(start ? 206 : 200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": 'attachment; filename="' + filename + '"',
      ...(url.pathname.endsWith("/unknown") ? {} : { "Content-Length": content.length - start }),
      "Accept-Ranges": "bytes",
      ETag: '"menu-file-v1"',
      ...(start ? { "Content-Range": "bytes " + start + "-" + (content.length - 1) + "/" + content.length } : {}),
    });
    if (!slow) {
      if (url.pathname.endsWith("/unknown")) response.write(content.subarray(start, start + 1));
      response.end(content.subarray(url.pathname.endsWith("/unknown") ? start + 1 : start));
      return;
    }
    let offset = start;
    const timer = setInterval(() => {
      const end = Math.min(content.length, offset + 8192);
      response.write(content.subarray(offset, end));
      offset = end;
      if (offset >= content.length) {
        clearInterval(timer);
        response.end();
      }
    }, 150);
    response.on("close", () => clearInterval(timer));
    return;
  }
  if (url.pathname === "/signin-form") {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(
      "<title>Fixture login</title><h1>" +
        siteTitle +
        '</h1><form method="POST" action="/fixture-auth"><input name="username" autocomplete="username"><input type="password" name="password" autocomplete="current-password"><button>Submit fixture login</button></form>',
    );
    return;
  }
  if (url.pathname === "/fixture-auth") {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const data = new URLSearchParams(body);
      if (data.get("username") === "fixture-person" && data.get("password") === "synthetic-only-pass") {
        response.writeHead(303, {
          "Set-Cookie": "fixture_menu=active; Path=/; HttpOnly; SameSite=Lax",
          Location: "/book",
        });
      } else response.writeHead(403);
      response.end();
    });
    return;
  }
  const signed = request.headers.cookie?.includes("fixture_menu=active") ?? false;
  if (url.pathname === "/login") {
    response.writeHead(303, {
      "Set-Cookie": "fixture_menu=active; Path=/; HttpOnly; SameSite=Lax",
      Location: "/book",
    });
    response.end();
    return;
  }
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(
    "<!doctype html><title>" +
      siteTitle +
      (url.pathname === "/second" ? "乙" : "甲") +
      '</title><meta name="viewport" content="width=device-width,initial-scale=1">' +
      "<style>html,body{background:#1977ad;color:white}button,a{padding:5px;margin:3px}body{min-height:130vh}#mobile{display:none}@media(max-width:500px){#mobile{display:block}}.paper{display:none}@media print{.paper{display:block} .screen{display:none}}</style>" +
      "<h1>" +
      siteTitle +
      "</h1><p>" +
      (url.pathname === "/second" ? "另一本测试书" : [word, word, word].join(" ")) +
      '</p><div id="mobile">Mobile layout</div><p class="paper">Piora menu print fixture<svg width="160" height="80"><rect width="160" height="80" fill="#c52b9a"/></svg></p><div class="screen">' +
      '<button id="coordinate" onclick="this.textContent=\'Activated\'">Coordinate target</button><a id="spa" href="#/chapters/1">Chapter one</a>' +
      '<a id="slow" href="/file/slow">Slow download</a><a id="fast" href="/file/fast">Fast download</a><a id="unknown" href="/file/unknown">Unspecified size</a><a href="/login">Fixture sign in</a>' +
      '<output id="auth">' +
      (signed ? "Signed in" : "Signed out") +
      '</output><form><input autocomplete="name"><input autocomplete="email"><input autocomplete="tel"><textarea autocomplete="street-address"></textarea></form></div>',
  );
}

export const browserMenu = {
  id: "browser-menu",
  scope:
    "Real Windows Electron browser menu, native views and OS clipboard, controlled loopback site and isolated profile across restarts.",
  coverage: [
    "native popup, submenu, find, zoom, screenshot",
    "device layout, contacts and form filling",
    "two concurrent downloads, pause/resume, file integrity",
    "local suggestions, history deletion, privacy and restart",
  ],
  limits: ["physical monitor DPI switching", "external browser accounts and sync services"],
  async prepare({ paths, directory, registerCleanup, report, env }) {
    env.PIORA_DESKTOP_E2E_FIXED_SOURCE = "1";
    const server = createServer(serve);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    registerCleanup(
      () =>
        new Promise((resolve) => {
          server.close(resolve);
          server.closeAllConnections();
        }),
    );
    const downloads = join(directory, "downloads"),
      sessions = join(paths.agent, "sessions", "--browser-menu-fixture--"),
      cwd = join(directory, "workspace");
    await Promise.all([
      mkdir(downloads),
      mkdir(cwd),
      mkdir(sessions, { recursive: true }),
      mkdir(paths.profile, { recursive: true }),
    ]);
    await writeFile(
      join(paths.profile, "browser-preferences.json"),
      JSON.stringify({ directory: downloads, askEachTime: false, zoom: {} }),
    );
    const id = randomUUID(),
      timestamp = new Date().toISOString();
    await writeFile(
      join(sessions, id + ".jsonl"),
      [
        { type: "session", version: 3, id, timestamp, cwd },
        {
          type: "message",
          id: "user1",
          parentId: null,
          message: { role: "user", content: "Local browser menu fixture", timestamp: Date.now() },
        },
        { type: "session_info", id: "info1", parentId: "user1", name: "Browser menu fixture", timestamp },
      ]
        .map((row) => JSON.stringify(row))
        .join("\n") + "\n",
    );
    fixture = { origin: "http://127.0.0.1:" + server.address().port, downloads, id, profile: paths.profile };
    report.fixture = { origin: fixture.origin, profile: "isolated", sessions: 1 };
  },
  async run({ page: initial, getBrowser, restart, step, waitUntil, directory, native = false }) {
    let page = initial,
      guest;
    const state = () => page.evaluate(() => window.piDesktop.browser.getState());
    const address = () => page.getByRole("combobox", { name: /^(Address|地址)$/ });
    const pages = () =>
      getBrowser()
        .contexts()
        .flatMap((c) => c.pages());
    const openPanel = async () => {
      const fixtureChat = page.getByText("Browser menu fixture", { exact: true }).first();
      const trigger = page.getByRole("button", { name: /^(打开工具|Open tool)$/ });
      const reveal = page.getByRole("button", { name: /^(显示文件面板|Show file panel)$/ });
      const readyStatus = await page.evaluate(async (id) => {
        const response = await fetch("/api/sessions/" + id, { signal: AbortSignal.timeout(90000) });
        return response.status;
      }, fixture.id);
      assert.equal(readyStatus, 200, "fixture chat is ready before opening the workspace");
      for (let attempt = 0; attempt < 2; attempt++) {
        await fixtureChat.click();
        if (await address().isVisible()) break;
        try {
          await reveal.or(trigger).or(address()).first().waitFor({ timeout: 25000 });
          if (await reveal.isVisible()) await reveal.click();
          await trigger.or(address()).first().waitFor({ timeout: 40000 });
          if (await address().isVisible()) break;
          await trigger.click();
          await page.getByRole("menuitem", { name: /浏览器|Browser/ }).click();
          await address().waitFor({ timeout: 40000 });
          break;
        } catch (error) {
          if (attempt) throw error;
          await page.reload({ waitUntil: "domcontentloaded" });
        }
      }
      await address().waitFor();
      await waitUntil(async () => (await state()).sessionId === fixture.id, "browser bound to fixture");
    };
    const navigate = async (path) => {
      const url = fixture.origin + path;
      await address().fill(url);
      await address().press("Enter");
      await waitUntil(async () => (await state()).url === url, "navigation reached " + path);
      guest = await waitUntil(() => pages().find((p) => p.url() === url), "native fixture target");
      await guest.getByRole("heading", { name: siteTitle }).waitFor();
    };
    const popup = async () => {
      await page.locator("[data-browser-menu-trigger]").click();
      const menu = await waitUntil(
        () => pages().find((p) => p.url().startsWith("data:text/html") && !p.isClosed()),
        "native browser menu window",
      );
      await menu.locator("button[data-action=history]").waitFor();
      return menu;
    };
    const choose = async (action, sub) => {
      const menu = await popup();
      if (sub) await menu.locator("[data-sub=" + sub + "]").click();
      await menu
        .locator("button[data-action=" + action + "]")
        .last()
        .click();
    };
    const close = () => page.getByRole("button", { name: /^(Close manager|关闭管理页)$/ }).click();
    const sheet = (section) => page.locator('[data-profile-section="' + section + '"]');
    if (native)
      return nativeMenuAcceptance({
        fixture,
        step,
        waitUntil,
        directory,
        getBrowser,
        ui: {
          page: () => page,
          guest: () => guest,
          openPanel,
          navigate,
          choose,
          close,
          sheet,
          state,
          restart: async () => {
            page = await restart({ graceful: true });
          },
        },
      });
    await step("targeted-page-find-and-inline-zoom", async () => {
      await openPanel();
      await navigate("/book");
      let menu = await popup();
      await menu.locator("[data-action=zoom_in]").click();
      await waitUntil(async () => (await state()).zoomFactor > 1, "website zoom increased");
      await menu.locator("[data-action=zoom_reset]").last().click();
      await waitUntil(async () => (await state()).zoomFactor === 1, "website zoom restored without closing menu");
      await menu.locator("[data-action=find]").click();
      const find = page.getByRole("search", { name: /在页面中查找|Find in page/ });
      const input = find.getByRole("textbox");
      await input.fill(word);
      await waitUntil(
        async () => /1\s*\/\s*3/.test(await find.locator("output").innerText()),
        "three real guest matches",
      );
      await input.press("Enter");
      await waitUntil(
        async () => /2\s*\/\s*3/.test(await find.locator("output").innerText()),
        "next real guest match",
      );
      await input.press("Shift+Enter");
      await input.fill("fixture-no-such-string");
      await waitUntil(async () => (await find.locator("output").innerText()) === "0 / 0", "empty search");
      const firstGuest = guest;
      const firstTabId = (await state()).activeTabId;
      const tabs = page.getByRole("tablist", { name: /浏览器标签页|Browser tabs/ });
      await tabs.getByRole("button", { name: /^(新建标签页|New tab)$/ }).click();
      await waitUntil(async () => (await state()).activeTabId !== firstTabId, "new tab selected");
      await navigate("/second");
      await choose("find");
      await input.fill("另一本测试书");
      await waitUntil(
        async () => (await find.locator("output").innerText()) === "1 / 1",
        "find targets the second tab",
      );
      await tabs
        .getByRole("tab")
        .filter({ hasText: siteTitle + "乙" })
        .getByRole("button", { name: /关闭标签页|Close tab/ })
        .click();
      await waitUntil(
        async () => (await state()).url === fixture.origin + "/book",
        "closing second tab restores first",
      );
      guest = firstGuest;
      assert.equal(await find.isVisible(), false);
      await guest.locator("#spa").click();
      await waitUntil(async () => (await state()).url.endsWith("#/chapters/1"), "SPA commit");
    });
    await step("device-viewport-and-clipboard-image", async () => {
      await choose("device", "devices");
      const device = page.locator("[data-browser-device]");
      await device.getByRole("combobox", { name: /设备预设|Device preset/ }).selectOption("iPhone SE");
      await waitUntil(
        async () => await guest.evaluate(() => innerWidth === 375 && matchMedia("(max-width:500px)").matches),
        "375 CSS pixel viewport",
      );
      await guest.locator("#coordinate").click();
      await guest.getByText("Activated", { exact: true }).waitFor();
      await device.getByRole("button", { name: /旋转|Rotate/ }).click();
      await waitUntil(async () => await guest.evaluate(() => innerWidth === 667), "rotated logical viewport");
      await choose("screenshot");
      await page.getByText(/网页截图已复制|Page screenshot copied/).waitFor();
      const pixel = await page.evaluate(async () => {
        const value = await window.piDesktop.clipboard.readImage();
        if (!value) return null;
        const img = new Image();
        img.src = value.startsWith("data:") ? value : "data:image/png;base64," + value;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        return {
          width: img.width,
          height: img.height,
          rgb: [...ctx.getImageData(Math.floor(img.width * 0.7), Math.floor(img.height * 0.85), 1, 1).data].slice(
            0,
            3,
          ),
        };
      });
      assert.ok(pixel?.width > 20 && pixel?.height > 20);
      assert.deepEqual(pixel.rgb, [25, 119, 173]);
      await writeFile(join(directory, "clipboard-evidence.json"), JSON.stringify(pixel));
      await device.getByRole("button", { name: /关闭设备工具栏|Close device toolbar/ }).click();
    });
    await step("manage-and-fill-contact", async () => {
      await choose("contacts", "autofill");
      let book = sheet("contacts");
      await book.getByRole("button", { name: /新增联系人|Add contact/ }).click();
      await book.getByLabel(/^(姓名|Name)$/).fill("Menu Fixture");
      await book.getByLabel(/^(邮箱|Email)$/).fill("fixture@example.invalid");
      await book.getByRole("button", { name: /保存联系人|Save contact/ }).click();
      await book.getByRole("button", { name: /填入当前网页|Fill current page/ }).click();
      await waitUntil(
        async () => (await guest.locator("input[autocomplete=email]").inputValue()) === "fixture@example.invalid",
        "actual webpage form filled",
      );
      await close();
    });
    await step("manage-concurrent-downloads-and-verify-files", async () => {
      await guest.locator("#slow").click();
      await guest.locator("#fast").click();
      await page.getByRole("button", { name: /^(近期下载|Recent downloads)$/ }).click();
      await sheet("recent")
        .getByRole("button", { name: /查看全部下载|See all downloads/ })
        .click();
      const slow = sheet("downloads").locator("article").filter({ hasText: "slow-notes.txt" });
      const fast = sheet("downloads").locator("article").filter({ hasText: "fast-notes.txt" });
      await slow.getByRole("button", { name: /^(暂停|Pause)$/ }).click();
      await waitUntil(
        async () => (await slow.getAttribute("data-transfer-state")) === "paused",
        "one download paused",
      );
      await waitUntil(
        async () => (await fast.getAttribute("data-transfer-state")) === "completed",
        "second download completed",
      );
      await slow.getByRole("button", { name: /^(继续|Resume)$/ }).click();
      await waitUntil(
        async () => (await slow.getAttribute("data-transfer-state")) === "completed",
        "first download completed",
      );
      assert.deepEqual(await readFile(join(fixture.downloads, "slow-notes.txt")), content);
      assert.deepEqual(await readFile(join(fixture.downloads, "fast-notes.txt")), content);
      await close();
      await guest.locator("#unknown").click();
      await guest.locator("#fast").click();
      await choose("downloads");
      const records = sheet("downloads");
      await waitUntil(
        async () => (await records.locator('article[data-transfer-state="completed"]').count()) === 4,
        "unknown-size and duplicate-name downloads completed",
      );
      assert.deepEqual(await readFile(join(fixture.downloads, "unknown-size.txt")), content);
      const duplicatePaths = await records
        .locator("article")
        .filter({ hasText: "fast-notes.txt" })
        .locator("small")
        .evaluateAll((items) => items.map((item) => item.title));
      assert.equal(new Set(duplicatePaths).size, 2);
      for (const path of duplicatePaths) {
        assert.equal(dirname(resolve(path)), resolve(fixture.downloads));
        assert.deepEqual(await readFile(path), content);
      }
      const unknown = records.locator("article").filter({ hasText: "unknown-size.txt" });
      await unknown.getByRole("button", { name: /移除记录|Remove record/ }).click();
      await unknown.waitFor({ state: "detached" });
      assert.deepEqual(await readFile(join(fixture.downloads, "unknown-size.txt")), content);
      await close();
    });
    await step("restart-and-reopen-history-with-address-suggestions", async () => {
      page = await restart({ graceful: true });
      await openPanel();
      await address().fill(siteTitle);
      const option = page.getByRole("option").filter({ hasText: "#/chapters/1" });
      await option.first().click();
      await waitUntil(async () => (await state()).url.endsWith("#/chapters/1"), "reopened saved SPA URL");
      guest = await waitUntil(
        () => pages().find((p) => p.url().endsWith("#/chapters/1")),
        "reopened native guest",
      );
      await choose("downloads");
      await sheet("downloads").getByText("fast-notes.txt", { exact: true }).first().waitFor();
      const moved = join(fixture.downloads, "slow-notes.txt");
      await rename(moved, join(fixture.downloads, "moved-slow-notes.txt"));
      await close();
      await choose("downloads");
      await sheet("downloads")
        .getByText(/文件已移动或删除|File moved or deleted/)
        .waitFor();
      await close();
      await choose("history");
      const history = sheet("history");
      await history.getByRole("searchbox").fill("/second");
      const old = history.getByRole("button", { name: /删除访问记录|Delete visit/ });
      await old.waitFor();
      await old.click();
      await old.waitFor({ state: "detached" });
      await history.getByLabel(/访问日期|Date visited/).fill("2000-01-01");
      await history.getByText(/没有匹配的记录|No matching records/).waitFor();
      await history.getByLabel(/访问日期|Date visited/).fill("");
      await history.getByRole("searchbox").fill("chapters");
      await history
        .getByText(/chapters\/1/)
        .first()
        .waitFor();
      assert.ok(
        (await sheet("history")
          .getByText(/chapters\/1/)
          .count()) >= 1,
      );
      await close();
    });
    await step("browser-settings-and-cookie-clear-after-restart", async () => {
      await choose("settings");
      const dialog = page.getByRole("dialog", { name: /^(设置|Settings)$/ });
      await dialog.getByRole("textbox", { name: /^(下载位置|Download location)$/ }).waitFor();
      await page.keyboard.press("Escape");
      await guest.getByRole("link", { name: "Fixture sign in" }).click();
      await guest.getByText("Signed in", { exact: true }).waitFor();
      const clear = async (sites) => {
        await choose("privacy");
        const pane = sheet("privacy");
        if (sites) {
          await pane.getByRole("checkbox", { name: /浏览历史|Browsing history/ }).uncheck();
          await pane.getByRole("checkbox", { name: /Cookie.*站点|Cookies and site data/ }).check();
          assert.equal(
            await pane.getByRole("button", { name: /预览清理范围|Preview data to clear/ }).isDisabled(),
            true,
          );
        }
        await pane.getByRole("combobox").selectOption("all");
        await pane.getByRole("button", { name: /预览清理范围|Preview data to clear/ }).click();
        await pane.getByRole("button", { name: /确认清除|Confirm clear/ }).click();
        await pane
          .getByRole("status")
          .filter({ hasText: /已清除|Cleared/ })
          .waitFor();
        await close();
      };
      await clear(false);
      await guest.reload();
      await guest.getByText("Signed in", { exact: true }).waitFor();
      await clear(true);
      page = await restart({ graceful: true });
      await openPanel();
      await navigate("/book");
      await guest.getByText("Signed out", { exact: true }).waitFor();
    });
  },
};

export const browserMenuNative = {
  ...browserMenu,
  id: "browser-menu-native",
  scope: "Windows native print and file dialogs scoped to the isolated Electron process.",
  coverage: [
    "cancel printing and print to PDF",
    "choose synthetic Chrome and Edge password exports",
    "fill a real local login form",
    "restore an app-owned encrypted session backup and restart",
  ],
  limits: ["unrelated browser profiles and OS accounts", "physical printers"],
  run: (context) => browserMenu.run({ ...context, native: true }),
};

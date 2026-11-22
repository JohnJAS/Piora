import assert from "node:assert/strict";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { nativeMenuAcceptance } from "../browser-menu-native.mjs";
import { openChatBrowser } from "../open-chat-browser.mjs";

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
        '</h1><form method="POST" action="/fixture-auth"><input name="username" autocomplete="username"><input type="password" name="password" autocomplete="current-password"><button>Sign in to fixture</button></form>',
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

async function captureImportWorkspace({ page, guest, dialog, directory }) {
  const viewport = await page.locator("[data-native-browser=true] [data-browser-viewport]").boundingBox();
  assert.ok(viewport);
  const [shell, website, overlay] = await Promise.all([
    page.screenshot({ scale: "css" }),
    guest.screenshot({ scale: "css" }),
    dialog.screenshot({ scale: "css", omitBackground: true }),
  ]);
  const { width, height } = await sharp(shell).metadata();
  const left = Math.max(0, Math.round(viewport.x)),
    top = Math.max(0, Math.round(viewport.y));
  const guestLayer = await sharp(website)
    .resize(
      Math.min(width - left, Math.round(viewport.width)),
      Math.min(height - top, Math.round(viewport.height)),
      { fit: "fill" },
    )
    .png()
    .toBuffer();
  assert.deepEqual(
    await sharp(overlay)
      .metadata()
      .then((m) => [m.width, m.height]),
    [width, height],
  );
  await sharp(shell)
    .composite([
      { input: guestLayer, left, top },
      { input: overlay, left: 0, top: 0 },
    ])
    .png()
    .toFile(join(directory, "import-workspace.png"));
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
    const browserRoots = join(directory, "external-profile-fixtures");
    if (process.platform === "win32") env.LOCALAPPDATA = browserRoots;
    else if (process.platform === "linux") env.XDG_CONFIG_HOME = browserRoots;
    if (process.platform === "win32" || process.platform === "linux") {
      const chrome =
        process.platform === "win32"
          ? join(browserRoots, "Google", "Chrome", "User Data")
          : join(browserRoots, "google-chrome");
      const edge =
        process.platform === "win32"
          ? join(browserRoots, "Microsoft", "Edge", "User Data")
          : join(browserRoots, "microsoft-edge");
      for (const [root, ids] of [
        [chrome, ["Default", "Profile 1", "Profile 2"]],
        [edge, ["Default"]],
      ]) {
        const info_cache = {};
        for (const dir of ids) {
          await mkdir(join(root, dir), { recursive: true });
          const work = dir !== "Profile 2";
          info_cache[dir] = {
            name: work ? "工作" : "阅读",
            gaia_given_name: work ? "工作" : "阅读",
            user_name: "",
            is_using_default_name: true,
          };
          const db = new DatabaseSync(join(root, dir, "History"));
          try {
            db.exec(
              "CREATE TABLE urls(id INTEGER PRIMARY KEY,url TEXT,title TEXT,hidden INTEGER); CREATE TABLE visits(id INTEGER PRIMARY KEY,url INTEGER,visit_time INTEGER)",
            );
            db.prepare("INSERT INTO urls VALUES(1,?,?,0)").run(
              "https://" + (work ? "work" : "reading") + ".example.invalid/",
              "归档测试",
            );
            db.prepare("INSERT INTO visits VALUES(1,1,?)").run(
              (BigInt(Date.now() - 86400000) + 11644473600000n) * 1000n,
            );
          } finally {
            db.close();
          }
        }
        await writeFile(
          join(root, "Local State"),
          JSON.stringify({ profile: { last_used: "Default", info_cache } }),
        );
      }
    }
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
      join(sessions, timestamp.replaceAll(":", "-") + "_" + id + ".jsonl"),
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
  async run({
    page: initial,
    getBrowser,
    restart,
    step,
    waitUntil,
    directory,
    native = false,
    appearance = false,
  }) {
    let page = initial,
      guest;
    const state = () => page.evaluate(() => window.piDesktop.browser.getState());
    const address = () => page.getByRole("combobox", { name: /^(Address|地址)$/ });
    const pages = () =>
      getBrowser()
        .contexts()
        .flatMap((c) => c.pages());
    const openPanel = () => openChatBrowser(page, fixture.id, waitUntil, { useLauncher: appearance });
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
    let floating;
    const expectFloating = async (section) => {
      floating = await waitUntil(
        () => pages().find((p) => !p.isClosed() && p.url().includes("/desktop-browser-dialog?section=" + section)),
        "native " + section + " window",
      );
      await floating.locator('[data-profile-section="' + section + '"]').waitFor();
      return floating;
    };
    const choose = async (action, sub) => {
      const menu = await popup();
      if (sub) await menu.locator("[data-sub=" + sub + "]").click();
      await menu
        .locator("button[data-action=" + action + "]")
        .last()
        .click();
      if (action === "import" || action === "privacy") await expectFloating(action);
    };
    const close = async () => {
      if (floating && !floating.isClosed()) {
        const surface = floating;
        await Promise.all([
          surface.waitForEvent("close"),
          surface.getByRole("button", { name: /^(关闭|Close)$/ }).click(),
        ]);
        floating = undefined;
      } else {
        const settings = page.getByRole("dialog", { name: /^(设置|Settings)$/ });
        if (await settings.isVisible()) {
          await page.keyboard.press("Escape");
          await settings.waitFor({ state: "hidden" });
        }
      }
    };
    const sheet = (section) =>
      (floating && !floating.isClosed() && ["recent", "import", "privacy"].includes(section)
        ? floating
        : page
      ).locator('[data-profile-section="' + section + '"]');
    await step("select-the-fixture-chat-and-open-its-browser", openPanel);
    await step("navigate-to-the-fixture-page", () => navigate("/book"));
    if (appearance) {
      await step("native-menu-import-window-and-browser-settings", async () => {
        const menu = await popup();
        await menu.locator("[data-action=import]").hover();
        await menu.locator("main > section").screenshot({ path: join(directory, "menu.png") });
        await menu.locator("[data-action=import]").click();
        const dialog = await expectFloating("import");
        const region = dialog.getByRole("dialog");
        const measure = await region.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return {
            width: r.width,
            height: r.height,
            x: r.x,
            y: r.y,
            viewport: [innerWidth, innerHeight],
            backdrop: getComputedStyle(el.parentElement).backgroundColor,
          };
        });
        assert.ok(
          measure.width > 300 &&
            measure.width <= 522 &&
            Math.abs(measure.x * 2 + measure.width - measure.viewport[0]) <= 3,
        );
        assert.equal(new URL(guest.url()).pathname, "/book");
        const picker = region.getByRole("combobox");
        await waitUntil(async () => await picker.isEnabled(), "installed profile names are available");
        await region.screenshot({ path: join(directory, "import.png") });
        await picker.click();
        const profiles = region.getByRole("listbox");
        assert.equal(await profiles.locator('[data-source-id^="chrome/"]').count(), 3);
        assert.equal(await profiles.locator("[aria-selected=true]").count(), 1);
        assert.equal(await picker.locator(":scope > svg").count(), 1);
        const selectedProfile = profiles.getByRole("option", { selected: true });
        const labelsFit = await selectedProfile.locator("small").evaluateAll((labels) =>
          labels.every((label) => label.scrollWidth <= label.clientWidth + 1),
        );
        assert.ok(labelsFit, "the selected profile name and its same-name hint fit inside the popup");
        await region.screenshot({ path: join(directory, "profile-menu.png") });
        await profiles.locator('[data-source-id="chrome/Profile 2"]').click();
        await picker.press("ArrowDown");
        await picker.press("Escape");
        assert.ok(await region.isVisible());
        assert.equal(await profiles.isVisible(), false);
        await region.getByRole("switch", { name: /已保存的密码|Saved passwords/ }).uncheck();
        await region.getByRole("switch", { name: /浏览记录|Browsing history/ }).check();
        await region.getByRole("button", { name: /预览导入|Preview import/ }).click();
        await region.getByText("https://reading.example.invalid", { exact: true }).waitFor();
        assert.equal(await region.getByText("https://work.example.invalid", { exact: true }).count(), 0);
        await region.getByRole("button", { name: /确认导入|Confirm import/ }).click();
        await region
          .getByRole("status")
          .filter({ hasText: /已导入 1|Imported 1/ })
          .waitFor();
        await picker.click();
        await profiles.locator('[data-source-id="chrome/Default"]').click();
        await captureImportWorkspace({ page, guest, dialog, directory });
        await writeFile(join(directory, "dialog-geometry.json"), JSON.stringify(measure));
        await close();
        await choose("vault", "autofill");
        const vault = sheet("vault");
        await vault.getByRole("tab", { name: /^(设置|Settings)$/ }).click();
        await page
          .getByRole("dialog", { name: /^(设置|Settings)$/ })
          .screenshot({ path: join(directory, "password-settings.png") });
        await close();
        await choose("history");
        await sheet("history")
          .getByText(/reading\.example\.invalid/)
          .waitFor();
        await sheet("history").screenshot({ path: join(directory, "history.png") });
        await close();
        await choose("privacy");
        await sheet("privacy").screenshot({ path: join(directory, "privacy.png") });
        await close();
        await choose("contacts", "autofill");
        await sheet("contacts").screenshot({ path: join(directory, "contacts.png") });
        await close();
        await choose("downloads");
        await sheet("downloads").screenshot({ path: join(directory, "downloads.png") });
        await close();
        await page.getByRole("button", { name: /^(近期下载|Recent downloads)$/ }).click();
        await expectFloating("recent");
        await sheet("recent").screenshot({ path: join(directory, "recent-downloads.png") });
        await close();
        await choose("find");
        const findBar = page.getByRole("search", { name: /在页面中查找|Find in page/ });
        await findBar.getByRole("textbox").fill(word);
        await waitUntil(
          async () => /1\s*\/\s*3/.test(await findBar.locator("output").innerText()),
          "find shows the current page count",
        );
        await findBar.screenshot({ path: join(directory, "find.png") });
        await findBar.getByRole("textbox").press("Escape");
        await choose("device", "devices");
        const toolbar = page.locator("[data-browser-device]");
        await toolbar.getByRole("combobox", { name: /设备预设|Device preset/ }).selectOption("iPhone SE");
        await toolbar.screenshot({ path: join(directory, "device-toolbar.png") });
      });
      await step("compact-window-browser-launcher-and-tool-menu", async () => {
        await page.setViewportSize({ width: 1024, height: 720 });
        const closeTool = page.locator("#workspace-browser-tab").locator("..").getByRole("button");
        await closeTool.click();
        const addTool = page.getByRole("button", { name: /^(打开工具|Open tool)$/ });
        const titlebar = page.locator(".desktop-titlebar");
        const [buttonBounds, titleBounds] = await Promise.all([addTool.boundingBox(), titlebar.boundingBox()]);
        assert.ok(buttonBounds, "the compact tool button is visible");
        if (titleBounds) assert.ok(buttonBounds.y >= titleBounds.y + titleBounds.height - 1,
          "the compact tool button clears the desktop title bar");
        await openChatBrowser(page, fixture.id, waitUntil);
        await closeTool.click();
        await openChatBrowser(page, fixture.id, waitUntil, { useLauncher: true });
        await page.screenshot({ path: join(directory, "compact-workspace.png") });
      });
      return;
    }
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
      await expectFloating("recent");
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
      await waitUntil(async () => {
        const visibleUrls = await history
          .locator("[data-visit-id] button[title]")
          .evaluateAll((links) => links.map((link) => link.title));
        return visibleUrls.length > 0 && visibleUrls.every((url) => url.includes("/second"));
      }, "history search returned only matching visits");
      const selectedVisit = await history.locator("[data-visit-id]").first().getAttribute("data-visit-id");
      const old = history.locator('[data-visit-id="' + selectedVisit + '"]');
      await old.getByRole("button", { name: /删除访问记录|Delete visit/ }).click();
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
    await step("abrupt-restart-keeps-visits-and-marks-unfinished-download-interrupted", async () => {
      await navigate("/crash-survivor");
      await guest.locator("#slow").click();
      await choose("downloads");
      await sheet("downloads")
        .locator('article[data-transfer-state="progressing"]')
        .filter({ hasText: "slow-notes.txt" })
        .waitFor();
      page = await restart();
      await openPanel();
      await address().fill("crash-survivor");
      await page.getByRole("option").filter({ hasText: "/crash-survivor" }).first().click();
      await waitUntil(async () => (await state()).url.endsWith("/crash-survivor"), "visit survived forced exit");
      await choose("downloads");
      const rows = sheet("downloads");
      await rows
        .locator('article[data-transfer-state="interrupted"]')
        .filter({ hasText: "slow-notes.txt" })
        .waitFor();
      assert.equal(await rows.getByRole("button", { name: /^(暂停|继续|Pause|Resume)$/ }).count(), 0);
      assert.equal(await rows.getByText("unknown-size.txt", { exact: true }).count(), 0);
      assert.deepEqual(await readFile(join(fixture.downloads, "fast-notes.txt")), content);
    });
  },
};

export const browserMenuAppearance = {
  ...browserMenu,
  id: "browser-menu-appearance",
  scope: "Real Windows menu, modal over a live webpage and browser settings in an isolated profile.",
  coverage: ["native menu and import dialog", "password manager, history and privacy surfaces"],
  run: (context) => browserMenu.run({ ...context, appearance: true }),
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

/// <reference lib="dom" />
import { ipcRenderer } from "electron";
import type { MenuModel } from "./menu-popup.js";

ipcRenderer.once("pi:browser-popup-ready", (_event, model: MenuModel & { left: boolean; width: number }) => {
  const send = (action: string) => ipcRenderer.send("pi:browser-popup-input", action);
  const label = (zh: string, en: string) => (model.locale.startsWith("zh") ? zh : en);
  document.body.classList.toggle("dark", model.dark);
  document.documentElement.lang = model.locale;
  const root = document.querySelector("main")!;
  const panel = () => {
    const el = document.createElement("section");
    el.style.width = model.width + "px";
    el.setAttribute("role", "menu");
    return el;
  };
  const primary = panel();
  root.append(primary);
  let secondary: HTMLElement | undefined;
  let opener: HTMLButtonElement | undefined;
  function closeSub() {
    if (!secondary) return;
    secondary.remove();
    secondary = undefined;
    opener?.setAttribute("aria-expanded", "false");
    opener?.focus();
    send("collapse");
  }
  function item(parent: HTMLElement, title: string, action: string, enabled = true) {
    const button = document.createElement("button");
    button.textContent = title;
    button.dataset.action = action;
    button.disabled = !enabled;
    button.setAttribute("role", "menuitem");
    button.addEventListener("click", () => send(action));
    parent.append(button);
    return button;
  }
  function submenu(title: string, key: string, populate: (el: HTMLElement) => void) {
    const button = document.createElement("button");
    button.textContent = title;
    button.dataset.sub = key;
    button.setAttribute("role", "menuitem");
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    const open = () => {
      if (secondary && opener === button) return;
      closeSub();
      opener = button;
      secondary = panel();
      secondary.className = "sub";
      button.setAttribute("aria-expanded", "true");
      populate(secondary);
      if (model.left) root.prepend(secondary);
      else root.append(secondary);
      const submenuHeight = Math.min(window.innerHeight, Math.ceil(secondary.getBoundingClientRect().height));
      const submenuTop = Math.max(
        0,
        Math.min(Math.round(button.getBoundingClientRect().top), window.innerHeight - submenuHeight),
      );
      secondary.style.marginTop = submenuTop + "px";
      ipcRenderer.send("pi:browser-popup-input", { submenuTop, submenuHeight });
      secondary.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    };
    button.addEventListener("click", open);
    button.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        open();
      }
    });
    primary.append(button);
  }
  const divider = () => primary.append(document.createElement("hr"));
  item(primary, label("在页面中查找", "Find in page"), "find", model.page);
  item(primary, label("打印", "Print"), "print", model.page);
  divider();
  const group = document.createElement("div");
  group.className = "zoom";
  const heading = document.createElement("span");
  heading.textContent = label("缩放", "Zoom");
  group.append(heading);
  const minus = item(group, "−", "zoom_out", model.page && !model.minZoom);
  const reset = item(group, Math.round(model.zoom * 100) + "%", "zoom_reset", model.page);
  reset.title = label("重置缩放", "Reset zoom");
  const plus = item(group, "+", "zoom_in", model.page && !model.maxZoom);
  const again = item(group, "↻", "zoom_reset", model.page);
  again.setAttribute("aria-label", reset.title);
  ipcRenderer.on("pi:browser-popup-zoom", (_event, data: Pick<MenuModel, "zoom" | "minZoom" | "maxZoom">) => {
    reset.textContent = Math.round(data.zoom * 100) + "%";
    minus.disabled = data.minZoom;
    plus.disabled = data.maxZoom;
  });
  primary.append(group);
  divider();
  submenu(label("设备工具栏", "Device toolbar"), "devices", (el) => {
    item(
      el,
      model.device
        ? label("隐藏设备工具栏", "Hide device toolbar")
        : label("显示设备工具栏", "Show device toolbar"),
      "device",
      model.hasTab,
    );
    const check = item(el, label("新标签默认显示", "Always show in new tabs"), "deviceDefault");
    check.setAttribute("role", "menuitemcheckbox");
    check.setAttribute("aria-checked", String(model.defaultDevice));
  });
  item(primary, label("截取屏幕截图", "Capture screenshot"), "screenshot", model.page);
  divider();
  item(primary, label("导入 Cookie 和密码…", "Import cookies and passwords…"), "import");
  submenu(label("密码和自动填充", "Passwords and autofill"), "autofill", (el) => {
    item(el, label("密码管理器", "Password manager"), "vault");
    item(el, label("联系人信息", "Contact info"), "contacts");
  });
  item(primary, label("下载", "Downloads"), "downloads");
  item(primary, label("历史记录", "History"), "history");
  item(primary, label("清除浏览数据", "Clear browsing data"), "privacy");
  divider();
  item(primary, label("浏览器设置", "Browser settings"), "settings");
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" || (secondary && event.key === "ArrowLeft")) {
      event.preventDefault();
      if (secondary) closeSub();
      else send("close");
      return;
    }
    if (!["ArrowUp", "ArrowDown", "Home", "End", "Tab"].includes(event.key)) return;
    event.preventDefault();
    const buttons = Array.from(
      (secondary ?? primary).querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
    );
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const delta = event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey) ? -1 : 1;
    buttons[
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (current + delta + buttons.length) % buttons.length
    ]?.focus();
  });
  primary.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
});

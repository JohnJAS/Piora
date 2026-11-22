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
  const icon = (path: string, size = 14) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.6");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    const line = document.createElementNS(svg.namespaceURI, "path");
    line.setAttribute("d", path);
    svg.append(line);
    return svg;
  };
  const primary = panel();
  root.append(primary);
  let secondary: HTMLElement | undefined;
  let opener: HTMLButtonElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stopHover = () => clearTimeout(timer);
  function closeSub(restore = true) {
    stopHover();
    if (!secondary) return;
    secondary.remove();
    secondary = undefined;
    opener?.setAttribute("aria-expanded", "false");
    if (restore) opener?.focus();
    send("collapse");
  }
  function item(parent: HTMLElement, title: string, action: string, enabled = true) {
    const button = document.createElement("button");
    button.textContent = title;
    button.dataset.action = action;
    button.disabled = !enabled;
    button.setAttribute("role", "menuitem");
    button.addEventListener("click", () => send(action));
    if (parent === primary)
      button.addEventListener("pointerenter", () => {
        stopHover();
        timer = setTimeout(() => closeSub(false), 120);
      });
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
    button.append(icon("m9 6 6 6-6 6", 12));
    const open = (focus = true) => {
      if (secondary && opener === button) {
        if (focus) secondary.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
        return;
      }
      closeSub(false);
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
      if (focus) secondary.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
      secondary.addEventListener("pointerenter", stopHover);
    };
    button.addEventListener("click", () => open());
    button.addEventListener("pointerenter", () => {
      stopHover();
      timer = setTimeout(() => open(false), 170);
    });
    button.addEventListener("pointerleave", stopHover);
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
  const stepper = document.createElement("div");
  stepper.className = "stepper";
  group.append(stepper);
  const minus = item(stepper, "−", "zoom_out", model.page && !model.minZoom);
  minus.setAttribute("aria-label", label("缩小", "Zoom out"));
  const reset = item(stepper, Math.round(model.zoom * 100) + "%", "zoom_reset", model.page);
  reset.title = label("重置缩放", "Reset zoom");
  const plus = item(stepper, "+", "zoom_in", model.page && !model.maxZoom);
  plus.setAttribute("aria-label", label("放大", "Zoom in"));
  const again = item(group, "", "zoom_reset", model.page);
  again.append(icon("M20 7v5h-5 M4 17v-5h5 M6 7a7 7 0 0 1 12-1l2 3 M4 15l2 3a7 7 0 0 0 12-1"));
  again.setAttribute("aria-label", reset.title);
  ipcRenderer.on("pi:browser-popup-zoom", (_event, data: Pick<MenuModel, "zoom" | "minZoom" | "maxZoom">) => {
    reset.textContent = Math.round(data.zoom * 100) + "%";
    again.disabled = data.zoom === 1;
    minus.disabled = data.minZoom;
    plus.disabled = data.maxZoom;
  });
  again.disabled = !model.page || model.zoom === 1;
  group.addEventListener("pointerenter", () => closeSub(false));
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
  document.addEventListener("pointermove", () => document.body.classList.remove("using-keys"));
  document.addEventListener("keydown", (event) => {
    document.body.classList.add("using-keys");
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

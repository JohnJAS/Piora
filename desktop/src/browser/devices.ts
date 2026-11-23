import type { Rectangle, WebContentsView } from "electron";
import { devices, initialDevice, type DeviceViewport } from "./contracts.js";
import { fitViewport } from "./device-display.js";

export function checkedViewport(value: DeviceViewport): DeviceViewport {
  if (
    !value ||
    typeof value.enabled !== "boolean" ||
    !devices.some(([name]) => name === value.preset) ||
    !Number.isInteger(value.width) ||
    !Number.isInteger(value.height) ||
    value.width < 160 ||
    value.width > 4096 ||
    value.height < 160 ||
    value.height > 4096 ||
    ![0, 0.25, 0.5, 0.75, 1].includes(value.preview)
  )
    throw new Error("Invalid device viewport");
  return {
    enabled: value.enabled,
    preset: value.preset,
    width: value.width,
    height: value.height,
    preview: value.preview,
  };
}
export class BrowserDevices {
  private readonly states = new Map<string, DeviceViewport>();
  private readonly applied = new WeakMap<WebContentsView, { key: string; scale: number }>();
  constructor(private readonly defaultEnabled: () => boolean) {}
  get(tab: string): DeviceViewport {
    let value = this.states.get(tab);
    if (!value) {
      value = { ...initialDevice, enabled: this.defaultEnabled() };
      this.states.set(tab, value);
    }
    return value;
  }
  set(tab: string, state: DeviceViewport) {
    this.states.set(tab, checkedViewport(state));
  }
  forget(tab: string) {
    this.states.delete(tab);
  }
  inputScale(view: WebContentsView) {
    return this.applied.get(view)?.scale ?? 1;
  }
  present(tab: string, view: WebContentsView, panel: Rectangle, force = false) {
    const state = this.get(tab);
    if (!state.enabled || panel.width <= 0 || panel.height <= 0) {
      if (this.applied.has(view)) {
        view.webContents.disableDeviceEmulation();
        this.applied.delete(view);
      }
      view.setBounds(panel);
      return false;
    }
    const { bounds, scale } = fitViewport(panel, state);
    view.setBounds(bounds);
    const key = [state.width, state.height, scale].join("/");
    if (force || key !== this.applied.get(view)?.key) {
      view.webContents.enableDeviceEmulation({
        screenPosition: "desktop",
        screenSize: { width: state.width, height: state.height },
        viewPosition: { x: 0, y: 0 },
        deviceScaleFactor: 1,
        viewSize: { width: state.width, height: state.height },
        scale,
      });
      this.applied.set(view, { key, scale });
    }
    return true;
  }
}

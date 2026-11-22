"use client";

import { useEffect, useLayoutEffect, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import type { DeviceViewport } from "@/desktop/src/browser/contracts";
import { devices, fitViewport } from "@/desktop/src/browser/device-display";
import { useBrowserCopy } from "./shared";
import styles from "./BrowserTools.module.css";

export function DeviceToolbar({
  viewport,
  host,
  change,
  suspend,
}: {
  viewport: DeviceViewport;
  host: HTMLElement | null;
  change(next: DeviceViewport): void;
  suspend(value: boolean): void;
}) {
  const { copy } = useBrowserCopy();
  const [rect, setRect] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [width, setWidth] = useState(String(viewport.width)),
    [height, setHeight] = useState(String(viewport.height));
  useEffect(() => {
    setWidth(String(viewport.width));
    setHeight(String(viewport.height));
  }, [viewport.width, viewport.height]);
  useEffect(() => () => suspend(false), [suspend]);
  useLayoutEffect(() => {
    if (!host) return;
    const observe = () => setRect({ x: 0, y: 0, width: host.clientWidth, height: host.clientHeight });
    observe();
    const observer = new ResizeObserver(observe);
    observer.observe(host);
    return () => observer.disconnect();
  }, [host]);
  const commit = (axis: "width" | "height", text: string) => {
    const size = Number(text);
    if (!Number.isInteger(size) || size < 160 || size > 4096) {
      setWidth(String(viewport.width));
      setHeight(String(viewport.height));
      return;
    }
    if (size !== viewport[axis]) change({ ...viewport, preset: "responsive", [axis]: size });
  };
  const fit = fitViewport(rect, viewport);
  const drag = (event: PointerEvent<HTMLButtonElement>, axis: "width" | "height") => {
    if (event.button !== 0 || fit.scale <= 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const start = axis === "width" ? event.clientX : event.clientY,
      original = viewport[axis];
    const pointer = event.pointerId;
    handle.setPointerCapture(pointer);
    suspend(true);
    const move = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== pointer) return;
      const delta = (axis === "width" ? 2 * (e.clientX - start) : e.clientY - start) / fit.scale;
      change({
        ...viewport,
        preset: "responsive",
        [axis]: Math.max(160, Math.min(4096, Math.round(original + delta))),
      });
    };
    const done = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("lostpointercapture", done);
      suspend(false);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("lostpointercapture", done);
  };
  return (
    <>
      <div className={styles.device} data-browser-device="">
        <select
          aria-label={copy("设备预设", "Device preset")}
          value={viewport.preset}
          onChange={(event) => {
            const preset = devices.find(([id]) => id === event.target.value);
            if (preset)
              change({
                ...viewport,
                preset: preset[0],
                width: preset[0] === "responsive" ? viewport.width : preset[1],
                height: preset[0] === "responsive" ? viewport.height : preset[2],
              });
          }}
        >
          {devices.map(([id]) => (
            <option key={id} value={id}>
              {id === "responsive" ? copy("响应式", "Responsive") : id}
            </option>
          ))}
        </select>
        {(["width", "height"] as const).map((axis) => (
          <input
            key={axis}
            type="number"
            min="160"
            max="4096"
            aria-label={
              axis === "width" ? copy("逻辑宽度", "Viewport width") : copy("逻辑高度", "Viewport height")
            }
            value={axis === "width" ? width : height}
            onChange={(event) => (axis === "width" ? setWidth : setHeight)(event.target.value)}
            onBlur={(event) => commit(axis, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        ))}
        <button
          type="button"
          onClick={() => change({ ...viewport, width: viewport.height, height: viewport.width })}
        >
          {copy("旋转", "Rotate")}
        </button>
        <select
          aria-label={copy("预览比例", "Preview scale")}
          value={viewport.preview}
          onChange={(e) => change({ ...viewport, preview: Number(e.target.value) })}
        >
          {[0, 0.25, 0.5, 0.75, 1].map((x) => (
            <option key={x} value={x}>
              {x ? x * 100 + "%" : copy("适应面板", "Fit panel")}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label={copy("关闭设备工具栏", "Close device toolbar")}
          onClick={() => change({ ...viewport, enabled: false })}
        >
          ×
        </button>
      </div>
      {host &&
        rect.width > 0 &&
        rect.height > 0 &&
        createPortal(
          <>
            <button
              type="button"
              tabIndex={-1}
              className={styles.sideHandle}
              aria-label={copy("拖动调整宽度", "Drag to resize width")}
              style={{ left: fit.bounds.x + fit.bounds.width, top: 0, height: fit.bounds.height }}
              onPointerDown={(event) => drag(event, "width")}
            />
            <button
              type="button"
              tabIndex={-1}
              className={styles.bottomHandle}
              aria-label={copy("拖动调整高度", "Drag to resize height")}
              style={{ left: fit.bounds.x, top: fit.bounds.height, width: fit.bounds.width }}
              onPointerDown={(event) => drag(event, "height")}
            />
          </>,
          host,
        )}
    </>
  );
}

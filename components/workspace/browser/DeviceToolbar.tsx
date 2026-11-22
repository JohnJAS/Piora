"use client";

import { useEffect, useLayoutEffect, useState, type PointerEvent } from "react";
import { AliIcon } from "@/components/AliIcon";
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
  const drag = (event: PointerEvent<HTMLButtonElement>, horizontal: -1 | 0 | 1, bottom: boolean) => {
    if (event.button !== 0 || fit.scale <= 0) return;
    event.preventDefault();
    const handle = event.currentTarget,
      pointer = event.pointerId;
    const x = event.clientX,
      y = event.clientY;
    handle.setPointerCapture(pointer);
    suspend(true);
    const clamp = (value: number) => Math.max(160, Math.min(4096, Math.round(value)));
    const move = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== pointer) return;
      change({
        ...viewport,
        preset: "responsive",
        width: horizontal
          ? clamp(viewport.width + (horizontal * 2 * (e.clientX - x)) / fit.scale)
          : viewport.width,
        height: bottom ? clamp(viewport.height + (e.clientY - y) / fit.scale) : viewport.height,
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
        <AliIcon name="mobile" size={15} />
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
          <label className={styles.dimension} key={axis}>
            {axis === "height" && <span aria-hidden="true">×</span>}
            <input
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
          </label>
        ))}
        <button
          type="button"
          aria-label={copy("旋转", "Rotate")}
          title={copy("旋转", "Rotate")}
          onClick={() => change({ ...viewport, width: viewport.height, height: viewport.width })}
        >
          <AliIcon name="reload" size={15} />
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
          <AliIcon name="close" size={14} />
        </button>
      </div>
      {host &&
        rect.width > 0 &&
        rect.height > 0 &&
        createPortal(
          <>
            {([-1, 1] as const).map((side) => (
              <button
                key={side}
                type="button"
                tabIndex={-1}
                className={styles.sideHandle}
                aria-label={
                  side < 0
                    ? copy("拖动左边缘调整宽度", "Resize from the left")
                    : copy("拖动右边缘调整宽度", "Resize from the right")
                }
                style={{
                  left: side < 0 ? fit.bounds.x - 6 : fit.bounds.x + fit.bounds.width,
                  top: 0,
                  height: fit.bounds.height,
                }}
                onPointerDown={(event) => drag(event, side, false)}
              />
            ))}
            <button
              type="button"
              tabIndex={-1}
              className={styles.bottomHandle}
              aria-label={copy("拖动调整高度", "Drag to resize height")}
              style={{ left: fit.bounds.x, top: fit.bounds.height, width: fit.bounds.width }}
              onPointerDown={(event) => drag(event, 0, true)}
            />
            {([-1, 1] as const).map((side) => (
              <button
                key={side}
                type="button"
                tabIndex={-1}
                className={styles.cornerHandle}
                aria-label={
                  side < 0
                    ? copy("拖动左下角调整尺寸", "Resize from bottom left")
                    : copy("拖动右下角调整尺寸", "Resize from bottom right")
                }
                style={{
                  left: side < 0 ? fit.bounds.x - 7 : fit.bounds.x + fit.bounds.width - 1,
                  top: fit.bounds.height - 1,
                  cursor: side < 0 ? "nesw-resize" : "nwse-resize",
                }}
                onPointerDown={(event) => drag(event, side, true)}
              />
            ))}
          </>,
          host,
        )}
    </>
  );
}

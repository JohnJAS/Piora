"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  BrowserSection,
  BrowserTarget,
  DeviceViewport,
  MenuChoice,
  Transfer,
} from "@/desktop/src/browser/contracts";
import { BrowserProfileSection } from "./BrowserProfileSection";
import { DeviceToolbar } from "./DeviceToolbar";
import { errorText, openBrowserSettings, useBrowserCopy, type ToolsBridge } from "./shared";
import styles from "./BrowserTools.module.css";

export function BrowserControls({
  bridge,
  sessionId,
  tabId,
  navigationEpoch,
  active,
  slot,
  viewport,
  cover,
  suspend,
  navigate,
  report,
}: {
  bridge: ToolsBridge;
  sessionId: string;
  tabId: string;
  navigationEpoch: number;
  active: boolean;
  slot: HTMLElement | null;
  viewport: HTMLElement | null;
  cover(value: boolean): void;
  suspend(value: boolean): void;
  navigate(url: string): void;
  report(message: string): void;
}) {
  const { locale, copy } = useBrowserCopy(),
    target = useMemo<BrowserTarget>(
      () => ({ sessionId, tabId, navigationEpoch }),
      [sessionId, tabId, navigationEpoch],
    );
  const [section, setSection] = useState<BrowserSection | "recent" | null>(null),
    [finding, setFinding] = useState(false);
  const [device, setDevice] = useState<DeviceViewport | null>(null),
    [query, setQuery] = useState(""),
    [match, setMatch] = useState({ total: 0, index: 0 });
  const [status, setStatus] = useState(""),
    [activity, setActivity] = useState<Transfer | null>(null);
  const input = useRef<HTMLInputElement>(null),
    button = useRef<HTMLButtonElement>(null),
    findQuery = useRef("");
  const alive = useRef(true),
    counter = useRef(0);
  useLayoutEffect(() => {
    cover(section !== null && section !== "recent");
    return () => cover(false);
  }, [cover, section]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      void bridge.tools("dismissMenu", target).catch(() => {});
      void bridge.tools("find", { target, query: "" }).catch(() => {});
    };
  }, [bridge, target]);
  useEffect(() => {
    if (!active) {
      void bridge.tools("dismissMenu", target).catch(() => {});
      return;
    }
    let current = true;
    void bridge
      .tools("device", { target })
      .then((value) => {
        if (current) setDevice(value);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [active, bridge, target]);
  const closeFind = () => {
    findQuery.current = "";
    setFinding(false);
    setQuery("");
    setMatch({ total: 0, index: 0 });
    void bridge.tools("find", { target, query: "" }).catch(() => {});
  };
  const openFind = () => {
    setSection(null);
    setFinding(true);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
    });
  };
  useEffect(() => {
    let live = true,
      tick = 0;
    const refresh = () => {
      const id = ++tick;
      void bridge
        .tools("downloadActivity", null)
        .then((row) => {
          if (live && tick === id) setActivity(row);
        })
        .catch(() => {});
    };
    refresh();
    const off = bridge.onToolsEvent?.((event) => {
      if (event.kind === "library") {
        if (event.section === "downloads") refresh();
        return;
      }
      if (event.target.sessionId !== sessionId || event.target.tabId !== tabId || !active) return;
      if (event.kind === "find") {
        if (event.query === findQuery.current) setMatch({ total: event.matches, index: event.active });
      } else if (event.action === "find") openFind();
      else {
        setFinding(false);
        setSection(event.action);
      }
    });
    return () => {
      live = false;
      off?.();
    };
  }, [active, bridge, sessionId, tabId]);
  const changeDevice = useCallback(
    (next: DeviceViewport) => {
      const id = ++counter.current;
      setDevice(next);
      void bridge
        .tools("device", { target, viewport: next })
        .then((result) => {
          if (alive.current && counter.current === id) setDevice(result);
        })
        .catch((error) => {
          if (alive.current && id === counter.current) report(errorText(error));
        });
    },
    [bridge, report, target],
  );
  const choose = async (choice: MenuChoice | null) => {
    if (!choice || !alive.current) return;
    setStatus("");
    if (choice === "find") {
      openFind();
      return;
    }
    if (choice === "print" || choice === "screenshot") {
      setSection(null);
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (!alive.current) return;
      await bridge.tools("page", { target, action: choice });
      if (alive.current && choice === "screenshot") setStatus(copy("网页截图已复制", "Page screenshot copied"));
    } else if (choice === "settings" || choice === "vault")
      openBrowserSettings(choice === "vault" ? "vault" : "browser");
    else if (choice === "device") {
      setSection(null);
      const previous = await bridge.tools("device", { target });
      if (alive.current) changeDevice({ ...previous, enabled: !previous.enabled });
    } else if (choice === "deviceDefault") {
      const previous = await bridge.tools("deviceDefault", null);
      if (alive.current) await bridge.tools("deviceDefault", !previous);
    } else {
      closeFind();
      setSection(choice);
    }
  };
  const open = async () => {
    if (!button.current) return;
    const bounds = button.current.getBoundingClientRect();
    const dark =
      document.documentElement.getAttribute("data-theme") === "dark" ||
      getComputedStyle(document.documentElement).colorScheme === "dark";
    try {
      const choice = await bridge.tools("menu", { target, x: bounds.right, y: bounds.bottom, locale, dark });
      if (alive.current) {
        button.current?.focus({ preventScroll: true });
        await choose(choice);
      }
    } catch (error) {
      if (alive.current) report(errorText(error));
    }
  };
  const find = (value: string, direction?: "next" | "previous") => {
    if (value !== findQuery.current) setMatch({ total: 0, index: 0 });
    findQuery.current = value;
    setQuery(value);
    void bridge.tools("find", { target, query: value, direction }).catch((e) => {
      if (alive.current) report(errorText(e));
    });
  };
  const downloadsLabel = copy("近期下载", "Recent downloads");
  return (
    <>
      <button
        type="button"
        className={styles.downloadButton}
        aria-label={downloadsLabel}
        title={downloadsLabel}
        onClick={() => {
          closeFind();
          setSection((x) => (x === "recent" ? null : "recent"));
        }}
      >
        <span aria-hidden="true">↓</span>
        {activity?.live && (
          <small>{activity.total > 0 ? Math.floor((100 * activity.received) / activity.total) + "%" : "…"}</small>
        )}
      </button>
      <button
        type="button"
        ref={button}
        data-browser-menu-trigger=""
        aria-haspopup="menu"
        aria-label={copy("浏览器菜单", "Browser menu")}
        title={copy("浏览器菜单", "Browser menu")}
        onClick={() => void open()}
      >
        •••
      </button>
      {slot &&
        createPortal(
          <>
            {status && (
              <div className={styles.status} role="status">
                {status}
                <button type="button" onClick={() => setStatus("")} aria-label={copy("关闭", "Close")}>
                  ×
                </button>
              </div>
            )}
            {finding && (
              <div className={styles.find} role="search" aria-label={copy("在页面中查找", "Find in page")}>
                <input
                  ref={input}
                  aria-label={copy("查找内容", "Find text")}
                  value={query}
                  onChange={(event) => find(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing) return;
                    if (event.key === "Escape") {
                      event.preventDefault();
                      closeFind();
                      button.current?.focus();
                    }
                    if (event.key === "Enter") {
                      event.preventDefault();
                      find(query, event.shiftKey ? "previous" : "next");
                    }
                  }}
                />
                <output aria-live="polite">
                  {match.index} / {match.total}
                </output>
                <button
                  type="button"
                  aria-label={copy("上一个", "Previous match")}
                  disabled={!query}
                  onClick={() => find(query, "previous")}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={copy("下一个", "Next match")}
                  disabled={!query}
                  onClick={() => find(query, "next")}
                >
                  ↓
                </button>
                <button type="button" aria-label={copy("关闭查找", "Close find")} onClick={closeFind}>
                  ×
                </button>
              </div>
            )}
            {device?.enabled && (!section || section === "recent") && (
              <DeviceToolbar viewport={device} host={viewport} change={changeDevice} suspend={suspend} />
            )}
            {section && (
              <BrowserProfileSection
                section={section}
                bridge={bridge}
                target={target}
                close={() => setSection(null)}
                expand={() => setSection("downloads")}
                navigate={(url) => {
                  setSection(null);
                  navigate(url);
                }}
              />
            )}
          </>,
          slot,
        )}
    </>
  );
}

"use client";

/* Browser frames are live, no-store screenshots; Next Image caching is intentionally not applicable. */
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { AliIcon } from "../AliIcon";
import styles from "./WorkspacePanel.module.css";

type BrowserState = {
  ready: true;
  revision: number;
  title: string;
  url: string;
  viewport: { width: number; height: number };
  activeTabIndex: number;
  tabs: Array<{ index: number; title: string; url: string }>;
};

type BrowserAction = {
  action: "navigate" | "back" | "forward" | "reload" | "click" | "type" | "press" | "scroll" | "new_tab" | "switch_tab" | "close_tab";
  url?: string;
  x?: number;
  y?: number;
  text?: string;
  key?: string;
  deltaY?: number;
  tabIndex?: number;
};

export function BrowserPanel({ active }: { active: boolean }) {
  const { t } = useI18n();
  const [state, setState] = useState<BrowserState | null>(null);
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [screenshotKey, setScreenshotKey] = useState(0);
  const keyboardRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);

  const applyState = useCallback((next: BrowserState) => {
    setState(next);
    setAddress(next.url === "about:blank" ? "" : next.url);
    setScreenshotKey((key) => key + 1);
    setError(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/browser", { cache: "no-store" });
      const payload = await response.json() as BrowserState & { error?: string };
      if (!response.ok) throw new Error(payload.error || t("browser.unavailable"));
      setState((previous) => {
        if (!previous || previous.revision !== payload.revision || previous.url !== payload.url) {
          setAddress(payload.url === "about:blank" ? "" : payload.url);
          setScreenshotKey((key) => key + 1);
        }
        return payload;
      });
      setError(null);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : t("browser.unavailable"));
    }
  }, [t]);

  useEffect(() => {
    if (!active) return;
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 900);
    return () => window.clearInterval(timer);
  }, [active, refresh]);

  const act = useCallback(async (input: BrowserAction) => {
    setBusy(true);
    try {
      const response = await fetch("/api/browser", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const payload = await response.json() as BrowserState & { error?: string };
      if (!response.ok) throw new Error(payload.error || t("browser.actionFailed"));
      applyState(payload);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : t("browser.actionFailed"));
    } finally {
      setBusy(false);
      keyboardRef.current?.focus({ preventScroll: true });
    }
  }, [applyState, t]);

  const pressKey = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (composingRef.current || event.key === "Process" || event.key === "Dead") return;
    event.preventDefault();
    if (event.ctrlKey || event.metaKey || event.altKey || event.key.length > 1) {
      const modifiers = [event.ctrlKey ? "Control" : "", event.metaKey ? "Meta" : "", event.altKey ? "Alt" : "", event.shiftKey ? "Shift" : ""].filter(Boolean);
      const key = event.key === " " ? "Space" : event.key;
      void act({ action: "press", key: [...modifiers, key].join("+") });
    } else if (event.key.length === 1) {
      void act({ action: "type", text: event.key });
    }
  };

  return <div className={styles.browserRoot}>
    <div className={styles.browserTabs} role="tablist" aria-label={t("browser.tabs")}>
      {state?.tabs.map((tab) => <button
        key={`${tab.index}-${tab.url}`}
        type="button"
        role="tab"
        aria-selected={state.activeTabIndex === tab.index}
        title={tab.url}
        onClick={() => void act({ action: "switch_tab", tabIndex: tab.index })}
      >
        <AliIcon name="earth" size={13} /><b>{tab.title || t("browser.newTab")}</b>
        <span
          className={styles.browserTabClose}
          role="button"
          aria-label={t("browser.closeTab")}
          onClick={(event) => { event.stopPropagation(); void act({ action: "close_tab", tabIndex: tab.index }); }}
        ><AliIcon name="close" size={11} /></span>
      </button>)}
      <button className={styles.browserNewTab} type="button" aria-label={t("browser.newTab")} onClick={() => void act({ action: "new_tab" })}><AliIcon name="plus" size={14} /></button>
    </div>
    <div className={styles.browserToolbar}>
      <button type="button" aria-label={t("browser.back")} disabled={busy} onClick={() => void act({ action: "back" })}><AliIcon name="arrowleft" size={14} /></button>
      <button type="button" aria-label={t("browser.forward")} disabled={busy} onClick={() => void act({ action: "forward" })}><AliIcon name="arrowright" size={14} /></button>
      <button type="button" aria-label={t("browser.reload")} disabled={busy} onClick={() => void act({ action: "reload" })}><AliIcon name="reload" size={14} /></button>
      <form onSubmit={(event) => { event.preventDefault(); if (address.trim()) void act({ action: "navigate", url: address.trim() }); }}>
        <input value={address} aria-label={t("browser.address")} placeholder={t("browser.addressPlaceholder")} onChange={(event) => setAddress(event.target.value)} />
      </form>
    </div>
    {error ? <div className={styles.browserError} role="alert">{error}</div> : null}
    <div
      className={styles.browserViewport}
      data-busy={busy}
      onPointerDown={(event) => {
        if (!state || state.url === "about:blank") return;
        const bounds = event.currentTarget.getBoundingClientRect();
        void act({
          action: "click",
          x: ((event.clientX - bounds.left) / bounds.width) * state.viewport.width,
          y: ((event.clientY - bounds.top) / bounds.height) * state.viewport.height,
        });
      }}
      onWheel={(event) => { event.preventDefault(); void act({ action: "scroll", deltaY: event.deltaY }); }}
    >
      {state ? <img src={`/api/browser/screenshot?v=${screenshotKey}`} alt={t("browser.pagePreview")} draggable={false} /> : <div className={styles.browserLoading}>{t("browser.starting")}</div>}
      {state?.url === "about:blank" ? <div className={styles.browserStart}>
        <AliIcon name="earth" size={28} />
        <strong>{t("browser.startTitle")}</strong>
        <span>{t("browser.startDescription")}</span>
      </div> : null}
      <textarea
        ref={keyboardRef}
        className={styles.browserKeyboardCapture}
        aria-label={t("browser.keyboardCapture")}
        value=""
        onChange={() => undefined}
        onKeyDown={pressKey}
        onCompositionStart={() => { composingRef.current = true; }}
        onCompositionEnd={(event) => {
          composingRef.current = false;
          if (event.data) void act({ action: "type", text: event.data });
        }}
      />
    </div>
    <div className={styles.browserPrivacy}>{t("browser.profileNotice")}</div>
  </div>;
}

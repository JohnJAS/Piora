"use client";

/* Browser frames are live, no-store screenshots; Next Image caching is intentionally not applicable. */
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { browserWaitPurpose } from "@/lib/browser-wait-policy";
import type {
  DesktopBrowserAction,
  DesktopBrowserAgentActivity,
  DesktopBrowserAgentBackend,
  DesktopBrowserDownload,
  DesktopBrowserState,
  ImportedChromeBookmarkNode,
  ImportedChromeBookmarkProfile,
} from "@/components/sidebar/sidebar-types";
import { useI18n } from "@/hooks/useI18n";
import { nextFollowState } from "@/lib/browser-follow";
import { createBrowserViewportSync, type BrowserViewportBounds } from "@/lib/browser-viewport-sync";
import { browserViewportCovered, observeBrowserViewportOverlays } from "@/lib/browser-viewport-overlays";
import { PANEL_RESIZE_EVENT } from "@/lib/panel-resize-events";
import { pollVisibleDocument } from "@/lib/visible-poller";
import { normalizeAnswerLink, type BrowserNavigationRequest } from "@/lib/answer-links";
import { AliIcon } from "../AliIcon";
import { BrowserAddress } from "./browser/BrowserAddress";
import { BrowserControls } from "./browser/BrowserControls";
import { BrowserHome, type BrowserHomeWorkspace } from "./browser/BrowserHome";
import { openBrowserSettings, type ToolsBridge } from "./browser/shared";
import styles from "./WorkspacePanel.module.css";

type BrowserState = {
  ready: true;
  revision: number;
  title: string;
  url: string;
  viewport: { width: number; height: number };
  cursor: string;
  activeTabIndex: number;
  tabs: Array<{ index: number; title: string; url: string }>;
};

type BrowserAction = {
  action: "navigate" | "back" | "forward" | "reload" | "click" | "mouse_move" | "mouse_down" | "mouse_up" | "resize" | "type" | "press" | "scroll" | "new_tab" | "switch_tab" | "close_tab";
  url?: string;
  x?: number;
  y?: number;
  text?: string;
  key?: string;
  deltaY?: number;
  tabIndex?: number;
  button?: "left" | "middle" | "right";
  width?: number;
  height?: number;
};

const BROWSER_ONBOARDING_KEY = "piora-desktop-browser-onboarding-v1";
const BROWSER_BOOKMARKS_KEY = "piora-desktop-browser-bookmarks-v2";
const BROWSER_FOLLOW_AGENT_KEY = "piora-browser-follow-agent-v1";
const LOGIN_NOTICES = {
  "http-blocked": "browser.loginHttpBlocked", "return-mismatch": "browser.loginReturnMismatch",
  recovering: "browser.loginRecovering", saved: "browser.loginSaved", restored: "browser.loginRestored",
  challenge: "browser.loginChallenge", "no-account": "browser.loginNoAccount", "unsupported-form": "browser.loginUnsupported",
  failed: "browser.loginFailed", timeout: "browser.loginTimeout", cooldown: "browser.loginCooldown",
  unverified: "browser.loginUnverified", unavailable: "browser.loginUnavailable", "save-failed": "browser.loginSaveFailed",
  "save-pending": "browser.loginSavePending", disabled: "browser.loginSaveDisabled",
} as const;

type DesktopBrowserBridge = NonNullable<NonNullable<Window["piDesktop"]>["browser"]>;

function normalizeBookmarkNode(value: unknown, depth = 0): ImportedChromeBookmarkNode | null {
  if (!value || typeof value !== "object" || depth > 100) return null;
  const candidate = value as Partial<ImportedChromeBookmarkNode>;
  if (typeof candidate.id !== "string" || typeof candidate.title !== "string") return null;
  if (candidate.type === "bookmark" && typeof candidate.url === "string") {
    return { id: candidate.id, title: candidate.title, type: "bookmark", url: candidate.url };
  }
  if (candidate.type !== "folder" || !Array.isArray(candidate.children)) return null;
  return {
    children: candidate.children.flatMap((child) => {
      const normalized = normalizeBookmarkNode(child, depth + 1);
      return normalized ? [normalized] : [];
    }),
    id: candidate.id,
    title: candidate.title,
    type: "folder",
  };
}

function legacyBookmarkProfiles(values: unknown[]): ImportedChromeBookmarkProfile[] {
  const profiles = new Map<string, ImportedChromeBookmarkProfile>();
  values.forEach((value, bookmarkIndex) => {
    if (!value || typeof value !== "object") return;
    const legacy = value as { folder?: unknown; profile?: unknown; title?: unknown; url?: unknown };
    if (typeof legacy.profile !== "string" || typeof legacy.title !== "string" || typeof legacy.url !== "string") return;
    const profile = profiles.get(legacy.profile) ?? { children: [], id: legacy.profile, title: legacy.profile };
    profiles.set(legacy.profile, profile);
    let children = profile.children;
    const folders = typeof legacy.folder === "string" ? legacy.folder.split(" / ").filter(Boolean) : [];
    folders.forEach((title, folderIndex) => {
      const folderId = `legacy:${legacy.profile}:${folders.slice(0, folderIndex + 1).join("/")}`;
      let folder = children.find((node) => node.type === "folder" && node.id === folderId);
      if (!folder || folder.type !== "folder") {
        folder = { children: [], id: folderId, title, type: "folder" };
        children.push(folder);
      }
      children = folder.children;
    });
    children.push({ id: `legacy:${legacy.profile}:bookmark:${bookmarkIndex}`, title: legacy.title, type: "bookmark", url: legacy.url });
  });
  return [...profiles.values()];
}

function storedBookmarkProfiles(): ImportedChromeBookmarkProfile[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(BROWSER_BOOKMARKS_KEY) ?? "null") as unknown;
    if (Array.isArray(parsed)) return legacyBookmarkProfiles(parsed);
    if (!parsed || typeof parsed !== "object") return [];
    const profiles = (parsed as { profiles?: unknown }).profiles;
    if (!Array.isArray(profiles)) return [];
    return profiles.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const profile = value as Partial<ImportedChromeBookmarkProfile>;
      if (typeof profile.id !== "string" || typeof profile.title !== "string" || !Array.isArray(profile.children)) return [];
      return [{
        children: profile.children.flatMap((child) => {
          const normalized = normalizeBookmarkNode(child);
          return normalized ? [normalized] : [];
        }),
        id: profile.id,
        title: profile.title,
      }];
    });
  } catch {
    return [];
  }
}

function storeBookmarkProfiles(profiles: ImportedChromeBookmarkProfile[]): void {
  try {
    window.localStorage.setItem(BROWSER_BOOKMARKS_KEY, JSON.stringify({ profiles, version: 2 }));
  } catch {
    // Very large Chrome collections still remain available for this run and
    // are refreshed from Chrome the next time the browser panel opens.
  }
}

function bookmarkCount(nodes: ImportedChromeBookmarkNode[]): number {
  return nodes.reduce((count, node) => count + (node.type === "bookmark" ? 1 : bookmarkCount(node.children)), 0);
}

function bookmarkBarNodes(profiles: ImportedChromeBookmarkProfile[]): ImportedChromeBookmarkNode[] {
  return profiles.flatMap((profile) => profile.children);
}

interface BrowserNavigationProps { navigationRequest?: BrowserNavigationRequest; onNavigationConsumed?: (id: string) => void }
function useRequestedNavigation(request: BrowserNavigationProps["navigationRequest"], ready: boolean, navigate: (input: { action: "navigate" | "new_tab"; url: string }) => Promise<void>, consumed?: (id: string) => void) {
  const previous = useRef<string | null>(null);
  useEffect(() => {
    if (!request || !ready || previous.current === request.id) return;
    const url = normalizeAnswerLink(request.url);
    previous.current = request.id;
    // Acknowledge before starting so a panel remount cannot replay the action.
    consumed?.(request.id);
    if (url) void navigate({ action: request.newTab ? "new_tab" : "navigate", url });
  }, [request, ready, navigate, consumed]);
}

interface BrowserPanelProps extends BrowserNavigationProps {
  active: boolean;
  maximized: boolean;
  sessionId: string | null;
  workspace?: BrowserHomeWorkspace;
}

export function BrowserPanel({ active, maximized, sessionId, workspace, navigationRequest, onNavigationConsumed }: BrowserPanelProps) {
  const { t } = useI18n();
  const [desktopBridge, setDesktopBridge] = useState<DesktopBrowserBridge | null | undefined>(undefined);
  const [agentBackend, setAgentBackend] = useState<DesktopBrowserAgentBackend | null>(null);

  useEffect(() => {
    const browser = window.piDesktop?.browser ?? null;
    setDesktopBridge(browser);
    try {
      window.localStorage.removeItem(BROWSER_FOLLOW_AGENT_KEY);
    } catch {
      // Storage may be unavailable; the retired preference is never read.
    }
    if (!browser?.getAgentBackend) {
      setAgentBackend("playwright");
      return;
    }
    let cancelled = false;
    void browser.getAgentBackend().then((value) => {
      if (!cancelled) setAgentBackend(value === "desktop" ? "desktop" : "playwright");
    }).catch(() => {
      if (!cancelled) setAgentBackend("playwright");
    });
    const unsubscribe = browser.onAgentBackend?.((value) => {
      setAgentBackend(value === "desktop" ? "desktop" : "playwright");
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  if (desktopBridge === undefined || agentBackend === null) {
    return <div className={styles.browserLoading}>{t("browser.starting")}</div>;
  }
  const desktopLinked = agentBackend === "desktop" && desktopBridge !== null;
  return <div className={styles.browserRoot}>
    <div className={styles.browserModeContent}>
      {desktopLinked
        ? <DesktopBrowserPanel linkAgent active={active} bridge={desktopBridge} maximized={maximized} sessionId={sessionId} workspace={workspace} navigationRequest={navigationRequest} onNavigationConsumed={onNavigationConsumed} />
        : desktopBridge
        ? <DesktopBrowserPanel active={active} bridge={desktopBridge} maximized={maximized} sessionId={sessionId} workspace={workspace} navigationRequest={navigationRequest} onNavigationConsumed={onNavigationConsumed} />
        : <ScreenshotBrowserPanel active={active} navigationRequest={navigationRequest} onNavigationConsumed={onNavigationConsumed} />}
    </div>
  </div>;
}

function DesktopBrowserPanel({ active, bridge, maximized, sessionId, workspace, navigationRequest, onNavigationConsumed, linkAgent = false }: BrowserPanelProps & { bridge: DesktopBrowserBridge; linkAgent?: boolean }) {
  const { t } = useI18n();
  const [readySession, setReadySession] = useState<string | null | undefined>(undefined);
  const [state, setState] = useState<DesktopBrowserState | null>(null);
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [bookmarkProfiles, setBookmarkProfiles] = useState<ImportedChromeBookmarkProfile[]>([]);
  const [openBookmarkFolderId, setOpenBookmarkFolderId] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [download, setDownload] = useState<DesktopBrowserDownload | null>(null);
  const [followingAgent, setFollowingAgent] = useState(true);
  const [agentActivity, setAgentActivity] = useState<DesktopBrowserAgentActivity | null>(null);
  const followingRef = useRef(true);
  const resizingRef = useRef(false);
  followingRef.current = followingAgent;
  const viewportRef = useRef<HTMLDivElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  const addressTarget = useRef<Pick<DesktopBrowserState, "sessionId" | "activeTabId"> | null>(null);
  const [toolSlot, setToolSlot] = useState<HTMLDivElement | null>(null);
  const [deviceDragging, setDeviceDragging] = useState(false);
  const viewportSyncRef = useRef<ReturnType<typeof createBrowserViewportSync> | null>(null);
  const viewportLayoutRef = useRef<{ bounds: BrowserViewportBounds; covered: boolean } | null>(null);
  const panelActiveRef = useRef(active);
  panelActiveRef.current = active;

  useLayoutEffect(() => {
    const sync = createBrowserViewportSync((bounds, visible) => bridge.setViewport(bounds, visible));
    viewportSyncRef.current = sync;
    return () => {
      // Closing the right panel unmounts us; passive cleanup may already see
      // viewportRef.current === null. Hide without reading the removed DOM.
      sync.dispose();
      if (viewportSyncRef.current === sync) viewportSyncRef.current = null;
    };
  }, [bridge]);

  const applyState = useCallback((next: DesktopBrowserState | null) => {
    if (!next) return;
    setState(next);
    const tabChanged = next.sessionId !== addressTarget.current?.sessionId || next.activeTabId !== addressTarget.current?.activeTabId;
    addressTarget.current = next;
    if (tabChanged || document.activeElement !== addressRef.current) {
      setAddress(next.url === "about:blank" ? "" : next.url);
    }
    setError(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void bridge.action({ action: "set_session", ...(sessionId ? { sessionId } : {}) }).then((next) => {
      if (!cancelled) { applyState(next); setReadySession(sessionId); }
    }).catch((sessionError) => {
      if (!cancelled) setError(sessionError instanceof Error ? sessionError.message : t("browser.unavailable"));
    });
    return () => { cancelled = true; };
  }, [applyState, bridge, sessionId, t]);

  useEffect(() => {
    let cancelled = false;
    const savedBookmarks = storedBookmarkProfiles();
    setBookmarkProfiles(savedBookmarks);
    const onboardingComplete = window.localStorage.getItem(BROWSER_ONBOARDING_KEY) === "done";
    setShowOnboarding(!onboardingComplete);
    if (onboardingComplete && savedBookmarks.length > 0) {
      void bridge.importChromeBookmarks().then((result) => {
        if (cancelled || !result || result.bookmarkCount === 0) return;
        storeBookmarkProfiles(result.profiles);
        setBookmarkProfiles(result.profiles);
      }).catch(() => {});
    }
    void bridge.getState().then(applyState).catch((stateError) => {
      setError(stateError instanceof Error ? stateError.message : t("browser.unavailable"));
    });
    const unsubscribeState = bridge.onState(applyState);
    const unsubscribeDownload = bridge.onDownload(setDownload);
    return () => {
      cancelled = true;
      unsubscribeState();
      unsubscribeDownload();
    };
  }, [applyState, bridge, t]);


  const syncViewport = useCallback((visible = state?.url !== "about:blank") => {
    const element = viewportRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const panelRect = element.closest("#file-panel")?.getBoundingClientRect();
    const left = Math.max(0, rect.left, panelRect?.left ?? rect.left);
    const top = Math.max(0, rect.top, panelRect?.top ?? rect.top);
    const right = Math.min(window.innerWidth, rect.right, panelRect?.right ?? rect.right);
    const bottom = Math.min(window.innerHeight, rect.bottom, panelRect?.bottom ?? rect.bottom);
    const bounds = {
      x: Math.ceil(left),
      y: Math.ceil(top),
      width: Math.max(0, Math.floor(right) - Math.ceil(left)),
      height: Math.max(0, Math.floor(bottom) - Math.ceil(top)),
    };
    const show = panelActiveRef.current && !deviceDragging && !resizingRef.current && visible && bounds.width > 0 && bounds.height > 0;
    const covered = show && browserViewportCovered(element.ownerDocument, bounds);
    viewportLayoutRef.current = { bounds, covered };
    if (covered) viewportSyncRef.current?.suspend(bounds);
    else viewportSyncRef.current?.sync(bounds, show);
  }, [deviceDragging, state?.url]);

  useLayoutEffect(() => {
    // WebContentsView lives above the renderer DOM and is not clipped by the
    // panel's width animation. Queue an explicit hide before paint so a widened
    // browser view cannot remain over the chat after the panel is collapsed.
    syncViewport(active && state?.url !== "about:blank");
    const document = viewportRef.current?.ownerDocument;
    if (!document || !active || !state?.url || state.url === "about:blank") return;
    // Dialogs rendered into portals do not resize the browser's DOM viewport.
    return observeBrowserViewportOverlays(document, () => {
      const layout = viewportLayoutRef.current;
      if (layout && browserViewportCovered(document, layout.bounds) !== layout.covered) syncViewport();
    });
  }, [active, state?.url, syncViewport]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    let frame = 0;
    const scheduleSync = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => syncViewport());
    };
    const observer = new ResizeObserver(scheduleSync);
    const panel = element.closest("#file-panel");
    observer.observe(element);
    if (panel) observer.observe(panel);
    const resizeChange = (event: Event) => {
      resizingRef.current = (event as CustomEvent<{ resizing: boolean }>).detail?.resizing === true;
      // Hide is sent immediately, including while a prior viewport IPC is in flight.
      // On release measure the committed DOM bounds on the next frame.
      if (resizingRef.current) syncViewport(false); else scheduleSync();
    };
    window.addEventListener(PANEL_RESIZE_EVENT, resizeChange);
    window.addEventListener("resize", scheduleSync);
    window.addEventListener("scroll", scheduleSync, true);
    panel?.addEventListener("transitionend", scheduleSync);
    scheduleSync();
    // ResizeObserver does not report position-only layout changes.
    let previousRect = "";
    const positionCheck = window.setInterval(() => {
      if (!panelActiveRef.current || document.hidden) return;
      const rect = element.getBoundingClientRect();
      const key = [rect.left, rect.top, rect.width, rect.height].map(Math.round).join(",");
      if (key === previousRect) return;
      previousRect = key;
      scheduleSync();
    }, 250);
    return () => {
      window.clearInterval(positionCheck);
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener(PANEL_RESIZE_EVENT, resizeChange);
      window.removeEventListener("resize", scheduleSync);
      window.removeEventListener("scroll", scheduleSync, true);
      panel?.removeEventListener("transitionend", scheduleSync);
      syncViewport(false);
    };
  }, [syncViewport]);

  useEffect(() => {
    syncViewport();
    const frame = window.requestAnimationFrame(() => window.requestAnimationFrame(() => syncViewport()));
    const settle = window.setTimeout(() => syncViewport(), 240);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settle);
    };
  }, [maximized, syncViewport]);

  const act = useCallback(async (input: DesktopBrowserAction) => {
    try {
      applyState(await bridge.action(input));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : t("browser.actionFailed"));
    }
  }, [applyState, bridge, t]);

  const navigateRequested = useCallback(async (input: { action: "navigate" | "new_tab"; url: string }) => {
    if (input.action === "new_tab") {
      followingRef.current = false;
      setFollowingAgent(false);
    }
    await act(input);
  }, [act]);
  useRequestedNavigation(navigationRequest, active && Boolean(state) && readySession === sessionId, navigateRequested, onNavigationConsumed);

  useEffect(() => {
    if (!linkAgent) return;
    setFollowingAgent(true);
    followingRef.current = true;
    setAgentActivity(null);
  }, [linkAgent, active, sessionId]);

  useEffect(() => {
    if (!linkAgent || !active) return;
    void act({ action: "show_agent_tab" });
  }, [linkAgent, active, sessionId, act]);

  useEffect(() => {
    if (!linkAgent || !bridge.onAgentActivity) return;
    return bridge.onAgentActivity((event) => {
      if (!sessionId || event.sessionId !== sessionId) return;
      setAgentActivity(event);
      if (followingRef.current && event.tabId) void act({ action: "switch_tab", tabId: event.tabId });
    });
  }, [linkAgent, bridge, sessionId, act]);

  useEffect(() => {
    if (!linkAgent) return;
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
      if (!sessionId || detail?.sessionId !== sessionId) return;
      setFollowingAgent(true);
      followingRef.current = true;
      void act({ action: "show_agent_tab" });
    };
    window.addEventListener("piora:open-agent-browser", onOpen);
    return () => window.removeEventListener("piora:open-agent-browser", onOpen);
  }, [linkAgent, sessionId, act]);

  const finishOnboarding = () => {
    window.localStorage.setItem(BROWSER_ONBOARDING_KEY, "done");
    setShowOnboarding(false);
  };

  const importChromeBookmarks = async () => {
    setImporting(true);
    setError(null);
    try {
      const result = await bridge.importChromeBookmarks();
      if (!result || result.bookmarkCount === 0) {
        setError(t("browser.importNoChrome"));
        return;
      }
      storeBookmarkProfiles(result.profiles);
      setBookmarkProfiles(result.profiles);
      setOpenBookmarkFolderId(null);
      finishOnboarding();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : t("browser.importFailed"));
    } finally {
      setImporting(false);
    }
  };

  const blank = !state || state.url === "about:blank";
  const ready = readySession === sessionId;
  const showHome = ready && blank && !state?.vaultProtected;
  const barNodes = bookmarkBarNodes(bookmarkProfiles);
  const openBookmarkMenu = async (node: ImportedChromeBookmarkNode, button: HTMLButtonElement) => {
    if (node.type !== "folder") return;
    const rect = button.getBoundingClientRect();
    setOpenBookmarkFolderId(node.id);
    try {
      // A native popup renders above WebContentsView without resizing or hiding
      // the live page. Its submenus also provide keyboard and Escape handling.
      const url = await bridge.showBookmarkMenu(node.children, { x: rect.left, y: rect.bottom });
      if (url) await act({ action: "navigate", url });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("browser.actionFailed"));
    } finally {
      setOpenBookmarkFolderId(null);
      button.focus({ preventScroll: true });
    }
  };
  const downloadLabel = download?.state === "completed"
    ? t("browser.downloadComplete", { filename: download.filename })
    : download?.state === "cancelled"
      ? t("browser.downloadCancelled", { filename: download.filename })
      : download?.state === "interrupted"
        ? t("browser.downloadInterrupted", { filename: download.filename })
        : download
          ? t("browser.downloading", { filename: download.filename, percent: download.percent })
          : null;

  const agentTabId = agentActivity?.sessionId === sessionId ? agentActivity.tabId : (state?.agentTabId ?? null);
  const agentOperating = agentActivity?.sessionId === sessionId ? agentActivity.operating : Boolean(state?.agentOperating);
  const agentWaiting = agentActivity?.sessionId === sessionId ? agentActivity.waiting === true : Boolean(state?.agentWaiting);
  const agentWaitReason = agentActivity?.sessionId === sessionId ? (agentActivity.reason || "") : (state?.agentWaitReason || "");
  const loginWaiting = browserWaitPurpose(agentWaitReason, agentActivity?.sessionId === sessionId ? agentActivity.purpose : state?.agentWaitPurpose) === "login";
  const decideWait = async (decision: "continue" | "cancel") => {
    if (!sessionId) return;
    try {
      const lookup = await fetch(`/api/agent/${encodeURIComponent(sessionId)}/browser-wait`, { cache: "no-store" });
      const current = await lookup.json().catch(() => null) as { wait?: { toolCallId?: unknown } | null; error?: string } | null;
      const toolCallId = current?.wait && typeof current.wait.toolCallId === "string" ? current.wait.toolCallId : "";
      if (!lookup.ok || !toolCallId) {
        setError(current?.error || t("browser.actionFailed"));
        return;
      }
      const response = await fetch(`/api/agent/${encodeURIComponent(sessionId)}/browser-wait`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, toolCallId }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        setError(payload?.error || t("browser.actionFailed"));
      }
    } catch (decideError) {
      setError(decideError instanceof Error ? decideError.message : t("browser.actionFailed"));
    }
  };
  return <div className={styles.browserRoot} data-native-browser="true" data-browser-chrome={bridge.tools ? "menu" : undefined}>
    {state?.loginNotice ? <div className={styles.browserAgentOperating} role="status" data-browser-login-notice={state.loginNotice}>
      <span>{t(LOGIN_NOTICES[state.loginNotice as keyof typeof LOGIN_NOTICES] ?? "browser.loginUnverified")}</span>
    </div> : null}
    {state?.vaultProtected ? <div className={styles.browserAgentOperating} role="status">
      <span>{t("browser.vaultProtected")}</span>
      <button type="button" onClick={() => { void window.piDesktop?.vault?.request({ action: "release" }).catch(() => setError(t("browser.actionFailed"))); }}>{t("browser.vaultRelease")}</button>
    </div> : state?.vaultMatches ? <div className={styles.browserAgentOperating} role="status">
      <span>{t("browser.vaultMatches")}</span>
      <button type="button" onClick={() => void act({ action: "configure_login" })}>{t("browser.vaultChoose")}</button>
    </div> : null}
    {linkAgent && !state?.vaultProtected && (agentOperating || agentWaiting) ? <div className={styles.browserAgentOperating} role="status">
      {agentWaiting ? <>
        <span>{loginWaiting ? t("browser.loginWaiting") : (agentWaitReason || t("browser.waitTitle"))}</span>
        <span className={styles.browserAgentActions}>
          {!loginWaiting && <button type="button" onClick={() => void decideWait("continue")}>{t("browser.waitContinue")}</button>}
          <button type="button" onClick={() => void decideWait("cancel")}>{t("browser.waitCancel")}</button>
        </span>
      </> : <span>{t("browser.agentOperating")}</span>}
    </div> : null}
    <div className={styles.browserTabs} role="tablist" aria-label={t("browser.tabs")}>
      {state?.tabs.map((tab) => <button
        key={tab.id}
        type="button"
        role="tab"
        aria-selected={state.activeTabId === tab.id}
        title={tab.url}
        onClick={() => {
          if (linkAgent) {
            const follow = nextFollowState(tab.id, agentTabId);
            setFollowingAgent(follow);
            followingRef.current = follow;
          }
          void act({ action: "switch_tab", tabId: tab.id });
        }}
      >
        <AliIcon name="earth" size={13} /><b>{tab.title || t("browser.newTab")}</b>
        {linkAgent && !followingAgent && agentTabId === tab.id ? <span
          className={styles.browserAgentMarker}
          role="button"
          onClick={(event) => {
            event.stopPropagation();
            setFollowingAgent(true);
            followingRef.current = true;
            void act({ action: "switch_tab", tabId: tab.id });
          }}
        >{t("browser.agentMarker")}</span> : null}
        <span
          className={styles.browserTabClose}
          role="button"
          aria-label={t("browser.closeTab")}
          onClick={(event) => { event.stopPropagation(); void act({ action: "close_tab", tabId: tab.id }); }}
        ><AliIcon name="close" size={11} /></span>
      </button>)}
      <button className={styles.browserNewTab} type="button" aria-label={t("browser.newTab")} disabled={state?.tabCount !== undefined && state.tabCount >= (state.tabLimit ?? 20) && !state.idleTabCount} onClick={() => void act({ action: "new_tab" })}><AliIcon name="plus" size={14} /></button>
    </div>
    {state?.tabCount !== undefined && state.tabCount >= (state.tabLimit ?? 20) ? <div className={styles.browserError} role="status">{t("browser.tabLimitReached", { limit: state.tabLimit ?? 20 })}</div> : null}
    <div className={styles.browserToolbar} data-home={showHome ? "true" : undefined}>
      {(!showHome || state?.canGoBack || state?.canGoForward) && <div className={styles.browserNavigation}>
      <button type="button" aria-label={t("browser.back")} disabled={!state?.canGoBack} onClick={() => void act({ action: "back" })}><AliIcon name="arrowleft" size={14} /></button>
      <button type="button" aria-label={t("browser.forward")} disabled={!state?.canGoForward} onClick={() => void act({ action: "forward" })}><AliIcon name="arrowright" size={14} /></button>
      {!showHome && <button type="button" aria-label={t("browser.reload")} disabled={!state} onClick={() => void act({ action: "reload" })}><AliIcon name="reload" size={14} /></button>}
      </div>}
      {ready && !showHome && <BrowserAddress key={state?.activeTabId ?? "starting"} value={address} change={setAddress} inputRef={addressRef} label={t("browser.address")}
        placeholder={t("browser.searchOrAddressPlaceholder")} invoke={bridge.tools} slot={toolSlot} navigate={url => void act({action:"navigate", url})} />}
      {!showHome && <button type="button" aria-label={t("browser.siteLogin")} title={t("browser.siteLogin")} disabled={!state || blank} onClick={() => void act({ action: "configure_login" })}><AliIcon name="lock" size={14} /></button>}
      {bridge.tools && !barNodes.length && !(showHome && showOnboarding) && <button type="button" disabled={importing} aria-label={t("browser.refreshBookmarks")} title={t("browser.refreshBookmarks")} onClick={() => void importChromeBookmarks()}><AliIcon name="bookmark" size={15} /></button>}
      {state && bridge.tools && <BrowserControls key={[state.sessionId, state.activeTabId, state.navigationEpoch].join("/")} bridge={bridge as ToolsBridge} navigationEpoch={state.navigationEpoch ?? 0}
        sessionId={state.sessionId} tabId={state.activeTabId} active={active} slot={toolSlot} viewport={viewportRef.current}
        suspend={setDeviceDragging} report={setError} />}
    </div>
    {(!bridge.tools || barNodes.length > 0) && <div className={styles.browserBookmarkBar} aria-label={t("browser.bookmarkBar")}>
      {!bridge.tools && <div className={styles.browserZoom} role="group" aria-label={t("browserPreferences.zoom")}>
        <button type="button" disabled={!state || blank} aria-label={t("browserPreferences.zoomOut")} onClick={() => void act({ action: "zoom_out" })}>−</button>
        <button type="button" disabled={!state || blank} title={t("browserPreferences.zoomReset")} aria-label={t("browserPreferences.zoomReset")} onClick={() => void act({ action: "zoom_reset" })}>{Math.round((state?.zoomFactor ?? 1) * 100)}%</button>
        <button type="button" disabled={!state || blank} aria-label={t("browserPreferences.zoomIn")} onClick={() => void act({ action: "zoom_in" })}>+</button>
      </div>}
      <div className={styles.browserBookmarkBarItems}>
        {barNodes.length ? barNodes.map((node) => node.type === "bookmark" ? (
          <button key={node.id} type="button" title={`${node.title}\n${node.url}`} onClick={() => void act({ action: "navigate", url: node.url })}>
            <AliIcon name="earth" size={12} /><span>{node.title}</span>
          </button>
        ) : (
          <button
            key={node.id}
            type="button"
            aria-expanded={openBookmarkFolderId === node.id}
            aria-haspopup="menu"
            title={`${node.title} · ${t("browser.bookmarkCount", { count: bookmarkCount(node.children) })}`}
            onClick={(event) => void openBookmarkMenu(node, event.currentTarget)}
          >
            <AliIcon name={openBookmarkFolderId === node.id ? "folder-open" : "folder"} size={13} /><span>{node.title}</span>
          </button>
        )) : <span className={styles.browserBookmarkBarEmpty}>{t("browser.bookmarkBarEmpty")}</span>}
      </div>
      <button
        className={styles.browserBookmarkRefresh}
        type="button"
        disabled={importing}
        title={t("browser.refreshBookmarks")}
        aria-label={t("browser.refreshBookmarks")}
        onClick={() => void importChromeBookmarks()}
      >
        <AliIcon name="reload" size={12} />
      </button>
    </div>}
    {error ? <div className={styles.browserError} role="alert">{error}</div> : null}
    <div ref={setToolSlot} style={{ flex: "0 1 auto", minHeight: 0, maxHeight: "55%", overflow: "auto" }} />
    <div ref={viewportRef} className={styles.browserViewport} data-browser-viewport="" data-busy={state?.loading ? "true" : undefined}>
      {!ready && !error && <div className={styles.browserLoading} role="status">{t("browser.starting")}</div>}
      {showHome && <BrowserHome
        key={state?.activeTabId ?? "empty"}
        active={active}
        address={address}
        changeAddress={setAddress}
        addressRef={addressRef}
        navigate={url => void act({ action: "navigate", url })}
        history={bridge.tools}
        workspace={workspace}
        onHistory={bridge.tools ? () => openBrowserSettings("history") : undefined}
        bookmarks={showOnboarding ? { importing, onImport: () => void importChromeBookmarks(), onDismiss: finishOnboarding } : undefined}
      />}
    </div>
    {(!showHome || download) && <div className={styles.browserPrivacy}>
      {download ? <button type="button" onClick={() => download.path && window.piDesktop?.revealPath?.(download.path)}>
        {downloadLabel}
      </button> : t("browser.profileNotice")}
    </div>}
  </div>;
}

function ScreenshotBrowserPanel({ active, navigationRequest, onNavigationConsumed }: { active: boolean } & BrowserNavigationProps) {
  const { t } = useI18n();
  const [state, setState] = useState<BrowserState | null>(null);
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [screenshotKey, setScreenshotKey] = useState(0);
  const keyboardRef = useRef<HTMLTextAreaElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  const pointerMoveRef = useRef<{ x: number; y: number } | null>(null);
  const pointerMoveInFlightRef = useRef(false);
  const actionQueueRef = useRef<Promise<void>>(Promise.resolve());
  const hoverRefreshTimerRef = useRef<number | null>(null);

  const applyState = useCallback((next: BrowserState) => {
    setState(next);
    setAddress(next.url === "about:blank" ? "" : next.url);
    setScreenshotKey((key) => key + 1);
    setError(null);
  }, []);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/browser", { cache: "no-store", signal });
      const payload = await response.json() as BrowserState & { error?: string };
      if (signal?.aborted) return;
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
      if (signal?.aborted) return;
      const message = refreshError instanceof Error ? refreshError.message : t("browser.unavailable");
      setError(message);
    }
  }, [t]);

  useEffect(() => {
    if (!active) return;
    const polling = pollVisibleDocument(refresh, 900);
    return () => polling.stop();
  }, [active, refresh]);

  const act = useCallback((input: BrowserAction, options: { transient?: boolean; focusKeyboard?: boolean; refreshScreenshot?: boolean } = {}) => {
    if (!options.transient) setBusy(true);
    const queued = actionQueueRef.current.catch(() => undefined).then(async () => {
      try {
        const response = await fetch("/api/browser", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        const payload = await response.json() as BrowserState & { error?: string };
        if (!response.ok) throw new Error(payload.error || t("browser.actionFailed"));
        if (options.transient) {
          setState(payload);
          setError(null);
          if (options.refreshScreenshot) setScreenshotKey((key) => key + 1);
        } else {
          applyState(payload);
        }
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : t("browser.actionFailed"));
      } finally {
        if (!options.transient) setBusy(false);
        if (options.focusKeyboard !== false) keyboardRef.current?.focus({ preventScroll: true });
      }
    });
    actionQueueRef.current = queued;
    return queued;
  }, [applyState, t]);

  useRequestedNavigation(navigationRequest, active && Boolean(state), act, onNavigationConsumed);

  useEffect(() => {
    if (!active || !viewportRef.current) return;
    let lastSize = "";
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      if (width < 1 || height < 1) return;
      const size = `${width}x${height}`;
      if (size === lastSize) return;
      lastSize = size;
      void act({ action: "resize", width, height }, { transient: true, focusKeyboard: false, refreshScreenshot: true });
    });
    observer.observe(viewportRef.current);
    return () => observer.disconnect();
  }, [active, act]);

  useEffect(() => () => {
    if (hoverRefreshTimerRef.current !== null) window.clearTimeout(hoverRefreshTimerRef.current);
  }, []);

  const pointerCoordinates = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!state) return null;
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * state.viewport.width,
      y: ((event.clientY - bounds.top) / bounds.height) * state.viewport.height,
    };
  };

  const browserButton = (button: number): "left" | "middle" | "right" => button === 1 ? "middle" : button === 2 ? "right" : "left";

  const flushPointerMove = async () => {
    if (pointerMoveInFlightRef.current) return;
    const pending = pointerMoveRef.current;
    if (!pending) return;
    pointerMoveRef.current = null;
    pointerMoveInFlightRef.current = true;
    await act({ action: "mouse_move", ...pending }, { transient: true, focusKeyboard: false });
    pointerMoveInFlightRef.current = false;
    if (hoverRefreshTimerRef.current !== null) window.clearTimeout(hoverRefreshTimerRef.current);
    hoverRefreshTimerRef.current = window.setTimeout(() => {
      hoverRefreshTimerRef.current = null;
      setScreenshotKey((key) => key + 1);
    }, 90);
    if (pointerMoveRef.current) void flushPointerMove();
  };

  const queuePointerMove = (coordinates: { x: number; y: number }) => {
    pointerMoveRef.current = coordinates;
    void flushPointerMove();
  };

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
      ref={viewportRef}
      className={styles.browserViewport}
      data-busy={busy}
      style={{ cursor: state?.cursor || "default" }}
      onPointerDown={(event) => {
        if (!state || state.url === "about:blank") return;
        const coordinates = pointerCoordinates(event);
        if (!coordinates) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        keyboardRef.current?.focus({ preventScroll: true });
        void act({ action: "mouse_down", ...coordinates, button: browserButton(event.button) }, { transient: true });
      }}
      onPointerMove={(event) => {
        const coordinates = pointerCoordinates(event);
        if (coordinates) queuePointerMove(coordinates);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        const coordinates = pointerCoordinates(event);
        void act({ action: "mouse_up", ...(coordinates ?? {}), button: browserButton(event.button) }, { transient: true, refreshScreenshot: true });
      }}
      onPointerCancel={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        const coordinates = pointerCoordinates(event);
        void act({ action: "mouse_up", ...(coordinates ?? {}), button: browserButton(event.button) }, { transient: true, focusKeyboard: false, refreshScreenshot: true });
      }}
      onContextMenu={(event) => event.preventDefault()}
      onWheel={(event) => { event.preventDefault(); void act({ action: "scroll", deltaY: event.deltaY }, { transient: true, focusKeyboard: false, refreshScreenshot: true }); }}
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
    <div className={styles.browserPrivacy}>{t("browser.backgroundProfileNotice")}</div>
  </div>;
}

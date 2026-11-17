"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { copyText } from "@/lib/clipboard";
import { resolveLocalFileHref } from "@/lib/file-links";
import { FILE_REFERENCE_HREF, formatFileReference, parseFileReference, resolveFileReferenceTarget } from "@/lib/file-references";
import { useI18n } from "@/hooks/useI18n";
import { AliIcon } from "./AliIcon";
import styles from "./ChatContentContextMenu.module.css";

type Target = { text: string; path?: string; filePath?: string; openPath?: string; href?: string };
type MenuState = { x: number; y: number; target: Target; selection: string; source: HTMLElement };

function contextTarget(element: Element, cwd?: string): Target {
  const control = element.closest<HTMLElement>("[data-chat-file-path], a[href]")
    ?? element.closest<HTMLElement>("button, [role=button], code");
  if (!control) return { text: "" };
  const text = control.textContent?.trim() ?? "";
  const href = control.getAttribute("href") ?? "";
  let path = control.getAttribute("data-chat-file-path");
  if (!path && href.startsWith(FILE_REFERENCE_HREF)) {
    try { path = decodeURIComponent(href.slice(FILE_REFERENCE_HREF.length)); } catch { /* Leave malformed links inert. */ }
  } else if (!path && resolveLocalFileHref(href, cwd)) {
    try { path = decodeURIComponent(href); } catch { path = href; }
  } else if (!path && control.tagName === "CODE" && !control.closest("pre")
    && (parseFileReference(text) || /^(?:[a-z]:[\\/]|\\\\|\/|\.\.?[\\/]|file:\/\/)/i.test(text))) {
    path = text;
  }
  if (path) {
    const resolved = /[\x00-\x1f\x7f]/.test(path) ? null : resolveFileReferenceTarget(path, cwd);
    const reference = parseFileReference(path);
    const target = resolved ? formatFileReference({ path: resolved.filePath, line: resolved.line, column: resolved.column }) : path;
    return { text, path: target, filePath: resolved?.filePath, openPath: resolved && reference ? target : undefined };
  }
  return { text, ...(href && !href.startsWith(FILE_REFERENCE_HREF) ? { href: control instanceof HTMLAnchorElement ? control.href : href } : {}) };
}

/** One delegated menu per message, including links nested in tool result cards. */
export function ChatContentContextMenu({ children, cwd, onOpenFile }: { children: ReactNode; cwd?: string; onOpenFile?: (path: string) => void }) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const close = useCallback(() => setMenu(null), []);
  const show = (element: Element, container: HTMLElement, x: number, y: number) => {
    // Editors retain their native cut/copy/paste menu.
    if (element.closest("input, textarea, [contenteditable=true], [role=textbox]")) return false;
    const selection = window.getSelection();
    const selectedText = selection?.anchorNode && selection.focusNode
      && container.contains(selection.anchorNode) && container.contains(selection.focusNode) ? selection.toString() : "";
    const target = contextTarget(element, cwd);
    if (!target.text && !target.path && !target.href && !selectedText) return false;
    const source = element.closest<HTMLElement>("a, button, [tabindex]") ?? container;
    const bounds = element.getBoundingClientRect();
    setMenu({ target, selection: selectedText, source, x: x || bounds.left, y: y || bounds.bottom });
    return true;
  };

  return <div className={styles.container}
    onContextMenu={event => {
      if (event.defaultPrevented || !(event.target instanceof Element)) return;
      if (show(event.target, event.currentTarget, event.clientX, event.clientY)) { event.preventDefault(); event.stopPropagation(); }
    }}
    onKeyDown={event => {
      if (event.defaultPrevented || !(event.target instanceof Element)) return;
      if ((event.key === "ContextMenu" || event.key === "F10" && event.shiftKey) && show(event.target, event.currentTarget, 0, 0)) {
        event.preventDefault(); event.stopPropagation();
      }
    }}>
    {children}
    {menu ? <ContentMenu key={`${menu.x}:${menu.y}:${menu.target.path ?? menu.target.href ?? menu.target.text}`} menu={menu} onClose={close} onOpenFile={onOpenFile} /> : null}
  </div>;
}

function ContentMenu({ menu, onClose, onOpenFile }: { menu: MenuState; onClose: () => void; onOpenFile?: (path: string) => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  const desktop = window.piDesktop;
  const closeAndRestoreFocus = () => {
    if (menu.source.isConnected) menu.source.focus({ preventScroll: true });
    onClose();
  };

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    element.style.left = `${Math.max(6, Math.min(menu.x, window.innerWidth - bounds.width - 6))}px`;
    element.style.top = `${Math.max(6, Math.min(menu.y, window.innerHeight - bounds.height - 6))}px`;
  }, [menu, error]);

  useEffect(() => {
    active.current = true;
    ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
    const outside = (event: Event) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("scroll", outside, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      active.current = false;
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("scroll", outside, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  const run = async (action: () => Promise<unknown>, errorKey: string) => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const result = await action();
      if (!active.current) return;
      if (result === false) { setError(t(errorKey)); return; }
      closeAndRestoreFocus();
    } catch { if (active.current) setError(t(errorKey)); }
    finally { if (active.current) setBusy(false); }
  };
  const copy = (value: string) => { void run(() => copyText(value), "chatContext.copyFailed"); };
  const { target, selection } = menu;

  return createPortal(<div ref={ref} className={styles.menu} role="menu" aria-label={t("chatContext.menu")} aria-busy={busy}
    style={{ left: menu.x, top: menu.y }} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); closeAndRestoreFocus(); return; }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const index = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
        : (current + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
      items[index]?.focus();
    }}>
    {selection ? <button type="button" role="menuitem" aria-disabled={busy} onClick={() => copy(selection)}><AliIcon name="copy" size={15} />{t("chatContext.copySelection")}</button> : null}
    {target.path ? <>
      <button type="button" role="menuitem" aria-disabled={busy} onClick={() => copy(target.path!)}><AliIcon name="copy" size={15} />{t("files.copyPath")}</button>
      {target.filePath && target.filePath !== target.path ? <button type="button" role="menuitem" aria-disabled={busy} onClick={() => copy(target.filePath!)}><AliIcon name="copy" size={15} />{t("chatContext.copyFilePath")}</button> : null}
      <button type="button" role="menuitem" aria-disabled={busy || !target.filePath || !desktop?.revealPath} disabled={!target.filePath || !desktop?.revealPath}
        title={!desktop?.revealPath ? t("chatContext.desktopOnly") : undefined}
        onClick={() => { void run(() => target.filePath && desktop?.revealPath ? desktop.revealPath(target.filePath) : Promise.resolve(false), "chatContext.revealFailed"); }}><AliIcon name="folder-open" size={15} />{t("chatContext.reveal")}</button>
      {target.openPath && onOpenFile ? <button type="button" role="menuitem" aria-disabled={busy} onClick={() => { if (busy) return; closeAndRestoreFocus(); onOpenFile(target.openPath!); }}><AliIcon name="file" size={15} />{t("files.openInPiora")}</button> : null}
    </> : target.href ? <button type="button" role="menuitem" aria-disabled={busy} onClick={() => copy(target.href!)}><AliIcon name="link" size={15} />{t("chatContext.copyLink")}</button> : null}
    {target.text && target.text !== selection && target.text !== (target.path ?? target.href) ? <button type="button" role="menuitem" aria-disabled={busy} onClick={() => copy(target.text)}><AliIcon name="copy" size={15} />{t("chatContext.copyText")}</button> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
  </div>, document.body);
}

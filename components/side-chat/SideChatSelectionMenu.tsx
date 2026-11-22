"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { AliIcon } from "../AliIcon";
import styles from "./SideChat.module.css";

interface Props {
  containerRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  onAskSelection: (selectedText: string) => void;
}

interface PillPosition {
  text: string;
  left: number;
  top: number;
}

function isInteractiveSelectionTarget(node: Node | null): boolean {
  const el = node instanceof Element ? node : node?.parentElement;
  if (!el) return false;
  return Boolean(el.closest('input, textarea, button, select, [contenteditable="true"], [data-no-side-selection]'));
}

/**
 * Floating "Ask in side chat" pill anchored above selected main-transcript text.
 * Matches Codex Desktop's transcript selection affordance.
 */
export function SideChatSelectionMenu({ containerRef, enabled, onAskSelection }: Props) {
  const { t } = useI18n();
  const [pill, setPill] = useState<PillPosition | null>(null);

  const syncSelection = useCallback(() => {
    const container = containerRef.current;
    if (!enabled || !container || typeof window === "undefined") {
      setPill(null);
      return;
    }
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      setPill(null);
      return;
    }
    const text = selection.toString().trim();
    if (!text) {
      setPill(null);
      return;
    }
    const range = selection.getRangeAt(0);
    const anchorInContainer = Boolean(selection.anchorNode && container.contains(selection.anchorNode));
    const focusInContainer = Boolean(selection.focusNode && container.contains(selection.focusNode));
    if (!anchorInContainer || !focusInContainer) {
      setPill(null);
      return;
    }
    if (isInteractiveSelectionTarget(selection.anchorNode) || isInteractiveSelectionTarget(selection.focusNode)) {
      setPill(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) {
      setPill(null);
      return;
    }
    const containerRect = container.getBoundingClientRect();
    if (rect.bottom < containerRect.top || rect.top > containerRect.bottom) {
      setPill(null);
      return;
    }
    const left = Math.min(Math.max(88, rect.left + rect.width / 2), window.innerWidth - 88);
    const top = Math.max(44, rect.top - 8);
    setPill({ text, left, top });
  }, [containerRef, enabled]);

  useEffect(() => {
    if (!enabled) {
      setPill(null);
      return;
    }
    const handleUpdate = () => syncSelection();
    const container = containerRef.current;
    document.addEventListener("selectionchange", handleUpdate);
    window.addEventListener("resize", handleUpdate);
    container?.addEventListener("mouseup", handleUpdate);
    container?.addEventListener("keyup", handleUpdate);
    container?.addEventListener("scroll", handleUpdate, { passive: true });
    return () => {
      document.removeEventListener("selectionchange", handleUpdate);
      window.removeEventListener("resize", handleUpdate);
      container?.removeEventListener("mouseup", handleUpdate);
      container?.removeEventListener("keyup", handleUpdate);
      container?.removeEventListener("scroll", handleUpdate);
    };
  }, [containerRef, enabled, syncSelection]);

  if (!pill || typeof document === "undefined") return null;

  return createPortal(
    <button
      type="button"
      className={styles.selectionPill}
      data-testid="side-chat-selection-pill"
      style={{ left: pill.left, top: pill.top }}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        const text = pill.text;
        setPill(null);
        window.getSelection()?.removeAllRanges();
        onAskSelection(text);
      }}
    >
      <AliIcon name="chat-bubble-plus" size={13} />
      <span>{t("sideChat.askInSideChat")}</span>
    </button>,
    document.body,
  );
}

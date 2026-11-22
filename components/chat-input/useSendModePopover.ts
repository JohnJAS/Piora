"use client";

import { useCallback, useEffect, useId, useRef } from "react";

export function useSendModePopover() {
  const sendModeMenuId = useId();
  const sendModeMenuRef = useRef<HTMLDivElement>(null);
  const sendModeButtonRef = useRef<HTMLDivElement>(null);
  const sendModeHoverDismissedRef = useRef(false);
  const sendModeCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const keepSendModeOpen = useCallback(() => {
    if (sendModeCloseTimerRef.current) clearTimeout(sendModeCloseTimerRef.current);
    sendModeCloseTimerRef.current = null;
  }, []);

  const closeSendModeMenu = useCallback(() => {
    keepSendModeOpen();
    // The revealed trigger remains under the pointer; wait for it to leave
    // before accepting another hover, including after an Escape dismissal.
    sendModeHoverDismissedRef.current = true;
    sendModeMenuRef.current?.hidePopover();
  }, [keepSendModeOpen]);

  const scheduleSendModeClose = useCallback(() => {
    keepSendModeOpen();
    sendModeCloseTimerRef.current = setTimeout(() => {
      const menu = sendModeMenuRef.current;
      if (!menu?.matches(":hover") && !sendModeButtonRef.current?.matches(":hover") && !menu?.contains(document.activeElement)) {
        menu?.hidePopover();
      }
    }, 180);
  }, [keepSendModeOpen]);

  const openSendModeMenu = useCallback((focus = false) => {
    keepSendModeOpen();
    const rect = sendModeButtonRef.current?.getBoundingClientRect();
    const menu = sendModeMenuRef.current;
    if (!rect || !menu) return;
    menu.style.width = `${rect.width}px`;
    menu.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
    menu.style.bottom = `${Math.max(8, window.innerHeight - rect.bottom)}px`;
    if (!menu.matches(":popover-open")) menu.showPopover();
    if (focus) menu.querySelector<HTMLButtonElement>("button[data-mode]")?.focus();
  }, [keepSendModeOpen]);

  useEffect(() => keepSendModeOpen, [keepSendModeOpen]);

  return {
    sendModeMenuId,
    sendModeMenuRef,
    sendModeButtonRef,
    sendModeHoverDismissedRef,
    keepSendModeOpen,
    closeSendModeMenu,
    scheduleSendModeClose,
    openSendModeMenu,
  };
}

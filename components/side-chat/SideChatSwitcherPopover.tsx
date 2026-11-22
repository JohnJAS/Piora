"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import type { SideChatStorage, SideChatSummary } from "@/lib/side-chat/types";
import { AliIcon } from "../AliIcon";
import styles from "./SideChat.module.css";

interface Props {
  open: boolean;
  anchorRef: RefObject<HTMLButtonElement | null>;
  canCreate: boolean;
  items: SideChatSummary[];
  activeSideChatId: string | null;
  unreadIds: ReadonlySet<string>;
  onClose: () => void;
  onSelect: (sideId: string) => void;
  onCreate: (storage: SideChatStorage) => void;
  onUnarchive: (sideId: string) => void;
}

/** Codex-style switcher & launcher popover anchored under the topbar Side Chat control. */
export function SideChatSwitcherPopover({
  open,
  anchorRef,
  canCreate,
  items,
  activeSideChatId,
  unreadIds,
  onClose,
  onSelect,
  onCreate,
  onUnarchive,
}: Props) {
  const { t } = useI18n();
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 44 });

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (popoverRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        anchorRef.current?.focus();
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [anchorRef, onClose, open]);

  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(320, Math.max(220, window.innerWidth - 16));
      const left = Math.min(Math.max(8, rect.right - width), Math.max(8, window.innerWidth - width - 8));
      const top = Math.min(rect.bottom + 6, Math.max(8, window.innerHeight - 160));
      setPosition({ left, top });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorRef, open]);

  if (!open || typeof document === "undefined") return null;

  const normalized = query.trim().toLowerCase();
  const matches = (item: SideChatSummary) => !normalized
    || item.title.toLowerCase().includes(normalized)
    || item.preview.toLowerCase().includes(normalized);
  const activeItems = items.filter((item) => !item.archived && matches(item));
  const archivedItems = items.filter((item) => item.archived && matches(item));

  return createPortal(
    <div
      ref={popoverRef}
      className={styles.popover}
      role="dialog"
      aria-label={t("sideChat.switcherTitle")}
      style={position}
    >
      <div className={styles.popoverHeader}>
        <span className={styles.popoverTitle}>{t("sideChat.switcherTitle")}</span>
        <div className={styles.popoverActions}>
          <button
            type="button"
            className={styles.popoverActionBtn}
            disabled={!canCreate}
            title={canCreate ? t("sideChat.newAttached") : t("sideChat.parentNotStartedNotice")}
            onClick={() => {
              onClose();
              onCreate("attached");
            }}
          >
            <AliIcon name="plus" size={12} />
            <span>{t("sideChat.panelTitle")}</span>
          </button>
          <button
            type="button"
            className={styles.popoverActionBtn}
            disabled={!canCreate}
            title={canCreate ? t("sideChat.newTemporary") : t("sideChat.parentNotStartedNotice")}
            onClick={() => {
              onClose();
              onCreate("temporary");
            }}
          >
            <AliIcon name="timer" size={12} />
            <span>{t("sideChat.tempBadge")}</span>
          </button>
        </div>
      </div>

      {items.length > 3 ? (
        <div className={styles.popoverFilter}>
          <input
            type="search"
            value={query}
            placeholder={t("sideChat.switcherSearchPlaceholder")}
            aria-label={t("sideChat.switcherSearchPlaceholder")}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      ) : null}

      <div className={styles.popoverList}>
        {activeItems.length === 0 && archivedItems.length === 0 ? (
          <div style={{ padding: "18px 10px", textAlign: "center", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
            {t("sideChat.switcherEmpty")}
          </div>
        ) : null}

        {activeItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className={styles.popoverItem}
            data-active={activeSideChatId === item.id ? "true" : "false"}
            onClick={() => {
              onClose();
              onSelect(item.id);
            }}
          >
            <span
              className={styles.statusDot}
              data-status={item.running ? "running" : item.lastPromptFailed ? "failed" : "idle"}
              aria-hidden="true"
            />
            <span className={styles.popoverItemCopy}>
              <span className={styles.popoverItemTitle}>
                {item.isDefaultTitle ? t("sideChat.untitled") : item.title}
              </span>
              {item.preview ? <span className={styles.popoverItemPreview}>{item.preview}</span> : null}
            </span>
            {item.storage === "temporary" ? (
              <span className={styles.tempBadge}>{t("sideChat.tempBadge")}</span>
            ) : null}
            {unreadIds.has(item.id) ? (
              <span className={styles.tabUnreadDot} title={t("sideChat.unreadIndicator")} />
            ) : null}
          </button>
        ))}

        {archivedItems.length > 0 ? (
          <>
            <button
              type="button"
              className={styles.popoverSectionLabel}
              aria-expanded={archivedOpen}
              onClick={() => setArchivedOpen((prev) => !prev)}
            >
              <span>{t("sideChat.archivedSection", { count: archivedItems.length })}</span>
              <span style={{ transform: archivedOpen ? "rotate(90deg)" : undefined, transition: "transform 120ms" }}>
                <AliIcon name="chevron-right" size={12} />
              </span>
            </button>
            {archivedOpen ? archivedItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={styles.popoverItem}
                onClick={() => {
                  onClose();
                  onUnarchive(item.id);
                }}
              >
                <AliIcon name="archive" size={13} />
                <span className={styles.popoverItemCopy}>
                  <span className={styles.popoverItemTitle}>
                    {item.isDefaultTitle ? t("sideChat.untitled") : item.title}
                  </span>
                  {item.preview ? <span className={styles.popoverItemPreview}>{item.preview}</span> : null}
                </span>
              </button>
            )) : null}
          </>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

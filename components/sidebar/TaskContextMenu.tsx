"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import type { SessionInfo } from "@/lib/types";
import { AliIcon } from "../AliIcon";

interface Props {
  anchor: { x: number; y: number };
  session: SessionInfo;
  pinned: boolean;
  archived: boolean;
  onPin: () => void;
  onRename: () => void;
  onArchive: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export function TaskContextMenu(props: Props) {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) props.onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [props]);

  const run = (action: () => unknown | Promise<unknown>) => {
    props.onClose();
    void action();
  };
  const menuWidth = 190;
  const left = Math.min(props.anchor.x, window.innerWidth - menuWidth - 8);
  const top = Math.min(props.anchor.y, window.innerHeight - 310);

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={t("sidebar.taskMenu")}
      style={{
        position: "fixed", left: Math.max(8, left), top: Math.max(8, top), zIndex: 10000,
        width: menuWidth, padding: 5, border: "1px solid var(--border)",
        borderRadius: 9, background: "var(--bg-panel)", boxShadow: "var(--shadow-popover)",
      }}
    >
      <MenuItem icon="pushpin" label={props.pinned ? t("sidebar.unpinTask") : t("sidebar.pinTask")} onClick={() => run(props.onPin)} />
      <MenuItem icon="edit" label={t("sidebar.rename")} onClick={() => run(props.onRename)} />
      <MenuItem icon="folder" label={props.archived ? t("sidebar.unarchiveTask") : t("sidebar.archiveTask")} onClick={() => run(props.onArchive)} />
      <MenuItem icon="copy" label={t("sidebar.duplicateTask")} onClick={() => run(props.onDuplicate)} />
      <MenuItem icon="copy" label={t("sidebar.copySessionPath")} onClick={() => run(() => navigator.clipboard.writeText(props.session.path))} />
      <MenuItem
        icon="folder-open"
        label={t("sidebar.revealSession")}
        disabled={!window.piDesktop?.revealPath}
        onClick={() => run(() => window.piDesktop?.revealPath?.(props.session.path))}
      />
      <div style={{ height: 1, background: "var(--border)", margin: "4px 3px" }} />
      <MenuItem icon="delete" label={t("sidebar.delete")} danger onClick={() => run(props.onDelete)} />
    </div>,
    document.body,
  );
}

function MenuItem({ icon, label, onClick, danger, disabled }: {
  icon: "pushpin" | "edit" | "folder" | "copy" | "folder-open" | "delete";
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 9,
        minHeight: 31, padding: "5px 8px", border: 0, borderRadius: 6,
        background: "transparent", color: danger ? "var(--status-failed)" : "var(--text)",
        cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.45 : 1,
        fontSize: "var(--text-sm)", textAlign: "left",
      }}
      onMouseEnter={(event) => { if (!disabled) event.currentTarget.style.background = "var(--bg-hover)"; }}
      onMouseLeave={(event) => { event.currentTarget.style.background = "transparent"; }}
    >
      <AliIcon name={icon} size={14} />
      <span>{label}</span>
    </button>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { copyText } from "@/lib/clipboard";
import { getRelativeFilePath } from "@/lib/file-paths";
import { AliIcon } from "../AliIcon";
import { FolderIcon, getFileIcon } from "../FileIcons";
import styles from "../FileExplorer.module.css";
import {
  AddToChatIcon,
  type FileContextMenuState,
  type FileContextTarget,
  type Translate,
} from "./shared";

export function FileContextMenu({
  menu,
  cwd,
  onClose,
  onOpenInApp,
  onAtMention,
  t,
}: {
  menu: FileContextMenuState;
  cwd: string;
  onClose: () => void;
  onOpenInApp: (target: FileContextTarget) => void;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  t: Translate;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [openWithVisible, setOpenWithVisible] = useState(false);
  const desktopBridge = window.piDesktop;
  const left = Math.max(6, Math.min(menu.x, window.innerWidth - 250));
  const top = Math.max(6, Math.min(menu.y, window.innerHeight - 210));
  const openSubmenuLeft = left + 238 + 222 + 12 > window.innerWidth;

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const handleViewportChange = () => onClose();
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", handleViewportChange);
    window.addEventListener("resize", handleViewportChange);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", handleViewportChange);
      window.removeEventListener("resize", handleViewportChange);
    };
  }, [onClose]);

  const runAndClose = (action: () => void | Promise<unknown>) => {
    onClose();
    void action();
  };

  return createPortal(
    <div
      ref={menuRef}
      className={styles.contextMenu}
      role="menu"
      aria-label={t("files.contextMenu")}
      style={{ left, top }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button
        type="button"
        role="menuitem"
        className={styles.contextMenuItem}
        disabled={!desktopBridge?.revealPath}
        onClick={() => runAndClose(() => desktopBridge?.revealPath?.(menu.target.fullPath))}
      >
        <span className={styles.contextMenuIcon}><FolderIcon size={15} /></span>
        <span className={styles.contextMenuLabel}>{t("files.revealInFileExplorer")}</span>
      </button>

      {menu.target.isDir ? (
        <button
          type="button"
          role="menuitem"
          className={styles.contextMenuItem}
          onClick={() => runAndClose(() => onOpenInApp(menu.target))}
        >
          <span className={styles.contextMenuIcon}><AliIcon name="folder-open" size={15} /></span>
          <span className={styles.contextMenuLabel}>{t("files.expandInPiora")}</span>
        </button>
      ) : (
        <div
          role="menuitem"
          tabIndex={0}
          className={styles.contextMenuItem}
          data-open={openWithVisible}
          onMouseEnter={() => setOpenWithVisible(true)}
          onMouseLeave={() => setOpenWithVisible(false)}
          onFocus={() => setOpenWithVisible(true)}
          onClick={() => setOpenWithVisible((visible) => !visible)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " " || event.key === "ArrowRight") {
              event.preventDefault();
              setOpenWithVisible(true);
            } else if (event.key === "ArrowLeft") {
              event.preventDefault();
              setOpenWithVisible(false);
            }
          }}
        >
          <span className={styles.contextMenuIcon}>{getFileIcon(menu.target.name, 15)}</span>
          <span className={styles.contextMenuLabel}>{t("files.openWith")}</span>
          <AliIcon name="chevron-right" size={14} />
          {openWithVisible && (
            <div
              className={`${styles.contextSubmenu}${openSubmenuLeft ? ` ${styles.contextSubmenuLeft}` : ""}`}
              role="menu"
              onMouseEnter={() => setOpenWithVisible(true)}
            >
              <button
                type="button"
                role="menuitem"
                className={styles.contextMenuItem}
                onClick={(event) => {
                  event.stopPropagation();
                  runAndClose(() => onOpenInApp(menu.target));
                }}
              >
                <span className={styles.contextMenuIcon}><AliIcon name="file" size={15} /></span>
                <span className={styles.contextMenuLabel}>{t("files.openInPiora")}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.contextMenuItem}
                disabled={!desktopBridge?.openPath}
                onClick={(event) => {
                  event.stopPropagation();
                  runAndClose(() => desktopBridge?.openPath?.(menu.target.fullPath));
                }}
              >
                <span className={styles.contextMenuIcon}><AliIcon name="export" size={15} /></span>
                <span className={styles.contextMenuLabel}>{t("files.openWithDefaultApp")}</span>
              </button>
            </div>
          )}
        </div>
      )}

      <div className={styles.contextMenuSeparator} role="separator" />
      <button
        type="button"
        role="menuitem"
        className={styles.contextMenuItem}
        onClick={() => runAndClose(() => copyText(menu.target.fullPath))}
      >
        <span className={styles.contextMenuIcon}><AliIcon name="copy" size={15} /></span>
        <span className={styles.contextMenuLabel}>{t("files.copyPath")}</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className={styles.contextMenuItem}
        disabled={!onAtMention}
        onClick={() => runAndClose(() => onAtMention?.(
          getRelativeFilePath(menu.target.fullPath, cwd),
          menu.target.isDir,
        ))}
      >
        <span className={styles.contextMenuIcon}><AddToChatIcon size={15} /></span>
        <span className={styles.contextMenuLabel}>{t("files.insertPath")}</span>
      </button>
    </div>,
    document.body,
  );
}

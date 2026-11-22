"use client";

import { useEffect, useRef, useState } from "react";
import { I18nProvider } from "@/hooks/useI18n";
import { AliIcon } from "@/components/AliIcon";
import { ProfileImport } from "@/components/workspace/browser/BrowserImport";
import { BrowserRecords } from "@/components/workspace/browser/BrowserRecords";
import { PrivacyControls } from "@/components/workspace/browser/BrowserPrivacy";
import { useBrowserCopy, type ToolsBridge } from "@/components/workspace/browser/shared";
import type { BrowserDialogKind } from "@/desktop/src/browser/contracts";
import styles from "@/components/workspace/browser/BrowserTools.module.css";

interface DialogBridge extends ToolsBridge {
  ready(): Promise<void>;
  close(destination?: "vault" | "downloads"): Promise<void>;
  height(height: number): Promise<void>;
}

function BrowserDialog() {
  const { copy } = useBrowserCopy();
  const panel = useRef<HTMLElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const [view, setView] = useState<{ kind: BrowserDialogKind | "recent"; bridge: DialogBridge } | null>(null);
  useEffect(() => {
    const bridge = (window as Window & { pioraBrowserDialog?: DialogBridge }).pioraBrowserDialog;
    const kind = new URLSearchParams(location.search).get("section");
    if (!bridge || (kind !== "import" && kind !== "privacy" && kind !== "recent")) return;
    document.documentElement.classList.add("piora-browser-dialog");
    setView({ kind, bridge });
    return () => document.documentElement.classList.remove("piora-browser-dialog");
  }, []);
  useEffect(() => {
    if (!view) return;
    void view.bridge.ready();
    (dialog.current ?? panel.current)?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        void view.bridge.close();
      }
    };
    window.addEventListener("keydown", key);
    const node = panel.current;
    const observer =
      view.kind === "recent" && node
        ? new ResizeObserver(() => void view.bridge.height(node.getBoundingClientRect().height))
        : undefined;
    if (node) observer?.observe(node);
    return () => {
      window.removeEventListener("keydown", key);
      observer?.disconnect();
    };
  }, [view]);
  if (!view) return null;
  const close = () => {
    void view.bridge.close();
  };
  if (view.kind === "recent")
    return (
      <main className={styles.popover} ref={panel} tabIndex={-1} data-profile-section="recent">
        <header className={styles.heading}>
          <h3>{copy("近期下载", "Recent downloads")}</h3>
          <button className={styles.iconButton} aria-label={copy("关闭", "Close")} type="button" onClick={close}>
            <AliIcon name="close" size={15} />
          </button>
        </header>
        <BrowserRecords
          bridge={view.bridge}
          kind="downloads"
          recent
          navigate={() => {}}
          expand={() => void view.bridge.close("downloads")}
        />
      </main>
    );
  const importing = view.kind === "import";
  return (
    <main className={styles.scrim} data-browser-dialog-frame="">
      <section
        ref={dialog}
        tabIndex={-1}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="browser-dialog-label"
        aria-describedby="browser-dialog-description"
        data-profile-section={view.kind}
      >
        <header className={styles.modalHeader}>
          <div>
            <h1 id="browser-dialog-label">
              {importing
                ? copy("从浏览器导入", "Import from a browser")
                : copy("清除浏览数据", "Clear browsing data")}
            </h1>
            <p id="browser-dialog-description">
              {importing
                ? copy("选择要导入到内置浏览器的数据", "Choose which data to import into the in-app browser")
                : copy(
                    "选择此浏览器要清除的内容和时间范围",
                    "Choose what to clear from this browser and for which period",
                  )}
            </p>
          </div>
          <button className={styles.iconButton} type="button" aria-label={copy("关闭", "Close")} onClick={close}>
            <AliIcon name="close" size={15} />
          </button>
        </header>
        {importing ? (
          <ProfileImport bridge={view.bridge} cancel={close} openVault={() => void view.bridge.close("vault")} />
        ) : (
          <PrivacyControls bridge={view.bridge} close={close} />
        )}
      </section>
    </main>
  );
}

export default function BrowserDialogPage() {
  return (
    <I18nProvider>
      <BrowserDialog />
    </I18nProvider>
  );
}

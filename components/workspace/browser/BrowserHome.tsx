"use client";

import { useEffect, useRef, type RefObject } from "react";
import { AliIcon } from "@/components/AliIcon";
import { useI18n } from "@/hooks/useI18n";
import type { BrowserToolInvoke } from "@/desktop/src/browser/contracts";
import { BrowserAddress, type BrowserAddressWorkspace } from "./BrowserAddress";
import styles from "./BrowserHome.module.css";

export interface BrowserHomeWorkspace extends BrowserAddressWorkspace {
  openFiles(): void;
  openTerminal(): void;
}

export function BrowserHome({
  active,
  address,
  changeAddress,
  addressRef,
  navigate,
  history,
  workspace,
  onHistory,
  bookmarks,
}: {
  active: boolean;
  address: string;
  changeAddress(value: string): void;
  addressRef: RefObject<HTMLInputElement | null>;
  navigate(value: string): void;
  history?: BrowserToolInvoke;
  workspace?: BrowserHomeWorkspace;
  onHistory?: () => void;
  bookmarks?: { importing: boolean; onImport(): void; onDismiss(): void };
}) {
  const { t } = useI18n();
  const focusedOnOpen = useRef(false);
  useEffect(() => {
    if (!active || focusedOnOpen.current) return;
    const frame = requestAnimationFrame(() => {
      addressRef.current?.focus({ preventScroll: true });
      focusedOnOpen.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [active, addressRef]);

  return <div className={styles.page} data-browser-home="">
    <div className={styles.content}>
      <div className={styles.search} role="search" aria-label={t("browser.homeSearch")}>
        <BrowserAddress
          value={address}
          change={changeAddress}
          inputRef={addressRef}
          label={t("browser.address")}
          placeholder={t(workspace ? "browser.homeFilePlaceholder" : "browser.searchOrAddressPlaceholder")}
          home={{ submitLabel: t("browser.homeSubmit") }}
          invoke={history}
          slot={null}
          navigate={navigate}
          workspace={workspace}
        />
      </div>
      {(workspace || onHistory) && <div className={styles.shortcuts} role="group" aria-label={t("browser.homeShortcuts")}>
        {workspace && <>
          <button type="button" onClick={workspace.openFiles}><AliIcon name="folder-open" size={17} /><span>{t("browser.homeFiles")}</span></button>
          <button type="button" onClick={workspace.openTerminal}><AliIcon name="code" size={17} /><span>{t("workspace.commands")}</span></button>
        </>}
        {onHistory && <button type="button" onClick={onHistory}><AliIcon name="history" size={17} /><span>{t("browser.homeHistory")}</span></button>}
      </div>}
      {bookmarks && <div className={styles.bookmarks} title={t("browser.importSafety")}>
        <button type="button" disabled={bookmarks.importing} onClick={bookmarks.onImport}>
          <AliIcon name="bookmark" size={14} />
          {t(bookmarks.importing ? "browser.importing" : "browser.importChrome")}
        </button>
        <button type="button" onClick={bookmarks.onDismiss}>{t("browser.skipImport")}</button>
      </div>}
    </div>
  </div>;
}

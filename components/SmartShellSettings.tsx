"use client";

import { useI18n } from "@/hooks/useI18n";
import styles from "./workspace/SmartShell.module.css";

export function SmartShellSettings({ cwd }: { cwd?: string }) {
  const { t } = useI18n();
  return <div className={styles.settings}>
    <header><h2>{t("shell.title")}</h2><p>{t("shell.description")}</p></header>
    <section className={styles.settingsSection}>
      <h3>{t("shell.terminalSection")}</h3>
      <p>{t("shell.nativeProfileHint")}</p>
      {cwd ? <code>{cwd}</code> : null}
    </section>
    <section className={styles.settingsSection} data-settings-id="shell.history">
      <h3>{t("shell.history")}</h3>
      <p>{t("shell.nativeHistoryHint")}</p>
      <p>{t("shell.nativeKeys")}</p>
    </section>
  </div>;
}

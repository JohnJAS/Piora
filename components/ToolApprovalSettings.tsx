"use client";

import { useToolApprovalSettings } from "@/hooks/useToolApprovalSettings";
import { useI18n } from "@/hooks/useI18n";
import { ModelErrorText } from "./ModelErrorText";
import { SettingsRow, SettingsSwitch } from "./settings/SettingsPrimitives";
import styles from "./SettingsDialog.module.css";

export function ToolApprovalSettings({ inline = false }: { inline?: boolean }) {
  const { t } = useI18n();
  const { enabled, ready, saving, error, setEnabled } = useToolApprovalSettings();
  const busy = !ready || saving;
  const toggle = () => setEnabled(!enabled);
  if (inline) {
    return (
      <SettingsRow
        title={t("permission.settings.title")}
        description={
          <>
            {t("permission.settings.description")}
            {error ? <p role="alert" style={{ color: "var(--error, #dc2626)", margin: "4px 0 0" }}><ModelErrorText value={error} /></p> : null}
          </>
        }
        settingsId="permission.settings"
        descriptionId="ToolApprovalSettings-description"
      >
        <SettingsSwitch
          checked={enabled}
          disabled={busy}
          label={t("permission.settings.title")}
          describedBy="ToolApprovalSettings-description"
          onToggle={() => void toggle()}
        />
      </SettingsRow>
    );
  }
  return <section className={styles.conversationSection} data-settings-id="permission.settings">
    <div className={styles.conversationRow}>
      <div className={styles.conversationCopy}>
        <div className={styles.rowTitle}>{t("permission.settings.title")}</div>
        <div id="ToolApprovalSettings-description" className={styles.rowDescription}>{t("permission.settings.description")}</div>
        {error ? <p role="alert" style={{ color: "var(--error, #dc2626)", margin: "5px 0 0" }}><ModelErrorText value={error} /></p> : null}
      </div>
      <button type="button" role="switch" className={styles.switch}
        aria-label={t("permission.settings.title")} aria-describedby="ToolApprovalSettings-description"
        aria-checked={enabled} disabled={busy} onClick={() => void toggle()}>
        <span />
      </button>
    </div>
  </section>;
}

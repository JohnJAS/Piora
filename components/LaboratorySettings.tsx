"use client";

import { useId } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useLaboratorySettings } from "@/hooks/useLaboratorySettings";
import styles from "./SettingsDialog.module.css";

export function LaboratorySettings() {
  const { t } = useI18n();
  const settings = useLaboratorySettings();
  const descriptionId = useId();
  return <>
    <div className={styles.contentHeading}>
      <h2>{t("laboratory.title")}</h2>
      <p>{t("laboratory.description")}</p>
    </div>
    <section className={styles.sectionCard} data-settings-id="laboratory.planGoal">
      <div className={styles.conversationRow}>
        <span className={styles.conversationCopy}>
          <strong className={styles.rowTitle}>{t("laboratory.planGoal")}</strong>
          <span id={descriptionId} className={styles.rowDescription}>{t("laboratory.planGoalDescription")}</span>
        </span>
        <button type="button" role="switch" className={styles.switch}
          data-testid="laboratory-plan-goal-toggle" aria-checked={settings.planGoalEnabled}
          aria-label={t("laboratory.planGoal")} aria-describedby={descriptionId} aria-busy={settings.saving}
          title={t(settings.saving ? "laboratory.saving" : settings.planGoalEnabled ? "laboratory.disable" : "laboratory.enable")}
          disabled={settings.loading || settings.saving} onClick={() => { void settings.setPlanGoalEnabled(!settings.planGoalEnabled); }}>
          <span aria-hidden="true" />
        </button>
      </div>
    </section>
    <p className={styles.localNote}>{t("laboratory.disableHelp")}</p>
    {settings.error && <div role="alert"><p>{t("laboratory.error")} {settings.error}</p><button type="button" className={styles.primaryButton} onClick={() => { void settings.refresh(); }}>{t("workflow.refresh")}</button></div>}
  </>;
}

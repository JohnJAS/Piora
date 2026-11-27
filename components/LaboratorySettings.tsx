"use client";

import { useId } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useLaboratorySettings } from "@/hooks/useLaboratorySettings";
import { useSideChatSettings } from "@/hooks/useSideChatSettings";
import { SettingsPage, SettingsRow, SettingsSection, SettingsSwitch } from "./settings/SettingsPrimitives";
import primitiveStyles from "./settings/SettingsPrimitives.module.css";
import { SubagentSettings } from "./SubagentSettings";

export function LaboratorySettings({ cwd }: { cwd?: string }) {
  const { t } = useI18n();
  const settings = useLaboratorySettings();
  const sideChat = useSideChatSettings();
  const descriptionId = useId();
  const sideChatDescriptionId = useId();

  return (
    <SettingsPage title={t("laboratory.title")}>
      <SettingsSection title={t("settings.section.experimentalFeatures")}>
        <SettingsRow
          title={t("laboratory.planGoal")}
          description={t("laboratory.planGoalDescription")}
          settingsId="laboratory.planGoal"
          descriptionId={descriptionId}
        >
          <SettingsSwitch
            checked={settings.planGoalEnabled}
            label={t("laboratory.planGoal")}
            describedBy={descriptionId}
            busy={settings.saving}
            testId="laboratory-plan-goal-toggle"
            disabled={settings.loading || settings.saving}
            onToggle={() => { void settings.setPlanGoalEnabled(!settings.planGoalEnabled); }}
          />
        </SettingsRow>
        <SettingsRow
          title={t("laboratory.sideChat")}
          description={t("laboratory.sideChatDescription")}
          settingsId="laboratory.sideChat"
          descriptionId={sideChatDescriptionId}
        >
          <SettingsSwitch
            checked={sideChat.enabled}
            label={t("laboratory.sideChat")}
            describedBy={sideChatDescriptionId}
            busy={sideChat.saving}
            testId="laboratory-side-chat-toggle"
            disabled={sideChat.loading || sideChat.saving}
            onToggle={() => { void sideChat.setEnabled(!sideChat.enabled); }}
          />
        </SettingsRow>
      </SettingsSection>

      <SubagentSettings cwd={cwd} />

      {settings.error ? (
        <div role="alert" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className={primitiveStyles.statusError}>{t("laboratory.error")} {settings.error}</span>
          <button type="button" className={primitiveStyles.button} onClick={() => { void settings.refresh(); }}>
            {t("workflow.refresh")}
          </button>
        </div>
      ) : null}
      {sideChat.error ? (
        <div role="alert" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className={primitiveStyles.statusError}>{t("laboratory.sideChatError")} {sideChat.error}</span>
          <button type="button" className={primitiveStyles.button} onClick={() => { void sideChat.refresh(); }}>
            {t("workflow.refresh")}
          </button>
        </div>
      ) : null}
    </SettingsPage>
  );
}

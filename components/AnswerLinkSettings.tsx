"use client";

import { useAnswerLinkPreference } from "@/hooks/useAnswerLinkPreference";
import { useI18n } from "@/hooks/useI18n";
import { SettingsRow, SettingsSegmented } from "./settings/SettingsPrimitives";
import styles from "./SettingsDialog.module.css";

export function AnswerLinkSettings({ inline = false }: { inline?: boolean }) {
  const { t } = useI18n();
  const { target, setTarget } = useAnswerLinkPreference();
  if (inline) {
    return (
      <SettingsRow
        title={t("settings.answerLinks")}
        description={t("settings.answerLinksHelp")}
        settingsId="conversation.answerLinks"
        titleId="answer-link-target-label"
        descriptionId="answer-link-target-help"
      >
        <SettingsSegmented
          value={target}
          options={[
            { value: "builtin", label: t("settings.answerLinksBuiltin") },
            { value: "system", label: t("settings.answerLinksSystem") },
          ]}
          ariaLabelledBy="answer-link-target-label"
          ariaDescribedBy="answer-link-target-help"
          onChange={setTarget}
        />
      </SettingsRow>
    );
  }
  return <section className={styles.conversationSection} data-settings-id="conversation.answerLinks">
    <div className={styles.conversationRow}>
      <div className={styles.conversationCopy}>
        <div id="answer-link-target-label" className={styles.rowTitle}>{t("settings.answerLinks")}</div>
        <div id="answer-link-target-help" className={styles.rowDescription}>{t("settings.answerLinksHelp")}</div>
      </div>
      <div className={styles.sendModeTabs} role="group" aria-labelledby="answer-link-target-label" aria-describedby="answer-link-target-help">
        {(["builtin", "system"] as const).map(value => <button key={value} type="button" aria-pressed={target === value} onClick={() => setTarget(value)}>
          {t(value === "builtin" ? "settings.answerLinksBuiltin" : "settings.answerLinksSystem")}
        </button>)}
      </div>
    </div>
  </section>;
}

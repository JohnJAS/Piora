"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useLiveOutputAutoScrollPreference } from "@/hooks/useLiveOutputAutoScrollPreference";
import { useRunningSendMode } from "@/hooks/useRunningSendMode";
import { AnswerLinkSettings } from "../AnswerLinkSettings";
import { ModelCompactionSettings } from "../ModelCompactionSettings";
import { ModelFallbackSetting } from "../ModelFallbackSetting";
import { ModelRetrySettings } from "../ModelRetrySettings";
import { ReplySuggestionsSettings } from "../ReplySuggestionsSettings";
import { RunningStatusSettings } from "../RunningStatusSettings";
import { ToolApprovalSettings } from "../ToolApprovalSettings";
import { InputPredictionSettings } from "./InputPredictionSettings";
import {
  SettingsDisclosure,
  SettingsPage,
  SettingsRow,
  SettingsSection,
  SettingsSegmented,
  SettingsSwitch,
} from "./SettingsPrimitives";

interface Props {
  modelCwd?: string;
  focusedItemId?: string;
  notificationEnabled: boolean;
  notificationCapability: "desktop" | "browser" | "unsupported";
  onNotificationToggle: () => void | Promise<void>;
}

const ADVANCED_IDS = new Set(["general.modelRetry", "models.compaction"]);

export function ConversationSettingsPage({
  modelCwd,
  focusedItemId,
  notificationEnabled,
  notificationCapability,
  onNotificationToggle,
}: Props) {
  const { t } = useI18n();
  const { mode: runningSendMode, setMode: setRunningSendMode } = useRunningSendMode();
  const { enabled: autoScrollEnabled, setEnabled: setAutoScrollEnabled } = useLiveOutputAutoScrollPreference();
  const [advancedOpen, setAdvancedOpen] = useState(() => Boolean(focusedItemId && ADVANCED_IDS.has(focusedItemId)));

  useEffect(() => {
    if (focusedItemId && ADVANCED_IDS.has(focusedItemId)) {
      setAdvancedOpen(true);
    }
  }, [focusedItemId]);

  return (
    <SettingsPage
      title={t("settings.conversation")}
    >
      <SettingsSection title={t("settings.section.interaction")}>
        <SettingsRow
          title={t("settings.liveOutputAutoScroll")}
          settingsId="conversation.autoScroll"
        >
          <SettingsSwitch
            checked={autoScrollEnabled}
            label={t("settings.liveOutputAutoScroll")}
            onToggle={() => setAutoScrollEnabled(!autoScrollEnabled)}
          />
        </SettingsRow>

        <SettingsRow
          title={t("taskControls.notifications")}
          description={
            notificationCapability === "unsupported"
              ? t("taskControls.notificationsUnsupported")
              : undefined
          }
          settingsId="conversation.notifications"
          descriptionId="conversation-notifications-desc"
        >
          <SettingsSwitch
            checked={notificationEnabled}
            disabled={notificationCapability === "unsupported"}
            label={t("taskControls.notifications")}
            describedBy={notificationCapability === "unsupported" ? "conversation-notifications-desc" : undefined}
            onToggle={() => void onNotificationToggle()}
          />
        </SettingsRow>

        <SettingsRow
          title={t("settings.runningSendMode")}
          description={t("settings.runningSendModeHelp")}
          settingsId="conversation.runningSendMode"
          titleId="running-send-mode-label"
          descriptionId="running-send-mode-desc"
        >
          <SettingsSegmented
            value={runningSendMode}
            options={[
              { value: "steer", label: t("chat.steer") },
              { value: "next_turn", label: t("chat.queueSend") },
            ]}
            ariaLabelledBy="running-send-mode-label"
            ariaDescribedBy="running-send-mode-desc"
            onChange={setRunningSendMode}
          />
        </SettingsRow>

        <AnswerLinkSettings inline />
      </SettingsSection>

      <SettingsSection title={t("settings.section.assistance")}>
        <InputPredictionSettings key={modelCwd} cwd={modelCwd} />
        <ReplySuggestionsSettings cwd={modelCwd} compact />
        <RunningStatusSettings cwd={modelCwd} compact />
      </SettingsSection>

      <SettingsSection title={t("settings.section.execution")}>
        <ToolApprovalSettings inline />
        <ModelFallbackSetting inline />
        <SettingsDisclosure
          key={advancedOpen ? "open" : "closed"}
          summary={t("settings.advancedTimeoutsAndCompaction")}
          defaultOpen={advancedOpen}
        >
          <div data-settings-id="general.modelRetry">
            <ModelRetrySettings compact />
          </div>
          <ModelCompactionSettings compact />
        </SettingsDisclosure>
      </SettingsSection>
    </SettingsPage>
  );
}

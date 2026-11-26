"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { SessionInfo } from "@/lib/types";
import { ArchivedChatsSettings } from "../ArchivedChatsSettings";
import { TrashSettings } from "../TrashSettings";
import { SettingsPage, SettingsSegmented } from "./SettingsPrimitives";

interface Props {
  initialTab?: "archived" | "trash";
  onChanged?: () => void;
  onSessionDeleted?: (session: SessionInfo, sessionIds?: string[]) => void;
}

export function ChatStorageSettingsPage({ initialTab = "archived", onChanged, onSessionDeleted }: Props) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"archived" | "trash">(initialTab);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  return (
    <SettingsPage
      title={t("settings.page.history")}
      description={t("settings.page.historyDescription")}
      actions={
        <SettingsSegmented
          value={tab}
          ariaLabel={t("settings.page.history")}
          options={[
            { value: "archived", label: t("archive.title") },
            { value: "trash", label: t("trash.title") },
          ]}
          onChange={setTab}
        />
      }
    >
      {tab === "trash" ? (
        <div data-settings-id="trash">
          <TrashSettings embedded onChanged={onChanged} />
        </div>
      ) : (
        <div data-settings-id="archived">
          <ArchivedChatsSettings
            embedded
            onChanged={onChanged}
            onSessionDeleted={onSessionDeleted}
          />
        </div>
      )}
    </SettingsPage>
  );
}

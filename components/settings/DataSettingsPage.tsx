"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { AliIcon } from "../AliIcon";
import { CredentialVaultSettings } from "../CredentialVaultSettings";
import { RuntimeLogSettings } from "../RuntimeLogSettings";
import {
  SettingsModal,
  SettingsPage,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from "./SettingsPrimitives";
import primitiveStyles from "./SettingsPrimitives.module.css";
import styles from "../SettingsDialog.module.css";

interface AgentDataDirectoryInfo {
  currentDirectory: string;
  defaultDirectory: string;
  configuredBy: "default" | "settings" | "environment";
  environmentOverride: boolean;
  portableRuntimeDirectory?: string;
}

interface Props {
  open: boolean;
  desktopAvailable: boolean;
}

export function DataSettingsPage({ open, desktopAvailable }: Props) {
  const { t } = useI18n();
  const [modalOpen, setModalOpen] = useState(false);
  const [agentDataInfo, setAgentDataInfo] = useState<AgentDataDirectoryInfo | null>(null);
  const [agentDataDirectoryDraft, setAgentDataDirectoryDraft] = useState("");
  const [migrateAgentData, setMigrateAgentData] = useState(false);
  const [agentDataStatus, setAgentDataStatus] = useState<"idle" | "loading" | "applying" | "restarting" | "error">("idle");
  const [agentDataErrorCode, setAgentDataErrorCode] = useState<string | null>(null);
  const [agentDataErrorDetail, setAgentDataErrorDetail] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !desktopAvailable) return;
    const bridge = window.piDesktop?.getAgentDataDirectory;
    if (!bridge) return;
    let cancelled = false;
    setAgentDataStatus("loading");
    void bridge()
      .then((info) => {
        if (cancelled) return;
        setAgentDataInfo(info);
        setAgentDataDirectoryDraft(info?.currentDirectory ?? "");
        setMigrateAgentData(false);
        setAgentDataStatus("idle");
        setAgentDataErrorCode(null);
        setAgentDataErrorDetail(null);
      })
      .catch(() => {
        if (!cancelled) setAgentDataStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [desktopAvailable, open]);

  const chooseAgentDataDirectory = async () => {
    const selected = await window.piDesktop?.selectAgentDataDirectory?.(agentDataDirectoryDraft || agentDataInfo?.currentDirectory);
    if (selected) {
      setAgentDataDirectoryDraft(selected);
      setAgentDataErrorCode(null);
      setAgentDataErrorDetail(null);
    }
  };

  const applyAgentDataDirectory = async () => {
    const bridge = window.piDesktop?.applyAgentDataDirectory;
    if (!bridge || !agentDataDirectoryDraft.trim()) return;
    setAgentDataStatus("applying");
    setAgentDataErrorCode(null);
    setAgentDataErrorDetail(null);
    try {
      const result = await bridge({ directory: agentDataDirectoryDraft.trim(), migrate: migrateAgentData });
      if (!result.ok) {
        setAgentDataStatus("error");
        setAgentDataErrorCode(result.code ?? "migration-failed");
        setAgentDataErrorDetail(result.error?.trim() || null);
        return;
      }
      const currentDirectory = result.currentDirectory ?? agentDataDirectoryDraft.trim();
      setAgentDataInfo((current) => current ? {
        ...current,
        currentDirectory,
        configuredBy: currentDirectory === current.defaultDirectory ? "default" : "settings",
      } : current);
      setAgentDataDirectoryDraft(currentDirectory);
      setMigrateAgentData(false);
      setAgentDataStatus("restarting");
    } catch (error) {
      setAgentDataStatus("error");
      setAgentDataErrorCode("migration-failed");
      setAgentDataErrorDetail(error instanceof Error ? error.message : String(error));
    }
  };

  const hasDirectoryBridge = desktopAvailable && typeof window !== "undefined" && Boolean(window.piDesktop?.getAgentDataDirectory);

  return (
    <SettingsPage
      title={t("settings.page.data")}
      description={t("settings.page.dataDescription")}
    >
      {hasDirectoryBridge ? (
        <SettingsSection>
          <SettingsRow
            title={t("settings.agentDataDirectory")}
            badge={agentDataInfo?.configuredBy === "environment" ? t("settings.agentDataDirectoryEnvironment") : undefined}
            description={
              <>
                {t("settings.agentDataDirectoryDescription")}
                {agentDataInfo ? (
                  <div style={{ marginTop: 4, fontFamily: "var(--font-mono)", fontSize: "calc(var(--text-xs) * 0.94)", overflowWrap: "anywhere" }}>
                    {agentDataInfo.currentDirectory}
                  </div>
                ) : null}
              </>
            }
          >
            <button type="button" className={primitiveStyles.button} onClick={() => setModalOpen(true)}>
              {t("settings.changeDirectory")}
            </button>
          </SettingsRow>
        </SettingsSection>
      ) : null}

      {desktopAvailable ? (
        <div data-settings-id="data.websiteAccounts">
          <CredentialVaultSettings />
        </div>
      ) : null}

      {desktopAvailable ? <RuntimeLogSettings /> : null}

      <SettingsModal
        open={modalOpen}
        title={t("settings.agentDataDirectory")}
        description={t("settings.agentDataDirectoryDescription")}
        closeLabel={t("settings.closeAction")}
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <button
              className={primitiveStyles.button}
              type="button"
              disabled={!agentDataInfo || agentDataStatus === "applying" || agentDataInfo.environmentOverride}
              onClick={() => setAgentDataDirectoryDraft(agentDataInfo?.defaultDirectory ?? "")}
            >
              {t("settings.agentDataDirectoryRestoreDefault")}
            </button>
            <button
              className={primitiveStyles.buttonPrimary}
              type="button"
              disabled={!agentDataInfo || !agentDataDirectoryDraft.trim() || agentDataDirectoryDraft.trim() === agentDataInfo.currentDirectory || agentDataStatus === "applying" || agentDataStatus === "restarting" || agentDataInfo.environmentOverride}
              onClick={() => { void applyAgentDataDirectory(); }}
            >
              {agentDataStatus === "applying" ? t("settings.agentDataDirectoryApplying") : agentDataStatus === "restarting" ? t("settings.agentDataDirectoryRestarting") : t(migrateAgentData ? "settings.agentDataDirectoryMigrateApply" : "settings.agentDataDirectoryApply")}
            </button>
          </>
        }
      >
        <div className={styles.agentDataBody}>
          <label className={styles.agentDataField}>
            <span>{t("settings.agentDataDirectoryTargetPath")}</span>
            <span className={styles.agentDataInputRow}>
              <input
                value={agentDataDirectoryDraft}
                onChange={(event) => {
                  setAgentDataDirectoryDraft(event.target.value);
                  setAgentDataErrorCode(null);
                  setAgentDataErrorDetail(null);
                }}
                disabled={agentDataStatus === "loading" || agentDataStatus === "applying" || agentDataInfo?.environmentOverride}
                spellCheck={false}
                aria-label={t("settings.agentDataDirectoryTargetPath")}
              />
              <button
                className={styles.secondaryButton}
                type="button"
                disabled={agentDataStatus === "applying" || agentDataInfo?.environmentOverride}
                onClick={() => { void chooseAgentDataDirectory(); }}
              >
                {t("settings.agentDataDirectoryChoose")}
              </button>
            </span>
          </label>
          {agentDataInfo ? <div className={styles.agentDataMeta}>{t("settings.agentDataDirectoryCurrent", { path: agentDataInfo.currentDirectory })}</div> : null}
          {agentDataInfo ? <div className={styles.agentDataMeta}>{t("settings.agentDataDirectoryDefault", { path: agentDataInfo.defaultDirectory })}</div> : null}
          <SettingsRow
            title={t("settings.agentDataMigrate")}
            description={t("settings.agentDataMigrateDescription")}
          >
            <SettingsSwitch
              checked={migrateAgentData}
              label={t("settings.agentDataMigrate")}
              disabled={agentDataStatus === "applying" || agentDataInfo?.environmentOverride}
              onToggle={() => {
                setMigrateAgentData((current) => !current);
                setAgentDataErrorCode(null);
                setAgentDataErrorDetail(null);
              }}
            />
          </SettingsRow>
          {agentDataErrorCode ? (
            <div className={styles.agentDataError} role="alert">
              <span>{t(`settings.agentDataDirectoryError.${agentDataErrorCode}`)}</span>
              {agentDataErrorDetail ? <code>{agentDataErrorDetail}</code> : null}
            </div>
          ) : null}
          {agentDataInfo?.environmentOverride ? <div className={styles.agentDataNotice}>{t("settings.agentDataDirectoryEnvironmentDescription")}</div> : null}
          {agentDataInfo?.portableRuntimeDirectory ? (
            <div className={styles.portableCacheNote}>
              <AliIcon name="info" size={14} />
              <span>{t("settings.portableRuntimeCache", { path: agentDataInfo.portableRuntimeDirectory })}</span>
            </div>
          ) : null}
        </div>
      </SettingsModal>
    </SettingsPage>
  );
}

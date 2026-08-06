"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { AliIcon } from "./AliIcon";
import type { TaskControls } from "./ChatWindow";
import styles from "./SettingsDialog.module.css";

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenModels: () => void;
  onOpenSkills: () => void;
  onOpenPlugins: () => void;
  onOpenAppearance: () => void;
  onOpenLanguage: () => void;
  onOpenCompanion: () => void;
  conversation: {
    hasSession: boolean;
    hasMessages: boolean;
    autoNameStatus: "idle" | "naming" | "success" | "error";
    autoNameError?: string;
    systemPrompt: string | null;
    taskControls: TaskControls | null;
    notificationEnabled: boolean;
    notificationCapability: "desktop" | "browser" | "unsupported";
    onGenerateTitle: () => void;
    onNotificationToggle: () => void | Promise<void>;
  };
}

type SettingsKey = "general" | "conversation" | "models" | "skills" | "plugins" | "appearance" | "language" | "companion";
type SettingsGroup = "general" | "agent" | "experience";

interface SettingsEntry {
  key: SettingsKey;
  group: SettingsGroup;
  labelKey: string;
  descriptionKey: string;
  icon: ReactNode;
  onOpen?: () => void;
}

export function SettingsDialog({
  open,
  onClose,
  onOpenModels,
  onOpenSkills,
  onOpenPlugins,
  onOpenAppearance,
  onOpenLanguage,
  onOpenCompanion,
  conversation,
}: Props) {
  const { t } = useI18n();
  const [activeKey, setActiveKey] = useState<SettingsKey>("general");

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const entries = useMemo<SettingsEntry[]>(() => [
    {
      key: "general",
      group: "general",
      labelKey: "settings.general",
      descriptionKey: "settings.generalDescription",
      icon: <AliIcon name="layout" size={16} />,
    },
    {
      key: "conversation",
      group: "agent",
      labelKey: "settings.conversation",
      descriptionKey: "settings.conversationDescription",
      icon: <AliIcon name="message" size={16} />,
    },
    {
      key: "models",
      group: "agent",
      labelKey: "common.models",
      descriptionKey: "settings.modelsDescription",
      onOpen: onOpenModels,
      icon: <AliIcon name="api" size={16} />,
    },
    {
      key: "skills",
      group: "agent",
      labelKey: "common.skills",
      descriptionKey: "settings.skillsDescription",
      onOpen: onOpenSkills,
      icon: <AliIcon name="solution" size={16} />,
    },
    {
      key: "plugins",
      group: "agent",
      labelKey: "common.plugins",
      descriptionKey: "settings.pluginsDescription",
      onOpen: onOpenPlugins,
      icon: <AliIcon name="appstore-add" size={16} />,
    },
    {
      key: "appearance",
      group: "experience",
      labelKey: "appearance.title",
      descriptionKey: "settings.appearanceDescription",
      onOpen: onOpenAppearance,
      icon: <AliIcon name="skin" size={16} />,
    },
    {
      key: "language",
      group: "experience",
      labelKey: "common.language",
      descriptionKey: "settings.languageDescription",
      onOpen: onOpenLanguage,
      icon: <AliIcon name="translate" size={16} />,
    },
    {
      key: "companion",
      group: "experience",
      labelKey: "companion.settingsTitle",
      descriptionKey: "settings.companionDescription",
      onOpen: onOpenCompanion,
      icon: <AliIcon name="robot" size={16} />,
    },
  ], [onOpenAppearance, onOpenCompanion, onOpenLanguage, onOpenModels, onOpenPlugins, onOpenSkills]);

  if (!open || typeof document === "undefined") return null;

  const activeEntry = entries.find((entry) => entry.key === activeKey) ?? entries[0];
  const quickEntries = entries.filter((entry) => ["appearance", "language", "companion"].includes(entry.key));
  const openEntry = (entry: SettingsEntry) => {
    if (!entry.onOpen) return;
    entry.onOpen();
  };

  return createPortal(
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label={t("sidebar.settings")}
    >
      <div className={styles.dialog}>
        <header className={styles.header}>
          <div className={styles.brandMark} aria-hidden="true"><AliIcon name="setting" size={17} /></div>
          <div className={styles.headerCopy}>
            <div className={styles.title}>{t("sidebar.settings")}</div>
            <div className={styles.subtitle}>{t("settings.description")}</div>
          </div>
          <button className={styles.closeButton} type="button" onClick={onClose} title={t("i18n.close")} aria-label={t("i18n.close")}>
            <AliIcon name="close" size={15} />
          </button>
        </header>

        <div className={styles.workspace}>
          <nav className={styles.navigation} aria-label={t("settings.navigation")}>
            {(["general", "agent", "experience"] as const).map((group) => (
              <div className={styles.navGroup} key={group}>
                <div className={styles.navGroupLabel}>{t(`settings.group.${group}`)}</div>
                {entries.filter((entry) => entry.group === group).map((entry) => (
                  <button
                    className={styles.navItem}
                    type="button"
                    key={entry.key}
                    aria-current={activeKey === entry.key ? "page" : undefined}
                    onClick={() => setActiveKey(entry.key)}
                  >
                    <span className={styles.navIcon}>{entry.icon}</span>
                    <span>{t(entry.labelKey)}</span>
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <main className={styles.content}>
            {activeEntry.key === "general" ? (
              <>
                <div className={styles.contentHeading}>
                  <h2>{t("settings.general")}</h2>
                  <p>{t("settings.generalDescription")}</p>
                </div>
                <section className={styles.sectionCard}>
                  <div className={styles.sectionEyebrow}>{t("settings.personalization")}</div>
                  {quickEntries.map((entry) => (
                    <button className={styles.settingRow} type="button" key={entry.key} onClick={() => openEntry(entry)}>
                      <span className={styles.rowIcon}>{entry.icon}</span>
                      <span className={styles.rowCopy}>
                        <span className={styles.rowTitle}>{t(entry.labelKey)}</span>
                        <span className={styles.rowDescription}>{t(entry.descriptionKey)}</span>
                      </span>
                      <AliIcon name="chevron-right" size={15} />
                    </button>
                  ))}
                </section>
                <div className={styles.localNote}>
                  <AliIcon name="lock" size={14} />
                  <span>{t("settings.localNote")}</span>
                </div>
              </>
            ) : activeEntry.key === "conversation" ? (
              <>
                <div className={styles.contentHeading}>
                  <h2>{t("settings.conversation")}</h2>
                  <p>{t("settings.conversationDescription")}</p>
                </div>

                <section className={styles.conversationSection}>
                  <div className={styles.conversationRow}>
                    <div className={styles.conversationCopy}>
                      <div className={styles.rowTitle}>{t("title.generate")}</div>
                      <div className={styles.rowDescription}>
                        {!conversation.hasSession
                          ? t("title.unsaved")
                          : !conversation.hasMessages
                            ? t("title.noMessages")
                            : conversation.autoNameStatus === "error"
                              ? conversation.autoNameError ?? t("title.failed")
                              : t("conversationMenu.generateTitleDescription")}
                      </div>
                    </div>
                    <button
                      className={styles.secondaryButton}
                      type="button"
                      disabled={!conversation.hasSession || !conversation.hasMessages || conversation.autoNameStatus === "naming"}
                      onClick={conversation.onGenerateTitle}
                    >
                      {conversation.autoNameStatus === "naming" ? t("title.generating") : t("title.generate")}
                    </button>
                  </div>

                  <div className={styles.conversationRowStacked}>
                    <div className={styles.conversationCopy}>
                      <div className={styles.rowTitle}>{t("taskControls.tools")}</div>
                      <div className={styles.rowDescription}>{t("settings.toolsDescription")}</div>
                    </div>
                    <div className={styles.optionGroup}>
                      {(["none", "default", "full"] as const).map((preset) => {
                        const selected = conversation.taskControls?.toolPreset === preset;
                        return (
                          <button
                            className={styles.optionButton}
                            type="button"
                            key={preset}
                            aria-pressed={selected}
                            disabled={!conversation.taskControls || conversation.taskControls.disabled}
                            onClick={() => conversation.taskControls?.onToolPresetChange(preset)}
                          >
                            {selected ? <AliIcon name="check" size={12} /> : null}
                            {t(`taskControls.preset${preset === "none" ? "Off" : preset === "default" ? "Default" : "Full"}`)}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className={styles.conversationRow}>
                    <div className={styles.conversationCopy}>
                      <div className={styles.rowTitle}>{t("taskControls.notifications")}</div>
                      <div className={styles.rowDescription}>
                        {conversation.notificationCapability === "unsupported"
                          ? t("taskControls.notificationsUnsupported")
                          : t("taskControls.notificationsDescription")}
                      </div>
                    </div>
                    <button
                      className={styles.switch}
                      type="button"
                      role="switch"
                      aria-checked={conversation.notificationEnabled}
                      disabled={conversation.notificationCapability === "unsupported"}
                      onClick={() => void conversation.onNotificationToggle()}
                    >
                      <span />
                    </button>
                  </div>
                </section>

                <section className={styles.promptCard}>
                  <div className={styles.sectionEyebrow}>{t("system.prompt")}</div>
                  <pre>{conversation.systemPrompt === null ? t("system.load") : conversation.systemPrompt || t("system.empty")}</pre>
                </section>
              </>
            ) : (
              <>
                <div className={styles.contentHeading}>
                  <h2>{t(activeEntry.labelKey)}</h2>
                  <p>{t(activeEntry.descriptionKey)}</p>
                </div>
                <section className={styles.featureCard}>
                  <div className={styles.featureIcon}>{activeEntry.icon}</div>
                  <div className={styles.featureCopy}>
                    <div className={styles.featureTitle}>{t(activeEntry.labelKey)}</div>
                    <div className={styles.featureDescription}>{t(activeEntry.descriptionKey)}</div>
                  </div>
                  <button className={styles.primaryButton} type="button" onClick={() => openEntry(activeEntry)}>
                    {t("settings.openSection")}
                    <AliIcon name="arrowright" size={14} />
                  </button>
                </section>
                <div className={styles.detailHint}>{t(`settings.hint.${activeEntry.key}`)}</div>
              </>
            )}
          </main>
        </div>
      </div>
    </div>,
    document.body,
  );
}

"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useI18n } from "@/hooks/useI18n";
import { AliIcon } from "./AliIcon";
import type { TaskControls } from "./ChatWindow";
import { SettingsPortabilityCard } from "./SettingsPortabilityCard";
import styles from "./SettingsDialog.module.css";

interface Props {
  open: boolean;
  onClose: () => void;
  activeKey: SettingsKey;
  onActiveKeyChange: (key: SettingsKey) => void;
  sections?: Partial<Record<SettingsKey, ReactNode>>;
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
  desktop: {
    available: boolean;
    globalShortcutEnabled: boolean;
    onGlobalShortcutToggle: () => void | Promise<void>;
  };
}

export type SettingsKey = "general" | "conversation" | "models" | "skills" | "plugins" | "appearance" | "language" | "companion";

interface SettingsEntry {
  key: SettingsKey;
  labelKey: string;
  descriptionKey: string;
  icon: ReactNode;
}

function getSettingsParentKey(key: SettingsKey): SettingsKey {
  if (key === "language") return "general";
  if (key === "models") return "conversation";
  if (key === "plugins") return "skills";
  if (key === "companion") return "appearance";
  return key;
}

export function SettingsDialog({
  open,
  onClose,
  activeKey,
  onActiveKeyChange,
  sections = {},
  conversation,
  desktop,
}: Props) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  useFocusTrap(dialogRef, open, { onEscape: onClose });

  const primaryEntries = useMemo<SettingsEntry[]>(() => [
    {
      key: "general",
      labelKey: "settings.general",
      descriptionKey: "settings.generalDescription",
      icon: <AliIcon name="layout" size={16} />,
    },
    {
      key: "conversation",
      labelKey: "settings.agent",
      descriptionKey: "settings.agentDescription",
      icon: <AliIcon name="message" size={16} />,
    },
    {
      key: "skills",
      labelKey: "settings.extensions",
      descriptionKey: "settings.extensionsDescription",
      icon: <AliIcon name="solution" size={16} />,
    },
    {
      key: "appearance",
      labelKey: "appearance.title",
      descriptionKey: "settings.appearanceDescription",
      icon: <AliIcon name="skin" size={16} />,
    },
  ], []);

  const detailEntries = useMemo<SettingsEntry[]>(() => [
    primaryEntries[0]!,
    {
      key: "language",
      labelKey: "common.language",
      descriptionKey: "settings.languageDescription",
      icon: <AliIcon name="translate" size={16} />,
    },
    {
      key: "conversation",
      labelKey: "settings.conversation",
      descriptionKey: "settings.conversationDescription",
      icon: <AliIcon name="message" size={16} />,
    },
    {
      key: "models",
      labelKey: "common.models",
      descriptionKey: "settings.modelsDescription",
      icon: <AliIcon name="api" size={16} />,
    },
    {
      key: "skills",
      labelKey: "common.skills",
      descriptionKey: "settings.skillsDescription",
      icon: <AliIcon name="solution" size={16} />,
    },
    {
      key: "plugins",
      labelKey: "common.plugins",
      descriptionKey: "settings.pluginsDescription",
      icon: <AliIcon name="appstore-add" size={16} />,
    },
    primaryEntries[3]!,
    {
      key: "companion",
      labelKey: "companion.settingsTitle",
      descriptionKey: "settings.companionDescription",
      icon: <AliIcon name="robot" size={16} />,
    },
  ], [primaryEntries]);

  useEffect(() => {
    if (!open) setSearchQuery("");
  }, [open]);

  const normalizedSearch = deferredSearchQuery.trim().toLocaleLowerCase();
  const filteredEntries = useMemo(() => {
    if (!normalizedSearch) return detailEntries;
    return detailEntries.filter((entry) => [
      t(entry.labelKey),
      t(entry.descriptionKey),
      t(primaryEntries.find((parent) => parent.key === getSettingsParentKey(entry.key))?.labelKey ?? entry.labelKey),
    ].join(" ").toLocaleLowerCase().includes(normalizedSearch));
  }, [detailEntries, normalizedSearch, primaryEntries, t]);

  if (!open || typeof document === "undefined") return null;

  const activeParentKey = getSettingsParentKey(activeKey);
  const activeEntry = detailEntries.find((entry) => entry.key === activeKey) ?? detailEntries[0];
  const activeSubEntries = detailEntries.filter((entry) => getSettingsParentKey(entry.key) === activeParentKey);
  const filteredParentKeys = new Set(filteredEntries.map((entry) => getSettingsParentKey(entry.key)));
  const searching = searchQuery.trim().length > 0;
  const sectionContent = searching ? undefined : sections[activeEntry.key];
  const selectEntry = (entry: SettingsEntry) => {
    setSearchQuery("");
    onActiveKeyChange(entry.key);
  };

  return createPortal(
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label={t("sidebar.settings")}
    >
      <div ref={dialogRef} className={styles.dialog}>
        <header className={styles.header}>
          <button
            className={styles.backButton}
            type="button"
            onClick={onClose}
            title={t("settings.back")}
            aria-label={t("settings.back")}
          >
            <AliIcon name="arrowleft" size={17} />
          </button>
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
            <label className={styles.navSearch}>
              <AliIcon name="search" size={14} />
              <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={t("settings.searchPlaceholder")} aria-label={t("settings.searchPlaceholder")} />
            </label>
            <div className={styles.navGroup}>
              {primaryEntries.filter((entry) => !normalizedSearch || filteredParentKeys.has(entry.key)).map((entry) => (
                <button
                  className={styles.navItem}
                  type="button"
                  key={entry.key}
                  aria-current={activeParentKey === entry.key ? "page" : undefined}
                  onClick={() => selectEntry(entry)}
                >
                  <span className={styles.navIcon}>{entry.icon}</span>
                  <span>{t(entry.labelKey)}</span>
                </button>
              ))}
            </div>
            {filteredEntries.length === 0 ? <div className={styles.navEmpty} role="status">{t("settings.searchEmpty")}</div> : null}
          </nav>

          <main className={`${styles.content}${sectionContent ? ` ${styles.contentEmbedded}` : ""}`}>
            {searching ? (
              <>
                <div className={styles.contentHeading}>
                  <h2>{t("settings.searchTitle")}</h2>
                  <p>{t("settings.searchDescription", { query: searchQuery.trim() })}</p>
                </div>
                {filteredEntries.length > 0 ? <section className={styles.searchResults} aria-label={t("settings.searchResults")}>
                  {filteredEntries.map((entry) => (
                    <button className={styles.settingRow} type="button" key={entry.key} onClick={() => selectEntry(entry)}>
                      <span className={styles.rowIcon}>{entry.icon}</span>
                      <span className={styles.rowCopy}>
                        <span className={styles.rowTitle}>{t(entry.labelKey)}</span>
                        <span className={styles.rowDescription}>{t(entry.descriptionKey)}</span>
                      </span>
                      <AliIcon name="chevron-right" size={15} />
                    </button>
                  ))}
                </section> : <div className={styles.searchEmpty} role="status">{t("settings.searchEmpty")}</div>}
              </>
            ) : <>
              <nav className={`${styles.subnavigation}${sectionContent ? ` ${styles.subnavigationEmbedded}` : ""}`} aria-label={t("settings.sectionNavigation")}>
                {activeSubEntries.map((entry) => (
                  <button type="button" key={entry.key} aria-current={activeKey === entry.key ? "page" : undefined} onClick={() => selectEntry(entry)}>
                    {t(entry.labelKey)}
                  </button>
                ))}
              </nav>
              {activeEntry.key === "general" ? (
              <>
                <div className={styles.contentHeading}>
                  <h2>{t("settings.general")}</h2>
                  <p>{t("settings.generalDescription")}</p>
                </div>
                <SettingsPortabilityCard />
                {desktop.available ? <section className={styles.conversationSection}>
                  <div className={styles.conversationRow}>
                    <div className={styles.conversationCopy}>
                      <div className={styles.rowTitle}>{t("settings.globalShortcut")}</div>
                      <div className={styles.rowDescription}>{t("settings.globalShortcutDescription")}</div>
                    </div>
                    <button className={styles.switch} type="button" role="switch" aria-checked={desktop.globalShortcutEnabled} onClick={() => void desktop.onGlobalShortcutToggle()}><span /></button>
                  </div>
                </section> : null}
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
              ) : sectionContent ? (
              <div className={styles.embeddedSection}>{sectionContent}</div>
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
                </section>
                <div className={styles.detailHint}>{t(`settings.hint.${activeEntry.key}`)}</div>
              </>
              )}
            </>}
          </main>
        </div>
      </div>
    </div>,
    document.body,
  );
}

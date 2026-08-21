"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useI18n } from "@/hooks/useI18n";
import { AliIcon } from "./AliIcon";
import { SettingsPortabilityCard } from "./SettingsPortabilityCard";
import { PROMPT_OPTIMIZER_MAX_SYSTEM_PROMPT_LENGTH, PROMPT_OPTIMIZER_SYSTEM_PROMPT } from "@/lib/prompt-optimizer";
import {
  readPromptOptimizerSystemPrompt,
  resetPromptOptimizerSystemPrompt,
  writePromptOptimizerSystemPrompt,
} from "@/lib/prompt-optimizer-settings";
import { SESSION_TITLE_PROMPT_MAX_LENGTH } from "@/lib/session-title-prompt";
import {
  SESSION_TITLE_PROMPT,
  readSessionTitlePrompt,
  resetSessionTitlePrompt,
  writeSessionTitlePrompt,
} from "@/lib/session-title-settings";
import styles from "./SettingsDialog.module.css";

interface Props {
  open: boolean;
  onClose: () => void;
  activeKey: SettingsKey;
  onActiveKeyChange: (key: SettingsKey) => void;
  sections?: Partial<Record<SettingsKey, ReactNode>>;
  conversation: {
    systemPrompt: string | null;
    notificationEnabled: boolean;
    notificationCapability: "desktop" | "browser" | "unsupported";
    onNotificationToggle: () => void | Promise<void>;
  };
  desktop: {
    available: boolean;
    globalShortcutEnabled: boolean;
    onGlobalShortcutToggle: () => void | Promise<void>;
  };
}

export type SettingsKey = "general" | "conversation" | "models" | "extensions" | "skills" | "plugins" | "appearance" | "language" | "companion" | "remote" | "archived";

interface SettingsEntry {
  key: SettingsKey;
  labelKey: string;
  descriptionKey: string;
  icon: ReactNode;
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
  const [optimizerPromptDraft, setOptimizerPromptDraft] = useState(PROMPT_OPTIMIZER_SYSTEM_PROMPT);
  const [optimizerPromptSaved, setOptimizerPromptSaved] = useState(PROMPT_OPTIMIZER_SYSTEM_PROMPT);
  const [optimizerPromptStatus, setOptimizerPromptStatus] = useState<"idle" | "saved" | "error">("idle");
  const [titlePromptDraft, setTitlePromptDraft] = useState(SESSION_TITLE_PROMPT);
  const [titlePromptSaved, setTitlePromptSaved] = useState(SESSION_TITLE_PROMPT);
  const [titlePromptStatus, setTitlePromptStatus] = useState<"idle" | "saved" | "error">("idle");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  useFocusTrap(dialogRef, open, { onEscape: onClose });

  const detailEntries = useMemo<SettingsEntry[]>(() => [
    {
      key: "general",
      labelKey: "settings.general",
      descriptionKey: "settings.generalDescription",
      icon: <AliIcon name="layout" size={16} />,
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
      key: "appearance",
      labelKey: "appearance.title",
      descriptionKey: "settings.appearanceDescription",
      icon: <AliIcon name="skin" size={16} />,
    },
    {
      key: "language",
      labelKey: "common.language",
      descriptionKey: "settings.languageDescription",
      icon: <AliIcon name="translate" size={16} />,
    },
    {
      key: "companion",
      labelKey: "companion.settingsTitle",
      descriptionKey: "settings.companionDescription",
      icon: <AliIcon name="robot" size={16} />,
    },
    {
      key: "extensions",
      labelKey: "settings.extensions",
      descriptionKey: "settings.manageExtensionsDescription",
      icon: <AliIcon name="setting" size={16} />,
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
    {
      key: "remote",
      labelKey: "remote.title",
      descriptionKey: "remote.description",
      icon: <AliIcon name="external-link" size={16} />,
    },
    {
      key: "archived",
      labelKey: "archive.title",
      descriptionKey: "archive.description",
      icon: <AliIcon name="archive" size={16} />,
    },
  ], []);

  const entryGroups = useMemo(() => [
    { labelKey: "settings.group.personal", keys: ["general", "conversation", "models", "appearance", "language", "companion"] as SettingsKey[] },
    { labelKey: "settings.group.capabilities", keys: ["extensions", "skills", "plugins", "remote"] as SettingsKey[] },
    { labelKey: "settings.group.history", keys: ["archived"] as SettingsKey[] },
  ], []);

  const availableEntries = useMemo(() => detailEntries.filter((entry) => (
    entry.key === "general" || entry.key === "conversation" || sections[entry.key] !== undefined
  )), [detailEntries, sections]);

  useEffect(() => {
    if (!open) setSearchQuery("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const saved = readPromptOptimizerSystemPrompt(window.localStorage);
    setOptimizerPromptDraft(saved);
    setOptimizerPromptSaved(saved);
    setOptimizerPromptStatus("idle");
    const savedTitlePrompt = readSessionTitlePrompt(window.localStorage);
    setTitlePromptDraft(savedTitlePrompt);
    setTitlePromptSaved(savedTitlePrompt);
    setTitlePromptStatus("idle");
  }, [open]);

  const saveOptimizerPrompt = () => {
    try {
      const saved = writePromptOptimizerSystemPrompt(optimizerPromptDraft, window.localStorage);
      setOptimizerPromptDraft(saved);
      setOptimizerPromptSaved(saved);
      setOptimizerPromptStatus("saved");
    } catch {
      setOptimizerPromptStatus("error");
    }
  };

  const restoreOptimizerPrompt = () => {
    try {
      const restored = resetPromptOptimizerSystemPrompt(window.localStorage);
      setOptimizerPromptDraft(restored);
      setOptimizerPromptSaved(restored);
      setOptimizerPromptStatus("saved");
    } catch {
      setOptimizerPromptStatus("error");
    }
  };

  const saveTitlePrompt = () => {
    try {
      const saved = writeSessionTitlePrompt(titlePromptDraft, window.localStorage);
      setTitlePromptDraft(saved);
      setTitlePromptSaved(saved);
      setTitlePromptStatus("saved");
    } catch {
      setTitlePromptStatus("error");
    }
  };

  const restoreTitlePrompt = () => {
    try {
      const restored = resetSessionTitlePrompt(window.localStorage);
      setTitlePromptDraft(restored);
      setTitlePromptSaved(restored);
      setTitlePromptStatus("saved");
    } catch {
      setTitlePromptStatus("error");
    }
  };

  const normalizedSearch = deferredSearchQuery.trim().toLocaleLowerCase();
  const filteredEntries = useMemo(() => {
    if (!normalizedSearch) return availableEntries;
    return availableEntries.filter((entry) => [
      t(entry.labelKey),
      t(entry.descriptionKey),
      ...entryGroups.filter((group) => group.keys.includes(entry.key)).map((group) => t(group.labelKey)),
    ].join(" ").toLocaleLowerCase().includes(normalizedSearch));
  }, [availableEntries, entryGroups, normalizedSearch, t]);

  if (!open || typeof document === "undefined") return null;

  const activeEntry = availableEntries.find((entry) => entry.key === activeKey) ?? availableEntries[0] ?? detailEntries[0]!;
  const searching = searchQuery.trim().length > 0;
  const sectionContent = searching ? undefined : sections[activeEntry.key];
  const selectEntry = (entry: SettingsEntry) => {
    setSearchQuery("");
    onActiveKeyChange(entry.key);
  };

  return createPortal(
    <div
      className={`${styles.backdrop}${desktop.available ? ` ${styles.desktopBackdrop}` : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={t("sidebar.settings")}
    >
      <div ref={dialogRef} className={styles.dialog}>
        <div className={styles.workspace}>
          <nav className={styles.navigation} aria-label={t("settings.navigation")}>
            <button
              className={styles.backButton}
              type="button"
              onClick={onClose}
              title={t("settings.back")}
              aria-label={t("settings.back")}
            >
              <AliIcon name="arrowleft" size={16} />
              <span className={styles.backLabel}>{t("settings.back")}</span>
            </button>
            <label className={styles.navSearch}>
              <AliIcon name="search" size={14} />
              <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={t("settings.searchPlaceholder")} aria-label={t("settings.searchPlaceholder")} />
            </label>
            {entryGroups.map((group) => {
              const entries = filteredEntries.filter((entry) => group.keys.includes(entry.key));
              if (entries.length === 0) return null;
              return <div className={styles.navGroup} key={group.labelKey}>
                <div className={styles.navGroupLabel}>{t(group.labelKey)}</div>
                {entries.map((entry) => (
                  <button
                    className={styles.navItem}
                    type="button"
                    key={entry.key}
                    aria-current={activeEntry.key === entry.key ? "page" : undefined}
                    onClick={() => selectEntry(entry)}
                  >
                    <span className={styles.navIcon}>{entry.icon}</span>
                    <span>{t(entry.labelKey)}</span>
                  </button>
                ))}
              </div>;
            })}
            {filteredEntries.length === 0 ? <div className={styles.navEmpty} role="status">{t("settings.searchEmpty")}</div> : null}
          </nav>

          <main className={styles.content}>
            <div className={styles.contentToolbar} aria-hidden="true" />
            <div className={`${styles.contentBody}${sectionContent ? ` ${styles.contentBodyEmbedded}` : ""}`}>
            <div className={sectionContent ? styles.embeddedSection : styles.contentCanvas}>
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
                  <div className={styles.conversationRowStacked}>
                    <div className={styles.conversationCopy}>
                      <div className={styles.rowTitle}>{t("settings.sessionTitlePromptTitle")}</div>
                      <div className={styles.rowDescription}>{t("settings.sessionTitlePromptDescription")}</div>
                    </div>
                    <textarea
                      className={styles.promptEditor}
                      value={titlePromptDraft}
                      maxLength={SESSION_TITLE_PROMPT_MAX_LENGTH}
                      aria-label={t("settings.sessionTitlePromptTitle")}
                      onChange={(event) => {
                        setTitlePromptDraft(event.target.value);
                        setTitlePromptStatus("idle");
                      }}
                    />
                    <div className={styles.promptEditorFooter}>
                      <span role="status">
                        {titlePromptStatus === "saved"
                          ? t("settings.sessionTitlePromptSaved")
                          : titlePromptStatus === "error"
                            ? t("settings.sessionTitlePromptSaveFailed")
                            : `${Array.from(titlePromptDraft).length.toLocaleString()} / ${SESSION_TITLE_PROMPT_MAX_LENGTH.toLocaleString()}`}
                      </span>
                      <div>
                        <button className={styles.secondaryButton} type="button" onClick={restoreTitlePrompt}>{t("settings.sessionTitlePromptRestore")}</button>
                        <button
                          className={styles.primaryButton}
                          type="button"
                          disabled={!titlePromptDraft.trim() || titlePromptDraft.trim() === titlePromptSaved}
                          onClick={saveTitlePrompt}
                        >
                          {t("settings.sessionTitlePromptSave")}
                        </button>
                      </div>
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

                  <div className={styles.conversationRowStacked}>
                    <div className={styles.conversationCopy}>
                      <div className={styles.rowTitle}>{t("settings.promptOptimizerTitle")}</div>
                      <div className={styles.rowDescription}>{t("settings.promptOptimizerDescription")}</div>
                    </div>
                    <textarea
                      className={styles.promptEditor}
                      value={optimizerPromptDraft}
                      maxLength={PROMPT_OPTIMIZER_MAX_SYSTEM_PROMPT_LENGTH}
                      aria-label={t("settings.promptOptimizerTitle")}
                      onChange={(event) => {
                        setOptimizerPromptDraft(event.target.value);
                        setOptimizerPromptStatus("idle");
                      }}
                    />
                    <div className={styles.promptEditorFooter}>
                      <span role="status">
                        {optimizerPromptStatus === "saved"
                          ? t("settings.promptOptimizerSaved")
                          : optimizerPromptStatus === "error"
                            ? t("settings.promptOptimizerSaveFailed")
                            : `${Array.from(optimizerPromptDraft).length.toLocaleString()} / ${PROMPT_OPTIMIZER_MAX_SYSTEM_PROMPT_LENGTH.toLocaleString()}`}
                      </span>
                      <div>
                        <button className={styles.secondaryButton} type="button" onClick={restoreOptimizerPrompt}>{t("settings.promptOptimizerRestore")}</button>
                        <button
                          className={styles.primaryButton}
                          type="button"
                          disabled={!optimizerPromptDraft.trim() || optimizerPromptDraft.trim() === optimizerPromptSaved}
                          onClick={saveOptimizerPrompt}
                        >
                          {t("settings.promptOptimizerSave")}
                        </button>
                      </div>
                    </div>
                  </div>
                </section>

                <section className={styles.promptCard}>
                  <div className={styles.sectionEyebrow}>{t("system.prompt")}</div>
                  <pre>{conversation.systemPrompt === null ? t("system.load") : conversation.systemPrompt || t("system.empty")}</pre>
                </section>
              </>
              ) : sectionContent ? (
              sectionContent
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
            </div>
            </div>
          </main>
        </div>
      </div>
    </div>,
    document.body,
  );
}

"use client";
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useI18n } from "@/hooks/useI18n";
import { filterSettingsSearchItems, normalizeSettingsKey, SETTINGS_GROUPS, type SettingsKey } from "@/lib/settings-search";
import { AliIcon, type AliIconName } from "./AliIcon";
import { BrowserSettings } from "./BrowserSettings";
import { DesktopAutoLaunchSetting } from "./DesktopAutoLaunchSetting";
import { DesktopUpdateScheduleSetting } from "./DesktopUpdateScheduleSetting";
import { DesktopUpdateSourceSetting } from "./DesktopUpdateSourceSetting";
import { LaboratorySettings } from "./LaboratorySettings";
import { NetworkProxySettings } from "./NetworkProxySettings";
import { ConversationSettingsPage } from "./settings/ConversationSettingsPage";
import { DataSettingsPage } from "./settings/DataSettingsPage";
import { PromptsSettingsPage } from "./settings/PromptsSettingsPage";
import { SettingsPage, SettingsRow, SettingsSection } from "./settings/SettingsPrimitives";
import primitiveStyles from "./settings/SettingsPrimitives.module.css";
import styles from "./SettingsDialog.module.css";

interface Props {
  open: boolean;
  onClose: () => void;
  activeKey: SettingsKey;
  focusedItemId?: string;
  onActiveKeyChange: (key: SettingsKey) => void;
  onOpenOnboarding?: () => void;
  modelCwd?: string;
  sections?: Partial<Record<SettingsKey, ReactNode>>;
  conversation: {
    systemPrompt: string | null;
    onSystemPromptSaved: () => void;
    notificationEnabled: boolean;
    notificationCapability: "desktop" | "browser" | "unsupported";
    onNotificationToggle: () => void | Promise<void>;
  };
  desktop: {
    available: boolean;
  };
}

export type { SettingsKey } from "@/lib/settings-search";

interface SettingsEntry {
  key: SettingsKey;
  labelKey: string;
  icon: ReactNode;
}

function entryInGroup(entry: SettingsEntry, group: typeof SETTINGS_GROUPS[number]): boolean {
  return group.pages.some((page) => page.key === entry.key);
}

export function SettingsDialog({
  open,
  onClose,
  activeKey: requestedKey,
  focusedItemId,
  onActiveKeyChange,
  onOpenOnboarding,
  modelCwd,
  sections = {},
  conversation,
  desktop,
}: Props) {
  const { t } = useI18n();
  const normalizedKey = normalizeSettingsKey(requestedKey);
  const activeKey = normalizedKey === "data" && !desktop.available ? "general" : normalizedKey;
  const dialogRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [targetItem, setTargetItem] = useState<{ id: string } | null>(null);
  useEffect(() => { setTargetItem(focusedItemId ? { id: focusedItemId } : null); }, [focusedItemId, open]);
  useEffect(() => {
    if (!open || searchQuery || !targetItem || targetItem.id === activeKey || targetItem.id.startsWith("browser.page.")) return;
    const root = dialogRef.current;
    if (!root) return;
    let cleanupHighlight: (() => void) | undefined;
    const locate = () => {
      const target = [...root.querySelectorAll<HTMLElement>("[data-settings-id]")]
        .find((element) => element.dataset.settingsId === targetItem.id);
      if (!target) return false;
      const hiddenPanel = target.closest<HTMLElement>('[role="tabpanel"][hidden]');
      if (hiddenPanel) {
        const tab = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
          .find(element => element.getAttribute("aria-controls") === hiddenPanel.id);
        tab?.click();
        return false;
      }
      for (let ancestor: HTMLElement | null = target; ancestor && ancestor !== root; ancestor = ancestor.parentElement) {
        if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
      }
      target.scrollIntoView({ block: "center", behavior: "instant" });
      const oldTabIndex = target.getAttribute("tabindex");
      target.tabIndex = -1;
      target.focus({ preventScroll: true });
      target.dataset.settingsHighlighted = "true";
      cleanupHighlight = () => {
        delete target.dataset.settingsHighlighted;
        if (oldTabIndex === null) target.removeAttribute("tabindex");
        else target.setAttribute("tabindex", oldTabIndex);
      };
      return true;
    };
    const observer = new MutationObserver(() => { if (locate()) observer.disconnect(); });
    if (!locate()) observer.observe(root, { childList: true, attributes: true, attributeFilter: ["hidden"], subtree: true });
    const timeout = window.setTimeout(() => { observer.disconnect(); cleanupHighlight?.(); }, 8_000);
    return () => { observer.disconnect(); window.clearTimeout(timeout); cleanupHighlight?.(); };
  }, [activeKey, open, searchQuery, targetItem]);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  useFocusTrap(dialogRef, open, { onEscape: onClose });

  const detailEntries = useMemo<SettingsEntry[]>(() => SETTINGS_GROUPS.flatMap((group) => group.pages.map((page) => ({
    key: page.key,
    labelKey: page.labelKey,
    icon: <AliIcon name={page.icon as AliIconName} size={16} />,
  }))), []);

  const availableEntries = useMemo(() => detailEntries.filter((entry) => entry.key === "data" || entry.key === "browser" ? desktop.available : (
    ["general", "network", "conversation", "prompts", "laboratory"].includes(entry.key)
    || sections[entry.key] !== undefined
  )), [desktop.available, detailEntries, sections]);

  useEffect(() => {
    if (!open) setSearchQuery("");
  }, [open]);

  const normalizedSearch = deferredSearchQuery.trim().toLocaleLowerCase();
  const searchItems = useMemo(() => filterSettingsSearchItems(normalizedSearch, t, { hasProject: Boolean(modelCwd), hasDesktop: desktop.available, limit: 100 })
    .filter((item) => availableEntries.some((entry) => entry.key === item.section)),
  [availableEntries, desktop.available, modelCwd, normalizedSearch, t]);
  const filteredEntries = useMemo(() => {
    if (!normalizedSearch) return availableEntries;
    const matches = new Set(searchItems.map((item) => item.section));
    return availableEntries.filter((entry) => matches.has(entry.key));
  }, [availableEntries, normalizedSearch, searchItems]);

  if (!open || typeof document === "undefined") return null;

  const activeEntry = availableEntries.find((entry) => entry.key === activeKey) ?? availableEntries[0] ?? detailEntries[0]!;
  const searching = searchQuery.trim().length > 0;
  const sectionContent = searching ? undefined : sections[activeKey];
  const embedded = Boolean(sectionContent) && activeKey !== "shell" && activeKey !== "archived";
  const widePage = embedded && ["models", "automations", "usage", "companion"].includes(activeKey);
  const selectEntry = (entry: SettingsEntry) => {
    setTargetItem(null);
    setSearchQuery("");
    onActiveKeyChange(entry.key);
  };

  return createPortal(
    <div
      className={`${styles.backdrop} settings-backdrop${desktop.available ? ` ${styles.desktopBackdrop}` : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={t("sidebar.settings")}
    >
      <div ref={dialogRef} className={`${styles.dialog} settings-dialog`}>
        <div className={styles.workspace}>
          <nav className={`${styles.navigation} settings-navigation`} aria-label={t("settings.navigation")}>
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
            <div className={styles.desktopGroups}>
            {SETTINGS_GROUPS.map((group) => {
              const entries = filteredEntries.filter((entry) => entryInGroup(entry, group));
              if (entries.length === 0) return null;
              return <div className={styles.navGroup} key={group.labelKey}>
                <div className={styles.navGroupLabel}>{t(group.labelKey)}</div>
                <div className={styles.navGroupItems}>{entries.map((entry) => (
                  <button
                    className={styles.navItem}
                    type="button"
                    key={entry.key}
                    data-testid={`settings-${entry.key}`}
                    aria-current={activeEntry.key === entry.key ? "page" : undefined}
                    onClick={() => selectEntry(entry)}
                  >
                    <span className={styles.navIcon}>{entry.icon}</span>
                    <span>{t(entry.labelKey)}</span>
                  </button>
                ))}</div>
              </div>;
            })}
            </div>
            {filteredEntries.length === 0 ? <div className={styles.navEmpty} role="status">{t("settings.searchEmpty")}</div> : null}
          </nav>

          <main className={`${styles.content} settings-content`}>
            <div className={`${styles.contentBody}${embedded ? ` ${styles.contentBodyEmbedded}` : ""}`}>
            <div className={`${styles.contentCanvas} settings-embedded-section`} data-embedded={embedded} data-wide={widePage}>
            <div className={styles.tabPanel}>
            {searching ? (
              <>
                <div className={styles.contentHeading}>
                  <h2>{t("settings.searchTitle")}</h2>
                </div>
                {searchItems.length > 0 ? <section className={styles.searchResults} aria-label={t("settings.searchResults")}>
                  {searchItems.map((entry) => {
                    const section = availableEntries.find((candidate) => candidate.key === entry.section);
                    return (
                      <button className={styles.settingRow} type="button" key={entry.id} onClick={() => { setSearchQuery(""); setTargetItem({ id: entry.id }); onActiveKeyChange(entry.section); }}>
                        <span className={styles.rowIcon}>{section?.icon}</span>
                        <span className={styles.rowCopy}>
                          <span className={styles.rowTitle}>{t(entry.labelKey)}</span>
                          {section && entry.labelKey !== section.labelKey && <span className={styles.rowDescription}>{t(section.labelKey)}</span>}
                        </span>
                        <AliIcon name="chevron-right" size={15} />
                      </button>
                    );
                  })}
                </section> : <div className={styles.searchEmpty} role="status">{t("settings.searchEmpty")}</div>}
              </>
            ) : <>
              {activeEntry.key === "browser" ? <BrowserSettings requestedPage={targetItem?.id} /> : activeEntry.key === "general" ? (
                <SettingsPage title={t("settings.general")}>
                  <SettingsSection>
                    {onOpenOnboarding ? (
                      <SettingsRow
                        title={t("settings.firstRunGuideTitle")}
                        settingsId="general.onboarding"
                      >
                        <button className={primitiveStyles.buttonPrimary} type="button" onClick={onOpenOnboarding}>
                          <AliIcon name="play" size={13} />
                          {t("settings.firstRunGuideAction")}
                        </button>
                      </SettingsRow>
                    ) : null}
                    {desktop.available ? (
                      <>
                        <div data-settings-id="general.autoLaunch"><DesktopAutoLaunchSetting /></div>
                        <DesktopUpdateSourceSetting />
                        <DesktopUpdateScheduleSetting />
                      </>
                    ) : null}
                  </SettingsSection>
                </SettingsPage>
              ) : activeKey === "laboratory" ? <LaboratorySettings cwd={modelCwd} /> : activeKey === "data" ? (
                <DataSettingsPage open={open} desktopAvailable={desktop.available} />
              ) : activeKey === "network" ? (
                <div data-settings-id="general.proxy"><NetworkProxySettings /></div>
              ) : activeKey === "conversation" ? (
                <ConversationSettingsPage
                  modelCwd={modelCwd}
                  focusedItemId={targetItem?.id}
                  notificationEnabled={conversation.notificationEnabled}
                  notificationCapability={conversation.notificationCapability}
                  onNotificationToggle={conversation.onNotificationToggle}
                />
              ) : activeKey === "prompts" ? (
                <PromptsSettingsPage
                  open={open}
                  modelCwd={modelCwd}
                  systemPrompt={conversation.systemPrompt}
                  onSystemPromptSaved={conversation.onSystemPromptSaved}
                />
              ) : sectionContent ? (
              sectionContent
              ) : (
              <div className={styles.contentHeading}>
                <h2>{t(activeEntry.labelKey)}</h2>
              </div>
              )}
            </>}
            </div>
            </div>
            </div>
          </main>
        </div>
      </div>
    </div>,
    document.body,
  );
}

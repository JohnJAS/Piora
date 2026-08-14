"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useI18n } from "@/hooks/useI18n";
import {
  getCompanionPetSourceKey,
  type CompanionPetSource,
} from "@/hooks/useCompanionPets";
import type { CompanionPet, CompanionPetSourceKind, CompanionPetsResponse } from "@/lib/companion-pets";
import { AliIcon } from "./AliIcon";
import styles from "./CompanionSettingsDialog.module.css";

const SOURCE_MESSAGE_KEYS: Record<CompanionPetSourceKind, string> = {
  "codex-builtin-cache": "companion.source.codexBuiltinCache",
  "codex-custom": "companion.source.codexCustom",
  "codex-legacy-avatar": "companion.source.codexLegacyAvatar",
  "piora-bundled": "companion.source.pioraBundled",
  "piora-installed": "companion.source.pioraInstalled",
};

function resolvePetSourceKind(pet: CompanionPetSource): CompanionPetSourceKind {
  if (pet.sourceKind === "piora-bundled") return pet.sourceKind;
  if (pet.installed && pet.origin && pet.origin in SOURCE_MESSAGE_KEYS) return pet.origin;
  if (pet.sourceKind && pet.sourceKind in SOURCE_MESSAGE_KEYS) return pet.sourceKind;
  return pet.source === "codex" ? "codex-custom" : "piora-installed";
}

interface Props {
  open: boolean;
  onClose: () => void;
  embedded?: boolean;
  companionOpen: boolean;
  onCompanionOpenChange: (open: boolean) => void;
  alwaysOnTop: boolean;
  onAlwaysOnTopChange: (alwaysOnTop: boolean) => void;
  desktopMode: boolean;
  selectedPetId: string;
  onSelectPet: (petId: string) => void;
  catalog: CompanionPetsResponse | null;
  loading: boolean;
  error: string | null;
  importingPetKey: string | null;
  importingArchive: boolean;
  onRefresh: () => void;
  onImportPet: (pet: CompanionPetSource) => Promise<CompanionPet | null>;
  onImportArchive: (file: File) => Promise<CompanionPet | null>;
}

export function CompanionSettingsDialog({
  open,
  onClose,
  embedded = false,
  companionOpen,
  onCompanionOpenChange,
  alwaysOnTop,
  onAlwaysOnTopChange,
  desktopMode,
  selectedPetId,
  onSelectPet,
  catalog,
  loading,
  error,
  importingPetKey,
  importingArchive,
  onRefresh,
  onImportPet,
  onImportArchive,
}: Props) {
  const { t } = useI18n();
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const archiveInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open && !embedded, { onEscape: onClose });

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  if (!open || (!embedded && !portalTarget)) return null;

  const content = (
    <div
      className="app-shell-dialog-backdrop"
      role={embedded ? undefined : "dialog"}
      aria-modal={embedded ? undefined : true}
      aria-label={t("companion.settingsTitle")}
      onClick={(event) => {
        if (!embedded && event.target === event.currentTarget) onClose();
      }}
      style={{
        position: embedded ? "relative" : "fixed", inset: embedded ? undefined : 0, zIndex: embedded ? undefined : 1200,
        width: "100%", height: "100%", minHeight: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: embedded ? "var(--bg)" : "rgba(0,0,0,0.35)",
      }}
    >
      <div ref={dialogRef} className={styles.dialog} style={embedded ? { width: "100%", maxWidth: "none", height: "100%", maxHeight: "none", border: 0, borderRadius: 0, boxShadow: "none" } : undefined}>
        <input
          ref={archiveInputRef}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            void onImportArchive(file).then((imported) => {
              if (imported) onSelectPet(imported.id);
            });
          }}
        />
        <header className={styles.header}>
          <div>
            <div className={styles.title}>{t("companion.settingsTitle")}</div>
            <div className={styles.subtitle}>{t("companion.settingsDescription")}</div>
          </div>
          {!embedded && <button className={styles.closeButton} type="button" onClick={onClose} title={t("i18n.close")} aria-label={t("i18n.close")}>
            <AliIcon name="close" size={14} />
          </button>}
        </header>

        <div className={styles.body}>
          <div className={styles.displayCard}>
            <span className={styles.displayIcon} aria-hidden="true">
              <AliIcon name="robot" size={18} />
            </span>
            <div className={styles.copy}>
              <div className={styles.label}>{t("companion.showCompanion")}</div>
              <div className={styles.description}>{t("companion.showCompanionDescription")}</div>
            </div>
            <button
              className={styles.switch}
              type="button"
              role="switch"
              aria-checked={companionOpen}
              aria-label={t("companion.showCompanion")}
              onClick={() => onCompanionOpenChange(!companionOpen)}
            >
              <span className={styles.switchThumb} />
            </button>
          </div>

          <div className={styles.displayCard} data-disabled={desktopMode ? undefined : "true"}>
            <span className={styles.displayIcon} aria-hidden="true">
              <AliIcon name="pushpin" size={18} />
            </span>
            <div className={styles.copy}>
              <div className={styles.label}>{t("companion.alwaysOnTop")}</div>
              <div className={styles.description}>{t("companion.alwaysOnTopDescription")}</div>
            </div>
            <button
              className={styles.switch}
              type="button"
              role="switch"
              aria-checked={alwaysOnTop}
              aria-label={t("companion.alwaysOnTop")}
              disabled={!desktopMode}
              onClick={() => onAlwaysOnTopChange(!alwaysOnTop)}
            >
              <span className={styles.switchThumb} />
            </button>
          </div>

          <div className={styles.modeCard} data-available={desktopMode ? "true" : "false"}>
            <span className={styles.modeIcon} aria-hidden="true"><AliIcon name="layout" size={16} /></span>
            <div className={styles.copy}>
              <div className={styles.label}>{t("companion.desktopMode")}</div>
              <div className={styles.description}>{t("companion.desktopModeDescription")}</div>
            </div>
            <span className={styles.modeBadge}>
              {desktopMode ? t("companion.desktopModeReady") : t("companion.desktopModeUnavailable")}
            </span>
          </div>

          <details className={styles.helpCard}>
            <summary>{t("companion.howToUse")}</summary>
            <ol>
              <li>{t("companion.helpStatus")}</li>
              <li>{t("companion.helpTodos")}</li>
              <li>{t("companion.helpPhrases")}</li>
              <li>{desktopMode ? t("companion.helpDesktop") : t("companion.helpBrowser")}</li>
            </ol>
          </details>

          <section className={styles.section} aria-labelledby="companion-import-zip-title">
            <div className={styles.importCard} style={{ marginBottom: 9 }}>
              <span className={styles.importIcon} aria-hidden="true"><AliIcon name="link" size={17} /></span>
              <div className={styles.copy}>
                <div className={styles.label}>{t("companion.openSourceCatalog")}</div>
                <div className={styles.description}>{t("companion.openSourceCatalogDescription")}</div>
                <div className={styles.archiveHint}>{t("companion.openSourceCatalogLicense")}</div>
              </div>
              <a
                className={styles.primaryButton}
                data-open-pet-runtime
                href="https://github.com/alterhq/openpets"
                target="_blank"
                rel="noreferrer noopener"
              >
                {t("companion.browseCatalog")}
              </a>
            </div>
            <div className={styles.importCard}>
              <span className={styles.importIcon} aria-hidden="true"><AliIcon name="import" size={17} /></span>
              <div className={styles.copy}>
                <div className={styles.label} id="companion-import-zip-title">{t("companion.importZip")}</div>
                <div className={styles.description}>{t("companion.importZipDescription")}</div>
                <div className={styles.archiveHint}>{t("companion.importZipHint")}</div>
              </div>
              <button
                className={styles.primaryButton}
                type="button"
                disabled={importingArchive || importingPetKey !== null}
                onClick={() => archiveInputRef.current?.click()}
              >
                {importingArchive ? t("companion.importing") : t("companion.chooseZip")}
              </button>
            </div>
          </section>

          <section className={styles.section} aria-labelledby="companion-installed-pets-title">
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle} id="companion-installed-pets-title">{t("companion.petAppearance")}</div>
                <div className={styles.sectionDescription}>{t("companion.petAppearanceDescription")}</div>
              </div>
            </div>
            <ul className={styles.petList}>
              <li className={styles.petRow}>
                <span className={styles.petIcon} aria-hidden="true"><AliIcon name="robot" size={17} /></span>
                <div className={styles.copy}>
                  <div className={styles.petName}>{t("companion.builtinPet")}</div>
                  <div className={styles.petMeta}>{t("companion.builtinPetDescription")}</div>
                </div>
                <button
                  className={`${styles.selectButton}${selectedPetId === "builtin" ? ` ${styles.selected}` : ""}`}
                  type="button"
                  disabled={selectedPetId === "builtin"}
                  onClick={() => onSelectPet("builtin")}
                >
                  {selectedPetId === "builtin" ? t("companion.selected") : t("companion.select")}
                </button>
              </li>
              {catalog?.installed.map((pet) => {
                const sourcedPet = pet as CompanionPetSource;
                const sourceLabel = t(SOURCE_MESSAGE_KEYS[resolvePetSourceKind(sourcedPet)]);
                const selected = selectedPetId === pet.id;
                return (
                  <li className={styles.petRow} key={`installed:${getCompanionPetSourceKey(sourcedPet)}`}>
                    <span className={styles.petIcon} aria-hidden="true"><AliIcon name="robot" size={17} /></span>
                    <div className={styles.copy}>
                      <div className={styles.petName}>{pet.displayName}</div>
                      <div className={styles.petMeta}>
                        {sourceLabel} · {t("companion.codexCompatibleVersion", { version: pet.spriteVersionNumber })}{pet.author ? ` · ${pet.author}` : ""}
                      </div>
                    </div>
                    <button
                      className={`${styles.selectButton}${selected ? ` ${styles.selected}` : ""}`}
                      type="button"
                      disabled={selected}
                      onClick={() => onSelectPet(pet.id)}
                    >
                      {selected ? t("companion.selected") : t("companion.select")}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className={styles.section} aria-labelledby="companion-local-pets-title">
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle} id="companion-local-pets-title">{t("companion.discoveredCodexPets")}</div>
                <div className={styles.sectionDescription}>{t("companion.localOnly")}</div>
              </div>
              <button className={styles.secondaryButton} type="button" onClick={onRefresh} disabled={loading}>
                {t("companion.refresh")}
              </button>
            </div>

            {loading && !catalog ? <div className={styles.notice}>{t("companion.loadingPets")}</div> : null}
            {!loading && catalog && catalog.sources.length === 0 ? (
              <div className={styles.empty}>{catalog.codexSourceAvailable ? t("companion.noCodexPets") : t("companion.codexNotFound")}</div>
            ) : null}
            <ul className={styles.petList}>
              {catalog?.sources.map((pet) => {
                const sourcedPet = pet as CompanionPetSource;
                const sourceKey = getCompanionPetSourceKey(sourcedPet);
                const sourceLabel = t(SOURCE_MESSAGE_KEYS[resolvePetSourceKind(sourcedPet)]);
                return (
                  <li className={styles.petRow} key={`source:${sourceKey}`}>
                    <span className={styles.petIcon} aria-hidden="true"><AliIcon name="robot" size={17} /></span>
                    <div className={styles.copy}>
                      <div className={styles.petName}>{pet.displayName}</div>
                      <div className={styles.petMeta}>
                        {sourceLabel} · {t("companion.codexCompatibleVersion", { version: pet.spriteVersionNumber })}{pet.description ? ` · ${pet.description}` : ""}
                      </div>
                    </div>
                    <button
                      className={styles.primaryButton}
                      type="button"
                      disabled={importingPetKey !== null}
                      onClick={() => {
                        void onImportPet(sourcedPet).then((imported) => {
                          if (imported) onSelectPet(imported.id);
                        });
                      }}
                    >
                      {importingPetKey === sourceKey ? t("companion.importing") : t("companion.import")}
                    </button>
                  </li>
                );
              })}
            </ul>
            {error ? <div className={styles.error} role="alert">{error}</div> : null}
            {catalog?.diagnostics.map((diagnostic, index) => (
              <div className={styles.diagnostic} key={`${diagnostic.scope}:${diagnostic.id ?? "general"}:${index}`}>{diagnostic.message}</div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
  return embedded ? content : createPortal(content, portalTarget!);
}

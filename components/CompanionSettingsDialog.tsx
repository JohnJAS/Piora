"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
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
  "pi-gui-installed": "companion.source.piGuiInstalled",
};

function resolvePetSourceKind(pet: CompanionPetSource): CompanionPetSourceKind {
  if (pet.installed && pet.origin && pet.origin in SOURCE_MESSAGE_KEYS) return pet.origin;
  if (pet.sourceKind && pet.sourceKind in SOURCE_MESSAGE_KEYS) return pet.sourceKind;
  return pet.source === "codex" ? "codex-custom" : "pi-gui-installed";
}

interface Props {
  open: boolean;
  onClose: () => void;
  companionOpen: boolean;
  onCompanionOpenChange: (open: boolean) => void;
  selectedPetId: string;
  onSelectPet: (petId: string) => void;
  catalog: CompanionPetsResponse | null;
  loading: boolean;
  error: string | null;
  importingPetKey: string | null;
  onRefresh: () => void;
  onImportPet: (pet: CompanionPetSource) => Promise<CompanionPet | null>;
}

export function CompanionSettingsDialog({
  open,
  onClose,
  companionOpen,
  onCompanionOpenChange,
  selectedPetId,
  onSelectPet,
  catalog,
  loading,
  error,
  importingPetKey,
  onRefresh,
  onImportPet,
}: Props) {
  const { t } = useI18n();
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose, open]);

  if (!open || !portalTarget) return null;

  return createPortal(
    <div
      className="app-shell-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t("companion.settingsTitle")}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      style={{
        position: "fixed", inset: 0, zIndex: 1200,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.35)",
      }}
    >
      <div className={styles.dialog}>
        <header className={styles.header}>
          <div>
            <div className={styles.title}>{t("companion.settingsTitle")}</div>
            <div className={styles.subtitle}>{t("companion.settingsDescription")}</div>
          </div>
          <button className={styles.closeButton} type="button" onClick={onClose} title={t("i18n.close")} aria-label={t("i18n.close")}>
            <AliIcon name="close" size={14} />
          </button>
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
    </div>,
    portalTarget,
  );
}

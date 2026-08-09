"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useCompanionPets } from "@/hooks/useCompanionPets";
import { useCompanionPreferences } from "@/hooks/useCompanionPreferences";
import { useI18n } from "@/hooks/useI18n";
import type { CompanionActivity } from "@/lib/companion";
import { AliIcon } from "./AliIcon";
import { BuiltinPet, COMPANION_ACTIVITY_COLORS, SpritePet } from "./CompanionPet";
import styles from "./DesktopCompanionWindow.module.css";

const DEFAULT_ACTIVITY: CompanionActivity = { status: "idle", cause: "" };

export function DesktopCompanionWindow() {
  const { t } = useI18n();
  const { preferences } = useCompanionPreferences();
  const pets = useCompanionPets(true);
  const [activity, setActivity] = useState<CompanionActivity>(DEFAULT_ACTIVITY);
  const activePet = useMemo(
    () => pets.catalog?.installed.find((pet) => pet.id === preferences.selectedPetId) ?? null,
    [pets.catalog?.installed, preferences.selectedPetId],
  );

  useEffect(() => {
    document.documentElement.classList.add("desktop-pet-document");
    document.body.classList.add("desktop-pet-document");
    return () => {
      document.documentElement.classList.remove("desktop-pet-document");
      document.body.classList.remove("desktop-pet-document");
    };
  }, []);

  useEffect(() => {
    const channel = new BroadcastChannel("pi-companion-runtime-v1");
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (!event.data || typeof event.data !== "object") return;
      const message = event.data as { type?: unknown; activity?: unknown };
      if (message.type !== "activity" || !message.activity || typeof message.activity !== "object") return;
      const candidate = message.activity as CompanionActivity;
      if (["idle", "running", "waiting", "review", "failed"].includes(candidate.status)) {
        setActivity(candidate);
      }
    };
    channel.postMessage({ type: "ready" });
    return () => channel.close();
  }, []);

  const statusLabel = t(`companion.activity.${activity.status}`);
  const cause = activity.cause || t(`companion.activity.${activity.status}Cause`);
  const petLabel = activePet?.displayName ?? t("companion.builtinPet");

  return (
    <main className={styles.window} aria-label={t("companion.desktopMode")}>
      <div className={styles.dragSurface} title={`${petLabel} · ${statusLabel} · ${cause}`}>
        <div className={styles.pet} aria-label={petLabel}>
          {activePet ? <SpritePet pet={activePet} status={activity.status} /> : <BuiltinPet status={activity.status} />}
        </div>
        <span
          className={styles.statusDot}
          aria-label={`${statusLabel}: ${cause}`}
          style={{ "--pet-status": COMPANION_ACTIVITY_COLORS[activity.status] } as CSSProperties}
        />
      </div>
      <div className={styles.actions} aria-label={t("companion.desktopMode")}>
        <button type="button" title={t("companion.focusApp")} aria-label={t("companion.focusApp")} onClick={() => void window.piDesktop?.companionAction?.("focus-main")}>
          <AliIcon name="message" size={14} />
        </button>
        <button type="button" title={t("companion.openSettings")} aria-label={t("companion.openSettings")} onClick={() => void window.piDesktop?.companionAction?.("open-settings")}>
          <AliIcon name="setting" size={14} />
        </button>
        <button type="button" title={t("i18n.close")} aria-label={t("i18n.close")} onClick={() => void window.piDesktop?.companionAction?.("hide")}>
          <AliIcon name="close" size={13} />
        </button>
      </div>
    </main>
  );
}

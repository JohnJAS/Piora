/*
 * MODIFIED MIT ADAPTATION NOTICE
 *
 * The transient task bubble and reserved message-area behavior in this
 * component are adapted from OpenPets/OpenPetsKit concepts. The implementation
 * is rewritten for Piora's Electron/React companion window and Pi task state.
 * See third_party/openpets/SOURCE.md and LICENSE.
 */

"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useCompanionPets } from "@/hooks/useCompanionPets";
import { useCompanionPreferences } from "@/hooks/useCompanionPreferences";
import { useI18n } from "@/hooks/useI18n";
import type { CompanionActivity } from "@/lib/companion";
import { BuiltinPet, COMPANION_ACTIVITY_COLORS, SpritePet } from "./CompanionPet";
import styles from "./DesktopCompanionWindow.module.css";

const DEFAULT_ACTIVITY: CompanionActivity = { status: "idle", cause: "" };

export function DesktopCompanionWindow() {
  const { t } = useI18n();
  const { preferences } = useCompanionPreferences();
  const pets = useCompanionPets(true);
  const [activity, setActivity] = useState<CompanionActivity>(DEFAULT_ACTIVITY);
  const [bubbleVisible, setBubbleVisible] = useState(false);
  const bubbleTimerRef = useRef<number | null>(null);
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

  useEffect(() => {
    setBubbleVisible(true);
    if (bubbleTimerRef.current !== null) window.clearTimeout(bubbleTimerRef.current);
    bubbleTimerRef.current = null;

    // Active and actionable states remain visible. Idle is a short completion
    // acknowledgement, then disappears so only the transparent pet remains.
    if (activity.status === "idle") {
      bubbleTimerRef.current = window.setTimeout(() => {
        setBubbleVisible(false);
        bubbleTimerRef.current = null;
      }, 3_200);
    }

    return () => {
      if (bubbleTimerRef.current !== null) window.clearTimeout(bubbleTimerRef.current);
      bubbleTimerRef.current = null;
    };
  }, [activity.cause, activity.status]);

  const statusLabel = t(`companion.activity.${activity.status}`);
  const cause = activity.cause || t(`companion.activity.${activity.status}Cause`);
  const petLabel = activePet?.displayName ?? t("companion.builtinPet");

  return (
    <main className={styles.window} aria-label={t("companion.desktopMode")} data-testid="desktop-companion-window">
      <div
        className={styles.dragSurface}
        title={`${petLabel} · ${statusLabel} · ${cause} · ${t("companion.desktopInteractionHint")}`}
      >
        <div
          className={styles.activityBubble}
          data-testid="companion-activity-bubble"
          data-visible={bubbleVisible}
          data-status={activity.status}
          role="status"
          aria-live="polite"
          aria-hidden={!bubbleVisible}
        >
          <span className={styles.activityCopy}>
            <strong>{statusLabel}</strong>
            <span>{cause}</span>
          </span>
          <span
            className={styles.bubbleIndicator}
            aria-hidden="true"
            style={{ "--pet-status": COMPANION_ACTIVITY_COLORS[activity.status] } as CSSProperties}
          />
        </div>
        <div className={styles.pet} aria-label={petLabel} data-testid="companion-pet-viewport">
          {activePet ? <SpritePet pet={activePet} status={activity.status} /> : <BuiltinPet status={activity.status} />}
        </div>
        <span
          className={styles.statusDot}
          aria-label={`${statusLabel}: ${cause}`}
          style={{ "--pet-status": COMPANION_ACTIVITY_COLORS[activity.status] } as CSSProperties}
        />
      </div>
    </main>
  );
}

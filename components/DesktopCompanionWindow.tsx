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
import { useRunningTaskSnapshots } from "@/hooks/useTaskStatus";
import type { CompanionActivity } from "@/lib/companion";
import type { TaskRuntimeSnapshot } from "@/lib/task-status";
import { BuiltinPet, COMPANION_ACTIVITY_COLORS, SpritePet } from "./CompanionPet";
import styles from "./DesktopCompanionWindow.module.css";

const DEFAULT_ACTIVITY: CompanionActivity = { status: "idle", cause: "" };

function snapshotActivityStatus(snapshot: TaskRuntimeSnapshot): CompanionActivity["status"] {
  if (snapshot.lastPromptFailed) return "failed";
  if (snapshot.pendingApproval) return "review";
  if (snapshot.activity?.kind === "thinking") return "waiting";
  return snapshot.runtime === "idle" ? "idle" : "running";
}

export function DesktopCompanionWindow() {
  const { t } = useI18n();
  const { preferences } = useCompanionPreferences();
  const pets = useCompanionPets(true);
  const runningTasks = useRunningTaskSnapshots();
  const [activity, setActivity] = useState<CompanionActivity>(DEFAULT_ACTIVITY);
  const [bubblesCollapsed, setBubblesCollapsed] = useState(false);
  const previousBubbleCountRef = useRef(0);
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

  const taskBubbles = useMemo(() => runningTasks.map((snapshot) => {
    const status = snapshotActivityStatus(snapshot);
    return {
      id: snapshot.id,
      status,
      title: snapshot.title || snapshot.id.slice(0, 8),
      cause: snapshot.activity?.message
        || snapshot.errorSummary
        || t(`companion.activity.${status}Cause`),
    };
  }), [runningTasks, t]);
  const displayActivity = useMemo<CompanionActivity>(() => {
    if (taskBubbles.length === 0) return activity;
    const priority = ["failed", "review", "running", "waiting", "idle"] as const;
    const status = priority.find((candidate) => taskBubbles.some((item) => item.status === candidate)) ?? "running";
    const active = taskBubbles.find((item) => item.status === status) ?? taskBubbles[0];
    return { status, cause: active.cause };
  }, [activity, taskBubbles]);
  const statusLabel = t(`companion.activity.${displayActivity.status}`);
  const cause = displayActivity.cause || t(`companion.activity.${displayActivity.status}Cause`);
  const statusCause = t(`companion.activity.${displayActivity.status}Cause`);
  const petLabel = activePet?.displayName ?? t("companion.builtinPet");
  const bubbleItems = useMemo(() => {
    if (taskBubbles.length > 0) return taskBubbles;
    if (displayActivity.status === "idle") return [];
    return [{
      id: "companion-status",
      status: displayActivity.status,
      title: statusLabel,
      cause: statusCause,
    }];
  }, [displayActivity.status, statusCause, statusLabel, taskBubbles]);
  const runningTaskCount = taskBubbles.length || (displayActivity.status === "idle" ? 0 : 1);
  const bubblesExpanded = bubbleItems.length > 0 && !bubblesCollapsed;

  useEffect(() => {
    if (bubbleItems.length === 0 || previousBubbleCountRef.current === 0) {
      setBubblesCollapsed(false);
    }
    previousBubbleCountRef.current = bubbleItems.length;
  }, [bubbleItems.length]);

  useEffect(() => {
    void window.piDesktop?.setCompanionWindowExpanded?.(bubblesExpanded);
  }, [bubblesExpanded]);

  return (
    <main className={styles.window} aria-label={t("companion.desktopMode")} data-testid="desktop-companion-window">
      <div
        className={styles.dragSurface}
        title={`${petLabel} · ${statusLabel} · ${cause} · ${t("companion.desktopInteractionHint")}`}
      >
        <div className={styles.activityBubbles} aria-live="polite" data-has-active-tasks={taskBubbles.length > 0}>
          {bubblesExpanded && bubbleItems.map((item) => (
            <div
              key={item.id}
              className={styles.activityBubble}
              data-testid="companion-activity-bubble"
              data-visible="true"
              data-kind={item.id === "companion-status" ? "status" : "task"}
              data-status={item.status}
              role="status"
            >
              <span className={styles.activityCopy}>
                <strong>{item.title}</strong>
                <span>{item.cause}</span>
              </span>
              <span
                className={styles.bubbleIndicator}
                aria-hidden="true"
                style={{ "--pet-status": COMPANION_ACTIVITY_COLORS[item.status] } as CSSProperties}
              />
            </div>
          ))}
        </div>
        <div className={styles.pet} aria-label={petLabel} data-testid="companion-pet-viewport">
          {activePet ? <SpritePet pet={activePet} status={displayActivity.status} /> : <BuiltinPet status={displayActivity.status} />}
        </div>
        {bubbleItems.length > 0 ? (
          <button
            className={styles.bubbleToggle}
            type="button"
            onClick={() => setBubblesCollapsed(bubblesExpanded)}
            title={t(bubblesExpanded ? "i18n.collapse" : "i18n.expand")}
            aria-label={`${t(bubblesExpanded ? "i18n.collapse" : "i18n.expand")} · ${runningTaskCount}`}
            aria-expanded={bubblesExpanded}
          >
            {bubblesExpanded ? <span className={styles.chevron} aria-hidden="true" /> : runningTaskCount}
          </button>
        ) : null}
      </div>
    </main>
  );
}

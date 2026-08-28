/*
 * MODIFIED MIT ADAPTATION NOTICE
 *
 * The transient task bubble and reserved message-area behavior in this
 * component are adapted from OpenPets/OpenPetsKit concepts. The implementation
 * is rewritten for Piora's Electron/React companion window and Pi task state.
 * See third_party/openpets/SOURCE.md and LICENSE.
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useCompanionPets } from "@/hooks/useCompanionPets";
import { useCompanionPreferences } from "@/hooks/useCompanionPreferences";
import { useI18n } from "@/hooks/useI18n";
import { useRunningTaskSnapshots } from "@/hooks/useTaskStatus";
import type { CompanionActivity, CompanionActivityEvent } from "@/lib/companion";
import {
  applyCompanionCareAction,
  getCompanionCareLevels,
  listCompanionCareNeeds,
  pickCompanionSpeechLine,
  COMPANION_CARE_NEED_THRESHOLD,
  type CompanionInteractionKind,
  type CompanionSpeechCategory,
} from "@/lib/companion-behavior";
import type { TaskRuntimeSnapshot } from "@/lib/task-status";
import { BuiltinPet, COMPANION_ACTIVITY_COLORS, SpritePet } from "./CompanionPet";
import styles from "./DesktopCompanionWindow.module.css";

const DEFAULT_ACTIVITY: CompanionActivity = { status: "idle", cause: "" };
const SPEECH_VISIBLE_MS = 6_000;
const CARE_TICK_MS = 30_000;

function snapshotActivityStatus(snapshot: TaskRuntimeSnapshot): CompanionActivity["status"] {
  if (snapshot.lastPromptFailed) return "failed";
  if (snapshot.pendingApproval) return "review";
  if (snapshot.activity?.kind === "thinking") return "waiting";
  return snapshot.runtime === "idle" ? "idle" : "running";
}

export function DesktopCompanionWindow() {
  const { t, locale } = useI18n();
  const { preferences, setPreferences } = useCompanionPreferences();
  const pets = useCompanionPets(true);
  const runningTasks = useRunningTaskSnapshots();
  const [activity, setActivity] = useState<CompanionActivity>(DEFAULT_ACTIVITY);
  const [runtimeEvent, setRuntimeEvent] = useState<CompanionActivity["event"]>();
  const [bubblesCollapsed, setBubblesCollapsed] = useState(false);
  const previousBubbleCountRef = useRef(0);
  const previousTasksRef = useRef(new Map<string, TaskRuntimeSnapshot>());
  const runtimeEventSequenceRef = useRef(0);
  const activePet = useMemo(
    () => pets.catalog?.installed.find((pet) => pet.id === preferences.selectedPetId) ?? null,
    [pets.catalog?.installed, preferences.selectedPetId],
  );

  // --- Pet interaction state: one-shot reactions and speech bubbles. ---
  const [overlayEvent, setOverlayEvent] = useState<CompanionActivityEvent | null>(null);
  const overlaySequenceRef = useRef(0);
  const [speech, setSpeech] = useState<{ key: number; text: string } | null>(null);
  const speechSequenceRef = useRef(0);
  const speechTimerRef = useRef<number | null>(null);
  const lastSpeechTextRef = useRef<string | null>(null);
  const [careNow, setCareNow] = useState(() => Date.now());

  useEffect(() => () => {
    if (speechTimerRef.current !== null) window.clearTimeout(speechTimerRef.current);
  }, []);

  const say = useCallback((text: string) => {
    if (!text) return;
    speechSequenceRef.current += 1;
    setSpeech({ key: speechSequenceRef.current, text });
  }, []);

  useEffect(() => {
    if (!speech) return;
    if (speechTimerRef.current !== null) window.clearTimeout(speechTimerRef.current);
    speechTimerRef.current = window.setTimeout(() => setSpeech(null), SPEECH_VISIBLE_MS);
  }, [speech]);

  const react = useCallback((kind: CompanionInteractionKind, lineCategory: CompanionSpeechCategory) => {
    overlaySequenceRef.current += 1;
    setOverlayEvent({ kind, key: `${kind}:${overlaySequenceRef.current}`, occurredAt: Date.now() });
    const line = pickCompanionSpeechLine(lineCategory, locale, lastSpeechTextRef.current);
    lastSpeechTextRef.current = line;
    say(line);
  }, [locale, say]);

  // --- Care loop: needs decay over real time and are restored by the buttons. ---
  useEffect(() => {
    const timer = window.setInterval(() => setCareNow(Date.now()), CARE_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const careLevels = useMemo(
    () => getCompanionCareLevels(preferences.care, careNow),
    [careNow, preferences.care],
  );
  const careNeeds = useMemo(() => listCompanionCareNeeds(careLevels), [careLevels]);
  const careNeedsKey = careNeeds.join(",");

  const handleCare = useCallback((kind: Exclude<CompanionInteractionKind, "poke">) => {
    setPreferences((current) => ({
      ...current,
      care: applyCompanionCareAction(current.care, kind, Date.now()),
    }));
    setCareNow(Date.now());
    react(kind, kind);
  }, [react, setPreferences]);

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
      startedAt: snapshot.startedAt ?? 0,
      cause: snapshot.activity?.message
        || snapshot.errorSummary
        || t(`companion.activity.${status}Cause`),
    };
  }), [runningTasks, t]);

  useEffect(() => {
    const previous = previousTasksRef.current;
    const current = new Map(runningTasks.map((snapshot) => [snapshot.id, snapshot]));
    const failed = runningTasks.find((snapshot) => (
      snapshot.lastPromptFailed && !previous.get(snapshot.id)?.lastPromptFailed
    ));
    const completed = [...previous.values()].find((snapshot) => (
      snapshot.runtime !== "idle" && !current.has(snapshot.id)
    ));
    const started = runningTasks.find((snapshot) => (
      snapshot.runtime !== "idle" && !previous.has(snapshot.id)
    ));
    const kind = failed ? "failed" : completed ? "completed" : started ? "started" : null;
    const subject = failed ?? completed ?? started;

    previousTasksRef.current = current;
    if (!kind || !subject) return;
    runtimeEventSequenceRef.current += 1;
    const occurredAt = Date.now();
    setRuntimeEvent({
      kind,
      occurredAt,
      key: `${subject.id}:${runtimeEventSequenceRef.current}:${kind}:${occurredAt}`,
    });
  }, [runningTasks]);

  // Task milestones get a spoken line once per runtime event.
  const runtimeEventKey = runtimeEvent?.key;
  const runtimeEventKind = runtimeEvent?.kind;
  useEffect(() => {
    if (!runtimeEventKey || !runtimeEventKind) return;
    if (runtimeEventKind !== "started" && runtimeEventKind !== "completed" && runtimeEventKind !== "failed") return;
    const line = pickCompanionSpeechLine(runtimeEventKind, locale, lastSpeechTextRef.current);
    lastSpeechTextRef.current = line;
    say(line);
    // Only the event identity may retrigger the line, not a locale switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtimeEventKey]);

  const displayActivity = useMemo<CompanionActivity>(() => {
    const event = (activity.event?.occurredAt ?? 0) >= (runtimeEvent?.occurredAt ?? 0)
      ? activity.event
      : runtimeEvent;
    if (taskBubbles.length === 0) return { ...activity, ...(event ? { event } : {}) };

    const active = taskBubbles.find((item) => item.status === "review")
      ?? taskBubbles.find((item) => item.status === "failed")
      ?? taskBubbles.find((item) => item.id === activity.sessionId)
      ?? [...taskBubbles].sort((left, right) => right.startedAt - left.startedAt)[0];
    return {
      status: active?.status ?? "running",
      cause: active?.cause ?? t("companion.activity.runningCause"),
      ...(active ? { sessionId: active.id } : {}),
      ...(event ? { event } : {}),
    };
  }, [activity, runtimeEvent, taskBubbles, t]);
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
  const bubblesExpanded = (bubbleItems.length > 0 || Boolean(speech)) && !bubblesCollapsed;

  // Ambient chatter: care needs first, then waiting/review reminders, then
  // idle small talk. Speaking reschedules the next line. Needs are read
  // through a ref so the 30s level refresh cannot reset the pending timer.
  const idleTricksEnabled = preferences.idleTricks !== false;
  const careNeedsRef = useRef(careNeeds);
  useEffect(() => {
    careNeedsRef.current = careNeeds;
  }, [careNeeds]);
  useEffect(() => {
    if (!idleTricksEnabled) return;
    const status = displayActivity.status;
    let category: CompanionSpeechCategory | null = null;
    let delay = 60_000;
    const need = careNeedsRef.current[0];
    if (need) {
      category = need === "hunger" ? "hungry" : need === "thirst" ? "thirsty" : "lonely";
      delay = 45_000;
    } else if (status === "waiting" || status === "review") {
      category = status;
      delay = 90_000;
    } else if (status === "idle" && taskBubbles.length === 0) {
      category = "idle";
      delay = 55_000 + Math.random() * 30_000;
    }
    if (!category) return;
    const timer = window.setTimeout(() => {
      const line = pickCompanionSpeechLine(category as CompanionSpeechCategory, locale, lastSpeechTextRef.current);
      lastSpeechTextRef.current = line;
      say(line);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [careNeedsKey, displayActivity.status, idleTricksEnabled, locale, say, speech?.key, taskBubbles.length]);

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
          {bubblesExpanded && speech ? (
            <div
              key={`speech:${speech.key}`}
              className={styles.activityBubble}
              data-testid="companion-speech-bubble"
              data-visible="true"
              data-kind="speech"
              role="status"
            >
              <span className={styles.activityCopy}>
                <strong>{petLabel}</strong>
                <span>{speech.text}</span>
              </span>
            </div>
          ) : null}
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
        <button
          className={styles.pet}
          type="button"
          data-testid="companion-pet-viewport"
          aria-label={`${petLabel} · ${t("companion.pokeHint")}`}
          title={t("companion.pokeHint")}
          onClick={() => react("poke", "poke")}
        >
          {activePet
            ? <SpritePet
                pet={activePet}
                status={displayActivity.status}
                event={displayActivity.event}
                overlayEvent={overlayEvent ?? undefined}
                idleTricks={idleTricksEnabled}
              />
            : <BuiltinPet status={displayActivity.status} />}
        </button>
        {bubblesExpanded ? (
          <div className={styles.careBar} role="group" aria-label={t("companion.care.title")} data-testid="companion-care-bar">
            {([["feed", "🍖", "hunger"], ["water", "💧", "thirst"], ["pet", "🤚", "affection"]] as const).map(([kind, glyph, needKey]) => {
              const level = careLevels[needKey];
              const label = t(`companion.care.${kind}`);
              const hint = t(`companion.care.${needKey}Hint`, { level });
              return (
                <button
                  key={kind}
                  type="button"
                  className={styles.careButton}
                  data-need={level <= COMPANION_CARE_NEED_THRESHOLD ? "true" : undefined}
                  title={`${label} · ${hint}`}
                  aria-label={`${label} · ${hint}`}
                  onClick={() => handleCare(kind)}
                >
                  <span aria-hidden="true">{glyph}</span>
                </button>
              );
            })}
          </div>
        ) : null}
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

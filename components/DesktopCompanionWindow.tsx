/*
 * MODIFIED MIT ADAPTATION NOTICE
 *
 * The transient task bubble and reserved message-area behavior in this
 * component are adapted from OpenPets/OpenPetsKit concepts. The implementation
 * is rewritten for Piora's Electron/React companion window and Pi task state.
 * See third_party/openpets/SOURCE.md and LICENSE.
 */

"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useCompanionPets } from "@/hooks/useCompanionPets";
import { useCompanionPreferences } from "@/hooks/useCompanionPreferences";
import { useI18n } from "@/hooks/useI18n";
import { useRunningTaskSnapshots } from "@/hooks/useTaskStatus";
import type { CompanionActivity, CompanionActivityEvent } from "@/lib/companion";
import {
  deriveCompanionTaskPresentation,
  getCompanionWanderDelay,
  pickCompanionSpeechLine,
  type CompanionInteractionKind,
  type CompanionSpeechCategory,
} from "@/lib/companion-behavior";
import type { TaskRuntimeSnapshot } from "@/lib/task-status";
import { BuiltinPet, COMPANION_ACTIVITY_COLORS, SpritePet } from "./CompanionPet";
import styles from "./DesktopCompanionWindow.module.css";

const DEFAULT_ACTIVITY: CompanionActivity = { status: "idle", cause: "" };
const SPEECH_VISIBLE_MS = 6_000;
const PET_DRAG_THRESHOLD_PX = 5;

const AGENT_ACTIVITY_LABELS = {
  idle: "companion.agent.idle",
  failed: "companion.agent.failed",
  review: "companion.agent.review",
  prompt: "companion.agent.prompt",
  thinking: "companion.agent.thinking",
  assistant: "companion.agent.responding",
  tool: "companion.agent.tool",
  command: "companion.agent.command",
  compacting: "companion.agent.compacting",
  approval: "companion.agent.review",
  retry: "companion.agent.retry",
} as const;

export function DesktopCompanionWindow() {
  const { t, locale } = useI18n();
  const { preferences } = useCompanionPreferences();
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
  const [motionDirection, setMotionDirection] = useState<"left" | "right" | null>(null);
  const pointerDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);

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

  useEffect(() => {
    document.documentElement.classList.add("desktop-pet-document");
    document.body.classList.add("desktop-pet-document");
    return () => {
      document.documentElement.classList.remove("desktop-pet-document");
      document.body.classList.remove("desktop-pet-document");
    };
  }, []);

  useEffect(() => window.piDesktop?.onCompanionMotion?.((state) => {
    setMotionDirection(state.moving ? state.direction : null);
  }), []);

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
    const presentation = deriveCompanionTaskPresentation(snapshot);
    const status = presentation.status;
    return {
      id: snapshot.id,
      status,
      title: snapshot.title || snapshot.id.slice(0, 8),
      startedAt: snapshot.startedAt ?? 0,
      activityLabel: t(AGENT_ACTIVITY_LABELS[presentation.activityKind]),
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
      activityLabel: statusLabel,
      cause: statusCause,
    }];
  }, [displayActivity.status, statusCause, statusLabel, taskBubbles]);
  const runningTaskCount = taskBubbles.length || (displayActivity.status === "idle" ? 0 : 1);
  const bubblesExpanded = (bubbleItems.length > 0 || Boolean(speech)) && !bubblesCollapsed;

  // Ambient chatter reflects agent attention states, then falls back to
  // occasional idle small talk. Speaking reschedules the next line.
  const idleTricksEnabled = preferences.idleTricks !== false;
  useEffect(() => {
    if (!idleTricksEnabled) return;
    const status = displayActivity.status;
    let category: CompanionSpeechCategory | null = null;
    let delay = 60_000;
    if (status === "waiting" || status === "review") {
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
  }, [displayActivity.status, idleTricksEnabled, locale, say, speech?.key, taskBubbles.length]);

  useEffect(() => {
    if (bubbleItems.length === 0 || previousBubbleCountRef.current === 0) {
      setBubblesCollapsed(false);
    }
    previousBubbleCountRef.current = bubbleItems.length;
  }, [bubbleItems.length]);

  useEffect(() => {
    void window.piDesktop?.setCompanionWindowExpanded?.(bubblesExpanded);
  }, [bubblesExpanded]);

  useEffect(() => {
    const bridge = window.piDesktop?.moveCompanionWindow;
    if (!bridge || !idleTricksEnabled || displayActivity.status !== "idle" || speech || motionDirection) return;
    const timer = window.setTimeout(() => {
      void bridge({
        kind: "walk",
        distance: 90 + Math.round(Math.random() * 150),
        durationMs: 1_900 + Math.round(Math.random() * 1_500),
      });
    }, getCompanionWanderDelay());
    return () => window.clearTimeout(timer);
  }, [displayActivity.status, idleTricksEnabled, motionDirection, speech]);

  useEffect(() => {
    const bridge = window.piDesktop?.moveCompanionWindow;
    if (!bridge || !runtimeEventKey) return;
    if (runtimeEventKind === "started" || runtimeEventKind === "completed") {
      void bridge({
        kind: "walk",
        distance: runtimeEventKind === "started" ? 72 : 110,
        durationMs: runtimeEventKind === "started" ? 1_250 : 1_650,
      });
    } else if (runtimeEventKind === "failed") {
      void bridge({ kind: "stop" });
    }
  }, [runtimeEventKey, runtimeEventKind]);

  useEffect(() => {
    if (displayActivity.status === "review" || displayActivity.status === "failed") {
      void window.piDesktop?.moveCompanionWindow?.({ kind: "stop" });
    }
  }, [displayActivity.status]);

  const endPointerDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>, cancelled: boolean) => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    pointerDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    void window.piDesktop?.moveCompanionWindow?.({ kind: "drag-end" });
    if (!cancelled && !drag.moved) react("poke", "poke");
  }, [react]);

  const handlePetPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    pointerDragRef.current = {
      pointerId: event.pointerId,
      startX: event.screenX,
      startY: event.screenY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    void window.piDesktop?.moveCompanionWindow?.({
      kind: "drag-start",
      screenX: event.screenX,
      screenY: event.screenY,
    });
  }, []);

  const handlePetPointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.screenX - drag.startX, event.screenY - drag.startY);
    if (!drag.moved && distance < PET_DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    void window.piDesktop?.moveCompanionWindow?.({
      kind: "drag-move",
      screenX: event.screenX,
      screenY: event.screenY,
    });
  }, []);

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
                <span className={styles.activityHeading}>
                  <strong>{item.title}</strong>
                  <small>{item.activityLabel}</small>
                </span>
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
        <div className={styles.petStage} data-moving={motionDirection ?? undefined}>
          <button
            className={styles.pet}
            type="button"
            data-testid="companion-pet-viewport"
            aria-label={`${petLabel} · ${t("companion.pokeHint")}`}
            title={t("companion.desktopInteractionHint")}
            onPointerDown={handlePetPointerDown}
            onPointerMove={handlePetPointerMove}
            onPointerUp={(event) => endPointerDrag(event, false)}
            onPointerCancel={(event) => endPointerDrag(event, true)}
          >
            {activePet
              ? <SpritePet
                  pet={activePet}
                  status={displayActivity.status}
                  event={displayActivity.event}
                  overlayEvent={overlayEvent ?? undefined}
                  idleTricks={idleTricksEnabled}
                  motionDirection={motionDirection}
                />
              : <BuiltinPet status={motionDirection ? "running" : displayActivity.status} />}
          </button>
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

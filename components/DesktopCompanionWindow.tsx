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
} from "@/lib/companion-behavior";
import {
  buildCompanionInteractionContext,
  createCompanionWorkRhythm,
  getTaskProgress,
  type CompanionSessionContext,
  type CompanionWorkRhythm,
} from "@/lib/companion-interaction";
import type { CompanionAutonomyLevel, CompanionRuntimeState } from "@/lib/companion-runtime";
import { planCompanionWander } from "@/lib/companion-wander";
import type { TaskRuntimeSnapshot } from "@/lib/task-status";
import { BuiltinPet, COMPANION_ACTIVITY_COLORS, SpritePet } from "./CompanionPet";
import styles from "./DesktopCompanionWindow.module.css";

const DEFAULT_ACTIVITY: CompanionActivity = { status: "idle", cause: "" };
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
  const { preferences, hydrated: preferencesHydrated } = useCompanionPreferences();
  const pets = useCompanionPets(true);
  const runningTasks = useRunningTaskSnapshots();
  const [activity, setActivity] = useState<CompanionActivity>(DEFAULT_ACTIVITY);
  const [runtimeEvent, setRuntimeEvent] = useState<CompanionActivity["event"]>();
  const [sessionContext, setSessionContext] = useState<CompanionSessionContext | null>(null);
  const [workRhythm, setWorkRhythm] = useState<CompanionWorkRhythm>(() => createCompanionWorkRhythm());
  const [bubblesCollapsed, setBubblesCollapsed] = useState(false);
  const previousBubbleCountRef = useRef(0);
  const previousTasksRef = useRef(new Map<string, TaskRuntimeSnapshot>());
  const runtimeEventSequenceRef = useRef(0);
  const activePet = useMemo(
    () => pets.catalog?.installed.find((pet) => pet.id === preferences.selectedPetId) ?? null,
    [pets.catalog?.installed, preferences.selectedPetId],
  );

  // --- Pet interaction state: one-shot model-driven reactions. ---
  const [overlayEvent, setOverlayEvent] = useState<CompanionActivityEvent | null>(null);
  const overlaySequenceRef = useRef(0);
  const speechRequestRef = useRef(0);
  const clickTimerRef = useRef<number | null>(null);
  const startupDecisionRef = useRef(false);
  const [motionDirection, setMotionDirection] = useState<"left" | "right" | null>(null);
  const [nextWakeAt, setNextWakeAt] = useState<number | null>(null);
  const [focusTimerEndsAt, setFocusTimerEndsAt] = useState<number | null>(null);
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [movementSettings, setMovementSettings] = useState<{
    allowMovement: boolean;
    autonomyPaused: boolean;
    autonomyLevel: CompanionAutonomyLevel;
  }>({ allowMovement: true, autonomyPaused: false, autonomyLevel: "balanced" });
  const movementAllowedRef = useRef(true);
  const lastTimerCompletionRequestRef = useRef<number | null>(null);
  const lastDecisionIdRef = useRef<string | null>(null);
  const pointerDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);

  useEffect(() => () => {
    if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current);
  }, []);

  const react = useCallback(async (kind: string) => {
    overlaySequenceRef.current += 1;
    setOverlayEvent({ kind: "poke", key: `${kind}:${overlaySequenceRef.current}`, occurredAt: Date.now() });
    speechRequestRef.current += 1;
    const requestId = speechRequestRef.current;
    try {
      const context = buildCompanionInteractionContext({
        rhythm: workRhythm,
        session: sessionContext,
        runningTasks,
        personalTasks: preferences.todos,
        includeWorkContext: preferences.shareWorkContext,
      });
      const response = await fetch("/api/companion/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: kind === "double-click" ? "pet.double-click" : kind === "poke" ? "pet.click" : kind, cwd: sessionContext?.cwd, locale, context }),
      });
      const payload = await response.json().catch(() => null) as { decision?: { speech?: string; actions?: Array<{ kind?: string; direction?: "left" | "right"; distance?: number }> }; error?: string } | null;
      if (!response.ok || !payload?.decision) throw new Error(payload?.error || `HTTP ${response.status}`);
      if (requestId !== speechRequestRef.current) return;
      for (const action of payload.decision.actions ?? []) {
        if (action.kind === "walk" && movementAllowedRef.current) {
          const wander = planCompanionWander({
            autonomyLevel: movementSettings.autonomyLevel,
            hasRunningTasks: runningTasks.length > 0,
          });
          void window.piDesktop?.moveCompanionWindow?.({
            kind: "walk",
            direction: action.direction ?? wander.direction,
            distance: action.distance ?? wander.distance,
            durationMs: wander.durationMs,
          });
        }
        if (action.kind === "open-panel") void window.piDesktop?.companionAction?.("open-panel");
      }
    } catch {
      // The pet keeps its current animation when the model is unavailable; the
      // independent bubble surface must never be replaced by stale canned text.
    }
  }, [locale, movementSettings.autonomyLevel, preferences.shareWorkContext, preferences.todos, runningTasks, sessionContext, workRhythm]);

  useEffect(() => {
    let source: EventSource | null = null;
    const applyState = (runtime: CompanionRuntimeState | null) => {
      setNextWakeAt(typeof runtime?.mind?.nextWakeAt === "number" ? runtime.mind.nextWakeAt : null);
      if (runtime?.settings) {
        const nextMovementSettings = {
          allowMovement: runtime.settings.allowMovement,
          autonomyPaused: runtime.settings.autonomyPaused,
          autonomyLevel: runtime.settings.autonomyLevel,
        };
        movementAllowedRef.current = nextMovementSettings.allowMovement;
        setMovementSettings((current) => (
          current.allowMovement === nextMovementSettings.allowMovement
          && current.autonomyPaused === nextMovementSettings.autonomyPaused
          && current.autonomyLevel === nextMovementSettings.autonomyLevel
            ? current
            : nextMovementSettings
        ));
      }
      const timer = runtime?.focusTimer;
      setFocusTimerEndsAt(timer?.status === "running" && typeof timer.endsAt === "number" ? timer.endsAt : null);
      const decision = runtime?.mind?.lastDecision;
      if (!decision || decision.id === lastDecisionIdRef.current) return;
      lastDecisionIdRef.current = decision.id;
      if (!decision.event.startsWith("timer.") || Date.now() - decision.createdAt > 30_000) return;
      overlaySequenceRef.current += 1;
      setOverlayEvent({ kind: "poke", key: `timer:${overlaySequenceRef.current}`, occurredAt: decision.createdAt });
    };
    void fetch("/api/companion/state", { cache: "no-store" }).then((response) => response.ok ? response.json() as Promise<CompanionRuntimeState> : null).then(applyState).catch(() => undefined);
    source = new EventSource("/api/companion/events");
    source.addEventListener("companion", (event) => {
      try { applyState((JSON.parse((event as MessageEvent<string>).data) as { state?: CompanionRuntimeState }).state ?? null); }
      catch { /* ignore malformed event */ }
    });
    return () => source?.close();
  }, []);

  useEffect(() => {
    if (!runtimeReady || focusTimerEndsAt === null) return;
    let timeoutId: number | null = null;
    let cancelled = false;
    const requestCompletion = async () => {
      if (cancelled || lastTimerCompletionRequestRef.current === focusTimerEndsAt) return;
      lastTimerCompletionRequestRef.current = focusTimerEndsAt;
      try {
        const response = await fetch("/api/companion/focus-timer/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      } catch {
        if (cancelled) return;
        lastTimerCompletionRequestRef.current = null;
        timeoutId = window.setTimeout(() => void requestCompletion(), 2_000);
      }
    };
    timeoutId = window.setTimeout(
      () => void requestCompletion(),
      Math.max(0, Math.min(2_147_000_000, focusTimerEndsAt - Date.now())),
    );
    return () => {
      cancelled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [focusTimerEndsAt, runtimeReady]);

  useEffect(() => {
    if (!runtimeReady || !nextWakeAt) return;
    const delay = Math.max(1_000, Math.min(2_147_000_000, nextWakeAt - Date.now()));
    const timer = window.setTimeout(() => void react("scheduler.wake"), delay);
    return () => window.clearTimeout(timer);
  }, [nextWakeAt, react, runtimeReady]);

  useEffect(() => {
    if (!runtimeReady || startupDecisionRef.current) return;
    startupDecisionRef.current = true;
    void react("scheduler.startup");
  }, [react, runtimeReady]);

  useEffect(() => {
    if (!preferencesHydrated) return;
    const controller = new AbortController();
    void fetch("/api/companion/state", { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((runtime: { migratedFromLocalStorage?: boolean } | null) => {
        if (!runtime) return;
        if (runtime.migratedFromLocalStorage) {
          setRuntimeReady(true);
          return;
        }
        return fetch("/api/companion/state", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ legacyPreferences: preferences }),
          signal: controller.signal,
        }).then((response) => { if (response.ok) setRuntimeReady(true); });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [preferences, preferencesHydrated]);

  useEffect(() => {
    document.documentElement.classList.add("desktop-pet-document");
    document.body.classList.add("desktop-pet-document");
    return () => {
      document.documentElement.classList.remove("desktop-pet-document");
      document.body.classList.remove("desktop-pet-document");
    };
  }, []);

  useEffect(() => {
    let interactive = false;
    const update = (event: MouseEvent) => {
      const next = Boolean((event.target as Element | null)?.closest?.("[data-testid='companion-pet-viewport'], [data-testid='companion-bubble-toggle']"));
      if (next === interactive) return;
      interactive = next;
      void window.piDesktop?.setCompanionHitTest?.(next);
    };
    const leave = () => { interactive = false; void window.piDesktop?.setCompanionHitTest?.(false); };
    window.addEventListener("mousemove", update, { passive: true });
    window.addEventListener("mouseleave", leave);
    return () => {
      window.removeEventListener("mousemove", update);
      window.removeEventListener("mouseleave", leave);
      void window.piDesktop?.setCompanionHitTest?.(false);
    };
  }, []);

  useEffect(() => window.piDesktop?.onCompanionMotion?.((state) => {
    setMotionDirection(state.moving ? state.direction : null);
  }), []);

  useEffect(() => {
    const channel = new BroadcastChannel("pi-companion-runtime-v1");
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (!event.data || typeof event.data !== "object") return;
      const message = event.data as { type?: unknown; activity?: unknown; session?: unknown; rhythm?: unknown };
      if ((message.type !== "activity" && message.type !== "context") || !message.activity || typeof message.activity !== "object") return;
      const candidate = message.activity as CompanionActivity;
      if (["idle", "running", "waiting", "review", "failed"].includes(candidate.status)) setActivity(candidate);
      if (message.type === "context" && message.session && typeof message.session === "object") setSessionContext(message.session as CompanionSessionContext);
      if (message.type === "context" && message.rhythm && typeof message.rhythm === "object") setWorkRhythm(message.rhythm as CompanionWorkRhythm);
    };
    channel.postMessage({ type: "ready" });
    return () => channel.close();
  }, []);

  const taskBubbles = useMemo(() => runningTasks.map((snapshot) => {
    const presentation = deriveCompanionTaskPresentation(snapshot);
    const status = presentation.status;
    const progress = getTaskProgress(snapshot);
    return {
      id: snapshot.id,
      status,
      title: snapshot.title || snapshot.id.slice(0, 8),
      startedAt: snapshot.startedAt ?? 0,
      activityLabel: progress.label
        ? `${t(AGENT_ACTIVITY_LABELS[presentation.activityKind])} · ${progress.label}`
        : t(AGENT_ACTIVITY_LABELS[presentation.activityKind]),
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
    if (runtimeReady) void react(`task.${kind}`);
  }, [react, runningTasks, runtimeReady]);

  const runtimeEventKey = runtimeEvent?.key;
  const runtimeEventKind = runtimeEvent?.kind;

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
  const personalTaskBubbles = useMemo(() => preferences.todos
    .filter((task) => !task.completed)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, 4)
    .map((task) => ({
      id: `personal:${task.id}`,
      status: "idle" as const,
      title: task.text,
      activityLabel: t("companion.personalTaskProgress", { progress: task.progress }),
      cause: task.project || t("companion.personalTaskCause"),
    })), [preferences.todos, t]);
  const bubbleItems = useMemo(() => {
    if (taskBubbles.length > 0) return taskBubbles;
    if (personalTaskBubbles.length > 0) return personalTaskBubbles;
    if (displayActivity.status === "idle") return [];
    return [{
      id: "companion-status",
      status: displayActivity.status,
      title: statusLabel,
      activityLabel: statusLabel,
      cause: statusCause,
    }];
  }, [displayActivity.status, personalTaskBubbles, statusCause, statusLabel, taskBubbles]);
  const runningTaskCount = bubbleItems.length;
  const bubblesExpanded = bubbleItems.length > 0 && !bubblesCollapsed;

  const idleTricksEnabled = preferences.idleTricks !== false;

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
    if (!bridge || !runtimeEventKey) return;
    if (!movementSettings.allowMovement) {
      void bridge({ kind: "stop" });
      return;
    }
    if (runtimeEventKind === "started" || runtimeEventKind === "completed") {
      const wander = planCompanionWander({
        autonomyLevel: movementSettings.autonomyLevel,
        hasRunningTasks: runtimeEventKind === "started",
      });
      void bridge({
        kind: "walk",
        direction: wander.direction,
        distance: runtimeEventKind === "started" ? Math.min(90, wander.distance) : Math.max(80, wander.distance),
        durationMs: wander.durationMs,
      });
    } else if (runtimeEventKind === "failed") {
      void bridge({ kind: "stop" });
    }
  }, [movementSettings.allowMovement, movementSettings.autonomyLevel, runtimeEventKey, runtimeEventKind]);

  useEffect(() => {
    const bridge = window.piDesktop?.moveCompanionWindow;
    if (!bridge) return;
    const movementBlocked = !runtimeReady
      || !movementSettings.allowMovement
      || movementSettings.autonomyPaused
      || displayActivity.status === "review"
      || displayActivity.status === "failed"
      || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (movementBlocked) {
      void bridge({ kind: "stop" });
      return;
    }

    let cancelled = false;
    let timer: number | null = null;
    const schedule = () => {
      const wander = planCompanionWander({
        autonomyLevel: movementSettings.autonomyLevel,
        hasRunningTasks: runningTasks.length > 0,
      });
      timer = window.setTimeout(() => {
        if (cancelled) return;
        if (wander.shouldMove && pointerDragRef.current === null) {
          void bridge({
            kind: "walk",
            direction: wander.direction,
            distance: wander.distance,
            durationMs: wander.durationMs,
          });
        }
        schedule();
      }, wander.delayMs);
    };
    schedule();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [
    displayActivity.status,
    movementSettings.allowMovement,
    movementSettings.autonomyLevel,
    movementSettings.autonomyPaused,
    runningTasks.length,
    runtimeReady,
  ]);

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
    if (!cancelled && !drag.moved) {
      if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = window.setTimeout(() => {
        clickTimerRef.current = null;
        void react("poke");
      }, 220);
    }
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
          {bubblesExpanded && bubbleItems.map((item) => (
            <div
              key={item.id}
              className={styles.activityBubble}
              data-testid="companion-activity-bubble"
              data-visible="true"
              data-kind={item.id === "companion-status" ? "status" : item.id.startsWith("personal:") ? "personal" : "task"}
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
            onDoubleClick={() => {
              if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current);
              clickTimerRef.current = null;
              void window.piDesktop?.companionAction?.("open-panel");
              void react("double-click");
            }}
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

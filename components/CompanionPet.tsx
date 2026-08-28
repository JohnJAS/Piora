"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { CompanionPet as CompanionPetMetadata } from "@/lib/companion-pets";
import {
  advanceCompanionAnimation,
  getCompanionAnimationFrameIndices,
  getCompanionAtlasFramePosition,
  prepareCompanionPersistentAnimation,
  prepareCompanionTransientAnimation,
  selectCompanionSpriteState,
  selectCompanionTransientSpriteState,
  type CompanionActivity,
  type CompanionActivityEvent,
} from "@/lib/companion";
import {
  isCompanionInteractionKind,
  pickCompanionIdleTrickStateId,
  pickCompanionInteractionStateId,
  pickCompanionSpeechLine,
} from "@/lib/companion-behavior";
import { MAX_COMPANION_PHRASES, MAX_COMPANION_TODOS, createCompanionId, type CompanionPreferences } from "@/lib/companion-store";
import { STATUS_PRESENTATION, type TaskStatusPresentationKey } from "@/lib/task-status";
import styles from "./CompanionPet.module.css";
import { AliIcon } from "./AliIcon";

type CompanionTab = "todos" | "phrases";

type RenderableAnimationState = {
  id: string;
  frameIndices?: readonly number[];
  durationsMs?: readonly number[];
  loopStart?: number | null;
  fallback?: string;
  frames?: number;
  row?: number | null;
};

type RenderablePet = Omit<CompanionPetMetadata, "states"> & {
  frame?: { width: number; height: number; columns: number; rows: number };
  states: RenderableAnimationState[];
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activity: CompanionActivity;
  canSendPhrase: boolean;
  onSendPhrase: (text: string) => boolean;
  preferences: CompanionPreferences;
  setPreferences: Dispatch<SetStateAction<CompanionPreferences>>;
  activePet: CompanionPetMetadata | null;
}

const COMPANION_STATUS_KEYS: Record<CompanionActivity["status"], TaskStatusPresentationKey> = {
  idle: "unread",
  running: "running",
  waiting: "needs_input",
  review: "needs_approval",
  failed: "failed",
};

export const COMPANION_ACTIVITY_COLORS: Record<CompanionActivity["status"], string> = Object.fromEntries(
  Object.entries(COMPANION_STATUS_KEYS).map(([activity, key]) => [
    activity,
    `var(${STATUS_PRESENTATION[key].colorVar})`,
  ]),
) as Record<CompanionActivity["status"], string>;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function BuiltinPet({ status }: { status: CompanionActivity["status"] }) {
  return (
    <div className={styles.builtinPet} data-status={status} aria-hidden="true">
      <div className={styles.builtinPetMotion}>
        <svg width="65" height="70" viewBox="0 0 72 76" fill="none">
          <path d="M19 24 13 10l15 8M53 24l6-14-15 8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="9" y="18" width="54" height="47" rx="23" fill="color-mix(in srgb, currentColor 13%, var(--bg))" stroke="currentColor" strokeWidth="3" />
          <circle cx="27" cy="39" r="3.5" fill="currentColor" />
          <circle cx="45" cy="39" r="3.5" fill="currentColor" />
          <path d={status === "failed" ? "m30 53 6-4 6 4" : status === "idle" ? "M30 50c3.5 4 8.5 4 12 0" : "M29 49c4 5 10 5 14 0"} stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          <path d="M36 18V9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          <circle cx="36" cy="6" r="3" fill="currentColor" />
        </svg>
      </div>
    </div>
  );
}

const MIN_TRICK_DELAY_MS = 18_000;
const MAX_TRICK_EXTRA_DELAY_MS = 24_000;

export function SpritePet({
  pet,
  status,
  event,
  overlayEvent,
  idleTricks = false,
}: {
  pet: CompanionPetMetadata;
  status: CompanionActivity["status"];
  event?: CompanionActivityEvent;
  /** One-shot user-driven reaction (poke/feed/water/pet); wins over runtime events. */
  overlayEvent?: CompanionActivityEvent;
  /** Play a random trick every now and then while the pet is idle. */
  idleTricks?: boolean;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const renderablePet = pet as unknown as RenderablePet;
  const grid = renderablePet.frame ?? {
    width: pet.frameWidth,
    height: pet.frameHeight,
    columns: pet.columns,
    rows: pet.rows,
  };
  const selectedBaseAnimation = useMemo(
    () => selectCompanionSpriteState(renderablePet.states, status),
    [renderablePet.states, status],
  );
  const idleAnimation = useMemo(
    () => renderablePet.states.find((state) => state.id === "idle") ?? null,
    [renderablePet.states],
  );
  const baseAnimation = useMemo(
    () => selectedBaseAnimation
      ? prepareCompanionPersistentAnimation(selectedBaseAnimation, idleAnimation, status)
      : null,
    [idleAnimation, selectedBaseAnimation, status],
  );
  const eventKey = event?.key;
  const eventKind = event?.kind;
  const selectedTransientAnimation = useMemo(
    () => eventKind ? selectCompanionTransientSpriteState(renderablePet.states, eventKind) : null,
    [eventKind, renderablePet.states],
  );
  const transientAnimation = useMemo(() => {
    if (reducedMotion || !eventKey || !selectedTransientAnimation || !baseAnimation) return null;
    return {
      ...prepareCompanionTransientAnimation(selectedTransientAnimation, idleAnimation, baseAnimation.id),
      id: `${selectedTransientAnimation.id}::${eventKey}`,
    };
  }, [baseAnimation, eventKey, idleAnimation, reducedMotion, selectedTransientAnimation]);
  const [completedEventKey, setCompletedEventKey] = useState<string | null>(null);
  const pendingTransientAnimation = eventKey !== completedEventKey ? transientAnimation : null;

  const overlayKey = overlayEvent?.key;
  const overlayKind = isCompanionInteractionKind(overlayEvent?.kind) ? overlayEvent?.kind : null;
  const stateIds = useMemo(() => renderablePet.states.map((state) => state.id), [renderablePet.states]);
  const lastReactionStateIdRef = useRef<string | null>(null);
  const lastTrickStateIdRef = useRef<string | null>(null);
  const trickSequenceRef = useRef(0);
  const selectedOverlayAnimationState = useMemo(() => {
    if (!overlayKind) return null;
    const picked = pickCompanionInteractionStateId(stateIds, overlayKind, lastReactionStateIdRef.current);
    lastReactionStateIdRef.current = picked;
    return picked;
    // Re-runs once per interaction key; the picked state must follow the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayKey, overlayKind, stateIds]);
  const overlayAnimation = useMemo(() => {
    if (reducedMotion || !overlayKey || !selectedOverlayAnimationState || !baseAnimation) return null;
    const state = renderablePet.states.find((entry) => entry.id === selectedOverlayAnimationState);
    if (!state) return null;
    return {
      ...prepareCompanionTransientAnimation(state, idleAnimation, baseAnimation.id),
      id: `${state.id}::${overlayKey}`,
    };
  }, [baseAnimation, idleAnimation, overlayKey, reducedMotion, renderablePet.states, selectedOverlayAnimationState]);
  const [completedOverlayKey, setCompletedOverlayKey] = useState<string | null>(null);
  const pendingOverlayAnimation = overlayKey && overlayKey !== completedOverlayKey ? overlayAnimation : null;

  // Idle tricks keep the pet lively while nothing is happening. They lose to
  // runtime events and user interactions and are dropped when those arrive.
  const [trick, setTrick] = useState<{ key: string; stateId: string } | null>(null);
  const [completedTrickKey, setCompletedTrickKey] = useState<string | null>(null);
  const pendingTrickAnimation = useMemo(() => {
    if (reducedMotion || !trick || trick.key === completedTrickKey || !baseAnimation) return null;
    const state = renderablePet.states.find((entry) => entry.id === trick.stateId);
    if (!state) return null;
    return {
      ...prepareCompanionTransientAnimation(state, idleAnimation, baseAnimation.id),
      id: `${state.id}::${trick.key}`,
    };
  }, [baseAnimation, completedTrickKey, idleAnimation, reducedMotion, renderablePet.states, trick]);

  const requestedAnimation = pendingOverlayAnimation ?? pendingTransientAnimation ?? pendingTrickAnimation ?? baseAnimation;
  const [animation, setAnimation] = useState<RenderableAnimationState | null>(requestedAnimation);
  const [frameOffset, setFrameOffset] = useState(0);
  const [failed, setFailed] = useState(false);
  const frameCount = Math.max(1, grid.columns * grid.rows);
  const frameIndices = getCompanionAnimationFrameIndices(animation, grid.columns, frameCount);

  useEffect(() => {
    setAnimation(requestedAnimation);
    setFrameOffset(0);
  }, [pet.atlasUrl, reducedMotion, requestedAnimation]);

  useEffect(() => {
    setFailed(false);
  }, [pet.atlasUrl]);

  useEffect(() => {
    if (reducedMotion || !animation || frameIndices.length === 0) return;
    const durations = animation.durationsMs;
    const timeout = window.setTimeout(() => {
      // Older Piora imports predate explicit loop metadata and were all
      // looping row animations. The normalized contract always supplies
      // loopStart (number or null), so undefined is the legacy-only case.
      const loopStart = animation.loopStart === undefined ? 0 : animation.loopStart;
      const next = advanceCompanionAnimation(frameOffset, frameIndices.length, loopStart);
      if (next !== null) {
        setFrameOffset(next);
        return;
      }
      if (pendingOverlayAnimation && animation.id === pendingOverlayAnimation.id && overlayKey) {
        setCompletedOverlayKey(overlayKey);
        setAnimation(baseAnimation);
        setFrameOffset(0);
        return;
      }
      if (pendingTransientAnimation && animation.id === pendingTransientAnimation.id && eventKey) {
        setCompletedEventKey(eventKey);
        setAnimation(baseAnimation);
        setFrameOffset(0);
        return;
      }
      if (pendingTrickAnimation && animation.id === pendingTrickAnimation.id && trick) {
        setCompletedTrickKey(trick.key);
        setAnimation(baseAnimation);
        setFrameOffset(0);
        return;
      }
      const fallback = renderablePet.states.find((state) => state.id === animation.fallback);
      if (fallback && fallback.id !== animation.id) {
        setAnimation(fallback.id === baseAnimation?.id ? baseAnimation : fallback);
        setFrameOffset(0);
      }
    }, Math.max(60, durations?.[frameOffset] ?? 150));
    return () => window.clearTimeout(timeout);
  }, [animation, baseAnimation, eventKey, frameIndices.length, frameOffset, overlayKey, pendingOverlayAnimation, pendingTransientAnimation, pendingTrickAnimation, reducedMotion, renderablePet.states, trick]);

  const idleTrickCapable = useMemo(
    () => pickCompanionIdleTrickStateId(stateIds) !== null,
    [stateIds],
  );

  // A higher-priority one-shot (runtime event or user interaction) cancels any
  // trick that is mid-flight so the pet never resumes a stale joke.
  useEffect(() => {
    if (pendingOverlayAnimation || pendingTransientAnimation) setTrick(null);
  }, [pendingOverlayAnimation, pendingTransientAnimation]);

  useEffect(() => {
    if (!idleTricks || reducedMotion || status !== "idle" || !idleTrickCapable) return;
    if (pendingOverlayAnimation || pendingTransientAnimation || pendingTrickAnimation) return;
    const delay = MIN_TRICK_DELAY_MS + Math.random() * MAX_TRICK_EXTRA_DELAY_MS;
    const timer = window.setTimeout(() => {
      const stateId = pickCompanionIdleTrickStateId(stateIds, lastTrickStateIdRef.current);
      if (!stateId) return;
      lastTrickStateIdRef.current = stateId;
      trickSequenceRef.current += 1;
      setTrick({ key: `trick:${trickSequenceRef.current}`, stateId });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [idleTrickCapable, idleTricks, pendingOverlayAnimation, pendingTransientAnimation, pendingTrickAnimation, reducedMotion, stateIds, status]);

  if (!pet.atlasUrl || !animation || frameIndices.length === 0 || failed) return <BuiltinPet status={status} />;
  const absoluteFrame = frameIndices[reducedMotion ? 0 : Math.min(frameOffset, frameIndices.length - 1)];
  const framePosition = getCompanionAtlasFramePosition(grid.columns, grid.rows, absoluteFrame);
  const frameRatio = Math.max(0.01, grid.width / grid.height);
  const viewportRatio = 82 / 89;
  const fittedSize = frameRatio >= viewportRatio
    ? { width: "100%", height: `${(viewportRatio / frameRatio) * 100}%` }
    : { width: `${(frameRatio / viewportRatio) * 100}%`, height: "100%" };
  return (
    <>
      {/* A hidden probe gives us a reliable broken-asset fallback. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={pet.atlasUrl} alt="" hidden onError={() => setFailed(true)} />
      <div
        className={styles.sprite}
        data-testid="companion-sprite-frame"
        aria-hidden="true"
        style={{
          ...fittedSize,
          backgroundImage: `url(${JSON.stringify(pet.atlasUrl).slice(1, -1)})`,
          backgroundSize: `${grid.columns * 100}% ${grid.rows * 100}%`,
          backgroundPosition: `${framePosition.xPercent}% ${framePosition.yPercent}%`,
        }}
      />
    </>
  );
}

export function CompanionPet({
  open,
  onOpenChange,
  activity,
  canSendPhrase,
  onSendPhrase,
  preferences,
  setPreferences,
  activePet,
}: Props) {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<CompanionTab>("todos");
  const [todoText, setTodoText] = useState("");
  const [phraseLabel, setPhraseLabel] = useState("");
  const [phraseText, setPhraseText] = useState("");
  const [editingPhraseId, setEditingPhraseId] = useState<string | null>(null);
  const [sendNotice, setSendNotice] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const sendNoticeTimerRef = useRef<number | null>(null);
  const [pokeEvent, setPokeEvent] = useState<CompanionActivityEvent | null>(null);
  const [petSpeech, setPetSpeech] = useState("");
  const petSpeechTimerRef = useRef<number | null>(null);
  const pokeSequenceRef = useRef(0);
  const lastPetSpeechRef = useRef<string | null>(null);

  useEffect(() => () => {
    if (sendNoticeTimerRef.current !== null) window.clearTimeout(sendNoticeTimerRef.current);
    if (petSpeechTimerRef.current !== null) window.clearTimeout(petSpeechTimerRef.current);
  }, []);

  const pokePet = () => {
    pokeSequenceRef.current += 1;
    setPokeEvent({ kind: "poke", key: `poke:${pokeSequenceRef.current}`, occurredAt: Date.now() });
    const line = pickCompanionSpeechLine("poke", locale, lastPetSpeechRef.current);
    lastPetSpeechRef.current = line;
    setPetSpeech(line);
    if (petSpeechTimerRef.current !== null) window.clearTimeout(petSpeechTimerRef.current);
    petSpeechTimerRef.current = window.setTimeout(() => setPetSpeech(""), 4_000);
  };

  const remainingTodos = preferences.todos.filter((todo) => !todo.completed).length;
  const statusLabel = t(`companion.activity.${activity.status}`);

  const addTodo = (event: FormEvent) => {
    event.preventDefault();
    const text = todoText.trim().slice(0, 240);
    if (!text || preferences.todos.length >= MAX_COMPANION_TODOS) return;
    setPreferences((current) => ({
      ...current,
      todos: [...current.todos, { id: createCompanionId("todo"), text, completed: false, createdAt: Date.now() }],
    }));
    setTodoText("");
  };

  const savePhrase = (event: FormEvent) => {
    event.preventDefault();
    const label = phraseLabel.trim().slice(0, 40);
    const text = phraseText.trim().slice(0, 2_000);
    if (!label || !text) return;
    setPreferences((current) => {
      if (editingPhraseId) {
        return { ...current, phrases: current.phrases.map((phrase) => phrase.id === editingPhraseId ? { ...phrase, label, text } : phrase) };
      }
      if (current.phrases.length >= MAX_COMPANION_PHRASES) return current;
      return { ...current, phrases: [...current.phrases, { id: createCompanionId("phrase"), label, text }] };
    });
    setPhraseLabel("");
    setPhraseText("");
    setEditingPhraseId(null);
  };

  const sendPhrase = (text: string) => {
    const sent = canSendPhrase && onSendPhrase(text);
    setSendNotice(sent ? t("companion.sent") : t("companion.sendUnavailable"));
    if (sendNoticeTimerRef.current !== null) window.clearTimeout(sendNoticeTimerRef.current);
    sendNoticeTimerRef.current = window.setTimeout(() => setSendNotice(""), 1800);
  };

  const moveTabFocus = (current: CompanionTab, direction: -1 | 1) => {
    const tabs: CompanionTab[] = ["todos", "phrases"];
    const next = tabs[(tabs.indexOf(current) + direction + tabs.length) % tabs.length];
    setTab(next);
    requestAnimationFrame(() => document.getElementById(`companion-tab-${next}`)?.focus());
  };

  if (!open) return null;

  return (
    <aside className={styles.dock} aria-label={t("companion.title")} data-testid="companion-dock">
      <div className={styles.header}>
        <button
          className={styles.petViewport}
          type="button"
          data-testid="companion-dock-pet"
          onClick={pokePet}
          title={t("companion.pokeHint")}
          aria-label={t("companion.pokeHint")}
        >
          {activePet
            ? <SpritePet
                pet={activePet}
                status={activity.status}
                event={activity.event}
                overlayEvent={pokeEvent ?? undefined}
                idleTricks={preferences.idleTricks !== false}
              />
            : <BuiltinPet status={activity.status} />}
        </button>
        <div className={styles.activityCopy} aria-live="polite">
          <div className={styles.activityRow}>
            <span className={styles.activityDot} style={{ "--activity-color": COMPANION_ACTIVITY_COLORS[activity.status] } as CSSProperties} />
            <span>{statusLabel}</span>
          </div>
          <div className={styles.activityCause}>{petSpeech || activity.cause}</div>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.iconButton} type="button" onClick={() => setHelpOpen((open) => !open)} title={t("companion.howToUse")} aria-label={t("companion.howToUse")} aria-expanded={helpOpen}>
            <AliIcon name="info" size={15} />
          </button>
          <button className={styles.iconButton} type="button" onClick={() => onOpenChange(false)} title={t("companion.close")} aria-label={t("companion.close")}>
            <AliIcon name="close" size={15} />
          </button>
        </div>
      </div>

      {helpOpen && (
        <div className={styles.helpPanel} role="note">
          <div className={styles.helpTitle}>{t("companion.howToUse")}</div>
          <ul>
            <li>{t("companion.helpStatus")}</li>
            <li>{t("companion.helpTodos")}</li>
            <li>{t("companion.helpPhrases")}</li>
          </ul>
        </div>
      )}

      <div className={styles.tabs} role="tablist" aria-label={t("companion.sections")}>
        {(["todos", "phrases"] as const).map((item) => (
          <button
            key={item}
            id={`companion-tab-${item}`}
            className={styles.tab}
            type="button"
            role="tab"
            aria-selected={tab === item}
            aria-controls={`companion-panel-${item}`}
            tabIndex={tab === item ? 0 : -1}
            onClick={() => setTab(item)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              moveTabFocus(item, event.key === "ArrowLeft" ? -1 : 1);
            }}
          >
            {t(`companion.tab.${item}`)}{item === "todos" && remainingTodos > 0 ? ` · ${remainingTodos}` : ""}
          </button>
        ))}
      </div>

      {tab === "todos" ? (
        <section id="companion-panel-todos" className={styles.panel} role="tabpanel" aria-labelledby="companion-tab-todos">
          <form className={styles.formRow} onSubmit={addTodo}>
            <input className={styles.input} value={todoText} maxLength={240} onChange={(event) => setTodoText(event.target.value)} placeholder={t("companion.todoPlaceholder")} aria-label={t("companion.todoPlaceholder")} />
            <button className={styles.primaryButton} type="submit" disabled={!todoText.trim() || preferences.todos.length >= MAX_COMPANION_TODOS}>{t("companion.add")}</button>
          </form>
          {preferences.todos.length === 0 ? <div className={styles.empty}>{t("companion.noTodos")}</div> : (
            <ul className={styles.list}>
              {preferences.todos.map((todo) => (
                <li className={styles.todoItem} key={todo.id}>
                  <input type="checkbox" checked={todo.completed} onChange={(event) => setPreferences((current) => ({ ...current, todos: current.todos.map((item) => item.id === todo.id ? { ...item, completed: event.target.checked } : item) }))} aria-label={t("companion.toggleTodo", { todo: todo.text })} />
                  <span className={`${styles.todoText}${todo.completed ? ` ${styles.todoDone}` : ""}`}>{todo.text}</span>
                  <button className={styles.dangerButton} type="button" onClick={() => setPreferences((current) => ({ ...current, todos: current.todos.filter((item) => item.id !== todo.id) }))} aria-label={t("companion.removeTodo", { todo: todo.text })}><AliIcon name="close" size={12} /></button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {tab === "phrases" ? (
        <section id="companion-panel-phrases" className={styles.panel} role="tabpanel" aria-labelledby="companion-tab-phrases">
          <div className={styles.summary}><span>{canSendPhrase ? t("companion.oneClickReady") : t("companion.oneClickBusy")}</span><span aria-live="polite">{sendNotice}</span></div>
          <form className={styles.stackForm} onSubmit={savePhrase}>
            <input className={styles.input} value={phraseLabel} maxLength={40} onChange={(event) => setPhraseLabel(event.target.value)} placeholder={t("companion.phraseLabelPlaceholder")} aria-label={t("companion.phraseLabelPlaceholder")} />
            <div className={styles.formRow}>
              <input className={styles.input} value={phraseText} maxLength={2_000} onChange={(event) => setPhraseText(event.target.value)} placeholder={t("companion.phraseTextPlaceholder")} aria-label={t("companion.phraseTextPlaceholder")} />
              <button className={styles.primaryButton} type="submit" disabled={!phraseLabel.trim() || !phraseText.trim()}>{editingPhraseId ? t("companion.save") : t("companion.add")}</button>
            </div>
          </form>
          {preferences.phrases.length === 0 ? <div className={styles.empty}>{t("companion.noPhrases")}</div> : (
            <ul className={styles.list}>
              {preferences.phrases.map((phrase) => (
                <li className={styles.phraseItem} key={phrase.id}>
                  <button className={styles.phraseButton} type="button" disabled={!canSendPhrase} title={phrase.text} onClick={() => sendPhrase(phrase.text)}>{phrase.label}</button>
                  <button className={styles.secondaryButton} type="button" onClick={() => { setEditingPhraseId(phrase.id); setPhraseLabel(phrase.label); setPhraseText(phrase.text); }}>{t("companion.edit")}</button>
                  <button className={styles.dangerButton} type="button" onClick={() => setPreferences((current) => ({ ...current, phrases: current.phrases.filter((item) => item.id !== phrase.id) }))} aria-label={t("companion.removePhrase", { phrase: phrase.label })}><AliIcon name="close" size={12} /></button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

    </aside>
  );
}

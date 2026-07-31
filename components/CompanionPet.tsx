"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { CompanionPet as CompanionPetMetadata, CompanionPetSourceKind, CompanionPetsResponse } from "@/lib/companion-pets";
import {
  advanceCompanionAnimation,
  getCompanionAnimationFrameIndices,
  getCompanionAtlasFramePosition,
  selectCompanionSpriteState,
  type CompanionActivity,
} from "@/lib/companion";
import {
  COMPANION_STORAGE_KEY,
  MAX_COMPANION_PHRASES,
  MAX_COMPANION_TODOS,
  createCompanionId,
  createDefaultCompanionPreferences,
  parseCompanionPreferences,
  type CompanionPreferences,
} from "@/lib/companion-store";
import styles from "./CompanionPet.module.css";

type CompanionTab = "todos" | "phrases" | "pets";

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

type SourcedPet = CompanionPetMetadata & {
  sourceKind?: CompanionPetSourceKind;
  sourceKey?: string;
  origin?: Exclude<CompanionPetSourceKind, "pi-gui-installed">;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activity: CompanionActivity;
  canSendPhrase: boolean;
  onSendPhrase: (text: string) => boolean;
}

const ACTIVITY_COLORS: Record<CompanionActivity["status"], string> = {
  idle: "#22a06b",
  running: "#2563eb",
  waiting: "#d97706",
  review: "#8b5cf6",
  failed: "#dc2626",
};

const SOURCE_MESSAGE_KEYS: Record<CompanionPetSourceKind, string> = {
  "codex-builtin-cache": "companion.source.codexBuiltinCache",
  "codex-custom": "companion.source.codexCustom",
  "codex-legacy-avatar": "companion.source.codexLegacyAvatar",
  "pi-gui-installed": "companion.source.piGuiInstalled",
};

function resolvePetSourceKind(pet: SourcedPet): CompanionPetSourceKind {
  if (pet.installed && pet.origin && pet.origin in SOURCE_MESSAGE_KEYS) return pet.origin;
  if (pet.sourceKind && pet.sourceKind in SOURCE_MESSAGE_KEYS) return pet.sourceKind;
  return pet.source === "codex" ? "codex-custom" : "pi-gui-installed";
}

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

function BuiltinPet({ status }: { status: CompanionActivity["status"] }) {
  return (
    <div className={styles.builtinPet} data-status={status} aria-hidden="true">
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
  );
}

function SpritePet({ pet, status }: { pet: CompanionPetMetadata; status: CompanionActivity["status"] }) {
  const reducedMotion = usePrefersReducedMotion();
  const renderablePet = pet as unknown as RenderablePet;
  const grid = renderablePet.frame ?? {
    width: pet.frameWidth,
    height: pet.frameHeight,
    columns: pet.columns,
    rows: pet.rows,
  };
  const requestedAnimation = useMemo(
    () => selectCompanionSpriteState(renderablePet.states, status),
    [renderablePet.states, status],
  );
  const [animationId, setAnimationId] = useState<string | null>(requestedAnimation?.id ?? null);
  const [frameOffset, setFrameOffset] = useState(0);
  const [failed, setFailed] = useState(false);
  const activeAnimation = renderablePet.states.find((state) => state.id === animationId) ?? requestedAnimation;
  const animation = reducedMotion ? requestedAnimation : activeAnimation;
  const frameCount = Math.max(1, grid.columns * grid.rows);
  const frameIndices = getCompanionAnimationFrameIndices(animation, grid.columns, frameCount);

  useEffect(() => {
    setAnimationId(requestedAnimation?.id ?? null);
    setFrameOffset(0);
  }, [pet.atlasUrl, requestedAnimation?.id, reducedMotion, status]);

  useEffect(() => {
    setFailed(false);
  }, [pet.atlasUrl]);

  useEffect(() => {
    if (reducedMotion || !animation || frameIndices.length === 0) return;
    const durations = animation.durationsMs;
    const timeout = window.setTimeout(() => {
      // Older piGUI imports predate explicit loop metadata and were all
      // looping row animations. The normalized contract always supplies
      // loopStart (number or null), so undefined is the legacy-only case.
      const loopStart = animation.loopStart === undefined ? 0 : animation.loopStart;
      const next = advanceCompanionAnimation(frameOffset, frameIndices.length, loopStart);
      if (next !== null) {
        setFrameOffset(next);
        return;
      }
      const fallback = renderablePet.states.find((state) => state.id === animation.fallback);
      if (fallback && fallback.id !== animation.id) {
        setAnimationId(fallback.id);
        setFrameOffset(0);
      }
    }, Math.max(60, durations?.[frameOffset] ?? 150));
    return () => window.clearTimeout(timeout);
  }, [animation, frameIndices.length, frameOffset, reducedMotion, renderablePet.states]);

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

export function CompanionPet({ open, onOpenChange, activity, canSendPhrase, onSendPhrase }: Props) {
  const { t } = useI18n();
  const defaults = useMemo(() => createDefaultCompanionPreferences([
    { label: t("companion.defaultContinueLabel"), text: t("companion.defaultContinueText") },
    { label: t("companion.defaultTestLabel"), text: t("companion.defaultTestText") },
  ]), [t]);
  const [preferences, setPreferences] = useState<CompanionPreferences>(defaults);
  const [hydrated, setHydrated] = useState(false);
  const [tab, setTab] = useState<CompanionTab>("todos");
  const [todoText, setTodoText] = useState("");
  const [phraseLabel, setPhraseLabel] = useState("");
  const [phraseText, setPhraseText] = useState("");
  const [editingPhraseId, setEditingPhraseId] = useState<string | null>(null);
  const [pets, setPets] = useState<CompanionPetsResponse | null>(null);
  const [petsLoading, setPetsLoading] = useState(false);
  const [petsError, setPetsError] = useState<string | null>(null);
  const [importingPetId, setImportingPetId] = useState<string | null>(null);
  const [sendNotice, setSendNotice] = useState("");
  const sendNoticeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let restored = defaults;
    try {
      restored = parseCompanionPreferences(window.localStorage.getItem(COMPANION_STORAGE_KEY), defaults);
    } catch {
      // Storage can be disabled by browser policy; the in-memory companion
      // remains fully usable for the current app session.
    }
    setPreferences(restored);
    onOpenChange(restored.open);
    setHydrated(true);
  }, [defaults, onOpenChange]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(COMPANION_STORAGE_KEY, JSON.stringify({ ...preferences, open }));
    } catch {
      // Keep the feature available in memory when persistence is unavailable.
    }
  }, [hydrated, open, preferences]);

  useEffect(() => () => {
    if (sendNoticeTimerRef.current !== null) window.clearTimeout(sendNoticeTimerRef.current);
  }, []);

  const loadPets = useCallback(async () => {
    setPetsLoading(true);
    setPetsError(null);
    try {
      const response = await fetch("/api/companion-pets", { cache: "no-store" });
      const body = await response.json() as CompanionPetsResponse | { error?: string };
      if (!response.ok) throw new Error("error" in body && body.error ? body.error : t("companion.loadPetsFailed"));
      setPets(body as CompanionPetsResponse);
    } catch (error) {
      setPetsError(error instanceof Error ? error.message : t("companion.loadPetsFailed"));
    } finally {
      setPetsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (open) void loadPets();
  }, [loadPets, open]);

  const activePet = pets?.installed.find((pet) => pet.id === preferences.selectedPetId) ?? null;
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

  const importPet = async (pet: SourcedPet) => {
    setImportingPetId(pet.sourceKey ?? pet.id);
    setPetsError(null);
    try {
      const response = await fetch("/api/companion-pets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "import",
          id: pet.id,
          ...(pet.sourceKind ? { sourceKind: pet.sourceKind } : {}),
        }),
      });
      const body = await response.json() as { pet?: CompanionPetMetadata; error?: string };
      if (!response.ok || !body.pet) throw new Error(body.error || t("companion.importFailed"));
      setPreferences((current) => ({ ...current, selectedPetId: body.pet!.id }));
      await loadPets();
    } catch (error) {
      setPetsError(error instanceof Error ? error.message : t("companion.importFailed"));
    } finally {
      setImportingPetId(null);
    }
  };

  const sendPhrase = (text: string) => {
    const sent = canSendPhrase && onSendPhrase(text);
    setSendNotice(sent ? t("companion.sent") : t("companion.sendUnavailable"));
    if (sendNoticeTimerRef.current !== null) window.clearTimeout(sendNoticeTimerRef.current);
    sendNoticeTimerRef.current = window.setTimeout(() => setSendNotice(""), 1800);
  };

  const moveTabFocus = (current: CompanionTab, direction: -1 | 1) => {
    const tabs: CompanionTab[] = ["todos", "phrases", "pets"];
    const next = tabs[(tabs.indexOf(current) + direction + tabs.length) % tabs.length];
    setTab(next);
    requestAnimationFrame(() => document.getElementById(`companion-tab-${next}`)?.focus());
  };

  if (!open) return null;

  return (
    <aside className={styles.dock} aria-label={t("companion.title")} data-testid="companion-dock">
      <div className={styles.header}>
        <div className={styles.petViewport}>
          {activePet ? <SpritePet pet={activePet} status={activity.status} /> : <BuiltinPet status={activity.status} />}
        </div>
        <div className={styles.activityCopy} aria-live="polite">
          <div className={styles.activityRow}>
            <span className={styles.activityDot} style={{ "--activity-color": ACTIVITY_COLORS[activity.status] } as CSSProperties} />
            <span>{statusLabel}</span>
          </div>
          <div className={styles.activityCause}>{activity.cause}</div>
        </div>
        <button className={styles.iconButton} type="button" onClick={() => onOpenChange(false)} title={t("companion.close")} aria-label={t("companion.close")}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </div>

      <div className={styles.tabs} role="tablist" aria-label={t("companion.sections")}>
        {(["todos", "phrases", "pets"] as const).map((item) => (
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
                  <button className={styles.dangerButton} type="button" onClick={() => setPreferences((current) => ({ ...current, todos: current.todos.filter((item) => item.id !== todo.id) }))} aria-label={t("companion.removeTodo", { todo: todo.text })}>×</button>
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
                  <button className={styles.dangerButton} type="button" onClick={() => setPreferences((current) => ({ ...current, phrases: current.phrases.filter((item) => item.id !== phrase.id) }))} aria-label={t("companion.removePhrase", { phrase: phrase.label })}>×</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {tab === "pets" ? (
        <section id="companion-panel-pets" className={styles.panel} role="tabpanel" aria-labelledby="companion-tab-pets">
          <div className={styles.summary}><span>{t("companion.localOnly")}</span><button className={styles.secondaryButton} type="button" onClick={() => void loadPets()} disabled={petsLoading}>{t("companion.refresh")}</button></div>
          <ul className={styles.list}>
            <li className={styles.petItem}>
              <div className={styles.petCopy}><div className={styles.petName}>{t("companion.builtinPet")}</div><div className={styles.petMeta}>{t("companion.builtinPetDescription")}</div></div>
              <button className={styles.secondaryButton} type="button" disabled={preferences.selectedPetId === "builtin"} onClick={() => setPreferences((current) => ({ ...current, selectedPetId: "builtin" }))}>{preferences.selectedPetId === "builtin" ? t("companion.selected") : t("companion.select")}</button>
            </li>
            {pets?.installed.map((pet) => {
              const sourcedPet = pet as SourcedPet;
              const sourceLabel = t(SOURCE_MESSAGE_KEYS[resolvePetSourceKind(sourcedPet)]);
              return (
                <li className={styles.petItem} key={`installed:${sourcedPet.sourceKey ?? pet.id}`}>
                  <div className={styles.petCopy}><div className={styles.petName}>{pet.displayName}</div><div className={styles.petMeta}>{sourceLabel} · {t("companion.codexCompatibleVersion", { version: pet.spriteVersionNumber })}{pet.author ? ` · ${pet.author}` : ""}</div></div>
                  <button className={styles.secondaryButton} type="button" disabled={preferences.selectedPetId === pet.id} onClick={() => setPreferences((current) => ({ ...current, selectedPetId: pet.id }))}>{preferences.selectedPetId === pet.id ? t("companion.selected") : t("companion.select")}</button>
                </li>
              );
            })}
          </ul>
          <div className={styles.summary} style={{ marginTop: 14 }}><span>{t("companion.discoveredCodexPets")}</span><span>{pets?.sources.length ?? 0}</span></div>
          {petsLoading && !pets ? <div className={styles.notice}>{t("companion.loadingPets")}</div> : null}
          {!petsLoading && pets && pets.sources.length === 0 ? <div className={styles.empty}>{pets.codexSourceAvailable ? t("companion.noCodexPets") : t("companion.codexNotFound")}</div> : null}
          <ul className={styles.list}>
            {pets?.sources.map((pet) => {
              const sourcedPet = pet as SourcedPet;
              const sourceKey = sourcedPet.sourceKey ?? `${resolvePetSourceKind(sourcedPet)}:${pet.id}`;
              const sourceLabel = t(SOURCE_MESSAGE_KEYS[resolvePetSourceKind(sourcedPet)]);
              return (
                <li className={styles.petItem} key={`source:${sourceKey}`}>
                  <div className={styles.petCopy}><div className={styles.petName}>{pet.displayName}</div><div className={styles.petMeta}>{sourceLabel} · {t("companion.codexCompatibleVersion", { version: pet.spriteVersionNumber })}{pet.description ? ` · ${pet.description}` : ""}</div></div>
                  <button className={styles.primaryButton} type="button" disabled={importingPetId !== null} onClick={() => void importPet(sourcedPet)}>{importingPetId === sourceKey ? t("companion.importing") : t("companion.import")}</button>
                </li>
              );
            })}
          </ul>
          {petsError ? <div className={styles.error} role="alert">{petsError}</div> : null}
          {pets?.diagnostics.map((diagnostic, index) => <div className={styles.diagnostic} key={`${diagnostic.scope}:${diagnostic.id ?? "general"}:${index}`}>{diagnostic.message}</div>)}
        </section>
      ) : null}
    </aside>
  );
}

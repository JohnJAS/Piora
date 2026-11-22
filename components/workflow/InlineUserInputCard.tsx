"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useDialogCountdown } from "@/hooks/useExtensionDialog";
import type { ExtensionUiRequest } from "@/lib/types";
import { USER_INPUT_MAX_TEXT_LENGTH, type UserInputAnswers } from "@/lib/user-input";
import { AliIcon } from "../AliIcon";
import {
  clearUserInputDraft,
  getUserInputDraft,
  setUserInputDraft,
} from "./user-input-draft-store";
import styles from "./Workflow.module.css";

export type UserInputRequest = Extract<ExtensionUiRequest, { method: "request_user_input" }>;

export interface InlineUserInputCardProps {
  request: UserInputRequest;
  sessionId?: string | null;
  onRespond: (request: UserInputRequest, response: { answers: UserInputAnswers } | { cancelled: true }) => void;
}

function sendPresenceSignal(sessionId: string | null | undefined, body: Record<string, unknown>): void {
  if (!sessionId) return;
  void fetch(`/api/agent/${encodeURIComponent(sessionId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => undefined);
}

/**
 * Codex-aligned inline Composer card for `request_user_input`.
 * Replaces the full-screen blocking modal with an inline card supporting
 * pagination, 1–6 keyboard choice, "Other" free-text answers, draft persistence,
 * foreground-inactivity pause, and global interaction snooze.
 */
export function InlineUserInputCard({
  request,
  sessionId,
  onRespond,
}: InlineUserInputCardProps) {
  const { t } = useI18n();
  const cardRef = useRef<HTMLDivElement>(null);
  const firstControlRef = useRef<HTMLElement>(null);
  const snoozeSentRef = useRef(false);

  const initialDraft = useMemo(() => getUserInputDraft(sessionId ?? undefined, request.id), [sessionId, request.id]);

  const [answers, setAnswers] = useState<UserInputAnswers>(() => (
    initialDraft?.answers ?? Object.fromEntries(request.questions.map((question) => [question.id, []]))
  ));
  const [customText, setCustomText] = useState<Record<string, string>>(() => initialDraft?.customText ?? {});
  const [activeIndex, setActiveIndex] = useState<number>(() => (
    Math.min(Math.max(0, initialDraft?.activeIndex ?? 0), Math.max(0, request.questions.length - 1))
  ));
  const [attempted, setAttempted] = useState(false);

  const activeExpiresAt = request.snoozed || request.paused ? undefined : request.expiresAt;
  const remainingSeconds = useDialogCountdown(activeExpiresAt);
  const expired = useCallback(
    () => Boolean(!request.snoozed && !request.paused && request.expiresAt && Date.now() >= request.expiresAt),
    [request.expiresAt, request.paused, request.snoozed],
  );

  // Persist partial drafts across chat/panel navigation.
  useEffect(() => {
    setUserInputDraft(sessionId ?? undefined, request.id, { answers, customText, activeIndex });
  }, [sessionId, request.id, answers, customText, activeIndex]);

  // Report foreground presentation so backgrounded chats pause auto-resolution.
  useEffect(() => {
    if (!sessionId) return;
    const report = () => {
      sendPresenceSignal(sessionId, {
        type: "user_input_presence",
        presented: document.visibilityState !== "hidden",
      });
    };
    report();
    document.addEventListener("visibilitychange", report);
    return () => {
      document.removeEventListener("visibilitychange", report);
      sendPresenceSignal(sessionId, { type: "user_input_presence", presented: false });
    };
  }, [sessionId, request.id]);

  // Snooze auto-resolution on any user interaction outside [data-user-input-auto-resolution].
  useEffect(() => {
    if (!sessionId || request.snoozed || snoozeSentRef.current) return;
    const onActivity = (event: Event) => {
      if (snoozeSentRef.current) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("[data-user-input-auto-resolution]")) return;
      snoozeSentRef.current = true;
      sendPresenceSignal(sessionId, { type: "user_input_activity", id: request.id });
    };
    window.addEventListener("keydown", onActivity, true);
    window.addEventListener("pointerdown", onActivity, true);
    return () => {
      window.removeEventListener("keydown", onActivity, true);
      window.removeEventListener("pointerdown", onActivity, true);
    };
  }, [sessionId, request.id, request.snoozed]);

  // The "Other" free-text answer for select questions is kept outside the
  // selection state and merged in only when it is non-empty, so a custom
  // answer can never be mistaken for one of the predefined option labels.
  const mergedAnswers = useMemo<UserInputAnswers>(() => {
    const merged: UserInputAnswers = {};
    for (const question of request.questions) {
      const values = [...(answers[question.id] ?? [])];
      const custom = (customText[question.id] ?? "").trim();
      if (custom) values.push(custom);
      merged[question.id] = values;
    }
    return merged;
  }, [answers, customText, request.questions]);

  const complete = request.questions.every((question) => (
    !question.required || (mergedAnswers[question.id]?.some((value) => value.trim().length > 0) ?? false)
  ));

  const cancel = useCallback(() => {
    if (expired()) return;
    clearUserInputDraft(sessionId ?? undefined, request.id);
    onRespond(request, { cancelled: true });
  }, [expired, sessionId, request, onRespond]);

  const setSingle = useCallback((id: string, value: string) => {
    setAnswers((current) => ({ ...current, [id]: [value] }));
    setCustomText((current) => ({ ...current, [id]: "" }));
  }, []);

  const toggleMultiple = useCallback((id: string, value: string) => {
    setAnswers((current) => {
      const selected = current[id] ?? [];
      return {
        ...current,
        [id]: selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value],
      };
    });
  }, []);

  const setText = useCallback((id: string, value: string) => {
    setAnswers((current) => ({ ...current, [id]: value ? [value] : [] }));
  }, []);

  const setCustom = useCallback((id: string, value: string, exclusive: boolean) => {
    setCustomText((current) => ({ ...current, [id]: value }));
    if (exclusive && value.trim()) {
      // A single-select custom answer replaces any chosen option label.
      setAnswers((current) => (
        (current[id]?.length ?? 0) > 0 ? { ...current, [id]: [] } : current
      ));
    }
  }, []);

  const submit = useCallback(() => {
    if (expired()) return;
    setAttempted(true);
    if (!complete) {
      const firstMissingIndex = request.questions.findIndex((question) => (
        question.required && !(mergedAnswers[question.id]?.some((value) => value.trim().length > 0))
      ));
      if (firstMissingIndex >= 0) setActiveIndex(firstMissingIndex);
      return;
    }
    clearUserInputDraft(sessionId ?? undefined, request.id);
    onRespond(request, { answers: mergedAnswers });
  }, [expired, complete, request, mergedAnswers, sessionId, onRespond]);

  if (remainingSeconds === 0 && !request.snoozed && !request.paused) return null;

  const totalQuestions = request.questions.length;
  const safeIndex = Math.min(activeIndex, Math.max(0, totalQuestions - 1));
  const currentQuestion = request.questions[safeIndex];
  if (!currentQuestion) return null;

  const selected = mergedAnswers[currentQuestion.id] ?? [];
  const missing = attempted && currentQuestion.required && !selected.some((value) => value.trim());
  const customValue = customText[currentQuestion.id] ?? "";
  const customActive = customValue.trim().length > 0;
  const isLastQuestion = safeIndex === totalQuestions - 1;

  const handleCardKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancel();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      submit();
      return;
    }
    const target = event.target as HTMLElement | null;
    const isTypingField = Boolean(target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA"));
    if (!isTypingField && currentQuestion.kind !== "text" && currentQuestion.options?.length) {
      if (/^[1-6]$/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const option = currentQuestion.options[Number(event.key) - 1];
        if (option) {
          event.preventDefault();
          if (currentQuestion.kind === "single_select") {
            setSingle(currentQuestion.id, option.label);
            if (!isLastQuestion) setActiveIndex((i) => Math.min(totalQuestions - 1, i + 1));
          } else {
            toggleMultiple(currentQuestion.id, option.label);
          }
        }
      }
    }
  };

  return (
    <section
      ref={cardRef}
      className={styles.inlineCard}
      role="region"
      data-testid="inline-user-input-card"
      aria-labelledby={`user-input-title-${request.id}`}
      onKeyDown={handleCardKeyDown}
    >
      <header className={styles.inlineHeader}>
        <div className={styles.inlineHeaderLeft}>
          <span className={styles.inlineIcon} aria-hidden="true">
            <AliIcon name="question" size={15} />
          </span>
          <div className={styles.inlineHeading}>
            <h3 id={`user-input-title-${request.id}`}>{request.title}</h3>
            {request.description ? <p id={`user-input-description-${request.id}`}>{request.description}</p> : null}
          </div>
        </div>
        <div className={styles.inlineHeaderRight}>
          {totalQuestions > 1 && (
            <div className={styles.pager} aria-label={t("userInput.questionProgress", { current: safeIndex + 1, total: totalQuestions })}>
              <button
                type="button"
                className={styles.pagerBtn}
                disabled={safeIndex === 0}
                onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
                aria-label={t("userInput.prevQuestion")}
              >
                <AliIcon name="arrowup" size={12} />
              </button>
              <span>{safeIndex + 1} / {totalQuestions}</span>
              <button
                type="button"
                className={styles.pagerBtn}
                disabled={isLastQuestion}
                onClick={() => setActiveIndex((i) => Math.min(totalQuestions - 1, i + 1))}
                aria-label={t("userInput.nextQuestion")}
              >
                <AliIcon name="arrowdown" size={12} />
              </button>
            </div>
          )}
          <button
            className={styles.inlineClose}
            type="button"
            onClick={cancel}
            aria-label={t("chat.cancel")}
            title={t("chat.cancel")}
          >
            <AliIcon name="close" size={14} />
          </button>
        </div>
      </header>

      <div className={styles.inlineBody}>
        <div className={styles.questionBlock} key={currentQuestion.id} data-invalid={missing || undefined}>
          <div className={styles.questionTitleRow}>
            <p className={styles.questionLabel}>
              {currentQuestion.header ? `${currentQuestion.header} · ` : ""}
              {currentQuestion.question}
            </p>
            <span className={styles.questionTag}>
              {currentQuestion.required ? t("userInput.required") : t("userInput.optional")}
            </span>
          </div>

          {currentQuestion.kind === "text" ? (
            currentQuestion.multiline ? (
              <textarea
                ref={firstControlRef as React.RefObject<HTMLTextAreaElement>}
                className={styles.textField}
                value={selected[0] ?? ""}
                maxLength={USER_INPUT_MAX_TEXT_LENGTH}
                rows={4}
                placeholder={currentQuestion.placeholder || t("userInput.textPlaceholder")}
                onChange={(event) => setText(currentQuestion.id, event.target.value)}
                aria-invalid={missing}
              />
            ) : (
              <input
                ref={firstControlRef as React.RefObject<HTMLInputElement>}
                className={styles.textField}
                value={selected[0] ?? ""}
                maxLength={USER_INPUT_MAX_TEXT_LENGTH}
                placeholder={currentQuestion.placeholder || t("userInput.textPlaceholder")}
                onChange={(event) => setText(currentQuestion.id, event.target.value)}
                aria-invalid={missing}
              />
            )
          ) : (
            <div className={styles.optionList} role={currentQuestion.kind === "single_select" ? "radiogroup" : "group"}>
              {currentQuestion.options?.map((option, optionIndex) => {
                const checked = selected.includes(option.label);
                return (
                  <button
                    ref={optionIndex === 0 ? firstControlRef as React.RefObject<HTMLButtonElement> : undefined}
                    key={option.label}
                    type="button"
                    className={styles.optionRow}
                    data-selected={checked ? "true" : undefined}
                    role={currentQuestion.kind === "single_select" ? "radio" : "checkbox"}
                    aria-checked={checked}
                    onClick={() => {
                      if (currentQuestion.kind === "single_select") {
                        setSingle(currentQuestion.id, option.label);
                      } else {
                        toggleMultiple(currentQuestion.id, option.label);
                      }
                    }}
                  >
                    <span className={styles.optionIndex} aria-hidden="true">
                      {checked ? <AliIcon name="check" size={11} /> : optionIndex + 1}
                    </span>
                    <span className={styles.optionCopy}>
                      <strong>{option.label}</strong>
                      {option.description ? <small>{option.description}</small> : null}
                    </span>
                  </button>
                );
              })}

              <label className={styles.optionRow} data-selected={customActive ? "true" : undefined}>
                <span className={styles.optionIndex} aria-hidden="true">
                  {customActive ? <AliIcon name="check" size={11} /> : (currentQuestion.options?.length ?? 0) + 1}
                </span>
                <input
                  type="text"
                  className={styles.customField}
                  value={customValue}
                  maxLength={USER_INPUT_MAX_TEXT_LENGTH}
                  placeholder={t("userInput.otherPlaceholder")}
                  aria-label={t("userInput.other")}
                  aria-invalid={missing}
                  onChange={(event) => setCustom(currentQuestion.id, event.target.value, currentQuestion.kind === "single_select")}
                />
              </label>
            </div>
          )}

          {missing ? <p className={styles.validation} role="alert">{t("userInput.missing")}</p> : null}
        </div>
      </div>

      <footer className={styles.inlineFooter}>
        <div className={styles.inlineFooterMeta} data-user-input-auto-resolution="true">
          {request.snoozed ? (
            <span>{t("userInput.autoResolveSnoozed")}</span>
          ) : request.paused ? (
            <span>{t("userInput.autoResolvePaused")}</span>
          ) : remainingSeconds !== null ? (
            <span className={styles.timerBadge} role="timer" aria-live="off" data-urgent={remainingSeconds <= 10 ? "true" : undefined}>
              {t("userInput.autoResolveIn", { seconds: remainingSeconds })}
            </span>
          ) : (
            <span>{t("userInput.keyboardHint")}</span>
          )}
        </div>
        <div className={styles.inlineActions}>
          <button className={styles.btnSecondary} type="button" onClick={cancel}>
            {t("userInput.skip")}
          </button>
          {totalQuestions > 1 && !isLastQuestion ? (
            <button
              className={styles.btnPrimary}
              type="button"
              onClick={() => setActiveIndex((i) => Math.min(totalQuestions - 1, i + 1))}
            >
              {t("userInput.nextQuestion")}
            </button>
          ) : (
            <button className={styles.btnPrimary} type="button" onClick={submit} aria-disabled={!complete}>
              {t("userInput.submit")}
              <span className={styles.shortcutKey}>Ctrl ↵</span>
            </button>
          )}
        </div>
      </footer>
    </section>
  );
}

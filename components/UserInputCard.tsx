"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useI18n } from "@/hooks/useI18n";
import type { ExtensionUiRequest } from "@/lib/types";
import { USER_INPUT_MAX_TEXT_LENGTH, type UserInputAnswers } from "@/lib/user-input";
import { AliIcon } from "./AliIcon";
import styles from "./UserInputCard.module.css";

type UserInputRequest = Extract<ExtensionUiRequest, { method: "request_user_input" }>;

export function UserInputCard({
  request,
  onRespond,
}: {
  request: UserInputRequest;
  onRespond: (request: UserInputRequest, response: { answers: UserInputAnswers } | { cancelled: true }) => void;
}) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstControlRef = useRef<HTMLElement>(null);
  const [answers, setAnswers] = useState<UserInputAnswers>(() => (
    Object.fromEntries(request.questions.map((question) => [question.id, []]))
  ));
  const [attempted, setAttempted] = useState(false);

  const complete = request.questions.every((question) => (
    !question.required || (answers[question.id]?.some((value) => value.trim().length > 0) ?? false)
  ));

  const cancel = () => onRespond(request, { cancelled: true });
  useFocusTrap(dialogRef, true, { initialFocus: firstControlRef, onEscape: cancel });

  const setSingle = (id: string, value: string) => {
    setAnswers((current) => ({ ...current, [id]: [value] }));
  };
  const toggleMultiple = (id: string, value: string) => {
    setAnswers((current) => {
      const selected = current[id] ?? [];
      return {
        ...current,
        [id]: selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value],
      };
    });
  };
  const setText = (id: string, value: string) => {
    setAnswers((current) => ({ ...current, [id]: value ? [value] : [] }));
  };
  const submit = () => {
    setAttempted(true);
    if (!complete) return;
    onRespond(request, { answers });
  };

  return createPortal(
    <div className={styles.backdrop} role="presentation">
      <div
        ref={dialogRef}
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`user-input-title-${request.id}`}
        aria-describedby={request.description ? `user-input-description-${request.id}` : undefined}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            submit();
          }
        }}
      >
        <header className={styles.header}>
          <div className={styles.icon} aria-hidden="true"><AliIcon name="question" size={17} /></div>
          <div className={styles.heading}>
            <div className={styles.eyebrow}>{t("userInput.eyebrow")}</div>
            <h2 id={`user-input-title-${request.id}`}>{request.title}</h2>
            {request.description ? <p id={`user-input-description-${request.id}`}>{request.description}</p> : null}
          </div>
          <button className={styles.close} type="button" onClick={cancel} aria-label={t("chat.cancel")} title={t("chat.cancel")}>
            <AliIcon name="close" size={15} />
          </button>
        </header>

        <div className={styles.body}>
          {request.questions.map((question, questionIndex) => {
            const selected = answers[question.id] ?? [];
            const missing = attempted && question.required && !selected.some((value) => value.trim());
            return (
              <section className={styles.question} key={question.id} data-invalid={missing || undefined}>
                <div className={styles.questionMeta}>
                  <span>{question.header || t("userInput.question", { count: questionIndex + 1 })}</span>
                  <span>{question.required ? t("userInput.required") : t("userInput.optional")}</span>
                </div>
                <h3>{question.question}</h3>
                {question.kind === "text" ? (
                  question.multiline ? (
                    <textarea
                      ref={questionIndex === 0 ? firstControlRef as React.RefObject<HTMLTextAreaElement> : undefined}
                      className={styles.textField}
                      value={selected[0] ?? ""}
                      maxLength={USER_INPUT_MAX_TEXT_LENGTH}
                      rows={5}
                      placeholder={question.placeholder || t("userInput.textPlaceholder")}
                      onChange={(event) => setText(question.id, event.target.value)}
                      aria-invalid={missing}
                    />
                  ) : (
                    <input
                      ref={questionIndex === 0 ? firstControlRef as React.RefObject<HTMLInputElement> : undefined}
                      className={styles.textField}
                      value={selected[0] ?? ""}
                      maxLength={USER_INPUT_MAX_TEXT_LENGTH}
                      placeholder={question.placeholder || t("userInput.textPlaceholder")}
                      onChange={(event) => setText(question.id, event.target.value)}
                      aria-invalid={missing}
                    />
                  )
                ) : (
                  <div className={styles.options} role={question.kind === "single_select" ? "radiogroup" : "group"}>
                    {question.options?.map((option, optionIndex) => {
                      const checked = selected.includes(option.label);
                      return (
                        <button
                          ref={questionIndex === 0 && optionIndex === 0 ? firstControlRef as React.RefObject<HTMLButtonElement> : undefined}
                          key={option.label}
                          type="button"
                          className={styles.option}
                          data-selected={checked || undefined}
                          role={question.kind === "single_select" ? "radio" : "checkbox"}
                          aria-checked={checked}
                          onClick={() => question.kind === "single_select"
                            ? setSingle(question.id, option.label)
                            : toggleMultiple(question.id, option.label)}
                        >
                          <span className={styles.control} aria-hidden="true">
                            {checked ? <AliIcon name="check" size={12} /> : null}
                          </span>
                          <span className={styles.optionCopy}>
                            <strong>{option.label}</strong>
                            {option.description ? <small>{option.description}</small> : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {missing ? <p className={styles.validation} role="alert">{t("userInput.missing")}</p> : null}
              </section>
            );
          })}
        </div>

        <footer className={styles.footer}>
          <div className={styles.waiting}><span aria-hidden="true" />{t("userInput.waiting")}</div>
          <div className={styles.actions}>
            <button className={styles.secondary} type="button" onClick={cancel}>{t("chat.cancel")}</button>
            <button className={styles.primary} type="button" onClick={submit} aria-disabled={!complete}>
              {t("userInput.submit")}
              <span className={styles.shortcut}>Ctrl ↵</span>
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

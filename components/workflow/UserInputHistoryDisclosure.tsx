"use client";

import React, { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { ToolCallContent, ToolResultMessage } from "@/lib/types";
import type { UserInputAnswers, UserInputQuestion } from "@/lib/user-input";
import { AliIcon } from "../AliIcon";
import { DisclosureChevron } from "../ChatDisclosure";
import styles from "./Workflow.module.css";

export interface UserInputHistoryDisclosureProps {
  block: ToolCallContent;
  result?: ToolResultMessage;
  pending: boolean;
}

function extractQuestions(input: Record<string, unknown>): Array<{ id: string; question: string; header?: string }> {
  const raw = input.questions;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Partial<UserInputQuestion>;
    const id = typeof candidate.id === "string" ? candidate.id : `q_${index}`;
    const question = typeof candidate.question === "string" ? candidate.question : "";
    if (!question) return [];
    return [{ id, question, ...(typeof candidate.header === "string" ? { header: candidate.header } : {}) }];
  });
}

function extractAnswers(result?: ToolResultMessage): UserInputAnswers | null {
  if (!result?.details || typeof result.details !== "object") return null;
  const answers = (result.details as { answers?: unknown }).answers;
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return null;
  return answers as UserInputAnswers;
}

/**
 * Codex-aligned transcript disclosure for `piora_request_user_input`:
 * displays "Asking question(s)…" while pending and collapses into
 * "Asked N question(s)" with expandable Q&A pairs once settled.
 */
export function UserInputHistoryDisclosure({
  block,
  result,
  pending,
}: UserInputHistoryDisclosureProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);

  const questions = extractQuestions(block.input);
  const answers = extractAnswers(result);
  const count = questions.length;

  const summaryLabel = pending
    ? t("userInput.askingQuestions")
    : count === 1
      ? t("userInput.askedOne")
      : t("userInput.askedCount", { count });

  return (
    <div className={styles.qaDisclosure} data-testid="user-input-history-disclosure">
      <button
        type="button"
        className={styles.qaTrigger}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <DisclosureChevron />
        <AliIcon name="question" size={13} />
        <span>{summaryLabel}</span>
      </button>

      {expanded && questions.length > 0 && (
        <div className={styles.qaList}>
          {questions.map((item) => {
            const answerList = answers?.[item.id]?.filter((value) => value.trim().length > 0) ?? [];
            return (
              <div key={item.id} className={styles.qaItem}>
                <span className={styles.qaQuestion}>
                  {item.header ? `${item.header}: ` : ""}{item.question}
                </span>
                {answerList.length > 0 ? (
                  <span className={styles.qaAnswer}>{answerList.join(", ")}</span>
                ) : (
                  <span className={styles.qaNoAnswer}>{t("userInput.noAnswerProvided")}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

"use client";

import React, { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { ToolCallContent, ToolResultMessage } from "@/lib/types";
import { AliIcon } from "../AliIcon";
import { DisclosureChevron } from "../ChatDisclosure";
import { MarkdownBody } from "../MarkdownBody";
import { dispatchOpenWorkflowPanel } from "./workflow-events";
import styles from "./Workflow.module.css";

export interface ProposedPlanCardProps {
  block: ToolCallContent;
  result?: ToolResultMessage;
  pending: boolean;
  cwd?: string;
  sessionId?: string;
}

/**
 * Codex-aligned transcript card for `piora_submit_plan`.
 * Stays collapsed while plan arguments are still streaming, auto-expands once
 * saved, and lets the user open the editable PLAN.md in the Right Panel.
 */
export function ProposedPlanCard({
  block,
  result,
  pending,
  cwd,
  sessionId,
}: ProposedPlanCardProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(!pending);
  const [userToggled, setUserToggled] = useState(false);

  useEffect(() => {
    if (!pending && !userToggled) {
      setExpanded(true);
    }
  }, [pending, userToggled]);

  const title = typeof block.input.title === "string" && block.input.title.trim()
    ? block.input.title.trim()
    : t(pending ? "workflow.plan.draftingTitle" : "workflow.plan.proposedTitle");
  const markdown = typeof block.input.markdown === "string" ? block.input.markdown : "";
  const detailsWorkflow = (result?.details as { workflow?: { current?: { id?: string; version?: number; planEditedByUser?: boolean } } } | undefined)?.workflow;
  const runId = detailsWorkflow?.current?.id;
  const version = detailsWorkflow?.current?.version;

  return (
    <section
      className={styles.proposedPlanCard}
      data-testid="proposed-plan-card"
      data-pending={pending ? "true" : undefined}
    >
      <div className={styles.proposedPlanHeader}>
        <button
          type="button"
          className={styles.proposedPlanToggle}
          aria-expanded={expanded}
          onClick={() => {
            setUserToggled(true);
            setExpanded((value) => !value);
          }}
        >
          <DisclosureChevron />
          <AliIcon name="list-check" size={14} style={{ color: "var(--accent)", flexShrink: 0 }} />
          <span className={styles.proposedPlanTitle}>{title}</span>
          {version ? (
            <span className={styles.proposedPlanMeta}>{t("workflow.version", { version })}</span>
          ) : null}
        </button>
        {!pending && sessionId && (
          <button
            type="button"
            className={styles.btnGhost}
            data-testid="proposed-plan-open-editor"
            onClick={() => dispatchOpenWorkflowPanel({ tab: "plan", sessionId, runId })}
          >
            <AliIcon name="external-link" size={13} />
            <span>{t("workflow.plan.openInEditor")}</span>
          </button>
        )}
      </div>

      {expanded && markdown && (
        <div className={styles.proposedPlanBody}>
          <MarkdownBody cwd={cwd}>{markdown}</MarkdownBody>
        </div>
      )}
    </section>
  );
}

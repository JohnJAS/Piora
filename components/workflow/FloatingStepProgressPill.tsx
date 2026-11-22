"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { PromptFileChanges } from "@/lib/prompt-file-changes";
import { pollVisibleDocument } from "@/lib/visible-poller";
import type { WorkflowTodoStep } from "@/lib/workflow-types";
import { AliIcon } from "../AliIcon";
import styles from "./Workflow.module.css";

export interface FloatingStepProgressPillProps {
  steps: WorkflowTodoStep[];
  sessionId?: string | null;
  running?: boolean;
  onOpenChanges?: () => void;
}

const DONUT_RADIUS = 6;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;

export function FloatingStepProgressPill({
  steps,
  sessionId,
  running = false,
  onOpenChanges,
}: FloatingStepProgressPillProps) {
  const { t } = useI18n();
  const popoverId = useId();
  const anchorRef = useRef<HTMLDivElement>(null);
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [changedFileCount, setChangedFileCount] = useState(0);

  const open = pinnedOpen || hovered;

  useEffect(() => {
    if (!sessionId || steps.length === 0) {
      setChangedFileCount(0);
      return;
    }
    let cancelled = false;
    const load = async (signal: AbortSignal) => {
      try {
        const res = await fetch(`/api/agent/${encodeURIComponent(sessionId)}/changes`, { cache: "no-store", signal });
        if (!res.ok) return;
        const data = await res.json() as PromptFileChanges | null;
        if (!cancelled && !signal.aborted) {
          setChangedFileCount(data?.files?.length ?? 0);
        }
      } catch {
        // Keep last observed count.
      }
    };
    const controller = new AbortController();
    const poller = running ? pollVisibleDocument(load, 3_000) : null;
    if (!poller) void load(controller.signal);
    return () => {
      cancelled = true;
      controller.abort();
      poller?.stop();
    };
  }, [sessionId, running, steps.length]);

  useEffect(() => {
    if (!pinnedOpen) return;
    const onOutside = (event: PointerEvent) => {
      if (!anchorRef.current?.contains(event.target as Node)) setPinnedOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPinnedOpen(false);
    };
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onOutside, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [pinnedOpen]);

  if (!steps.length) return null;

  const total = steps.length;
  const completedCount = steps.filter((step) => step.status === "completed").length;
  const inProgressIndex = steps.findIndex((step) => step.status === "in_progress");
  const allDone = completedCount === total;
  const activeStep = inProgressIndex >= 0
    ? steps[inProgressIndex]
    : steps.find((step) => step.status === "pending") ?? steps[total - 1];
  const currentNumber = inProgressIndex >= 0
    ? inProgressIndex + 1
    : allDone
      ? total
      : Math.min(completedCount + 1, total);

  const progressRatio = total > 0 ? completedCount / total : 0;
  const dashOffset = DONUT_CIRCUMFERENCE * (1 - progressRatio);

  return (
    <div
      ref={anchorRef}
      className={styles.stepPillAnchor}
      data-testid="floating-step-progress-pill"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {open && (
        <div
          id={popoverId}
          role="region"
          aria-label={t("workflow.steps.popoverTitle")}
          className={styles.stepPopover}
          data-testid="step-progress-popover"
        >
          <div className={styles.stepPopoverHeader}>
            <span>{t("workflow.steps.popoverTitle")}</span>
            <span className={styles.stepPillCount}>{completedCount} / {total}</span>
          </div>
          <ol className={styles.stepPopoverList}>
            {steps.map((step) => (
              <li key={step.id} className={styles.stepPopoverItem} data-status={step.status}>
                <span className={styles.stepStatusGlyph} aria-hidden="true">
                  {step.status === "completed" ? (
                    <span className={styles.stepCheckCompleted}><AliIcon name="check-circle" size={13} /></span>
                  ) : step.status === "in_progress" ? (
                    <span className={styles.stepSpinner} />
                  ) : (
                    <span className={styles.stepCirclePending} />
                  )}
                </span>
                <span>{step.label}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className={styles.stepPill}>
        <button
          type="button"
          className={styles.stepPillTrigger}
          aria-expanded={open}
          aria-controls={open ? popoverId : undefined}
          onClick={() => setPinnedOpen((value) => !value)}
        >
          <svg className={styles.stepDonut} viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r={DONUT_RADIUS} strokeWidth="2" className={styles.stepDonutTrack} />
            <circle
              cx="8"
              cy="8"
              r={DONUT_RADIUS}
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={DONUT_CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
              className={styles.stepDonutFill}
            />
          </svg>
          <span className={styles.stepPillCount}>
            {allDone
              ? t("workflow.steps.allDone", { total })
              : t("workflow.steps.label", { current: currentNumber, total })}
          </span>
          {activeStep && !allDone && (
            <span className={styles.stepPillCurrent}>{activeStep.label}</span>
          )}
        </button>

        {changedFileCount > 0 && (
          <>
            <span className={styles.stepPillDivider} aria-hidden="true">·</span>
            <button
              type="button"
              className={styles.stepPillFilesBtn}
              data-testid="step-progress-files-changed"
              onClick={onOpenChanges}
              disabled={!onOpenChanges}
            >
              <span>
                {changedFileCount === 1
                  ? t("workflow.steps.oneFileChanged")
                  : t("workflow.steps.filesChanged", { count: changedFileCount })}
              </span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

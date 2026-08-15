"use client";

import { useState } from "react";
import type { GoalRunState, GoalRunStatus } from "@/lib/goal-run-registry";
import { useI18n } from "@/hooks/useI18n";
import styles from "./GoalPanel.module.css";

const STATUS_KEYS: Record<GoalRunStatus, string> = {
  active: "goal.status.active",
  paused: "goal.status.paused",
  waiting_user: "goal.status.waitingUser",
  blocked: "goal.status.blocked",
  complete: "goal.status.complete",
  cancelled: "goal.status.cancelled",
};

export function GoalStatusBadge({ status }: { status: GoalRunStatus }) {
  const { t } = useI18n();
  return <span className={`${styles.badge} ${styles[status]}`}>{t(STATUS_KEYS[status])}</span>;
}

export function GoalPanel({
  goal,
  busy,
  onPause,
  onResume,
  onCancel,
}: {
  goal: GoalRunState;
  busy: boolean;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const canPause = goal.status === "active";
  const canResume = goal.status === "paused" || goal.status === "waiting_user" || goal.status === "blocked";
  const canCancel = goal.status !== "complete" && goal.status !== "cancelled";

  return (
    <section className={styles.panel} aria-label={t("goal.panelLabel")}>
      <button
        type="button"
        className={styles.summary}
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className={styles.target} aria-hidden="true" />
        <span className={styles.objective}>{goal.objective}</span>
        <GoalStatusBadge status={goal.status} />
        <span className={styles.counts}>
          {t("goal.iterationShort", { count: goal.iteration })}
          <span aria-hidden="true"> · </span>
          {t("goal.evidenceShort", { count: goal.evidence.length })}
        </span>
        <span className={`${styles.chevron} ${expanded ? styles.expanded : ""}`} aria-hidden="true">›</span>
      </button>

      {expanded ? (
        <div className={styles.details}>
          <DetailList title={t("goal.successCriteria")} items={goal.successCriteria} />
          {goal.constraints.length > 0 ? <DetailList title={t("goal.constraints")} items={goal.constraints} /> : null}
          {goal.reason ? <DetailText title={t("goal.reason")} text={goal.reason} /> : null}
          {goal.summary ? <DetailText title={t("goal.summary")} text={goal.summary} /> : null}
          {goal.checkpoints.length > 0 ? (
            <DetailList
              title={t("goal.checkpoints")}
              items={goal.checkpoints.slice(-5).map((item) => item.message)}
            />
          ) : null}
          {goal.evidence.length > 0 ? (
            <DetailList
              title={t("goal.evidence")}
              items={goal.evidence.slice(-5).map((item) => item.summary)}
            />
          ) : null}
          {(canPause || canResume || canCancel) ? (
            <div className={styles.actions}>
              {canPause ? <button type="button" onClick={onPause}>{t("goal.pause")}</button> : null}
              {canResume ? <button type="button" onClick={onResume} disabled={busy}>{t("goal.resume")}</button> : null}
              {canCancel ? <button type="button" className={styles.danger} onClick={onCancel}>{t("goal.cancel")}</button> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function DetailList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className={styles.detailBlock}>
      <h3>{title}</h3>
      <ul>{items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
    </div>
  );
}

function DetailText({ title, text }: { title: string; text: string }) {
  return (
    <div className={styles.detailBlock}>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

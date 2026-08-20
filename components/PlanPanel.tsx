"use client";

import { useState } from "react";

import { useI18n } from "@/hooks/useI18n";
import type {
  PlanArtifactState,
  PlanDraftInput,
} from "@/lib/plan-artifact-registry";
import styles from "./PlanPanel.module.css";

const STATUS_KEYS = {
  draft: "plan.status.draft",
  approved: "plan.status.approved",
  cancelled: "plan.status.cancelled",
  running: "plan.execution.running",
  verifying: "plan.execution.verifying",
  waiting_user: "plan.execution.waitingUser",
  blocked: "plan.execution.blocked",
  completed: "plan.execution.completed",
  failed: "plan.execution.failed",
  interrupted: "plan.execution.interrupted",
} as const;

const STEP_STATUS_KEYS = {
  pending: "plan.stepStatus.pending",
  running: "plan.stepStatus.running",
  completed: "plan.stepStatus.completed",
  blocked: "plan.stepStatus.blocked",
  skipped: "plan.stepStatus.skipped",
} as const;

type EditableStep = PlanDraftInput["steps"][number];

export function PlanPanel({
  artifact,
  busy,
  onSave,
  onApprove,
  onCancel,
  onExecute,
}: {
  artifact: PlanArtifactState;
  busy: boolean;
  onSave: (plan: PlanDraftInput) => Promise<boolean>;
  onApprove: () => Promise<void>;
  onCancel: () => Promise<void>;
  onExecute: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [objective, setObjective] = useState(artifact.plan.objective);
  const [assumptions, setAssumptions] = useState(artifact.plan.assumptions.join("\n"));
  const [successCriteria, setSuccessCriteria] = useState(artifact.plan.successCriteria.join("\n"));
  const [steps, setSteps] = useState<EditableStep[]>(() => artifact.plan.steps.map((step) => ({
    id: step.id,
    title: step.title,
    description: step.description,
    dependsOn: [...step.dependsOn],
  })));
  const displayStatus = artifact.execution?.status ?? artifact.status;

  const resetEditor = () => {
    setObjective(artifact.plan.objective);
    setAssumptions(artifact.plan.assumptions.join("\n"));
    setSuccessCriteria(artifact.plan.successCriteria.join("\n"));
    setSteps(artifact.plan.steps.map((step) => ({
      id: step.id,
      title: step.title,
      description: step.description,
      dependsOn: [...step.dependsOn],
    })));
  };

  const save = async () => {
    setSaving(true);
    const saved = await onSave({
      objective,
      assumptions: assumptions.split("\n").map((item) => item.trim()).filter(Boolean),
      successCriteria: successCriteria.split("\n").map((item) => item.trim()).filter(Boolean),
      steps,
    });
    setSaving(false);
    if (saved) setEditing(false);
  };

  return (
    <section className={styles.panel} aria-label={t("plan.panelLabel")}>
      <button
        type="button"
        className={styles.summary}
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className={styles.icon} aria-hidden="true">≡</span>
        <span className={styles.objective}>{artifact.plan.objective}</span>
        <span className={`${styles.badge} ${styles[displayStatus]}`}>{t(STATUS_KEYS[displayStatus])}</span>
        <span className={styles.counts}>{t("plan.stepsShort", { count: artifact.plan.steps.length })}</span>
        <span className={`${styles.chevron} ${expanded ? styles.expanded : ""}`} aria-hidden="true">›</span>
      </button>

      {expanded ? (
        <div className={styles.details}>
          {editing ? (
            <div className={styles.editor}>
              <EditorField label={t("plan.objective")} value={objective} onChange={setObjective} />
              <EditorField label={t("plan.assumptions")} value={assumptions} onChange={setAssumptions} rows={3} hint={t("plan.onePerLine")} />
              <EditorField label={t("plan.successCriteria")} value={successCriteria} onChange={setSuccessCriteria} rows={4} hint={t("plan.onePerLine")} />
              <div className={styles.editorSteps}>
                <h3>{t("plan.steps")}</h3>
                {steps.map((step, index) => (
                  <div className={styles.stepEditor} key={step.id}>
                    <span className={styles.stepId}>{step.id}</span>
                    <input
                      aria-label={t("plan.stepTitle", { count: index + 1 })}
                      value={step.title}
                      onChange={(event) => setSteps((current) => current.map((item, itemIndex) => (
                        itemIndex === index ? { ...item, title: event.target.value } : item
                      )))}
                    />
                    <textarea
                      aria-label={t("plan.stepDescription", { count: index + 1 })}
                      value={step.description ?? ""}
                      rows={2}
                      onChange={(event) => setSteps((current) => current.map((item, itemIndex) => (
                        itemIndex === index ? { ...item, description: event.target.value } : item
                      )))}
                    />
                    {step.dependsOn?.length ? (
                      <span className={styles.dependencies}>{t("plan.dependsOn", { ids: step.dependsOn.join(", ") })}</span>
                    ) : null}
                  </div>
                ))}
              </div>
              <div className={styles.actions}>
                <button type="button" onClick={() => { void save(); }} disabled={saving || busy}>{saving ? t("plan.saving") : t("plan.save")}</button>
                <button type="button" onClick={() => { resetEditor(); setEditing(false); }} disabled={saving}>{t("plan.discard")}</button>
              </div>
            </div>
          ) : (
            <>
              {artifact.plan.assumptions.length > 0 ? <DetailList title={t("plan.assumptions")} items={artifact.plan.assumptions} /> : null}
              <SuccessCriteriaList artifact={artifact} />
              <div className={styles.planSteps}>
                <h3>{t("plan.steps")}</h3>
                <ol>
                  {artifact.plan.steps.map((step) => (
                    <li key={step.id} className={styles[step.status]}>
                      <div>
                        <span className={styles.stepState} aria-label={t(STEP_STATUS_KEYS[step.status])} />
                        <span className={styles.stepId}>{step.id}</span>
                        <strong>{step.title}</strong>
                      </div>
                      {step.description ? <p>{step.description}</p> : null}
                      {step.dependsOn.length ? <small>{t("plan.dependsOn", { ids: step.dependsOn.join(", ") })}</small> : null}
                      {step.result ? <small className={styles.stepResult}>{t("plan.stepResult", { result: step.result })}</small> : null}
                      {step.reason ? <small className={styles.stepReason}>{t("plan.stepReason", { reason: step.reason })}</small> : null}
                      {artifact.execution?.evidence.filter((item) => item.stepId === step.id).map((item) => (
                        <small className={styles.stepEvidence} key={item.id}><SourceBadge source={item.source} />{t("plan.stepEvidence", { summary: item.summary })}</small>
                      ))}
                      {artifact.execution?.artifacts.filter((item) => item.stepId === step.id).map((item) => (
                        <small className={styles.stepArtifact} key={item.id}><SourceBadge source={item.source} />{t("plan.stepArtifact", { name: item.name })}</small>
                      ))}
                    </li>
                  ))}
                </ol>
              </div>
              {artifact.status === "draft" ? (
                <div className={styles.actions}>
                  <button type="button" onClick={() => { resetEditor(); setEditing(true); }} disabled={busy}>{t("plan.edit")}</button>
                  <button type="button" className={styles.primary} onClick={() => { void onApprove(); }} disabled={busy}>{t("plan.approve")}</button>
                  <button type="button" className={styles.danger} onClick={() => { void onCancel(); }} disabled={busy}>{t("plan.cancel")}</button>
                </div>
              ) : null}
              {artifact.status === "approved" && !artifact.execution ? (
                <div className={styles.executionReady}>
                  <p className={styles.ready}>{t("plan.readyForExecution")}</p>
                  <button type="button" className={styles.execute} onClick={() => { void onExecute(); }} disabled={busy}>{t("plan.execute")}</button>
                </div>
              ) : null}
              {artifact.execution ? (
                <div className={styles.executionSummary}>
                  <strong>{t(STATUS_KEYS[artifact.execution.status])}</strong>
                  <span>{t("plan.executionAttempt", { count: artifact.execution.attempt })}</span>
                  {artifact.execution.progress ? <p>{artifact.execution.progress}</p> : null}
                  <span className={styles.executionCount}>{t("plan.evidenceCount", { count: artifact.execution.evidence.length })}</span>
                  <span className={styles.executionCount}>{t("plan.artifactCount", { count: artifact.execution.artifacts.length })}</span>
                  <span className={styles.executionCount}>{t("plan.runtimeEvidenceCount", { count: artifact.execution.evidence.filter((item) => item.source === "runtime").length })}</span>
                  {artifact.execution.changeSummary ? <p><strong>{t("plan.changeSummary")}: </strong>{artifact.execution.changeSummary}</p> : null}
                  {artifact.execution.summary ? <p>{artifact.execution.summary}</p> : null}
                  {artifact.execution.reason ? <p className={styles.stepReason}>{artifact.execution.reason}</p> : null}
                  {artifact.execution.evidence.filter((item) => !item.stepId).length > 0 ? (
                    <ul className={styles.executionRecords}>
                      {artifact.execution.evidence.filter((item) => !item.stepId).map((item) => <li key={item.id}><SourceBadge source={item.source} />{item.summary}</li>)}
                    </ul>
                  ) : null}
                  {artifact.execution.artifacts.filter((item) => !item.stepId).length > 0 ? (
                    <ul className={styles.executionRecords}>
                      {artifact.execution.artifacts.filter((item) => !item.stepId).map((item) => <li key={item.id}><SourceBadge source={item.source} />{item.name}</li>)}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

function SourceBadge({ source }: { source: "model" | "runtime" }) {
  const { t } = useI18n();
  return <span className={`${styles.sourceBadge} ${source === "runtime" ? styles.runtimeSource : styles.modelSource}`}>{t(source === "runtime" ? "plan.source.runtime" : "plan.source.model")}</span>;
}

function DetailList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className={styles.detailBlock}>
      <h3>{title}</h3>
      <ul>{items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
    </div>
  );
}

function SuccessCriteriaList({ artifact }: { artifact: PlanArtifactState }) {
  const { t } = useI18n();
  const hasRuntimeVerification = artifact.execution?.evidence.some((item) => item.source === "runtime" && item.kind === "verification") ?? false;
  const covered = new Set(
    hasRuntimeVerification ? artifact.execution?.evidence
      .filter((item) => item.kind === "verification")
      .flatMap((item) => item.successCriterionIndices) ?? [] : [],
  );
  return (
    <div className={styles.detailBlock}>
      <h3>{t("plan.successCriteria")}</h3>
      <ul className={styles.criteriaList}>
        {artifact.plan.successCriteria.map((item, index) => (
          <li key={`${index}-${item}`} className={covered.has(index) ? styles.covered : undefined}>
            <span className={styles.criterionState} aria-label={covered.has(index) ? t("plan.criterionCovered") : t("plan.criterionPending")} />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EditorField({
  label,
  value,
  onChange,
  rows = 2,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  hint?: string;
}) {
  return (
    <label className={styles.field}>
      <span>{label}{hint ? <small>{hint}</small> : null}</span>
      <textarea value={value} rows={rows} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

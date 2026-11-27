"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { AliIcon } from "../AliIcon";
import styles from "./SettingsPrimitives.module.css";

export function SettingsPage({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div className={styles.pageHeaderCopy}>
          <h2>{title}</h2>
        </div>
        {actions ? <div className={styles.pageHeaderActions}>{actions}</div> : null}
      </header>
      <div className={styles.pageStack}>{children}</div>
    </div>
  );
}

export function SettingsSection({
  title,
  actions,
  settingsId,
  children,
}: {
  title?: string;
  actions?: ReactNode;
  settingsId?: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.section} data-settings-id={settingsId}>
      {title || actions ? (
        <div className={styles.sectionHeader}>
          {title ? <h3 className={styles.sectionTitle}>{title}</h3> : <span />}
          {actions ? <div className={styles.sectionActions}>{actions}</div> : null}
        </div>
      ) : null}
      <div className={styles.sectionCard}>{children}</div>
    </section>
  );
}

export function SettingsRow({
  title,
  description,
  badge,
  settingsId,
  titleId,
  descriptionId,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  badge?: ReactNode;
  settingsId?: string;
  titleId?: string;
  descriptionId?: string;
  children?: ReactNode;
}) {
  return (
    <div className={styles.row} data-settings-id={settingsId}>
      <div className={styles.rowCopy}>
        <div className={styles.rowTitleLine}>
          <span id={titleId} className={styles.rowTitle}>{title}</span>
          {badge ? <span className={styles.rowBadge}>{badge}</span> : null}
        </div>
        {description ? (
          <div id={descriptionId} className={styles.rowDescription}>{description}</div>
        ) : null}
      </div>
      {children !== undefined ? <div className={styles.rowControl}>{children}</div> : null}
    </div>
  );
}

export function SettingsSwitch({
  checked,
  disabled,
  label,
  describedBy,
  busy,
  testId,
  onToggle,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  describedBy?: string;
  busy?: boolean;
  testId?: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      className={styles.switch}
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      aria-busy={busy}
      data-testid={testId}
      disabled={disabled}
      onClick={onToggle}
    >
      <span aria-hidden="true" />
    </button>
  );
}

export function SettingsSegmented<T extends string>({
  value,
  options,
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  disabled,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  disabled?: boolean;
  onChange: (next: T) => void;
}) {
  return (
    <div
      className={styles.segmented}
      role="group"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={styles.segmentedButton}
          aria-pressed={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsDisclosure({
  summary,
  meta,
  settingsId,
  defaultOpen = false,
  children,
}: {
  summary: ReactNode;
  meta?: ReactNode;
  settingsId?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className={styles.disclosure} data-settings-id={settingsId} open={defaultOpen || undefined}>
      <summary className={styles.disclosureSummary}>
        <span className={styles.disclosureLabel}>{summary}</span>
        <span className={styles.disclosureRight}>
          {meta ? <span className={styles.disclosureMeta}>{meta}</span> : null}
          <AliIcon name="chevron-right" size={14} className={styles.disclosureChevron} />
        </span>
      </summary>
      <div className={styles.disclosureBody}>{children}</div>
    </details>
  );
}

export function SettingsModal({
  open,
  title,
  description,
  closeLabel,
  onClose,
  footer,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  closeLabel: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const modalRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(modalRef, open, { onEscape: onClose });

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={styles.modalBackdrop}
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        className={styles.modalCard}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className={styles.modalHeader}>
          <div className={styles.modalHeaderCopy}>
            <h3 id={titleId}>{title}</h3>
            {description ? <p>{description}</p> : null}
          </div>
          <button
            type="button"
            className={styles.modalClose}
            aria-label={closeLabel}
            title={closeLabel}
            onClick={onClose}
          >
            <AliIcon name="close" size={15} />
          </button>
        </header>
        <div className={styles.modalBody}>{children}</div>
        {footer ? <footer className={styles.modalFooter}>{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}

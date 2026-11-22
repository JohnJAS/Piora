"use client";

import { useState, useEffect } from "react";
import { useI18n } from "@/hooks/useI18n";
import { AliIcon } from "../AliIcon";
import styles from "../ModelsConfig.module.css";

export function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={styles.field} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", fontWeight: 500 }}>{label}</label>
      {children}
    </div>
  );
}

export const inputStyle = {
  padding: "6px 9px",
  background: "var(--bg-panel)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-control)",
  color: "var(--text)",
  fontSize: "var(--text-sm)",
  outline: "none",
  width: "100%",
  boxSizing: "border-box" as const,
};

export function TextInput({ value, onChange, placeholder, mono, invalid = false }: { value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean; invalid?: boolean }) {
  return <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
    aria-invalid={invalid || undefined}
    style={{ ...inputStyle, borderColor: invalid ? "color-mix(in srgb, #ef4444 58%, var(--border))" : "var(--border)", fontFamily: mono ? "var(--font-mono)" : "inherit" }} />;
}

export function SecretTextInput({
  value,
  onChange,
  placeholder,
  mono,
  onKeyDown,
  autoComplete = "off",
  spellCheck = false,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  autoComplete?: string;
  spellCheck?: boolean;
  style?: React.CSSProperties;
}) {
  const [visible, setVisible] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    if (!value) setVisible(false);
  }, [value]);

  return (
    <div style={{ position: "relative", width: "100%", ...style }}>
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        style={{ ...inputStyle, paddingRight: 34, fontFamily: mono ? "var(--font-mono)" : "inherit" }}
        autoComplete={autoComplete}
        spellCheck={spellCheck}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? t("i18n.hideDetails") : t("i18n.showDetails")}
        title={visible ? t("i18n.hideDetails") : t("i18n.showDetails")}
        style={{
          position: "absolute",
          right: 5,
          top: "50%",
          transform: "translateY(-50%)",
          width: 24,
          height: 24,
          padding: 0,
          border: "none",
          background: "transparent",
          color: "var(--text-dim)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {visible ? (
          <AliIcon name="eye-close" size={15} />
        ) : (
          <AliIcon name="eye" size={15} />
        )}
      </button>
    </div>
  );
}

export function NumInput({ value, onChange, placeholder, invalid = false }: { value: string; onChange: (v: string) => void; placeholder?: string; invalid?: boolean }) {
  return <input type="number" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-invalid={invalid || undefined}
    style={{ ...inputStyle, borderColor: invalid ? "color-mix(in srgb, #ef4444 58%, var(--border))" : "var(--border)" }} />;
}

export function Select({ value, onChange, options, required }: { value: string; onChange: (v: string) => void; options: readonly string[]; required?: boolean }) {
  const { t } = useI18n();
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      style={{ ...inputStyle, color: value ? "var(--text)" : "var(--text-dim)" }}>
      {!required && <option value="">— {t("models.form.inherit")} —</option>}
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        style={{ width: 13, height: 13, accentColor: "var(--accent)", cursor: "pointer" }} />
      {label}
    </label>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>{children}</div>;
}

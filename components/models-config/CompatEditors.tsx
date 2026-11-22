"use client";

import { useI18n } from "@/hooks/useI18n";
import { Check, Field, Select } from "./FormFields";
import type { ModelEntry } from "./types";

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type ThinkingLevel = typeof THINKING_LEVELS[number];
const THINKING_LABELS = {
  off: "chat.thinkingLevelOff",
  minimal: "chat.thinkingLevelMinimal",
  low: "chat.thinkingLevelLow",
  medium: "chat.thinkingLevelMedium",
  high: "chat.thinkingLevelHigh",
  xhigh: "chat.thinkingLevelXhigh",
  max: "chat.thinkingLevelMax",
} as const;

const LEVEL_COLORS: Record<ThinkingLevel, string> = {
  off:     "var(--text-dim)",
  minimal: "#6b7280",
  low:     "#60a5fa",
  medium:  "#a78bfa",
  high:    "#f472b6",
  xhigh:   "#fb923c",
  max:     "#ef4444",
};

export function ThinkingLevelMapEditor({
  value,
  onChange,
}: {
  value: Record<string, string | null> | undefined;
  onChange: (v: Record<string, string | null> | undefined) => void;
}) {
  const { t } = useI18n();
  const map = value ?? {};

  const setLevel = (level: ThinkingLevel, entry: string | null | "omit") => {
    const next = { ...map };
    if (entry === "omit") {
      delete next[level];
    } else {
      next[level] = entry;
    }
    onChange(Object.keys(next).length ? next : undefined);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {THINKING_LEVELS.map((level) => {
        const raw = map[level];
        const state: "omit" | "null" | "string" =
          !(level in map) ? "omit" : raw === null ? "null" : "string";
        const strVal = typeof raw === "string" ? raw : "";
        const color = LEVEL_COLORS[level];

        const btnBase: React.CSSProperties = {
          padding: "4px 10px",
          fontSize: "var(--text-xs)",
          border: "none",
          cursor: "pointer",
          fontWeight: 400,
          transition: "background 0.1s, color 0.1s",
          whiteSpace: "nowrap",
          background: "var(--bg-panel)",
          color: "var(--text-dim)",
        };
        const btnActive: React.CSSProperties = {
          background: "var(--accent)",
          color: "#fff",
          fontWeight: 600,
        };
        const btnActiveDisabled: React.CSSProperties = {
          background: "#ef4444",
          color: "#fff",
          fontWeight: 600,
        };

        return (
          <div
            key={level}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "5px 4px",
              borderRadius: "var(--radius-control)",
              background: "transparent",
              border: "1px solid transparent",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 5, width: 68, flexShrink: 0 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0, opacity: state === "null" ? 0.3 : 1 }} />
              <span style={{
                fontSize: "var(--text-xs)",
                fontFamily: "var(--font-mono)",
                color: state === "null" ? "var(--text-dim)" : "var(--text-muted)",
                textDecoration: state === "null" ? "line-through" : "none",
              }}>
                {t(THINKING_LABELS[level])}
              </span>
            </div>

            <div style={{ display: "flex", borderRadius: "var(--radius-control)", border: "1px solid var(--border)", overflow: "hidden", flexShrink: 0 }}>
              <button
                onClick={() => setLevel(level, "omit")}
                style={{ ...btnBase, ...(state === "omit" ? btnActive : {}) }}
              >
                {t("i18n.default")}
              </button>
              <button
                onClick={() => setLevel(level, null)}
                style={{ ...btnBase, borderLeft: "1px solid var(--border)", ...(state === "null" ? btnActiveDisabled : {}) }}
              >
                {t("i18n.disabled")}
              </button>
            </div>

            <div style={{ display: "flex", borderRadius: "var(--radius-control)", border: `1px solid ${state === "string" ? "var(--accent)" : "var(--border)"}`, overflow: "hidden", transition: "border-color 0.1s" }}>
              <button
                onClick={() => setLevel(level, strVal || level)}
                style={{ ...btnBase, ...(state === "string" ? btnActive : {}), borderRight: "1px solid var(--border)", flexShrink: 0 }}
              >
                {t("i18n.custom")}
              </button>
              <input
                value={strVal}
                onChange={(e) => setLevel(level, e.target.value)}
                onFocus={() => { if (state !== "string") setLevel(level, strVal || level); }}
                placeholder={level}
                maxLength={10}
                style={{
                  width: "12ch",
                  background: state === "string" ? "var(--bg)" : "var(--bg-panel)",
                  border: "none",
                  outline: "none",
                  color: state === "string" ? "var(--text)" : "var(--text-dim)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--text-xs)",
                  padding: "4px 7px",
                  transition: "background 0.1s, color 0.1s",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

const DEEPSEEK_COMPAT = {
  thinkingFormat: "deepseek",
  requiresReasoningContentOnAssistantMessages: true,
} as const;

export function hasDeepseekCompat(model: ModelEntry): boolean {
  return model.compat?.thinkingFormat === "deepseek";
}

export function setDeepseekCompat(model: ModelEntry, enabled: boolean): ModelEntry {
  if (enabled) {
    return { ...model, compat: { ...(model.compat ?? {}), ...DEEPSEEK_COMPAT } };
  }
  if (!model.compat) return model;
  const rest = { ...model.compat };
  delete rest.thinkingFormat;
  delete rest.requiresReasoningContentOnAssistantMessages;
  return { ...model, compat: Object.keys(rest).length ? rest : undefined };
}

// Strict OpenAI-compatible servers (vLLM, llama.cpp, one-api gateways) often
// reject fields the auto-detected compat sends, and the compaction summarizer
// talks to the same endpoint — a rejected summary request means auto-compaction
// never persists. These overrides let users strip the problematic fields.
const COMPAT_TOGGLE_KEYS = ["supportsReasoningEffort", "supportsStore"] as const;
const MAX_TOKENS_FIELD_VALUES = ["max_tokens", "max_completion_tokens"] as const;

export function CompatOverridesEditor({ compat, inherited, onChange }: {
  compat?: Record<string, unknown>;
  /** Channel-level values the model falls back to when it sets no override. */
  inherited?: Record<string, unknown>;
  onChange: (compat: Record<string, unknown> | undefined) => void;
}) {
  const { t } = useI18n();
  const effective = (key: string) => compat?.[key] ?? inherited?.[key];
  // Setting a value equal to what the channel already provides clears the
  // per-model override, so later channel-level edits keep applying to it.
  const setOverride = (key: string, value: unknown) => {
    const next = { ...compat };
    if (value === undefined || (inherited && inherited[key] === value)) {
      delete next[key];
    } else {
      next[key] = value;
    }
    onChange(Object.keys(next).length ? next : undefined);
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
        {COMPAT_TOGGLE_KEYS.map((key) => {
          const checked = effective(key) !== false;
          return (
            <Check
              key={key}
              label={key === "supportsReasoningEffort" ? t("models.compatReasoningEffort") : t("models.compatStoreField")}
              checked={checked}
              onChange={(v) => setOverride(key, v === checked ? undefined : v)}
            />
          );
        })}
        <Field label={t("models.compatMaxTokensField")}>
          <Select
            value={typeof effective("maxTokensField") === "string" ? String(effective("maxTokensField")) : ""}
            onChange={(v) => setOverride("maxTokensField", v || undefined)}
            options={[...MAX_TOKENS_FIELD_VALUES]}
          />
        </Field>
      </div>
      <p style={{ margin: "6px 0 0", color: "var(--text-dim)", fontSize: "var(--text-xs)", lineHeight: 1.5 }}>
        {inherited ? t("models.compatModelHint") : t("models.compatProviderHint")}
      </p>
    </div>
  );
}

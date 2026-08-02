"use client";

import { useId } from "react";
import { useBackground } from "@/hooks/useBackground";
import { useI18n } from "@/hooks/useI18n";
import { useTheme, type Theme } from "@/hooks/useTheme";
import { getBackgroundPreset } from "@/lib/backgrounds";
import { AliIcon } from "./AliIcon";

interface AppearanceLook {
  id: string;
  theme: Theme;
  backgroundId: string;
  overlay: number;
  blur: number;
  previewOverlay: string;
  nameKey: string;
  descriptionKey: string;
}

const APPEARANCE_LOOKS: readonly AppearanceLook[] = [
  {
    id: "starlight",
    theme: "starlight",
    backgroundId: "aurora-glass",
    overlay: 72,
    blur: 0,
    previewOverlay: "rgba(248, 247, 255, 0.34)",
    nameKey: "appearance.look.starlight",
    descriptionKey: "appearance.look.starlightDescription",
  },
  {
    id: "ivory",
    theme: "ivory",
    backgroundId: "sage-paper",
    overlay: 28,
    blur: 0,
    previewOverlay: "rgba(251, 249, 240, 0.18)",
    nameKey: "appearance.look.ivory",
    descriptionKey: "appearance.look.ivoryDescription",
  },
  {
    id: "doodle",
    theme: "doodle",
    backgroundId: "playful-doodle",
    overlay: 30,
    blur: 0,
    previewOverlay: "rgba(255, 250, 240, 0.14)",
    nameKey: "appearance.look.doodle",
    descriptionKey: "appearance.look.doodleDescription",
  },
  {
    id: "fortune",
    theme: "fortune",
    backgroundId: "auspicious-cloud",
    overlay: 24,
    blur: 0,
    previewOverlay: "rgba(255, 249, 235, 0.12)",
    nameKey: "appearance.look.fortune",
    descriptionKey: "appearance.look.fortuneDescription",
  },
] as const;

export function AppearanceLooks() {
  const titleId = useId();
  const { t } = useI18n();
  const { theme, setThemeWithAction } = useTheme();
  const { preference, hydrated, busy, applyBuiltinPreset } = useBackground();

  return (
    <section aria-labelledby={titleId} style={{ paddingBottom: 16 }}>
      <div style={{ marginBottom: 9 }}>
        <h3 id={titleId} style={{ margin: 0, fontSize: "var(--font-sm)", fontWeight: 700 }}>
          {t("appearance.looks")}
        </h3>
        <p style={{ margin: "2px 0 0", color: "var(--text-dim)", fontSize: "var(--font-2xs)" }}>
          {t("appearance.looksHint")}
        </p>
      </div>
      <div
        role="radiogroup"
        aria-label={t("appearance.looks")}
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(148px, 1fr))", gap: 9 }}
      >
        {APPEARANCE_LOOKS.map((look) => {
          const background = getBackgroundPreset(look.backgroundId);
          const selected = theme === look.theme
            && preference.source === "builtin"
            && preference.presetId === look.backgroundId
            && preference.overlay === look.overlay
            && preference.blur === look.blur;
          const artwork = background
            ? `linear-gradient(${look.previewOverlay}, ${look.previewOverlay}), url("${background.asset}")`
            : undefined;

          return (
            <button
              key={look.id}
              type="button"
              role="radio"
              aria-checked={selected}
              data-appearance-look={look.id}
              disabled={!hydrated || busy}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setThemeWithAction(look.theme, () => {
                  applyBuiltinPreset(look.backgroundId, { overlay: look.overlay, blur: look.blur });
                }, {
                  x: rect.left + rect.width / 2,
                  y: rect.top + rect.height / 2,
                });
              }}
              style={{
                minWidth: 0,
                padding: 6,
                display: "grid",
                gap: 6,
                border: selected ? "1px solid var(--accent)" : "1px solid var(--border)",
                borderRadius: "var(--radius-control)",
                background: selected ? "var(--bg-selected)" : "var(--bg)",
                color: "var(--text)",
                cursor: !hydrated || busy ? "not-allowed" : "pointer",
                opacity: !hydrated || busy ? 0.62 : 1,
                textAlign: "left",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  position: "relative",
                  display: "block",
                  width: "100%",
                  aspectRatio: "16 / 7",
                  overflow: "hidden",
                  border: "1px solid color-mix(in srgb, var(--border) 78%, transparent)",
                  borderRadius: "calc(var(--radius-control) - 2px)",
                  backgroundColor: background?.appearance === "dark" ? "#172554" : "#fffaf0",
                  backgroundImage: artwork,
                  backgroundPosition: "center",
                  backgroundSize: "cover",
                }}
              >
                {selected && (
                  <span style={{ position: "absolute", right: 6, top: 6, width: 18, height: 18, display: "grid", placeItems: "center", borderRadius: "50%", background: "var(--accent)", color: "#fff" }}>
                    <AliIcon name="check" size={11} />
                  </span>
                )}
              </span>
              <span style={{ minWidth: 0, padding: "0 2px 2px" }}>
                <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "var(--font-xs)", fontWeight: 650 }}>
                  {t(look.nameKey)}
                </span>
                <span style={{ display: "block", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-dim)", fontSize: "var(--font-2xs)" }}>
                  {t(look.descriptionKey)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

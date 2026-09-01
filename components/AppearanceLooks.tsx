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
  backgroundId: string | null;
  overlay: number;
  blur: number;
  sidebarOverlay: number;
  filePanelOverlay: number;
  previewOverlay: string;
  previewBackground?: string;
  nameKey: string;
  descriptionKey: string;
}

const APPEARANCE_LOOKS: readonly AppearanceLook[] = [
  {
    id: "codex",
    theme: "dream",
    backgroundId: null,
    overlay: 58,
    blur: 0,
    sidebarOverlay: 36,
    filePanelOverlay: 42,
    previewOverlay: "transparent",
    previewBackground: "radial-gradient(circle at 72% 0%, rgba(136, 157, 146, 0.16), transparent 43%), linear-gradient(145deg, #111214, #17191c 55%, #101113)",
    nameKey: "appearance.look.codex",
    descriptionKey: "appearance.look.codexDescription",
  },
  {
    id: "starlight",
    theme: "starlight",
    backgroundId: "aurora-glass",
    overlay: 72,
    blur: 0,
    sidebarOverlay: 44,
    filePanelOverlay: 48,
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
    sidebarOverlay: 24,
    filePanelOverlay: 32,
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
    sidebarOverlay: 26,
    filePanelOverlay: 32,
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
    sidebarOverlay: 28,
    filePanelOverlay: 34,
    previewOverlay: "rgba(255, 249, 235, 0.12)",
    nameKey: "appearance.look.fortune",
    descriptionKey: "appearance.look.fortuneDescription",
  },
  {
    id: "nordic",
    theme: "nordic",
    backgroundId: "nordic-ice",
    overlay: 26,
    blur: 0,
    sidebarOverlay: 24,
    filePanelOverlay: 30,
    previewOverlay: "rgba(245, 249, 252, 0.18)",
    nameKey: "appearance.look.nordic",
    descriptionKey: "appearance.look.nordicDescription",
  },
  {
    id: "sakura",
    theme: "sakura",
    backgroundId: "sakura-mist",
    overlay: 24,
    blur: 0,
    sidebarOverlay: 26,
    filePanelOverlay: 32,
    previewOverlay: "rgba(255, 247, 250, 0.14)",
    nameKey: "appearance.look.sakura",
    descriptionKey: "appearance.look.sakuraDescription",
  },
  {
    id: "cyber",
    theme: "cyber",
    backgroundId: "cyber-teal",
    overlay: 58,
    blur: 0,
    sidebarOverlay: 44,
    filePanelOverlay: 50,
    previewOverlay: "rgba(7, 25, 28, 0.42)",
    nameKey: "appearance.look.cyber",
    descriptionKey: "appearance.look.cyberDescription",
  },
  {
    id: "ember",
    theme: "ember",
    backgroundId: "desert-sunset",
    overlay: 58,
    blur: 0,
    sidebarOverlay: 44,
    filePanelOverlay: 50,
    previewOverlay: "rgba(27, 17, 16, 0.42)",
    nameKey: "appearance.look.ember",
    descriptionKey: "appearance.look.emberDescription",
  },
  {
    id: "surreal",
    theme: "midnight",
    backgroundId: "surreal-stillness",
    overlay: 56,
    blur: 0,
    sidebarOverlay: 42,
    filePanelOverlay: 48,
    previewOverlay: "rgba(11, 16, 32, 0.38)",
    nameKey: "appearance.look.surreal",
    descriptionKey: "appearance.look.surrealDescription",
  },
  {
    id: "riso",
    theme: "doodle",
    backgroundId: "riso-garden",
    overlay: 24,
    blur: 0,
    sidebarOverlay: 26,
    filePanelOverlay: 32,
    previewOverlay: "rgba(255, 250, 240, 0.12)",
    nameKey: "appearance.look.riso",
    descriptionKey: "appearance.look.risoDescription",
  },
  {
    id: "liquid-chrome",
    theme: "midnight",
    backgroundId: "liquid-chrome",
    overlay: 54,
    blur: 0,
    sidebarOverlay: 44,
    filePanelOverlay: 50,
    previewOverlay: "rgba(11, 16, 32, 0.38)",
    nameKey: "appearance.look.liquidChrome",
    descriptionKey: "appearance.look.liquidChromeDescription",
  },
  {
    id: "soft-clay",
    theme: "ivory",
    backgroundId: "soft-clay",
    overlay: 24,
    blur: 0,
    sidebarOverlay: 24,
    filePanelOverlay: 30,
    previewOverlay: "rgba(251, 249, 240, 0.14)",
    nameKey: "appearance.look.softClay",
    descriptionKey: "appearance.look.softClayDescription",
  },
  {
    id: "quantum",
    theme: "cyber",
    backgroundId: "quantum-circuit",
    overlay: 56,
    blur: 0,
    sidebarOverlay: 44,
    filePanelOverlay: 50,
    previewOverlay: "rgba(7, 25, 28, 0.4)",
    nameKey: "appearance.look.quantum",
    descriptionKey: "appearance.look.quantumDescription",
  },
  {
    id: "white-future",
    theme: "nordic",
    backgroundId: "white-future",
    overlay: 20,
    blur: 0,
    sidebarOverlay: 22,
    filePanelOverlay: 28,
    previewOverlay: "rgba(245, 249, 252, 0.12)",
    nameKey: "appearance.look.whiteFuture",
    descriptionKey: "appearance.look.whiteFutureDescription",
  },
  {
    id: "jade",
    theme: "doodle",
    backgroundId: "jade-ascension",
    overlay: 24,
    blur: 0,
    sidebarOverlay: 26,
    filePanelOverlay: 32,
    previewOverlay: "rgba(255, 250, 240, 0.12)",
    nameKey: "appearance.look.jade",
    descriptionKey: "appearance.look.jadeDescription",
  },
  {
    id: "crimson",
    theme: "ember",
    backgroundId: "crimson-sword",
    overlay: 56,
    blur: 0,
    sidebarOverlay: 44,
    filePanelOverlay: 50,
    previewOverlay: "rgba(27, 17, 16, 0.4)",
    nameKey: "appearance.look.crimson",
    descriptionKey: "appearance.look.crimsonDescription",
  },
  {
    id: "moonlit",
    theme: "midnight",
    backgroundId: "moonlit-beauty",
    overlay: 54,
    blur: 0,
    sidebarOverlay: 42,
    filePanelOverlay: 48,
    previewOverlay: "rgba(11, 16, 32, 0.36)",
    nameKey: "appearance.look.moonlit",
    descriptionKey: "appearance.look.moonlitDescription",
  },
  {
    id: "alpine",
    theme: "nordic",
    backgroundId: "alpine-mirror",
    overlay: 22,
    blur: 0,
    sidebarOverlay: 24,
    filePanelOverlay: 30,
    previewOverlay: "rgba(245, 249, 252, 0.14)",
    nameKey: "appearance.look.alpine",
    descriptionKey: "appearance.look.alpineDescription",
  },
] as const;

export function AppearanceLooks() {
  const titleId = useId();
  const { t } = useI18n();
  const { theme, setThemeWithAction } = useTheme();
  const { preference, hydrated, busy, applyBuiltinPreset, setNone } = useBackground();

  return (
    <section aria-labelledby={titleId} style={{ paddingBottom: 16 }}>
      <div style={{ marginBottom: 9 }}>
        <h3 id={titleId} style={{ margin: 0, fontSize: "var(--text-sm)", fontWeight: 700 }}>
          {t("appearance.looks")}
        </h3>
        <p style={{ margin: "2px 0 0", color: "var(--text-dim)", fontSize: "var(--text-xs)" }}>
          {t("appearance.looksHint")}
        </p>
      </div>
      <div
        role="radiogroup"
        aria-label={t("appearance.looks")}
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(148px, 1fr))", gap: 9 }}
      >
        {APPEARANCE_LOOKS.map((look) => {
          const background = look.backgroundId ? getBackgroundPreset(look.backgroundId) : undefined;
          const selected = theme === look.theme
            && (look.backgroundId
              ? preference.source === "builtin" && preference.presetId === look.backgroundId
              : preference.source === "none")
            && (!look.backgroundId
              || (preference.overlay === look.overlay
                && preference.blur === look.blur
                && preference.sidebarOverlay === look.sidebarOverlay
                && preference.filePanelOverlay === look.filePanelOverlay));
          const artwork = background
            ? `linear-gradient(${look.previewOverlay}, ${look.previewOverlay}), url("${background.asset}")`
            : look.previewBackground;

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
                  if (look.backgroundId) {
                    applyBuiltinPreset(look.backgroundId, {
                      overlay: look.overlay,
                      blur: look.blur,
                      sidebarOverlay: look.sidebarOverlay,
                      filePanelOverlay: look.filePanelOverlay,
                    });
                  } else {
                    setNone();
                  }
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
                <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "var(--text-xs)", fontWeight: 650 }}>
                  {t(look.nameKey)}
                </span>
                <span style={{ display: "block", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-dim)", fontSize: "var(--text-xs)" }}>
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

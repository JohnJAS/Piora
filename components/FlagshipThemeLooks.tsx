"use client";

import { useEffect, useId } from "react";
import { useAgentThemeMood } from "@/hooks/useAgentThemeMood";
import { useBackground } from "@/hooks/useBackground";
import { useFlagshipPerformanceBus } from "@/hooks/useFlagshipPerformanceBus";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import {
  setAgentMoodPreview,
  type AgentThemeMood,
} from "@/lib/appearance/agent-mood-store";
import {
  requestFlagshipPerformance,
  type FlagshipPerformanceId,
} from "@/lib/appearance/flagship-performance-bus";
import {
  FLAGSHIP_THEMES,
  isFlagshipTheme,
} from "@/lib/appearance/flagship-themes";
import styles from "./FlagshipThemeLooks.module.css";

const MOOD_PREVIEW_PILLS: readonly (AgentThemeMood | null)[] = [
  null,
  "idle",
  "waiting",
  "running",
  "review",
  "completed",
  "failed",
];

const PERFORMANCE_TRIGGERS: readonly FlagshipPerformanceId[] = [
  "celebrate",
  "salute",
];

export function FlagshipThemeLooks() {
  const titleId = useId();
  const { t } = useI18n();
  const { theme, setThemeWithAction } = useTheme();
  const { preference, hydrated, busy, applyBuiltinPreset } = useBackground();
  const moodSnapshot = useAgentThemeMood();
  const perfBus = useFlagshipPerformanceBus();

  const flagshipActive = isFlagshipTheme(theme)
    && preference.source === "builtin"
    && isFlagshipTheme(preference.presetId);
  const perfDisabled = !hydrated || busy || preference.motionEnabled === false || preference.performanceEnabled === false;

  useEffect(() => {
    if (!flagshipActive) setAgentMoodPreview(null);
  }, [flagshipActive]);

  useEffect(() => () => {
    setAgentMoodPreview(null);
  }, []);

  return (
    <section className={styles.section} aria-labelledby={titleId}>
      <div className={styles.heading}>
        <div>
          <div className={styles.titleRow}>
            <h3 id={titleId}>{t("appearance.flagship.title")}</h3>
            <span className={styles.badge}>{t("appearance.flagship.badge")}</span>
          </div>
          <p className={styles.hint}>{t("appearance.flagship.hint")}</p>
        </div>
      </div>

      <div className={styles.grid} role="group" aria-label={t("appearance.flagship.title")}>
        {FLAGSHIP_THEMES.map((look) => {
          const selected = theme === look.id
            && preference.source === "builtin"
            && preference.presetId === look.id
            && preference.overlay === look.overlay
            && preference.blur === look.blur
            && preference.sidebarOverlay === look.sidebarOverlay
            && preference.filePanelOverlay === look.filePanelOverlay;

          return (
            <button
              key={look.id}
              type="button"
              className={styles.card}
              aria-pressed={selected}
              data-appearance-look={look.id}
              disabled={!hydrated || busy}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setThemeWithAction(
                  look.id,
                  () => applyBuiltinPreset(look.id, {
                    overlay: look.overlay,
                    blur: look.blur,
                    sidebarOverlay: look.sidebarOverlay,
                    filePanelOverlay: look.filePanelOverlay,
                  }),
                  { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
                );
              }}
            >
              <span className={styles.artwork} style={{ backgroundColor: look.colors.bg }}>
                {/* Pre-encoded local WebP; avoid an optimizer server for desktop/offline assets. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={look.asset} alt="" loading="lazy" width={1672} height={941} />
                {selected ? <span className={styles.check} aria-hidden="true">✓</span> : null}
              </span>
              <span className={styles.caption}>
                <span>{t(`theme.${look.id}.name`)}</span>
                <small>{t(look.variant === "day" ? "appearance.flagship.day" : "appearance.flagship.night")}</small>
              </span>
              <span className={styles.colors} aria-hidden="true">
                {Object.values(look.colors).map((color, index) => (
                  <i key={index} style={{ backgroundColor: color }} />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      {flagshipActive ? (
        <div className={styles.moodBarWrap}>
          <div className={styles.previewRow}>
            <span className={styles.moodBarLabel}>{t("appearance.flagship.previewLabel")}</span>
            <div
              className={styles.moodBar}
              data-flagship-mood-preview
              role="group"
              aria-label={t("appearance.flagship.previewLabel")}
            >
              {MOOD_PREVIEW_PILLS.map((pill) => {
                const pressed = pill === null
                  ? moodSnapshot.previewMood === null
                  : moodSnapshot.previewMood === pill;
                const key = pill ?? "live";
                return (
                  <button
                    key={key}
                    type="button"
                    className={styles.moodPill}
                    aria-pressed={pressed}
                    data-mood-pill={key}
                    onClick={() => setAgentMoodPreview(pill)}
                  >
                    {t(`appearance.flagship.mood.${key}`)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className={styles.previewRow}>
            <span className={styles.moodBarLabel}>{t("appearance.flagship.performanceLabel")}</span>
            <div
              className={styles.moodBar}
              data-flagship-performance-controls
              role="group"
              aria-label={t("appearance.flagship.performanceLabel")}
            >
              {PERFORMANCE_TRIGGERS.map((clipId) => {
                const active = perfBus.phase !== "idle" && perfBus.activeClipId === clipId;
                return (
                  <button
                    key={clipId}
                    type="button"
                    className={styles.moodPill}
                    aria-pressed={active}
                    data-flagship-performance-trigger={clipId}
                    disabled={perfDisabled}
                    onClick={() => requestFlagshipPerformance(clipId)}
                  >
                    {active
                      ? t("appearance.flagship.performance.playing")
                      : t(`appearance.flagship.performance.${clipId}`)}
                  </button>
                );
              })}
              {perfBus.phase !== "idle" ? (
                <button
                  type="button"
                  className={styles.moodPill}
                  data-flagship-performance-trigger="stop"
                  onClick={() => requestFlagshipPerformance("stop")}
                >
                  {t("appearance.flagship.performance.stop")}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

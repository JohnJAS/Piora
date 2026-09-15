"use client";

import { useId } from "react";
import { useInterfaceTransparency } from "@/hooks/useInterfaceTransparency";
import { useI18n } from "@/hooks/useI18n";
import styles from "./InterfaceTransparencySettings.module.css";

export function InterfaceTransparencySettings() {
  const { t } = useI18n();
  const { transparency, setTransparency, reset } = useInterfaceTransparency();
  const id = useId();
  return (
    <section className={styles.section} aria-labelledby={`${id}-title`}>
      <div className={styles.header}>
        <h3 id={`${id}-title`}>{t("appearance.transparency.title")}</h3>
        <button type="button" onClick={reset}>{t("appearance.transparency.reset")}</button>
      </div>
      <p id={`${id}-hint`}>{t("appearance.transparency.hint")}</p>
      <div className={styles.preview} aria-hidden="true">
        <div className={styles.previewComposer}>{t("appearance.transparency.composer")}</div>
        <div className={styles.previewSearch}>{t("appearance.transparency.search")}</div>
      </div>
      <label className={styles.label} htmlFor={id}>
        <span>{t("appearance.transparency.title")}</span><output aria-hidden="true">{transparency}%</output>
      </label>
      <input id={id} className={styles.range} type="range" min={0} max={100} step={1}
        value={transparency} aria-describedby={`${id}-hint`} aria-valuetext={`${transparency}%`}
        onChange={event => setTransparency(Number(event.currentTarget.value))} />
      <div className={styles.ends}><span>{t("appearance.transparency.opaque")}</span><span>{t("appearance.transparency.clear")}</span></div>
      <p className={styles.reduced}>{t("appearance.transparency.reduced")}</p>
    </section>
  );
}

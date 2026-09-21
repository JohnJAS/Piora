"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";

/** Mounted only while this session is compacting; elapsed time is local wait time. */
export function CompactionProgress({ onStop }: { onStop?: () => void }) {
  const { t } = useI18n();
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="compaction-progress">
      <div className="compaction-progress-heading">
        <span role="status" aria-live="polite">{t("chat.compactingWait")}</span>
        <span className="compaction-progress-elapsed">{t("chat.compactingElapsed", { seconds })}</span>
        {onStop ? (
          <button type="button" className="compaction-progress-stop" onClick={onStop}>
            {t("chat.stopCompaction")}
          </button>
        ) : null}
      </div>
      <div className="compaction-progress-hint">{t("chat.compactingHint")}</div>
      <div className="compaction-progress-track" role="progressbar" aria-label={t("chat.compactContext")}>
        <span />
      </div>
    </div>
  );
}

"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useVirtualRowToggle } from "./VirtualRowState";
import { DisclosureChevron, togglePreservingScroll } from "./ChatDisclosure";
import { useCompactProcess } from "./CompactProcessContext";
import { processElapsedSeconds, type ProcessTimeRange } from "@/lib/process-duration";

export const ProcessStackContext = createContext<{
  first: boolean;
  expanded: boolean;
  count: number;
  timeRanges: Array<ProcessTimeRange | undefined>;
  toggle: () => void;
  onInteract: () => void;
} | null>(null);
export const ProcessCompletedContext = createContext(false);

export function ProcessStack({ stateKey, count, timeRanges, children }: { stateKey: string; count: number; timeRanges: Array<ProcessTimeRange | undefined>; children: ReactNode }) {
  const { t } = useI18n();
  const shared = useContext(ProcessStackContext);
  const compact = useCompactProcess();
  const completed = useContext(ProcessCompletedContext);
  const [localExpanded, setLocalExpanded] = useVirtualRowToggle(`process-stack:${stateKey}`, true);
  const [touched, setTouched] = useVirtualRowToggle(`process-stack-touched:${stateKey}`);
  const expanded = compact || (shared?.expanded ?? (touched ? localExpanded : !completed));
  const elapsed = processElapsedSeconds(shared?.timeRanges ?? timeRanges);
  return <div className="chat-process-stack" onClickCapture={(event) => {
    if ((event.target as HTMLElement).closest(".chat-process-stack-heading")) return;
    if (shared) shared.onInteract();
    else { setTouched(true); setLocalExpanded(true); }
  }}>
    {!compact && (!shared || shared.first) ? <button type="button" className="chat-process-stack-heading"
      aria-expanded={expanded}
      onClick={(event) => togglePreservingScroll(event.currentTarget, () => {
        if (shared) shared.toggle();
        else { setTouched(true); setLocalExpanded(!expanded); }
      })}>
      <DisclosureChevron />
      <span>{t(completed ? "chat.processCompleted" : "chat.processDetails")}</span>
      {!expanded && elapsed !== undefined ? <span className="chat-process-stack-duration">· {t("chat.processElapsedDuration", { seconds: elapsed })}</span> : null}
      <span className="chat-process-stack-count">· {t("chat.processSteps", { count: shared?.count ?? count })}</span>
    </button> : null}
    {expanded ? children : null}
  </div>;
}

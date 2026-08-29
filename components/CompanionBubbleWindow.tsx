"use client";

import { useEffect, useState } from "react";
import type { CompanionDecision } from "@/lib/companion-runtime";
import styles from "./CompanionBubbleWindow.module.css";

export function CompanionBubbleWindow() {
  const [decision, setDecision] = useState<CompanionDecision | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const source = new EventSource("/api/companion/events");
    source.addEventListener("companion", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as { state?: { mind?: { lastDecision?: CompanionDecision | null } } };
        const next = payload.state?.mind?.lastDecision ?? null;
        setDecision(next);
        setVisible(Boolean(next?.speech && Date.now() - next.createdAt < 18_000));
      } catch { /* ignore malformed event */ }
    });
    return () => source.close();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(() => setVisible(false), 18_000);
    return () => window.clearTimeout(timer);
  }, [decision?.id, visible]);

  return (
    <main className={`${styles.surface}${visible ? ` ${styles.visible}` : ""}`} aria-live="polite">
      {visible && decision?.speech ? <div className={styles.bubble}>{decision.speech}</div> : null}
    </main>
  );
}

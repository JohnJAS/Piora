"use client";

import { useEffect, useState } from "react";
import {
  createCompanionRuntimeChannel,
  fetchCompanionRuntimeState,
} from "@/lib/companion-runtime-client";
import type { CompanionDecision } from "@/lib/companion-runtime";
import styles from "./CompanionBubbleWindow.module.css";

export function CompanionBubbleWindow() {
  const [decision, setDecision] = useState<CompanionDecision | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const applyDecision = (next: CompanionDecision | null) => {
      setDecision(next);
      setVisible(Boolean(next?.speech && Date.now() - next.createdAt < 18_000));
    };
    const channel = createCompanionRuntimeChannel((state) => applyDecision(state.mind.lastDecision));
    void fetchCompanionRuntimeState({ signal: controller.signal })
      .then((state) => applyDecision(state.mind.lastDecision))
      .catch(() => undefined);
    return () => {
      controller.abort();
      channel?.close();
    };
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

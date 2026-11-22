"use client";

import React from "react";
import { useI18n } from "@/hooks/useI18n";
import type { ContextUsage, SessionStatsInfo } from "@/lib/pi-types";
import { AliIcon } from "../AliIcon";
import { formatTokenCount, getContextRemainingPercent } from "./shared";

export function SessionStatsBadge({ sessionStats }: { sessionStats?: SessionStatsInfo | null }) {
  const { t, locale } = useI18n();
  const sessionMessageRows: [string, string][] = sessionStats ? [
    [t("session.user"), sessionStats.userMessages.toLocaleString(locale)],
    [t("session.assistant"), sessionStats.assistantMessages.toLocaleString(locale)],
    [t("session.toolCalls"), sessionStats.toolCalls.toLocaleString(locale)],
    [t("session.total"), sessionStats.totalMessages.toLocaleString(locale)],
  ] : [];
  const sessionTokenRows: [string, string][] = sessionStats ? [
    [t("session.input"), sessionStats.tokens.input.toLocaleString(locale)],
    [t("session.output"), sessionStats.tokens.output.toLocaleString(locale)],
    ...(sessionStats.tokens.cacheRead > 0
      ? [[t("session.cacheRead"), sessionStats.tokens.cacheRead.toLocaleString(locale)] as [string, string]]
      : []),
    [t("session.total"), sessionStats.tokens.total.toLocaleString(locale)],
  ] : [];

  return (
    <div className="session-stats-control">
      <div className="session-stats-trigger" tabIndex={0} aria-label={t("session.title")}>
        <AliIcon name="chart-no-axes-column" size={18} />
      </div>
      <div className="session-stats-tooltip" role="tooltip">
        <div className="session-stats-tooltip-title">{t("session.title")}</div>
        {sessionStats ? (
          <div className="session-stats-tooltip-sections">
            <div>
              <div className="session-stats-tooltip-section-title">{t("session.messages")}</div>
              <div className="session-stats-tooltip-grid">
                {sessionMessageRows.map(([label, value]) => (
                  <React.Fragment key={`message:${label}`}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </React.Fragment>
                ))}
              </div>
            </div>
            <div>
              <div className="session-stats-tooltip-section-title">{t("session.tokens")}</div>
              <div className="session-stats-tooltip-grid">
                {sessionTokenRows.map(([label, value]) => (
                  <React.Fragment key={`token:${label}`}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="session-stats-tooltip-empty">{t("session.load")}</div>
        )}
        {sessionStats ? (
          <div className="session-stats-tooltip-cost">
            <span>{t("session.cumulativeCost")}</span>
            <strong>
              {sessionStats.costStatus === "unknown"
                ? t("session.costUnknown")
                : `$${sessionStats.cost.toFixed(4)}${sessionStats.costStatus === "partial" ? ` (${t("session.costPartial")})` : ""}`}
            </strong>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ContextUsageRing({ contextUsage }: { contextUsage?: ContextUsage | null }) {
  const { t } = useI18n();
  const contextRemainingPercent = getContextRemainingPercent(contextUsage);
  const contextUsedPercent = contextRemainingPercent === null ? null : 100 - contextRemainingPercent;
  const contextUsageLabel = contextUsedPercent === null
    ? t("chat.contextUsageUnknown")
    : t("chat.contextUsageLabel", { percent: Math.round(contextUsedPercent) });
  const contextTokenLabel = contextUsage?.tokens === null || !contextUsage?.contextWindow
    ? t("chat.contextTokensUnknown")
    : t("chat.contextTokensUsed", {
        used: formatTokenCount(contextUsage.tokens),
        total: formatTokenCount(contextUsage.contextWindow),
      });
  const contextBreakdownRows: [string, string][] | null = contextUsage?.breakdown ? [
    [t("chat.contextSystemPrompt"), formatTokenCount(contextUsage.breakdown.systemPrompt)],
    [t("chat.contextProjectInstructions"), formatTokenCount(contextUsage.breakdown.projectInstructions)],
    [t("chat.contextToolDefinitions"), formatTokenCount(contextUsage.breakdown.toolDefinitions)],
    [t("chat.contextConversationMessages"), formatTokenCount(contextUsage.breakdown.conversationMessages)],
    ...(contextUsage.breakdown.otherRuntime > 0
      ? [[t("chat.contextOtherRuntime"), formatTokenCount(contextUsage.breakdown.otherRuntime)] as [string, string]]
      : []),
  ] : null;

  return (
    <div className="context-usage-control">
      <div
        className="context-usage-ring"
        tabIndex={0}
        aria-label={`${contextUsageLabel}. ${contextTokenLabel}`}
        data-context-used={contextUsedPercent?.toFixed(2) ?? "unknown"}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="10" cy="10" r="8" pathLength="100" fill="none" stroke="color-mix(in srgb, var(--text-dim) 40%, transparent)" strokeWidth="2.4" />
          {contextUsedPercent === null ? (
            <circle cx="10" cy="10" r="8" pathLength="100" fill="none" stroke="var(--text-dim)" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="3 6" transform="rotate(-90 10 10)" />
          ) : (
            <circle
              cx="10" cy="10" r="8" pathLength="100" fill="none"
              stroke={contextUsedPercent >= 90 ? "#ef4444" : contextUsedPercent >= 75 ? "#f59e0b" : "var(--text-muted)"}
              strokeWidth="2.4" strokeLinecap="round"
              strokeDasharray={`${contextUsedPercent} ${100 - contextUsedPercent}`}
              transform="rotate(-90 10 10)"
              style={{ transition: "stroke-dasharray 240ms ease, stroke 180ms ease" }}
            />
          )}
        </svg>
      </div>
      <div className="context-usage-tooltip" role="tooltip">
        <div className="context-usage-tooltip-heading">
          <span>{t("chat.contextWindow")}:</span>
          <span>{contextUsageLabel}</span>
        </div>
        <div className="context-usage-tooltip-value">{contextTokenLabel}</div>
        {contextBreakdownRows ? (
          <div className="context-usage-breakdown">
            <div className="context-usage-breakdown-title">{t("chat.contextBreakdownTitle")}</div>
            {contextBreakdownRows.map(([label, value]) => (
              <div className="context-usage-breakdown-row" key={label}>
                <span>{label}</span>
                <strong>≈ {value}</strong>
              </div>
            ))}
            <div className="context-usage-tooltip-note">{t("chat.contextBreakdownNote")}</div>
          </div>
        ) : <div className="context-usage-tooltip-note">{t("chat.contextIncludesSystemTools")}</div>}
      </div>
    </div>
  );
}

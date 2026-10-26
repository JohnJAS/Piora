"use client";

import type { ToolActivityGroup } from "@/lib/compact-chat-history";
import { toolActivityIcons } from "@/lib/tool-activity";
import { useI18n } from "@/hooks/useI18n";
import { ChatDisclosureTrigger, togglePreservingScroll } from "./ChatDisclosure";

export function ToolActivitySummary({ group, onToggle }: { group: ToolActivityGroup; onToggle: () => void }) {
  const { t } = useI18n();
  return <div className="compact-process-detail tool-activity-heading" data-tool-activity={group.kind}>
    <ChatDisclosureTrigger className="tool-activity-toggle" expanded={group.expanded}
      disabled={group.attention} icon={toolActivityIcons[group.kind]}
      label={t(`chat.toolActivity.${group.kind}`, { count: group.count })}
      metadata={group.attention ? t("chat.processAttention") : group.active ? t("command.status.running") : undefined}
      onClick={(event) => togglePreservingScroll(event.currentTarget, onToggle)} />
  </div>;
}

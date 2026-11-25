"use client";

import { useContext, useMemo, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { copyText } from "@/lib/clipboard";
import type { CommandExecutionData } from "@/lib/command-execution";
import { parseCompactionSummary } from "@/lib/compaction-summary";
import type { BashExecutionMessage, CustomMessage } from "@/lib/types";
import { WORKFLOW_GOAL_CONTINUE_CUSTOM_TYPE } from "@/lib/workflow/goal-continuation";
import { AliIcon } from "../AliIcon";
import { ChatDisclosure, DisclosureChevron } from "../ChatDisclosure";
import { CommandExecutionCard } from "../CommandExecutionView";
import { LazyMarkdownBody as MarkdownBody } from "../LazyMarkdownBody";
import { MessageImage, MessageImageViewer } from "../MessageImage";
import {
  formatCustomType,
  formatTime,
  getMessageImages,
  getMessageText,
  HistoryModeContext,
  imageSource,
  previewText,
  safeJson,
} from "./shared";

function CompactionFileList({ title, files }: { title: string; files: string[] }) {
  return (
    <div className="compaction-file-section">
      <div className="compaction-file-title">{title}</div>
      <ul className="compaction-file-list">
        {files.map((file) => (
          <li key={file}>{file}</li>
        ))}
      </ul>
    </div>
  );
}

function CompactionFileMetadata({ readFiles, modifiedFiles }: { readFiles: string[]; modifiedFiles: string[] }) {
  const { t } = useI18n();
  const total = readFiles.length + modifiedFiles.length;
  if (total === 0) return null;

  const parts = [];
  if (readFiles.length > 0) parts.push(`${readFiles.length} read`);
  if (modifiedFiles.length > 0) parts.push(`${modifiedFiles.length} modified`);

  return (
    <details className="compaction-file-details">
      <summary><DisclosureChevron />{t("i18n.fileContext", { details: parts.join(", ") })}</summary>
      {modifiedFiles.length > 0 && <CompactionFileList title={t("i18n.modifiedFiles")} files={modifiedFiles} />}
      {readFiles.length > 0 && <CompactionFileList title={t("i18n.readFiles")} files={readFiles} />}
    </details>
  );
}

export function CompactionMessageView({ message }: { message: CustomMessage }) {
  const { t } = useI18n();
  const summary = getMessageText(message.content);
  const parsedSummary = useMemo(() => parseCompactionSummary(summary), [summary]);
  const time = formatTime(message.timestamp);

  return (
    <div className="chat-disclosure is-expanded compaction-message-card">
      <div className="chat-disclosure-heading">
        <AliIcon name="archive" size={14} aria-hidden="true" />
        <span className="chat-disclosure-label">{t("i18n.conversationCompacted")}</span>
        {time ? <span className="chat-disclosure-meta">{time}</span> : null}
      </div>
      <div className="chat-disclosure-content">
        <p className="compaction-description">{t("i18n.compactionDescription")}</p>
        {parsedSummary.body ? <MarkdownBody className="markdown-compaction-message">{parsedSummary.body}</MarkdownBody>
          : <span className="chat-disclosure-notice">{t("i18n.noSummary")}</span>}
        <CompactionFileMetadata readFiles={parsedSummary.readFiles} modifiedFiles={parsedSummary.modifiedFiles} />
      </div>
    </div>
  );
}

export function CustomMessageView({
  messageActions,
  message,
  cwd,
  onOpenFile,
}: {
  messageActions?: ReactNode;
  message: CustomMessage;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
}) {
  const { t } = useI18n();
  const isHiddenDisplay = message.display === false;
  const [contentExpanded, setContentExpanded] = useState(!isHiddenDisplay);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [openImageIndex, setOpenImageIndex] = useState<number | null>(null);
  const text = getMessageText(message.content);
  const images = getMessageImages(message.content);
  const isGoalAutoContinue = message.customType === WORKFLOW_GOAL_CONTINUE_CUSTOM_TYPE;
  const hasDetails = !isGoalAutoContinue && message.details !== undefined;
  const detailsText = hasDetails ? safeJson(message.details) : "";
  const goalContinueDetails = isGoalAutoContinue && message.details && typeof message.details === "object"
    ? (message.details as { completedTurns?: unknown; turnBudget?: unknown })
    : null;
  const goalContinueMeta = goalContinueDetails
    && typeof goalContinueDetails.completedTurns === "number"
    && typeof goalContinueDetails.turnBudget === "number"
    ? t("workflow.goal.autoContinueTurn", {
        next: Math.min(goalContinueDetails.completedTurns + 1, goalContinueDetails.turnBudget),
        budget: goalContinueDetails.turnBudget,
      })
    : null;
  const title = isGoalAutoContinue ? t("workflow.goal.autoContinueLabel") : formatCustomType(message.customType);
  const time = formatTime(message.timestamp);

  const copyContent = () => {
    copyText(text || detailsText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const actions = (
    <>
      {text || detailsText ? (
        <button
          type="button"
          className="chat-disclosure-action"
          onClick={copyContent}
          title={t(copied ? "i18n.copied" : "i18n.copy")}
          aria-label={t(copied ? "i18n.copied" : "i18n.copy")}
        >
          <AliIcon name={copied ? "check" : "copy"} size={14} />
        </button>
      ) : null}
      <span className="message-hover-actions">{messageActions}</span>
    </>
  );
  const body = (
    <>
      {images.length > 0 ? (
        <div className="custom-message-images">
          {images.map((img, i) => {
            const src = imageSource(img);
            return src ? <MessageImage key={i} src={src} index={i} onOpen={() => setOpenImageIndex(i)} /> : null;
          })}
        </div>
      ) : null}
      {text ? <MarkdownBody className="markdown-custom-message" cwd={cwd} onOpenFile={onOpenFile}>{text}</MarkdownBody>
        : <span className="chat-disclosure-notice">{t("i18n.noMessage")}</span>}
    </>
  );
  const details = <pre className="chat-disclosure-diagnostics custom-message-details">{detailsText}</pre>;

  return (
    <div className="message-row custom-message-row">
      {isHiddenDisplay ? (
        <ChatDisclosure
          className="custom-message-card"
          expanded={contentExpanded}
          onExpandedChange={setContentExpanded}
          icon="message"
          label={title}
          description={text ? previewText(text) : t("i18n.showExtensionMessage")}
          metadata={<><span>{t("i18n.hiddenExtensionMessage")}</span>{time ? <span>{time}</span> : null}</>}
          actions={actions}
        >
          {body}
          {hasDetails ? details : null}
        </ChatDisclosure>
      ) : (
        <div className="chat-disclosure is-expanded custom-message-card">
          <div className="chat-disclosure-header">
            <div className="chat-disclosure-heading">
              <AliIcon name={isGoalAutoContinue ? "target" : "message"} size={14} aria-hidden="true" />
              <span className="chat-disclosure-label">{title}</span>
              {goalContinueMeta ? <span className="chat-disclosure-meta">{goalContinueMeta}</span> : null}
              {time ? <span className="chat-disclosure-meta">{time}</span> : null}
            </div>
            <div className="chat-disclosure-actions">{actions}</div>
          </div>
          <div className="chat-disclosure-content">
            {body}
            {hasDetails ? (
              <ChatDisclosure
                variant="inline"
                expanded={detailsExpanded}
                onExpandedChange={setDetailsExpanded}
                label={t(detailsExpanded ? "i18n.hideDetails" : "i18n.showDetails")}
              >
                {details}
              </ChatDisclosure>
            ) : null}
          </div>
        </div>
      )}
      {openImageIndex !== null && images[openImageIndex] ? (
        <MessageImageViewer src={imageSource(images[openImageIndex])} index={openImageIndex} onClose={() => setOpenImageIndex(null)} />
      ) : null}
    </div>
  );
}

export function BashExecutionView({
  messageActions,
  message,
  sessionId,
  cwd,
  onOpenCommandExecution,
}: {
  messageActions?: ReactNode;
  message: BashExecutionMessage;
  sessionId?: string;
  cwd?: string;
  onOpenCommandExecution?: (data: CommandExecutionData) => void;
}) {
  const historyMode = useContext(HistoryModeContext);
  const isPending = !message.output && message.exitCode === undefined && !message.cancelled;
  const toolName = message.excludeFromContext ? "bash (local)" : "bash";
  const data: CommandExecutionData = {
    id: `bash-${message.timestamp ?? message.command}`,
    toolName,
    command: message.command,
    output: message.output,
    status: isPending || message.exitCode === undefined && !message.cancelled ? "running" : message.cancelled ? "cancelled" : message.exitCode === 0 ? "success" : "failed",
    isStreaming: !historyMode && message.exitCode === undefined && !message.cancelled,
    historical: historyMode,
    cwd,
    exitCode: message.exitCode,
    truncated: message.truncated === true,
    fullOutputPath: message.fullOutputPath,
    sessionId,
    diagnostics: safeJson({
      command: message.command,
      exitCode: message.exitCode,
      cancelled: message.cancelled,
      truncated: message.truncated,
      fullOutputPath: message.fullOutputPath,
    }),
  };
  return <div style={{ margin: "6px 0" }}><CommandExecutionCard data={data} onOpen={onOpenCommandExecution} actions={messageActions} /></div>;
}

"use client";

import { useContext, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useI18n } from "@/hooks/useI18n";
import { commandExitCode, commandResultMetadata, commandStatus, isCommandToolName, toolResultText, type CommandExecutionData } from "@/lib/command-execution";
import { getFileChangeInfo, type FileChangeInfo } from "@/lib/file-change";
import { fileToolResult } from "@/lib/file-tool-result";
import { summarizeToolDisclosure } from "@/lib/tool-summary";
import type { ToolCallContent, ToolResultMessage } from "@/lib/types";
import { AliIcon, type AliIconName } from "../AliIcon";
import { BrowserUserWaitCard } from "../BrowserUserWaitCard";
import { ChatDisclosure, DisclosurePath } from "../ChatDisclosure";
import { CommandExecutionCard } from "../CommandExecutionView";
import { FileToolResultView } from "../FileToolResultView";
import { NestedToolCalls, useNestedToolCalls } from "../NestedToolCalls";
import { useVirtualRowToggle } from "../VirtualRowState";
import { ProposedPlanCard } from "../workflow/ProposedPlanCard";
import { UserInputHistoryDisclosure } from "../workflow/UserInputHistoryDisclosure";
import {
  getAutomationToolCardDetails,
  HistoryModeContext,
  safeJson,
  ToolRunActiveContext,
} from "./shared";

const DiffView = dynamic(
  () => import("../DiffView").then((module) => module.DiffView),
  { ssr: false },
);
const AutomationCard = dynamic(
  () => import("../AutomationPanel").then((module) => module.AutomationCard),
  { ssr: false },
);

interface ResultDiff {
  text: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getResultDiff(result: ToolResultMessage): ResultDiff | null {
  const details = (result as ToolResultMessage & { details?: unknown }).details;
  if (!isRecord(details)) return null;

  const patch = typeof details.patch === "string" ? details.patch : null;
  if (patch) return { text: patch };

  const diff = typeof details.diff === "string" ? details.diff : null;
  if (diff) return { text: diff };

  return null;
}

function PairedDiffResult({ diff }: { diff: ResultDiff }) {
  return <div className="tool-result-diff"><DiffView patch={diff.text} mode="split" /></div>;
}

function PairedResult({ text, isEmpty, isError }: {
  text: string;
  isEmpty: boolean;
  isError: boolean;
}) {
  const { t } = useI18n();
  return (
    <pre className={`tool-result-output${isError ? " is-error" : ""}${isEmpty ? " is-empty" : ""}`}>
      {isEmpty ? t("i18n.noOutput") : text}
    </pre>
  );
}

function FileChangeBlock({
  change,
  resultText,
  duration,
  expanded,
  diagnosticsOpen,
  diagnostics,
  onOpenFile,
  onExpandedChange,
  onDiagnosticsOpenChange,
}: {
  change: FileChangeInfo;
  resultText: string;
  duration?: number;
  expanded: boolean;
  diagnosticsOpen: boolean;
  diagnostics: string;
  onOpenFile?: (filePath: string) => void;
  onExpandedChange: (value: boolean) => void;
  onDiagnosticsOpenChange: (value: boolean) => void;
}) {
  const { t } = useI18n();
  const titleKey = change.status === "running"
    ? "fileChange.running"
    : change.status === "failed"
      ? "fileChange.failed"
      : change.kind === "created"
        ? "fileChange.created"
        : change.kind === "unchanged"
          ? "fileChange.unchanged"
          : "fileChange.edited";
  const icon: AliIconName = change.kind === "created" ? "file-add" : "edit";
  const statusClass = change.status === "failed" ? "is-failed" : change.status === "running" ? "is-running" : "is-complete";
  const noDiffMessage = change.unavailableReason === "too_large"
    ? t("fileChange.tooLarge")
    : change.unavailableReason === "binary"
      ? t("fileChange.binary")
      : change.kind === "unchanged"
        ? t("fileChange.noChanges")
        : t("fileChange.unavailable");

  return (
    <ChatDisclosure
      className={`file-change-card ${statusClass}`}
      data-file-change-path={change.path}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
      icon={icon}
      label={t(titleKey)}
      triggerClassName="file-change-toggle tool-call-toggle"
      description={<DisclosurePath path={change.path} filePath={change.path} />}
      metadata={
        <>
          {change.status !== "completed" ? (
            <span className={`chat-disclosure-status is-${change.status}`}>
              {t(change.status === "running" ? "command.status.running" : "command.status.failed")}
            </span>
          ) : null}
          {change.status === "completed" && (change.added > 0 || change.removed > 0) ? (
            <span className="file-change-stats" aria-label={t("fileChange.stats", { added: change.added, removed: change.removed })}>
              <span className="file-change-additions">+{change.added}</span>
              <span className="file-change-deletions">−{change.removed}</span>
            </span>
          ) : null}
          {duration !== undefined ? <span>{duration}s</span> : null}
        </>
      }
      actions={onOpenFile ? (
        <button
          type="button"
          className="chat-disclosure-action"
          title={t("diff.openFile")}
          data-chat-file-path={change.path}
          aria-label={t("diff.openFile")}
          onClick={() => onOpenFile(change.path)}
        >
          <AliIcon name="external-link" size={14} />
        </button>
      ) : null}
    >
      {change.patch ? (
        <DiffView className="file-change-diff" patch={change.patch} filePath={change.path} mode="unified" showFileHeader={false} />
      ) : change.status === "failed" ? (
        <PairedResult text={resultText} isEmpty={!resultText.trim()} isError />
      ) : (
        <div className="chat-disclosure-notice">{noDiffMessage}</div>
      )}
      <ChatDisclosure
        variant="inline"
        expanded={diagnosticsOpen}
        onExpandedChange={onDiagnosticsOpenChange}
        label={t("toolSummary.diagnostics")}
      >
        <pre className="chat-disclosure-diagnostics">{diagnostics}</pre>
      </ChatDisclosure>
    </ChatDisclosure>
  );
}

export function ToolCallBlock({
  block,
  preparing,
  result,
  duration,
  cwd,
  sessionId,
  onOpenFile,
  onOpenAutomation,
  onOpenCommandExecution,
}: {
  block: ToolCallContent;
  preparing?: boolean;
  result?: ToolResultMessage;
  duration?: number;
  cwd?: string;
  sessionId?: string;
  onOpenFile?: (filePath: string) => void;
  onOpenAutomation?: (automationId: string) => void;
  onOpenCommandExecution?: (data: CommandExecutionData) => void;
}) {
  const { t } = useI18n();
  const historyMode = useContext(HistoryModeContext);
  const [expanded, setExpanded] = useVirtualRowToggle(`tool:${block.toolCallId}`, Boolean(result?.isError && !result.isStreaming));
  const [diagnosticsOpen, setDiagnosticsOpen] = useVirtualRowToggle(`diagnostics:${block.toolCallId}`);
  const runActive = useContext(ToolRunActiveContext);
  const pending = runActive && (!result || result.isStreaming === true);
  const [waitSeconds, setWaitSeconds] = useState(0);
  useEffect(() => {
    if (!pending) return;
    const started = Date.now();
    const timer = setInterval(() => setWaitSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [pending, block.toolCallId]);
  const phase = result && !result.isStreaming ? result.isError ? "error" : "ok" : !runActive ? "unfinished" : preparing && !result ? "preparing" : "running";
  const longWait = t(phase === "preparing" ? "toolSummary.preparingLong" : "toolSummary.waitingLong");
  const diagnostics = safeJson({
    toolName: block.toolName,
    state: phase,
    streamingParameters: phase === "preparing",
    waitingSeconds: pending ? waitSeconds : undefined,
    input: block.input,
    result: result ?? null,
  });
  const fileChange = getFileChangeInfo(block, result);
  const resultDiff = result && !result.isError ? getResultDiff(result) : null;
  const summary = summarizeToolDisclosure(block.toolName, block.input, result?.isStreaming ? undefined : result, t);
  const automationDetails = getAutomationToolCardDetails(block, result);
  const nestedCalls = useNestedToolCalls(block.toolCallId, result?.nestedCalls);
  const fileResult = useMemo(() => fileToolResult(block, result, cwd), [block, result, cwd]);

  if (block.toolName === "piora_submit_plan") {
    return (
      <ProposedPlanCard
        block={block}
        result={result}
        pending={pending}
        cwd={cwd}
        sessionId={sessionId}
      />
    );
  }

  if (block.toolName === "piora_request_user_input") {
    return (
      <UserInputHistoryDisclosure
        block={block}
        result={result}
        pending={pending}
      />
    );
  }

  if (isCommandToolName(block.toolName)) {
    const output = toolResultText(result);
    const metadata = commandResultMetadata(result);
    const data: CommandExecutionData = {
      id: block.toolCallId,
      toolName: block.toolName,
      command: typeof block.input.command === "string" ? block.input.command : "",
      output,
      status: commandStatus(result, output),
      isStreaming: pending,
      historical: historyMode || !runActive && (!result || result.isStreaming === true),
      duration,
      cwd,
      exitCode: commandExitCode(result, output),
      truncated: metadata.truncated,
      fullOutputPath: metadata.fullOutputPath,
      sessionId,
      diagnostics,
    };
    return <CommandExecutionCard data={data} onOpen={onOpenCommandExecution} />;
  }

  if (block.toolName === "browser" && block.input.action === "wait_for_user") {
    return (
      <BrowserUserWaitCard
        sessionId={sessionId}
        toolCallId={block.toolCallId}
        reason={typeof block.input.reason === "string" ? block.input.reason : ""}
        result={result}
        historical={historyMode}
        purpose={block.input.purpose === "login" || block.input.purpose === "confirmation" ? block.input.purpose : undefined}
      />
    );
  }

  if (automationDetails && !historyMode) {
    return (
      <AutomationCard
        automationId={automationDetails.id}
        fallbackName={automationDetails.name}
        fallbackRrule={automationDetails.rrule}
        onOpen={onOpenAutomation}
      />
    );
  }

  const resultText = result && Array.isArray(result.content)
    ? result.content
      .filter((b): b is { type: "text"; text: string } => b?.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("\n")
    : null;
  const resultIsEmpty = resultText === null ? false : (resultText.trim() === "(no output)" || resultText.trim() === "");
  const isError = result?.isError ?? false;

  if (fileChange && result && !result.isStreaming) {
    return (
      <FileChangeBlock
        change={fileChange}
        resultText={resultText ?? ""}
        duration={duration}
        expanded={expanded}
        diagnosticsOpen={diagnosticsOpen}
        diagnostics={diagnostics}
        onOpenFile={onOpenFile}
        onExpandedChange={setExpanded}
        onDiagnosticsOpenChange={setDiagnosticsOpen}
      />
    );
  }

  return (
    <ChatDisclosure
      className="tool-call-card"
      triggerClassName="tool-call-toggle"
      expanded={expanded}
      onExpandedChange={setExpanded}
      icon={summary.icon as AliIconName}
      label={summary.title}
      description={summary.subject ? (
        <>
          {summary.subjectIsPath ? <DisclosurePath path={summary.subject} filePath={summary.subject} /> : <span title={summary.subject}>{summary.subject}</span>}
          {summary.detail ? <span className="tool-call-detail" title={summary.detail}>{summary.detail}</span> : null}
        </>
      ) : summary.detail ? <span title={summary.detail}>{summary.detail}</span> : undefined}
      metadata={
        <>
          {nestedCalls ? (
            <span>{t("nestedCalls.progress", { done: nestedCalls.calls.filter(call => call.status === "ok" || call.status === "error").length, total: nestedCalls.calls.length })}</span>
          ) : null}
          <span className={`chat-disclosure-status is-${phase === "unfinished" ? "unknown" : phase === "preparing" ? "running" : phase}`}>
            {t(phase === "unfinished" ? "toolSummary.unfinished" : phase === "preparing" ? "toolSummary.preparing" : phase === "running" ? "command.status.running" : phase === "error" ? "command.status.failed" : "command.status.success")}
          </span>
          {pending && waitSeconds > 0 ? <span title={waitSeconds >= 60 ? longWait : undefined}>{waitSeconds}s{waitSeconds >= 60 ? ` · ${t("toolSummary.takingLong")}` : ""}</span> : null}
          {duration !== undefined ? <span>{duration}s</span> : null}
        </>
      }
    >
      {result ? resultDiff
        ? <PairedDiffResult diff={resultDiff} />
        : fileResult ? <FileToolResultView model={fileResult} toolCallId={block.toolCallId} onOpenFile={onOpenFile} />
        : <PairedResult text={resultText ?? ""} isEmpty={resultIsEmpty} isError={isError} />
        : <div className="chat-disclosure-notice">{t(phase === "unfinished" ? "toolSummary.unfinishedResult" : phase === "preparing" ? "toolSummary.preparing" : "command.waitingForOutput")}</div>}
      {pending && waitSeconds >= 60 ? <div className="chat-disclosure-notice">{longWait}</div> : null}
      {nestedCalls ? <NestedToolCalls snapshot={nestedCalls} /> : null}
      <ChatDisclosure
        variant="inline"
        expanded={diagnosticsOpen}
        onExpandedChange={setDiagnosticsOpen}
        label={t("toolSummary.diagnostics")}
      >
        <pre className="chat-disclosure-diagnostics">{diagnostics}</pre>
      </ChatDisclosure>
    </ChatDisclosure>
  );
}

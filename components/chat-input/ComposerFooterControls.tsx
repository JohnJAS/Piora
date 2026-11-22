"use client";

import React from "react";
import { useI18n } from "@/hooks/useI18n";
import { AliIcon } from "../AliIcon";

export interface AttachmentAddMenuProps {
  menuRef: React.RefObject<HTMLDivElement | null>;
  open: boolean;
  canAttachFiles: boolean;
  hasAttachments: boolean;
  workflowEnabled?: boolean;
  planWorkflowActive?: boolean;
  goalWorkflowActive?: boolean;
  workflowDisabled?: boolean;
  onToggle: () => void;
  onAttachFiles: () => void;
  onAttachFolder: () => void;
  onTogglePlanWorkflow?: () => void;
  onStartGoalWorkflow?: () => void;
}

export function AttachmentAddMenu({
  menuRef,
  open,
  canAttachFiles,
  hasAttachments,
  workflowEnabled = false,
  planWorkflowActive = false,
  goalWorkflowActive = false,
  workflowDisabled = false,
  onToggle,
  onAttachFiles,
  onAttachFolder,
  onTogglePlanWorkflow,
  onStartGoalWorkflow,
}: AttachmentAddMenuProps) {
  const { t } = useI18n();
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const canOpen = canAttachFiles || workflowEnabled;
  return (
    <div ref={menuRef} className="composer-add-control" onKeyDown={(event) => {
      if (event.key !== "Escape" || !open) return;
      event.preventDefault();
      event.stopPropagation();
      onToggle();
      triggerRef.current?.focus();
    }}>
      {open && (
        <div className="composer-add-menu" role="menu" aria-label={t("chat.addMenu")}>
          {canAttachFiles && (
            <>
              <div className="composer-add-menu-title">{t("chat.add")}</div>
              <button
                type="button"
                role="menuitem"
                className="composer-add-option"
                onClick={onAttachFiles}
              >
                <span className="composer-add-option-icon"><AliIcon name="attachment" size={15} /></span>
                <span className="composer-add-option-copy">
                  <strong>{t("chat.attachFiles")}</strong>
                  <small>{t("chat.attachFilesDescription")}</small>
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="composer-add-option"
                onClick={onAttachFolder}
              >
                <span className="composer-add-option-icon"><AliIcon name="folder-open" size={15} /></span>
                <span className="composer-add-option-copy">
                  <strong>{t("chat.attachFolder")}</strong>
                  <small>{t("chat.attachFolderDescription")}</small>
                </span>
              </button>
            </>
          )}
          {workflowEnabled && (onTogglePlanWorkflow || onStartGoalWorkflow) && (
            <>
              <div className="composer-add-menu-title" style={canAttachFiles ? { marginTop: 4, paddingTop: 6, borderTop: "1px solid var(--border-soft)" } : undefined}>
                {t("workflow.mode")}
              </div>
              {onTogglePlanWorkflow && (
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={planWorkflowActive}
                  data-testid="composer-add-plan-mode"
                  className="composer-add-option"
                  disabled={workflowDisabled}
                  onClick={onTogglePlanWorkflow}
                >
                  <span className="composer-add-option-icon"><AliIcon name="list-check" size={15} /></span>
                  <span className="composer-add-option-copy">
                    <strong>{t("workflow.menu.planMode")}</strong>
                    <small>{t("workflow.help.plan")}</small>
                  </span>
                  {planWorkflowActive && <AliIcon name="check" size={14} style={{ color: "var(--accent)", flexShrink: 0 }} />}
                </button>
              )}
              {onStartGoalWorkflow && (
                <button
                  type="button"
                  role="menuitem"
                  data-testid="composer-add-goal-mode"
                  className="composer-add-option"
                  disabled={workflowDisabled}
                  onClick={onStartGoalWorkflow}
                >
                  <span className="composer-add-option-icon"><AliIcon name="target" size={15} /></span>
                  <span className="composer-add-option-copy">
                    <strong>{t("workflow.menu.goalMode")}</strong>
                    <small>{t("workflow.help.goal")}</small>
                  </span>
                  {goalWorkflowActive && <AliIcon name="check" size={14} style={{ color: "var(--accent)", flexShrink: 0 }} />}
                </button>
              )}
            </>
          )}
        </div>
      )}
      <button
        ref={triggerRef}
        type="button"
        className={`composer-add-trigger${open ? " is-open" : ""}${hasAttachments ? " has-attachments" : ""}`}
        data-testid="composer-add-trigger"
        onClick={onToggle}
        disabled={!canOpen}
        title={t("chat.add")}
        aria-label={t("chat.add")}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <AliIcon name="plus" size={15} />
      </button>
    </div>
  );
}

export interface VoiceInputControlProps {
  voiceListening: boolean;
  transcribing: boolean;
  error: string | null;
  shortcut: string;
  onToggle: () => void;
}

export function VoiceInputControl({
  voiceListening,
  transcribing,
  error,
  shortcut,
  onToggle,
}: VoiceInputControlProps) {
  const { t } = useI18n();
  return (
    <>
      <button
        type="button"
        className={`voice-input-button${voiceListening ? " is-listening" : ""}${transcribing ? " is-transcribing" : ""}${error ? " is-error" : ""}`}
        onClick={onToggle}
        disabled={transcribing}
        aria-pressed={voiceListening}
        aria-label={voiceListening ? t("chat.stopVoiceInput") : t("chat.startVoiceInput")}
        title={shortcut
          ? t("chat.voiceInputShortcutHint", {
              action: voiceListening ? t("chat.stopVoiceInput") : t("chat.startVoiceInput"),
              shortcut,
            })
          : voiceListening ? t("chat.stopVoiceInput") : t("chat.startVoiceInput")}
      >
        <AliIcon name="microphone" size={15} />
      </button>
      {(voiceListening || transcribing || error) && (
        <span
          className={`voice-input-status${error ? " is-error" : ""}`}
          role="status"
          aria-live="polite"
        >
          {voiceListening
            ? t("chat.voiceListening")
            : transcribing
              ? t("chat.voiceTranscribing")
              : error === "permission"
                ? t("chat.voicePermissionDenied")
                : error === "microphone"
                  ? t("chat.voiceMicrophoneUnavailable")
                  : error === "no-speech"
                    ? t("chat.voiceNoSpeech")
                    : t("chat.voiceInputFailed")}
        </span>
      )}
    </>
  );
}

export interface StreamingSubmitControlProps {
  canQueueStreamingMessage: boolean;
  runningSendMode: "steer" | "next_turn";
  sendModeMenuId: string;
  sendModeButtonRef: React.RefObject<HTMLDivElement | null>;
  sendModeMenuRef: React.RefObject<HTMLDivElement | null>;
  sendModeHoverDismissedRef: React.MutableRefObject<boolean>;
  keepSendModeOpen: () => void;
  closeSendModeMenu: () => void;
  scheduleSendModeClose: () => void;
  openSendModeMenu: (focus?: boolean) => void;
  onSubmitStreamingMessage: () => void;
  onSendQueued: (mode: "steer" | "followup") => Promise<void>;
  onAbort: () => void;
}

export function StreamingSubmitControl({
  canQueueStreamingMessage,
  runningSendMode,
  sendModeMenuId,
  sendModeButtonRef,
  sendModeMenuRef,
  sendModeHoverDismissedRef,
  keepSendModeOpen,
  closeSendModeMenu,
  scheduleSendModeClose,
  openSendModeMenu,
  onSubmitStreamingMessage,
  onSendQueued,
  onAbort,
}: StreamingSubmitControlProps) {
  const { t } = useI18n();
  return (
    <div className="streaming-action-control">
      {canQueueStreamingMessage ? (
        <div
          ref={sendModeButtonRef}
          className="streaming-send-button"
          onPointerEnter={keepSendModeOpen}
          onPointerLeave={() => { sendModeHoverDismissedRef.current = false; scheduleSendModeClose(); }}
        >
          <button
            type="button"
            className="streaming-action-primary"
            onClick={onSubmitStreamingMessage}
            title={t(runningSendMode === "steer" ? "chat.steer" : "chat.queueSend")}
            aria-label={t(runningSendMode === "steer" ? "chat.steer" : "chat.queueSend")}
          >
            <span>{t(runningSendMode === "steer" ? "chat.steer" : "chat.queueSend")}</span>
            <AliIcon name="send" size={15} />
          </button>
          <button
            type="button"
            className="streaming-mode-picker"
            aria-controls={sendModeMenuId}
            aria-label={t("settings.runningSendMode")}
            aria-haspopup="menu"
            onPointerEnter={(event) => { if (event.pointerType === "mouse" && !sendModeHoverDismissedRef.current) openSendModeMenu(); }}
            onClick={(event) => openSendModeMenu(event.detail === 0)}
            onKeyDown={(event) => { if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); openSendModeMenu(true); } }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="m6 15 6-6 6 6" />
            </svg>
          </button>
          <div
            id={sendModeMenuId}
            ref={sendModeMenuRef}
            popover="auto"
            role="menu"
            aria-label={t("settings.runningSendMode")}
            className="streaming-mode-menu"
            onPointerEnter={keepSendModeOpen}
            onPointerLeave={scheduleSendModeClose}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                closeSendModeMenu();
                sendModeButtonRef.current?.querySelector<HTMLButtonElement>(".streaming-mode-picker")?.focus();
                return;
              }
              if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-mode]"));
              const index = items.indexOf(document.activeElement as HTMLButtonElement);
              items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length]?.focus();
            }}
          >
            <div className="streaming-mode-actions">
              {([runningSendMode === "steer" ? "next_turn" : "steer", runningSendMode] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="menuitem"
                  data-mode={mode}
                  onClick={() => {
                    closeSendModeMenu();
                    void onSendQueued(mode === "steer" ? "steer" : "followup");
                  }}
                >
                  <span>{t(mode === "steer" ? "chat.steer" : "chat.queueSend")}</span>
                  <AliIcon name="send" size={15} />
                </button>
              ))}
            </div>
            <button
              type="button"
              className="streaming-mode-collapse"
              aria-label={t("settings.runningSendMode")}
              onClick={closeSendModeMenu}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={onAbort}
          title={t("chat.stopAgent")}
          aria-label={t("chat.stopAgent")}
          className="streaming-stop-button"
        >
          <AliIcon name="stop" size={15} />
        </button>
      )}
    </div>
  );
}

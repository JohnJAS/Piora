"use client";

import { useRef } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { APPROVAL_ALLOW_ONCE, APPROVAL_ALLOW_TASK, APPROVAL_REJECT, decodeApprovalTitle } from "@/lib/approval-ui";
import type { ExtensionUiRequest } from "@/lib/types";

type Request = Extract<ExtensionUiRequest, { method: "select" }>;

export function isApprovalRequest(request: ExtensionUiRequest): request is Request {
  return request.method === "select" && decodeApprovalTitle(request.title) !== null;
}

export function ApprovalCard({ request, onRespond }: { request: Request; onRespond: (request: Request, response: { value: string } | { cancelled: true }) => void }) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const rejectButtonRef = useRef<HTMLButtonElement>(null);
  const reject = () => onRespond(request, { value: APPROVAL_REJECT });
  useFocusTrap(dialogRef, true, { initialFocus: rejectButtonRef, onEscape: reject });
  const prompt = decodeApprovalTitle(request.title);
  if (!prompt) return null;
  return <div className="extension-dialog-backdrop">
    <div ref={dialogRef} className="extension-dialog approval-card" role="alertdialog" aria-modal="true" aria-labelledby="approval-card-title" aria-describedby="approval-card-summary approval-card-reason approval-card-keyboard">
      <div className="approval-card-heading" id="approval-card-title"><span>{t("approval.title")}</span><code>{prompt.toolName}</code></div>
      <pre id="approval-card-summary">{prompt.summary}</pre>
      <p id="approval-card-reason">{prompt.reason}</p>
      <p id="approval-card-keyboard" className="sr-only">{t("approval.keyboardHint")}</p>
      <div className="approval-card-actions">
        <button type="button" onClick={() => onRespond(request, { value: APPROVAL_ALLOW_ONCE })}>{t("approval.once")}</button>
        <button type="button" onClick={() => onRespond(request, { value: APPROVAL_ALLOW_TASK })}>{t("approval.task")}</button>
        <button ref={rejectButtonRef} type="button" className="danger" aria-keyshortcuts="Escape" onClick={reject}>{t("approval.reject")}</button>
      </div>
    </div>
  </div>;
}

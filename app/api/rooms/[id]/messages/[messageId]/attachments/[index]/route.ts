import { requireRoomMemberBySession } from "@/lib/team-agent-api";
import { teamApiError } from "@/lib/team-api";
import { TeamError } from "@/lib/team-errors";
import { findRoomMessage } from "@/lib/room-store";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { getPromptFilesRoot } from "@/lib/prompt-files";
import { roomFileDownload } from "@/lib/room-downloads";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; messageId: string; index: string }> }) {
  try {
    const { id, messageId, index } = await params;
    requireRoomMemberBySession(id, new URL(request.url).searchParams.get("sessionId"));
    if (!/^\d{1,2}$/u.test(index)) throw new TeamError("TEAM_INVALID_INPUT", "附件编号无效。");
    const attachment = findRoomMessage(id, messageId)?.attachments?.[Number(index)];
    if (!attachment) throw new TeamError("TEAM_INVALID_INPUT", "附件不存在。");
    const roots = new Set(await getAllowedFileRoots()); roots.add(getPromptFilesRoot());
    if (!isExistingFilePathAllowed(attachment.path, roots)) throw new TeamError("TEAM_INVALID_CONTEXT", "附件已移除或超出允许的目录。");
    return roomFileDownload(attachment.path, attachment.name);
  } catch (error) { return teamApiError(error); }
}

import { NextResponse } from "next/server";

import { restorePromptMaterialDisplay } from "@/lib/prompt-materials";
import { getSessionEntries, resolveSessionPath } from "@/lib/session-reader";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const { id, entryId } = await params;
  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    const entry = getSessionEntries(filePath).find((candidate) => candidate.id === entryId);
    if (!entry || entry.type !== "message" || entry.message.role !== "user") {
      return NextResponse.json({ error: "User message not found" }, { status: 404 });
    }
    const content = typeof entry.message.content === "string"
      ? restorePromptMaterialDisplay(entry.message.content)
      : entry.message.content
          .filter((block): block is { type: "text"; text: string } => block.type === "text")
          .map((block) => restorePromptMaterialDisplay(block.text))
          .join("\n");
    return NextResponse.json({ content });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { SessionControlStore } from "@/lib/session-control-store";
import { resolveSessionPath } from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-manager";
import { resolvePromptMaterialReferences } from "@/lib/prompt-materials";
import { commandOperationView } from "@/lib/chat-command-events";

/** Read the durable send archive even when a prompt never reached model history. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = new SessionControlStore();
  const query = new URL(request.url).searchParams;
  const offset = Math.max(0, Number.parseInt(query.get("offset") ?? "0", 10) || 0);
  const headers = { "Cache-Control": "no-store" };
  const exists = async () => Boolean(getRpcSession(id) || await resolveSessionPath(id));
  const timingKeys = new Set(query.getAll("timingPromptId").slice(0, 128));
  if (query.get("view") === "timings") {
    const taskTimings = await store.readTaskTimings(id, timingKeys);
    return NextResponse.json({ taskTimings: taskTimings ?? [] }, { headers });
  }
  if (query.get("view") === "operations") {
    const page = await store.readOperationPage(id, {
      offset, trackedIds: new Set(query.getAll("trackedCommandId").slice(0, 100)),
      recoveredKeys: new Set(query.getAll("trackedPromptId").slice(0, 100)),
      timingKeys: query.get("scope") === "chat" ? timingKeys : undefined,
    });
    if (!page?.hasUiRecords && !await exists()) return NextResponse.json({ error: "会话不存在" }, { status: 404 });
    return NextResponse.json({ taskTiming: page?.taskTiming ?? null, taskTimings: page?.taskTimings ?? [],
      items: page?.commands.map(commandOperationView) ?? [], nextOffset: page?.nextOffset ?? null }, { headers });
  }
  const commandId = query.get("commandId");
  if (commandId) {
    const command = await store.queryByCommandId(id, commandId);
    if (command?.source !== "ui") return NextResponse.json({ error: "发送记录不存在" }, { status: 404 });
    try {
      const files = command.materials?.length ? resolvePromptMaterialReferences(command.materials).map((file) => ({ name: file.name, size: file.byteLength, text: readFileSync(file.path, "utf8"), kind: "file" as const })) : [];
      return NextResponse.json({ value: command.operation?.rawText ?? command.content, images: (command.images ?? []).map(({ data, mimeType }) => ({ data, mimeType })), files: [...files, ...(command.localFiles ?? []).map(file => ({ ...file, text: null }))], ...(command.operation?.inputOptions ? { commandInput: command.operation.inputOptions } : command.inputMode ? { commandInput: { inputMode: command.inputMode } } : {}) }, { headers });
    } catch {
      return NextResponse.json({ error: "附件无法完整读取，未恢复残缺内容。原发送记录仍保留。" }, { status: 409 });
    }
  }
  const page = await store.readArchivePage(id, offset);
  if (!page?.hasUiRecords && !await exists()) return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  return NextResponse.json({ items: page?.commands.map(item => ({ id: item.commandId, timestamp: item.acceptedAt, preview: item.content.slice(0, 180), attachments: (item.images?.length ?? 0) + (item.materials?.length ?? 0) })) ?? [],
    nextOffset: page?.nextOffset ?? null }, { headers });
}

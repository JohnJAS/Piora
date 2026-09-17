import { NextResponse } from "next/server";
import { savePromptFiles } from "@/lib/prompt-files";
import { MAX_PROMPT_MATERIAL_BYTES } from "@/lib/prompt-input-policy";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (Number(req.headers.get("content-length")) > MAX_PROMPT_MATERIAL_BYTES + 1024 * 1024) {
    return NextResponse.json({ error: "Attachments must total 100 MiB or less." }, { status: 413 });
  }
  try {
    const form = await req.formData();
    const files = form.getAll("files");
    if (files.some((file) => !(file instanceof File))) throw new Error("Invalid file attachment.");
    return NextResponse.json({ files: await savePromptFiles(files as File[]) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

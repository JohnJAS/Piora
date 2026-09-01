import { NextResponse } from "next/server";

import { invalidateServicesCache, reloadAllNormalSessionSystemPrompts } from "@/lib/rpc-manager";
import {
  createSystemPromptTemplate,
  deleteSystemPromptTemplate,
  readSystemPromptConfig,
  setDefaultSystemPromptTemplate,
  setSystemPromptSelectorVisible,
  SYSTEM_PROMPT_MAX_LENGTH,
  SYSTEM_PROMPT_TEMPLATE_NAME_MAX_LENGTH,
  updateSystemPromptTemplate,
  writeSystemPromptConfig,
  type SystemPromptConfig,
} from "@/lib/system-prompt-config";

function response(config: SystemPromptConfig, refresh?: { reloadedSessions: number; deferredSessions: number }) {
  const defaultTemplate = config.templates.find((template) => template.id === config.defaultTemplateId);
  return NextResponse.json({
    templates: config.templates,
    defaultTemplateId: config.defaultTemplateId,
    selectorVisible: config.selectorVisible,
    prompt: defaultTemplate?.prompt ?? null,
    updatedAt: config.updatedAt,
    maxLength: SYSTEM_PROMPT_MAX_LENGTH,
    maxPromptLength: SYSTEM_PROMPT_MAX_LENGTH,
    maxNameLength: SYSTEM_PROMPT_TEMPLATE_NAME_MAX_LENGTH,
    ...refresh,
  });
}

async function finishMutation(config: SystemPromptConfig) {
  invalidateServicesCache();
  return response(config, await reloadAllNormalSessionSystemPrompts());
}

export async function GET() {
  return response(readSystemPromptConfig());
}

/** Backward-compatible global default mutation. */
export async function PUT(request: Request) {
  try {
    const body = await request.json() as { prompt?: unknown };
    if (body.prompt !== null && typeof body.prompt !== "string") {
      return NextResponse.json({ error: "System prompt must be a string or null." }, { status: 400 });
    }
    return await finishMutation(writeSystemPromptConfig(body.prompt as string | null));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { name?: unknown; prompt?: unknown };
    return await finishMutation(createSystemPromptTemplate(body.name, body.prompt));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as {
      id?: unknown;
      name?: unknown;
      prompt?: unknown;
      selectorVisible?: unknown;
      defaultTemplateId?: unknown;
    };
    if (Object.hasOwn(body, "selectorVisible")) {
      return response(setSystemPromptSelectorVisible(body.selectorVisible));
    }
    const config = Object.hasOwn(body, "defaultTemplateId")
      ? setDefaultSystemPromptTemplate(body.defaultTemplateId)
      : updateSystemPromptTemplate(body.id, { name: body.name, prompt: body.prompt });
    return await finishMutation(config);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as { id?: unknown };
    return await finishMutation(deleteSystemPromptTemplate(body.id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

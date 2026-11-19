import { createTrustedModelServices, resolveModelRequestCwd } from "@/lib/model-runtime-context";
import { resolveVisibleModels } from "@/lib/model-scope";
import { modelSupportsImages } from "@/lib/model-capabilities";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";

interface ExtensionModelRequest {
  action?: string;
  selection?: { provider?: string; model?: string; cwd?: string };
  messages?: { content: { type: string; text?: string; attachment?: { data?: string; mediaType?: string } }[] }[];
}

export async function completeDesktopExtensionModel(value: unknown, signal: AbortSignal, imageRequired: boolean): Promise<string | true> {
  const input = value as ExtensionModelRequest | null;
  if (input?.action !== "check" && input?.action !== "complete") throw new Error("Invalid model action");
  const content: (TextContent | ImageContent)[] = [];
  for (const part of input.messages?.[0]?.content ?? []) {
    if (part?.type === "text" && typeof part.text === "string") content.push({ type: "text", text: part.text.slice(0, 16000) });
    if (part?.type === "image" && typeof part.attachment?.data === "string" && part.attachment.data.length <= 12 * 1024 * 1024
      && /^image\/(png|jpeg|gif|webp)$/.test(part.attachment.mediaType || "")) {
      content.push({ type: "image", data: part.attachment.data, mimeType: part.attachment.mediaType! });
    }
  }
  const containsImage = content.some(part => part.type === "image");
  const cwd = await resolveModelRequestCwd(imageRequired ? input.selection?.cwd : undefined);
  const services = await createTrustedModelServices(cwd);
  const scope = await resolveVisibleModels(services.modelRuntime, services.settingsManager.getEnabledModels());
  const requested = input.selection?.provider && input.selection.provider !== "piora";
  const model = requested ? scope.visible.find(model => model.provider === input.selection?.provider && model.id === input.selection?.model) : scope.visible[0];
  if (!model || (imageRequired || containsImage) && !modelSupportsImages(model)) {
    throw new Error(imageRequired
      ? "当前模型不可用或不支持图片，请选择支持图片的模型，或手动指定分类。"
      : "当前模型不可用或不支持所需输入，请选择兼容模型。");
  }
  if (input.action === "check") return true;
  if (imageRequired && !containsImage) throw new Error("No valid image");
  if (!content.length) throw new Error("No valid model input");
  signal.throwIfAborted();
  const result = await services.modelRuntime.completeSimple(model, { messages: [{ role: "user", content, timestamp: Date.now() }] },
    { maxTokens: 4096, maxRetries: 0, timeoutMs: 110000, signal });
  if (result.stopReason === "error" || result.stopReason === "aborted") throw new Error(result.errorMessage || "Extension model request failed");
  return result.content.filter(part => part.type === "text").map(part => part.text).join("");
}

import { createTrustedModelServices, ModelRequestCwdError, resolveModelRequestCwd } from "@/lib/model-runtime-context";
import { modelCapabilityKey, modelSupportsImages, writeConfiguredImageInput } from "@/lib/model-capabilities";
import { invalidateModelsCache } from "@/lib/models-cache";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const cwd = await resolveModelRequestCwd(new URL(req.url).searchParams.get("cwd"));
    const services = await createTrustedModelServices(cwd);
    return Response.json({ imageInput: Object.fromEntries(services.modelRuntime.getModels().map((model) => [modelCapabilityKey(model.provider, model.id), modelSupportsImages(model)])) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof ModelRequestCwdError ? error.status : 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json() as { cwd?: unknown; provider?: unknown; id?: unknown; imageInput?: unknown };
    if (body.cwd !== undefined && typeof body.cwd !== "string") throw new TypeError("cwd must be a string");
    if (typeof body.provider !== "string" || !body.provider.trim() || typeof body.id !== "string" || !body.id.trim() || typeof body.imageInput !== "boolean") throw new TypeError("provider, id, and imageInput are required");
    const cwd = await resolveModelRequestCwd(body.cwd);
    const services = await createTrustedModelServices(cwd);
    const model = services.modelRuntime.getModel(body.provider.trim(), body.id.trim());
    if (!model) return Response.json({ error: "Model not found" }, { status: 404 });
    writeConfiguredImageInput(model.provider, model.id, body.imageInput);
    invalidateModelsCache();
    return Response.json({ imageInput: body.imageInput });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof ModelRequestCwdError ? error.status : 400 });
  }
}

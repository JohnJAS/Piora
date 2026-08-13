import { InvalidJsonBodyError, JsonBodyTooLargeError, parseJsonWithinLimit } from "@/lib/bounded-json";
import { getHarmonyDeviceManager } from "@/lib/harmony";
import { HarmonyError } from "@/lib/harmony/errors";
import { hasJsonContentType } from "@/lib/request-security";
import { harmonyErrorResponse, noStoreJson, requireHarmonyAccess } from "../_shared";

export const dynamic = "force-dynamic";

function requiredString(body: Record<string, unknown>, key: string, max = 512): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new HarmonyError("INVALID_ARGUMENT", `${key} must be a non-empty string of at most ${max} characters`);
  }
  return value;
}

function coordinate(body: Record<string, unknown>, key: string): number {
  const value = body[key];
  if (!Number.isFinite(value) || Number(value) < 0 || Number(value) > 100_000) {
    throw new HarmonyError("INVALID_ARGUMENT", `${key} must be a coordinate between 0 and 100000`);
  }
  return Math.round(Number(value));
}

function generation(body: Record<string, unknown>): number | undefined {
  if (body.generation === undefined) return undefined;
  if (!Number.isInteger(body.generation) || Number(body.generation) < 0) {
    throw new HarmonyError("INVALID_ARGUMENT", "generation must be a non-negative integer");
  }
  return Number(body.generation);
}

export async function POST(request: Request) {
  const denied = requireHarmonyAccess(request);
  if (denied) return denied;
  if (!hasJsonContentType(request)) return noStoreJson({ error: "Content-Type must be application/json" }, { status: 415 });
  try {
    const body = await parseJsonWithinLimit(request, 16 * 1024) as Record<string, unknown>;
    const manager = getHarmonyDeviceManager();
    if (body.action === "emergency_stop") {
      const reason = typeof body.reason === "string" ? body.reason.slice(0, 160) : undefined;
      await manager.emergencyStop(reason);
      return noStoreJson({ stopped: true });
    }

    const serial = requiredString(body, "serial", 160);
    const leaseToken = requiredString(body, "leaseToken", 256);
    const common = { serial, leaseToken, signal: request.signal };
    let result: unknown;
    switch (body.action) {
      case "tap":
        result = await manager.tap({ ...common, x: coordinate(body, "x"), y: coordinate(body, "y"), generation: generation(body) });
        break;
      case "tap_ref":
        if (!Number.isInteger(body.generation) || Number(body.generation) < 0) throw new HarmonyError("INVALID_ARGUMENT", "tap_ref requires generation");
        result = await manager.tapRef({ ...common, ref: requiredString(body, "ref", 256), generation: Number(body.generation) });
        break;
      case "swipe": {
        const duration = body.durationMs === undefined ? undefined : Number(body.durationMs);
        if (duration !== undefined && (!Number.isFinite(duration) || duration < 50 || duration > 30_000)) {
          throw new HarmonyError("INVALID_ARGUMENT", "durationMs must be between 50 and 30000");
        }
        result = await manager.swipe({
          ...common,
          fromX: coordinate(body, "fromX"), fromY: coordinate(body, "fromY"),
          toX: coordinate(body, "toX"), toY: coordinate(body, "toY"),
          ...(duration === undefined ? {} : { durationMs: Math.round(duration) }),
          generation: generation(body),
        });
        break;
      }
      case "input_text":
        result = await manager.inputText({ ...common, text: requiredString(body, "text", 8_192) });
        break;
      case "press_key": {
        const key = requiredString(body, "key", 16);
        if (key !== "back" && key !== "home" && key !== "recents" && key !== "enter") {
          throw new HarmonyError("INVALID_ARGUMENT", "Unsupported key");
        }
        result = await manager.pressKey({ ...common, key });
        break;
      }
      case "launch_app": {
        const bundleName = requiredString(body, "bundleName", 255);
        const abilityName = typeof body.abilityName === "string" && body.abilityName.trim() ? body.abilityName : undefined;
        if (!/^[A-Za-z0-9_.]+$/.test(bundleName) || (abilityName && !/^[A-Za-z0-9_.$]+$/.test(abilityName))) {
          throw new HarmonyError("INVALID_ARGUMENT", "Invalid bundle or ability name");
        }
        result = await manager.launchApp({ ...common, bundleName, abilityName });
        break;
      }
      default:
        throw new HarmonyError("INVALID_ARGUMENT", "Unsupported device action");
    }
    return noStoreJson({ result });
  } catch (error) {
    if (error instanceof JsonBodyTooLargeError) return noStoreJson({ error: "Request body is too large" }, { status: 413 });
    if (error instanceof InvalidJsonBodyError) return noStoreJson({ error: "Invalid JSON body" }, { status: 400 });
    return harmonyErrorResponse(error);
  }
}

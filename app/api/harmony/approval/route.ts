import { randomUUID } from "node:crypto";
import { InvalidJsonBodyError, JsonBodyTooLargeError, parseJsonWithinLimit } from "@/lib/bounded-json";
import { HarmonyError } from "@/lib/harmony/errors";
import { hasJsonContentType } from "@/lib/request-security";
import { harmonyErrorResponse, noStoreJson, requireHarmonyAccess } from "../_shared";

export const dynamic = "force-dynamic";

type Approval = {
  id: string;
  serial: string;
  sessionId?: string;
  status: "pending" | "approved" | "denied" | "expired";
  createdAt: string;
  expiresAt: string;
};

declare global {
  var __pioraHarmonyApprovals: Map<string, Approval> | undefined;
}

function approvals(): Map<string, Approval> {
  return globalThis.__pioraHarmonyApprovals ??= new Map();
}

function sweep(): void {
  const now = Date.now();
  for (const [id, approval] of approvals()) {
    if (Date.parse(approval.expiresAt) > now) continue;
    if (approval.status === "pending") approval.status = "expired";
    if (Date.parse(approval.expiresAt) + 60_000 < now) approvals().delete(id);
  }
}

function publicApproval(approval: Approval) {
  return { ...approval, note: "Agent leases use Piora's native per-run confirmation; this endpoint is metadata-only and never grants a device lease." };
}

export async function GET(request: Request) {
  const denied = requireHarmonyAccess(request);
  if (denied) return denied;
  sweep();
  const id = new URL(request.url).searchParams.get("id");
  if (id) {
    const approval = approvals().get(id);
    return approval ? noStoreJson({ approval: publicApproval(approval) }) : noStoreJson({ error: "Approval not found" }, { status: 404 });
  }
  return noStoreJson({ approvals: [...approvals().values()].map(publicApproval) });
}

export async function POST(request: Request) {
  const denied = requireHarmonyAccess(request);
  if (denied) return denied;
  if (!hasJsonContentType(request)) return noStoreJson({ error: "Content-Type must be application/json" }, { status: 415 });
  try {
    sweep();
    const body = await parseJsonWithinLimit(request, 8 * 1024) as Record<string, unknown>;
    if (body.action === "request") {
      if (typeof body.serial !== "string" || !body.serial.trim() || body.serial.length > 160) {
        throw new HarmonyError("INVALID_ARGUMENT", "A valid serial is required");
      }
      if (approvals().size >= 32) throw new HarmonyError("INVALID_ARGUMENT", "Too many pending approvals");
      const now = Date.now();
      const approval: Approval = {
        id: randomUUID(),
        serial: body.serial,
        ...(typeof body.sessionId === "string" && body.sessionId.length <= 160 ? { sessionId: body.sessionId } : {}),
        status: "pending",
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 60_000).toISOString(),
      };
      approvals().set(approval.id, approval);
      return noStoreJson({ approval: publicApproval(approval) }, { status: 201 });
    }
    if (body.action === "resolve") {
      if (typeof body.id !== "string" || typeof body.approved !== "boolean") {
        throw new HarmonyError("INVALID_ARGUMENT", "id and approved are required");
      }
      const approval = approvals().get(body.id);
      if (!approval) return noStoreJson({ error: "Approval not found" }, { status: 404 });
      if (approval.status !== "pending") throw new HarmonyError("INVALID_ARGUMENT", "Approval is no longer pending");
      approval.status = body.approved ? "approved" : "denied";
      return noStoreJson({ approval: publicApproval(approval) });
    }
    throw new HarmonyError("INVALID_ARGUMENT", "Unsupported approval action");
  } catch (error) {
    if (error instanceof JsonBodyTooLargeError) return noStoreJson({ error: "Request body is too large" }, { status: 413 });
    if (error instanceof InvalidJsonBodyError) return noStoreJson({ error: "Invalid JSON body" }, { status: 400 });
    return harmonyErrorResponse(error);
  }
}

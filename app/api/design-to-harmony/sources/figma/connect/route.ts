import {
  designCredentialStatus,
  removeFigmaAccessToken,
  writeFigmaAccessToken,
} from "@/lib/design-to-harmony/credential-store";
import { designErrorResponse, noStoreDesignJson, readDesignJson } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return noStoreDesignJson({ status: designCredentialStatus() });
}

export async function POST(request: Request) {
  try {
    const body = await readDesignJson(request);
    return noStoreDesignJson({ status: writeFigmaAccessToken(body.token) });
  } catch (error) {
    return designErrorResponse(error);
  }
}

export async function DELETE() {
  try {
    return noStoreDesignJson({ status: removeFigmaAccessToken() });
  } catch (error) {
    return designErrorResponse(error);
  }
}

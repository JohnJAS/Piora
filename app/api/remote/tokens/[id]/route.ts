import { revokeRemoteCapabilityToken } from "@/lib/remote-control-store";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const revoked = await revokeRemoteCapabilityToken(id);
  return Response.json({ revoked }, { status: revoked ? 200 : 404, headers: { "Cache-Control": "no-store" } });
}

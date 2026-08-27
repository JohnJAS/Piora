import { getProjectlessChatWorkspace } from "@/lib/projectless-chat-server";

export async function GET() {
  try {
    return Response.json({ cwd: getProjectlessChatWorkspace() });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}

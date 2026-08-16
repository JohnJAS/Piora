import { getRoom, getRoomTask, listRoomArtifacts, listRoomAudit, listRoomMessages, listRoomTasks, subscribeRoomEvents } from "@/lib/room-store";
import { projectRoomTaskRun } from "@/lib/task-run";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const room = getRoom(id);
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        let closed = false;
        const send = (data: unknown) => {
          if (closed) return;
          try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch { closed = true; }
        };
        const taskRunFor = (taskId: string) => projectRoomTaskRun(getRoomTask(id, taskId), listRoomArtifacts(id));
        const unsubscribe = subscribeRoomEvents(id, (event) => {
          if (event.type === "task") send({ ...event, taskRun: projectRoomTaskRun(event.task, listRoomArtifacts(id)) });
          else if (event.type === "artifact" && event.artifact.taskId) send({ ...event, taskRun: taskRunFor(event.artifact.taskId) });
          else send(event);
        });
        const tasks = listRoomTasks(id);
        const artifacts = listRoomArtifacts(id);
        send({
          type: "snapshot",
          room,
          messages: listRoomMessages(id),
          tasks,
          taskRuns: tasks.map((task) => projectRoomTaskRun(task, artifacts)),
          artifacts,
          audit: listRoomAudit(id),
        });
        const heartbeat = setInterval(() => {
          if (!closed) {
            try { controller.enqueue(encoder.encode(":\n\n")); } catch { closed = true; }
          }
        }, 30_000);
        const cleanup = () => {
          if (closed) return;
          closed = true;
          clearInterval(heartbeat);
          unsubscribe();
          try { controller.close(); } catch { /* already closed */ }
        };
        request.signal.addEventListener("abort", cleanup, { once: true });
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 404 });
  }
}

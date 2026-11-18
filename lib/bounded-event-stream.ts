export function enqueueStreamFrame(controller: ReadableStreamDefaultController<Uint8Array>, frame: Uint8Array): boolean {
  const remaining = controller.desiredSize;
  if (remaining === null || (remaining < frame.byteLength && remaining < EVENT_STREAM_QUEUE_BYTES)) return false;
  controller.enqueue(frame);
  return true;
}

export const EVENT_STREAM_QUEUE_BYTES = 2 * 1024 * 1024;

export const eventStreamQueue = {
  highWaterMark: EVENT_STREAM_QUEUE_BYTES,
  size: (chunk: Uint8Array) => chunk.byteLength,
};

import { isAbsolute, resolve } from "node:path";

interface ShutdownMessage {
  type: "pi-desktop:shutdown";
}

const entryArgument = process.argv[2];
if (!entryArgument) {
  console.error("Standalone server entry was not provided");
  process.exit(1);
}

const serverEntry = isAbsolute(entryArgument) ? entryArgument : resolve(entryArgument);
let shutdownRequested = false;

function requestShutdown(): void {
  if (shutdownRequested) return;
  shutdownRequested = true;

  // Next installs a SIGTERM handler around its HTTP server. Emitting the event
  // through IPC also reaches that handler on Windows, where POSIX signal
  // delivery is not available. The timeout is a final safety net for stuck SSE
  // requests or extensions that keep the event loop alive.
  const handled = process.emit("SIGTERM");
  const forceExitTimer = setTimeout(() => process.exit(0), handled ? 5_000 : 50);
  forceExitTimer.unref();
}

process.on("message", (message: unknown) => {
  if (
    typeof message === "object"
    && message !== null
    && (message as ShutdownMessage).type === "pi-desktop:shutdown"
  ) {
    requestShutdown();
  }
});

process.on("disconnect", requestShutdown);

try {
  // The standalone output is CommonJS and resolves its traced dependencies
  // relative to its own location. Requiring the absolute entry preserves that
  // behavior while this small host owns the shutdown IPC channel.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require(serverEntry);
} catch (error) {
  console.error("Unable to start the Next standalone server", error);
  process.exit(1);
}

// Keep request ownership across Electron restarts; never replay browser writes.
export function createDesktopDevRelay(sendServer) {
  let shell;
  const pending = new Map();
  const failure = (message) => sendServer({ type: message.type.replace(/-request$/, "-response"), requestId: message.requestId, ok: false, error: "Desktop development shell disconnected; retry after Electron restarts." });
  return {
    attach(child) {
      shell = child;
      child.on("message", (message) => {
        if (shell !== child || !pending.has(message?.requestId)) return;
        pending.delete(message.requestId);
        sendServer(message);
      });
      const disconnect = () => {
        if (shell !== child) return;
        shell = undefined;
        for (const message of pending.values()) failure(message);
        pending.clear();
      };
      child.once("disconnect", disconnect);
      child.once("exit", disconnect);
    },
    receive(message) {
      if (!message || typeof message.type !== "string" || !message.type.startsWith("pi-desktop:")) return;
      const request = message.type.endsWith("-request");
      if (!shell?.connected) { if (request) failure(message); return; }
      if (request) pending.set(message.requestId, message);
      if (message.type.endsWith("-cancel")) pending.delete(message.requestId);
      const target = shell;
      target.send(message, (error) => {
        if (error && pending.get(message.requestId) === message) {
          pending.delete(message.requestId);
          failure(message);
        }
      });
    },
  };
}

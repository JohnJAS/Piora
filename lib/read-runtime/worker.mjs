import { parentPort } from "node:worker_threads";
import { readHistory } from "./session-history.mjs";
import { fileIndex } from "./file-index.mjs";

parentPort.on("message", async ({ id, operation, data, cancel }) => {
  const check = () => {
    if (Atomics.load(cancel, 0)) throw Object.assign(new Error("Local read cancelled"), { code: "ABORT_ERR" });
  };
  try {
    check();
    const result = operation.startsWith("file") ? await fileIndex(operation, data, check) : readHistory(operation, data, check);
    check();
    parentPort.postMessage({ id, result });
  } catch (error) {
    if (Atomics.load(cancel, 0)) parentPort.postMessage({ id });
    else parentPort.postMessage({ id, error: { message: error.message, code: error.code } });
  }
});

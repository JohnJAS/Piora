import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { resolveOrStartRpcSession, SessionRuntimeResolverError } = await jiti.import("./session-runtime-resolver.ts");

test("runtime resolver rejects invalid and unknown session ids with stable errors", async () => {
  await assert.rejects(() => resolveOrStartRpcSession(""), (error) => error instanceof SessionRuntimeResolverError && error.code === "INVALID_SESSION_ID");
  await assert.rejects(() => resolveOrStartRpcSession("00000000-0000-4000-8000-000000000000"), (error) => error instanceof SessionRuntimeResolverError && error.code === "SESSION_NOT_FOUND");
});

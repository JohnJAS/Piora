import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");

test("closes the session event stream only after prompt settlement or a pre-prompt failure", () => {
  const finishSource = source.slice(
    source.indexOf("const finishPromptWithoutStream"),
    source.indexOf("const waitForPromptSettlement"),
  );
  const agentEndSource = source.slice(
    source.indexOf('case "agent_end"'),
    source.indexOf('case "prompt_done"'),
  );
  const sendSource = source.slice(
    source.indexOf("  const handleSend = useCallback"),
    source.indexOf("  const executeBash = useCallback"),
  );

  assert.match(finishSource, /closeEvents\(\)/);
  assert.match(finishSource, /promptSettlementByRunRef\.current\.get\(runId\)/);
  assert.match(finishSource, /loadSession\(sid, false, true\)/);
  assert.doesNotMatch(agentEndSource, /closeEvents\(\)/);
  assert.doesNotMatch(agentEndSource, /loadSession\(/);
  assert.doesNotMatch(agentEndSource, /fetch\(/);
  assert.match(agentEndSource, /Keep the stream open until prompt_done/);
  assert.match(sendSource, /e instanceof AgentCommandError && e\.status >= 400 && e\.status < 500/);
  assert.match(sendSource, /if \(promptRequestStarted && sentSessionId && !definitivelyRejected\) \{[\s\S]*?waitForPromptSettlement/);
  assert.match(sendSource, /if \(promptRequestStarted && sentSessionId && !definitivelyRejected\) \{[\s\S]*?return;[\s\S]*?\}[\s\S]*?closeEvents\(\)/);
});

test("cancels stale session loads when switching tasks", () => {
  const loadSource = source.slice(
    source.indexOf("  const loadSession = useCallback"),
    source.indexOf("  const loadContext = useCallback"),
  );

  assert.match(loadSource, /sessionLoadAbortRef\.current\?\.abort\(\)/);
  assert.match(loadSource, /signal: controller\.signal/);
  assert.match(loadSource, /if \(controller\.signal\.aborted\) return null/);
  assert.match(loadSource, /throw await sessionResponseError\(res\)/);
});

test("settles the local stream as soon as the server accepts an abort", () => {
  const abortSource = source.slice(
    source.indexOf("  const handleAbort = useCallback"),
    source.indexOf("  const handleGoalPause = useCallback"),
  );

  assert.match(abortSource, /const runId = promptRunIdRef\.current/);
  assert.match(abortSource, /await sendAgentCommand\(sid, \{ type: "abort" \}\);[\s\S]*?await finishPromptWithoutStream\(sid, runId\)/);
});

test("keeps the first prompt as the new-session title and restores failed material drafts", () => {
  const sendSource = source.slice(
    source.indexOf("  const handleSend = useCallback"),
    source.indexOf("  const executeBash = useCallback"),
  );
  assert.ok(sendSource.indexOf("promoteNewSession(0, displayMessage.slice(0, 2_000))") < sendSource.indexOf("await ensureEventsConnected(sid)"));
  assert.match(sendSource, /uploadPromptMaterialFiles\(materialFiles\)/);
  assert.match(sendSource, /restoreFailedPrompt\(message, files, images\)/);
});

test("refreshes context usage during streaming and after assistant messages", () => {
  const reconcileSource = source.slice(
    source.indexOf("const reconcileAgentState"),
    source.indexOf("// Recovery net for missed SSE events"),
  );
  const messageUpdateSource = source.slice(
    source.indexOf('case "message_update"'),
    source.indexOf('case "message_end"'),
  );
  const messageEndSource = source.slice(
    source.indexOf('case "message_end"'),
    source.indexOf('case "tool_execution_start"'),
  );

  assert.ok(
    reconcileSource.indexOf("setContextUsage(state.contextUsage ?? null)")
      < reconcileSource.indexOf("if (busy || !agentRunningRef.current) return"),
  );
  assert.match(messageUpdateSource, /CONTEXT_USAGE_REFRESH_MS/);
  assert.match(messageUpdateSource, /refreshContextUsage\(sessionIdRef\.current\)/);
  assert.match(messageEndSource, /completed\?\.role === "assistant"[\s\S]*refreshContextUsage/);
});

test("browser tool execution does not force open the workspace panel", () => {
  const toolStartSource = source.slice(
    source.indexOf('case "tool_execution_start"'),
    source.indexOf('case "tool_execution_end"'),
  );

  assert.doesNotMatch(toolStartSource, /dispatchEvent|piora:show-browser/);
  assert.match(toolStartSource, /setAgentPhase/);
});

test("waits for the session scroll container before consuming the initial bottom scroll", () => {
  const scrollEffectSource = source.slice(
    source.indexOf("// Loading may publish the message array"),
    source.indexOf("// Load model list"),
  );

  assert.match(scrollEffectSource, /if \(loading \|\| messages\.length === 0\) return/);
  assert.match(scrollEffectSource, /startInitialBottomPin\(\)/);
  assert.match(scrollEffectSource, /\[messages\.length, agentRunning, liveOutputAutoScrollEnabled, loading,/);
});

test("pins a newly selected session to the bottom while async content settles", () => {
  const pinSource = source.slice(
    source.indexOf("const startInitialBottomPin"),
    source.indexOf("const handleScrollToBottom"),
  );
  const userIntentSource = source.slice(
    source.indexOf("const markUserScrollIntent"),
    source.indexOf("const handleScrollPositionChange"),
  );

  assert.match(pinSource, /new ResizeObserver\(schedulePin\)/);
  assert.match(pinSource, /container\.addEventListener\("load", schedulePin, true\)/);
  assert.match(pinSource, /pinToBottom\(\)[\s\S]*schedulePin\(\)/);
  assert.match(userIntentSource, /stopInitialBottomPin\(\)/);
});

test("keeps live session output pinned to the newest content", () => {
  const livePinStart = source.lastIndexOf(
    "useLayoutEffect(() => {",
    source.indexOf("const pinLiveOutputToBottom"),
  );
  const livePinSource = source.slice(
    livePinStart,
    source.indexOf("// Loading may publish the message array"),
  );

  assert.match(livePinSource, /if \(!liveOutputAutoScrollEnabled \|\| !agentRunning \|\| loading\) return/);
  assert.match(livePinSource, /scrollToBottom\("instant"\)/);
  assert.match(livePinSource, /if \(!liveOutputFollowRef\.current\) return/);
  assert.match(livePinSource, /new ResizeObserver\(schedulePin\)/);
  assert.match(livePinSource, /container\.addEventListener\("load", schedulePin, true\)/);
  assert.match(livePinSource, /pinLiveOutputToBottom\(\)[\s\S]*schedulePin\(\)/);
  assert.match(source, /completionScrollAllowedRef\.current && liveOutputAutoScrollEnabled/);
});

test("manual scrolling pauses live follow until jump-to-latest resumes it", () => {
  const scrollIntentSource = source.slice(
    source.indexOf("const markUserScrollIntent"),
    source.indexOf("// Load session on mount"),
  );
  const jumpSource = source.slice(
    source.indexOf("const handleScrollToBottom"),
    source.indexOf("const scrollUserMsgToTop"),
  );

  assert.match(scrollIntentSource, /event instanceof WheelEvent/);
  assert.match(scrollIntentSource, /target\?\.closest\("\.chat-column-scroll-rail"\)/);
  assert.match(scrollIntentSource, /liveOutputFollowRef\.current = false/);
  assert.match(scrollIntentSource, /setLiveOutputFollowPaused\(true\)/);
  assert.match(jumpSource, /liveOutputFollowRef\.current = true/);
  assert.match(jumpSource, /setLiveOutputFollowPaused\(false\)/);
  assert.match(source, /case "agent_start":[\s\S]*liveOutputFollowRef\.current = true;[\s\S]*setLiveOutputFollowPaused\(false\)/);
  assert.match(source, /window\.addEventListener\("pointerdown", markUserScrollIntent, \{ capture: true, passive: true \}\)/);
  assert.match(source, /window\.addEventListener\("wheel", markUserScrollIntent, \{ capture: true, passive: true \}\)/);
});

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
  assert.doesNotMatch(agentEndSource, /closeEvents\(\)/);
  assert.match(agentEndSource, /Keep the stream open until prompt_done/);
  assert.match(sendSource, /if \(promptRequestStarted && sentSessionId\) \{[\s\S]*?waitForPromptSettlement/);
  assert.match(sendSource, /if \(promptRequestStarted && sentSessionId\) \{[\s\S]*?return;[\s\S]*?\}[\s\S]*?closeEvents\(\)/);
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

test("waits for the session scroll container before consuming the initial bottom scroll", () => {
  const scrollEffectSource = source.slice(
    source.indexOf("// Loading may publish the message array"),
    source.indexOf("// Load model list"),
  );

  assert.match(scrollEffectSource, /if \(loading \|\| messages\.length === 0\) return/);
  assert.match(scrollEffectSource, /scrollToBottom\("instant"\)[\s\S]*requestAnimationFrame\(\(\) => scrollToBottom\("instant"\)\)/);
  assert.match(scrollEffectSource, /\[messages\.length, agentRunning, loading,/);
});

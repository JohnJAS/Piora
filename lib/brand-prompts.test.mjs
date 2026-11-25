import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { Type } from "typebox";
import { createJiti } from "jiti";

const nativeRequire = createRequire(import.meta.url);
const harmonyContracts = await createJiti(import.meta.url).import("./harmony/contracts/actions.ts");
const libDir = dirname(fileURLToPath(import.meta.url));

async function loadModule(file, brand) {
  const entryPath = fileURLToPath(new URL(file, import.meta.url));
  const cache = new Map();
  const sources = new Map();

  async function preload(filePath) {
    const resolved = resolve(filePath);
    if (sources.has(resolved)) return;
    const text = await readFile(resolved, "utf8");
    sources.set(resolved, text);
    for (const match of text.matchAll(/from\s+["'](\.[^"']+\.ts)["']/g)) {
      const target = resolve(dirname(resolved), match[1]);
      if (target.includes("prompt-runtime") || target.endsWith("atomic-file.ts")) {
        await preload(target);
      }
    }
  }
  await preload(entryPath);

  function compileAndRun(filePath) {
    const resolved = resolve(filePath);
    if (cache.has(resolved)) return cache.get(resolved);
    const source = sources.get(resolved);
    if (source === undefined) return {};
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports = {};
    cache.set(resolved, exports);
    runInNewContext(compiled, {
      exports,
      process,
      Buffer,
      console,
      setTimeout,
      clearTimeout,
      require: (id) => {
        if (/branding(?:\.ts)?$/.test(id)) return { APP_DISPLAY_NAME: brand };
        // This fixture tests help/brand copy of the explicitly retained workbench.
        if (id.endsWith("mirror-mode.ts")) return { harmonyWorkbenchEnabled: () => true };
        if (id.endsWith("harmony/contracts/actions.ts")) return harmonyContracts;
        if (id.startsWith("node:")) return nativeRequire(id);
        if (id === "typebox") return { Type };
        if (id === "@earendil-works/pi-coding-agent") {
          return {
            defineTool: (value) => value,
            getAgentDir: () => process.env.PI_CODING_AGENT_DIR || libDir,
          };
        }
        if (id.startsWith(".")) {
          const target = resolve(dirname(resolved), id);
          if (sources.has(target)) return compileAndRun(target);
        }
        // Registration and prompt generation must not start browsers or jobs.
        return {};
      },
    });
    return exports;
  }

  return compileAndRun(entryPath);
}

for (const brand of ["Piora", "ExampleApp"]) {
  test(`${brand} room and device tool copy retains stable tool identifiers`, async () => {
    for (const [file, expectedName] of [["piora-room.ts", "piora_room"]]) {
      const extension = await loadModule(`../extensions/${file}`, brand);
      const tools = [];
      extension.default({ registerTool: tool => tools.push(tool), registerCommand() {}, on() {} });
      assert.ok(tools.some(tool => tool.name === expectedName));
      const copy = tools.flatMap(tool => [tool.label, tool.description, tool.promptSnippet, ...(tool.promptGuidelines ?? [])]).filter(Boolean).join("\n");
      assert.ok(copy.includes(brand));
      if (brand !== "Piora") assert.doesNotMatch(copy, /\bPiora\b/);
    }
    const harmony = await loadModule("../extensions/piora-harmony.ts", brand);
    const tools = [];
    harmony.default({ registerTool: tool => tools.push(tool), on() {} });
    assert.equal(tools[0].name, "harmony_control");
    const help = await tools[0].execute("test", { operation: "help" });
    assert.doesNotMatch(help.content[0].text, /\bPiora\b/);
  });

  test(`${brand} tool descriptions and injected capabilities use the build identity without rewriting input`, async (t) => {
    const agentDir = mkdtempSync(join(tmpdir(), "piora-brand-prompts-"));
    const previousDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    t.after(() => {
      if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousDir;
      rmSync(agentDir, { recursive: true, force: true });
    });
    mkdirSync(join(agentDir, "piora"), { recursive: true });
    writeFileSync(join(agentDir, "piora", "runtime-prompt.json"), JSON.stringify({
      version: 1,
      mergeCompact: true,
      alignCliCompaction: true,
      extensions: { browser: true, automations: true, userInput: true },
    }), "utf8");

    for (const [file, toolName] of [["piora-browser.ts", "browser"], ["piora-automations.ts", "piora_automation"], ["piora-user-input.ts", "piora_request_user_input"]]) {
      const extension = await loadModule(`../extensions/${file}`, brand);
      const tools = [];
      const handlers = new Map();
      extension.default({ registerTool: tool => tools.push(tool), on: (event, handler) => handlers.set(event, handler) });
      const tool = tools.find(candidate => candidate.name === toolName);
      assert.ok(tool, `${toolName} identifier stays stable`);
      for (const copy of [tool.description, tool.promptSnippet]) {
        assert.ok(copy.includes(brand));
        if (brand !== "Piora") assert.doesNotMatch(copy, /\bPiora\b/);
      }
      const original = "User-owned prompt: Piora, PIORA, ExampleApp, PIORA_BROWSER_EXECUTABLE, piora_automation. 不要改我的原文。";
      const before = handlers.get("before_agent_start");
      const activeEvent = {
        systemPrompt: original,
        systemPromptOptions: { selectedTools: [toolName], appendSystemPrompt: "" },
      };
      assert.equal(await before(activeEvent), undefined);
      const injected = activeEvent.systemPromptOptions.appendSystemPrompt;
      assert.ok(injected.includes(brand));
      assert.match(injected, /<piora_runtime>/);
      if (brand !== "Piora") assert.doesNotMatch(injected, /\bPiora\b/);

      const emptyEvent = { systemPrompt: original, systemPromptOptions: { selectedTools: [], appendSystemPrompt: "" } };
      assert.equal(await before(emptyEvent), undefined);
      assert.equal(emptyEvent.systemPromptOptions.appendSystemPrompt, "");

      const beforeSecond = activeEvent.systemPromptOptions.appendSystemPrompt;
      assert.equal(await before(activeEvent), undefined);
      assert.equal(activeEvent.systemPromptOptions.appendSystemPrompt, beforeSecond, "capability remains deduplicated");
    }
  });

  test(`${brand} extension display names and Shell Agent identity follow the brand`, async () => {
    const { FIRST_PARTY_EXTENSIONS } = await loadModule("./first-party-extensions.ts", brand);
    for (const extension of FIRST_PARTY_EXTENSIONS) {
      assert.ok(extension.name.startsWith(brand + " "));
      assert.ok(extension.id.startsWith("piora:"));
      assert.ok(extension.fileName.startsWith("piora-"));
    }
    const source = await readFile(new URL("./shell/agent.ts", import.meta.url), "utf8");
    const parsed = ts.createSourceFile("agent.ts", source, ts.ScriptTarget.Latest, true);
    let initializer;
    function visit(node) {
      if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === "SYSTEM_PROMPT") initializer = node.initializer.getText(parsed);
      ts.forEachChild(node, visit);
    }
    visit(parsed);
    assert.ok(initializer);
    const prompt = runInNewContext(initializer, { APP_DISPLAY_NAME: brand });
    assert.ok(prompt.startsWith(`You are ${brand}'s Shell Agent`));
  });
}

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const cwdHandler = source.slice(
  source.indexOf("const handleCwdChange"),
  source.indexOf("const handleSelectSession"),
);

const syntax = ts.createSourceFile("AppShell.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let selectionCallback;
let nativeUrlReplacement;
let selectionHistoryState;
let historyRestorationCallback;
function findSelectionHandlers(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(syntax) === "handleSelectSession") {
    assert.ok(node.initializer && ts.isCallExpression(node.initializer));
    selectionCallback = node.initializer.arguments[0];
    assert.ok(ts.isArrowFunction(selectionCallback));
  }
  if (ts.isFunctionDeclaration(node) && node.name?.text === "replaceUrlWithoutNextNavigation") {
    nativeUrlReplacement = node;
  }
  if (ts.isFunctionDeclaration(node) && node.name?.text === "getSelectionHistoryState") {
    selectionHistoryState = node;
  }
  if (ts.isCallExpression(node) && node.expression.getText(syntax) === "useEffect"
    && node.arguments[0]?.getText(syntax).includes('window.addEventListener("popstate", restore)')) {
    historyRestorationCallback = node.arguments[0];
  }
  ts.forEachChild(node, findSelectionHandlers);
}
findSelectionHandlers(syntax);
assert.ok(selectionCallback && nativeUrlReplacement && selectionHistoryState, "run the actual AppShell selection callback and URL helpers");

function createSelectionHarness(selectedId, {
  isMobile = false,
  href = "https://piora.test/",
  initialHistoryState = { __NA: true, _N: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { tree: "retained" }, ownedCustomData: "retained" },
} = {}) {
  const calls = new Map();
  const values = new Map([["setSessionKey", 0]]);
  const frameCallbacks = [];
  const historyWrites = [];
  const location = { href };
  const history = {
    state: initialHistoryState,
    replaceState(state, title, url) {
      historyWrites.push({ state, title, url });
      history.state = state;
      location.href = new URL(url, location.href).href;
    },
  };
  const context = {
    isMobile,
    selectedSessionIdRef: { current: selectedId },
    suppressCwdBumpRef: { current: false },
    workspaceNavigationVersionRef: { current: 0 },
    chatInputRef: { current: { focus: () => calls.set("focus", (calls.get("focus") ?? 0) + 1) } },
    fetch: () => assert.fail("selection must not wait for data"),
    window: { history, location, requestAnimationFrame: (callback) => frameCallbacks.push(callback) },
  };
  for (const name of [
    "setSettingsDialogOpen", "setHistoryDialogOpen", "setHistoryLocation", "setSelectedRoom",
    "setActiveTopPanel", "setNewSessionCwd", "setNewSessionInitialModel", "setNewSessionInitialPrompt",
    "setSelectedSession", "setFocusedEntryId", "setSessionKey", "setSystemPrompt",
    "setInitialSessionRestored", "setSidebarOpen",
  ]) {
    context[name] = (value) => {
      calls.set(name, [...(calls.get(name) ?? []), value]);
      values.set(name, typeof value === "function" ? value(values.get(name)) : value);
    };
  }
  const sandbox = vm.createContext(context);
  const transpile = (text) => ts.transpileModule(text, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  vm.runInContext(transpile(`${selectionHistoryState.getText(syntax)}\n${nativeUrlReplacement.getText(syntax)}`), sandbox);
  const select = vm.runInContext(transpile(`(${selectionCallback.getText(syntax)})`), sandbox);
  return {
    select, calls, values, historyWrites, location, context, initialHistoryState,
    run: text => vm.runInContext(transpile(text), sandbox),
    flushFrames() { while (frameCallbacks.length) frameCallbacks.shift()(); },
    pendingFrames: () => frameCallbacks.length,
  };
}

test("selecting a session in another project survives cwd synchronization", () => {
  assert.match(cwdHandler, /const cwdBelongsToSelectedSession = selectedSession\?\.cwd === cwd/);
  assert.match(cwdHandler, /const cwdBelongsToSelectedRoom = Boolean/);
  assert.match(
    cwdHandler,
    /if \(!cwdBelongsToCurrentSelection\) \{[\s\S]*?setSelectedSession\(null\);[\s\S]*?setSelectedRoom\(null\);[\s\S]*?setSessionKey/,
  );
  assert.match(
    cwdHandler,
    /if \(!cwdBelongsToCurrentSelection\) \{\s*replaceUrlWithoutNextNavigation\("\/"\);\s*\}/,
  );
});

test("the file panel and new file tabs use the selected worktree before sidebar cwd catches up", () => {
  const declarations = new Map();
  let panelCwd;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) declarations.set(node.name.text, node.initializer.getText(syntax));
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (node.tagName.getText(syntax) === "RightPanel") {
        const attribute = node.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(syntax) === "cwd");
        panelCwd = attribute?.initializer?.expression?.getText(syntax);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(syntax);
  assert.ok(panelCwd);
  const activeCwd = "F:\\Piora";
  const worktree = "F:\\Piora-worktrees\\feature";
  const mirroredRoom = "F:\\room-workspace";
  const getCwd = ts.transpileModule(`
    ${["chatWorkspaceCwd", "isProjectlessConversation", "workspaceCwd"].filter(name => declarations.has(name)).map(name => `const ${name} = ${declarations.get(name)};`).join("\n")}
    (${declarations.get("handleOpenFile")})(file, "readme.md");
    ${panelCwd};
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const [selection, expected] of [
    [{ selectedSession: { cwd: worktree, projectRoot: activeCwd } }, worktree],
    [{ newSessionCwd: worktree }, worktree],
    [{ selectedRoom: { workspace: { path: mirroredRoom } }, selectedSession: { cwd: worktree } }, mirroredRoom],
    [{ selectedSession: { cwd: "F:\\scratch", projectless: true } }, null],
    [{}, activeCwd],
  ]) {
    let tabs = [];
    let fileNavMode = "run";
    const noop = () => {};
    assert.equal(vm.runInNewContext(getCwd, {
      activeCwd, isMobile: false, newSessionCwd: null, effectiveNewSessionCwd: selection.newSessionCwd ?? null,
      selectedRoom: null, selectedSession: null, isProjectlessChatCwd: () => false, ...selection,
      file: `${expected ?? "F:\\scratch"}\\readme.md`, useCallback: callback => callback,
      setFileTabs: update => { tabs = update(tabs); }, setClosedFileTabs: noop,
      setFileNavMode: mode => { fileNavMode = mode; },
      setActiveFileTabId: noop, setRightPanelTab: noop, setRightPanelOpen: noop,
    }), expected);
    assert.equal(tabs[0].cwd, expected ?? undefined);
    assert.equal(fileNavMode, "tree", "opening a regular file leaves the per-run diff view");
  }
});

test("selection URL updates permit native Next synchronization with an empty history state", async () => {
  const session = { id: "owned-session-1", cwd: "F:\\Piora" };
  for (const initialHistoryState of [null, {}]) {
    const harness = createSelectionHarness(session.id, { initialHistoryState });
    await harness.select(session);
    assert.equal(new URL(harness.location.href).searchParams.get("session"), session.id);
    assert.equal(harness.historyWrites.length, 1);
    assert.deepEqual(Object.keys(harness.historyWrites[0].state), []);
    assert.equal(harness.calls.has("setSessionKey"), false);
  }
});

test("session selection restores focus to the remounted composer", () => {
  const selectionHandler = source.slice(
    source.indexOf("const handleSelectSession"),
    source.indexOf("const handleNewSession"),
  );
  assert.match(selectionHandler, /requestAnimationFrame[^]*chatInputRef\.current\?\.focus\(\)/);
});

test("clicking the selected session restores its URL without remounting the chat", async () => {
  const session = { id: "owned-session-1", cwd: "F:\\Piora" };
  const harness = createSelectionHarness(session.id);
  await harness.select(session);

  assert.equal(new URL(harness.location.href).searchParams.get("session"), session.id);
  assert.equal(harness.historyWrites.length, 1);
  assert.equal(Object.hasOwn(harness.historyWrites[0].state, "__NA"), false);
  assert.equal(Object.hasOwn(harness.historyWrites[0].state, "_N"), false);
  assert.equal(harness.historyWrites[0].state.ownedCustomData, "retained");
  assert.equal(harness.historyWrites[0].state.__PRIVATE_NEXTJS_INTERNALS_TREE,
    harness.initialHistoryState.__PRIVATE_NEXTJS_INTERNALS_TREE);
  assert.equal(harness.initialHistoryState.__NA, true, "the stored state is not mutated before Next copies its data");
  assert.equal(harness.initialHistoryState._N, true);
  assert.deepEqual(harness.calls.get("setActiveTopPanel"), [null]);
  for (const setter of ["setSessionKey", "setSelectedSession", "setNewSessionCwd", "setFocusedEntryId"]) {
    assert.equal(harness.calls.has(setter), false, `${setter} must not disturb the current chat`);
  }
  assert.equal(harness.pendingFrames(), 0);
});

test("clicking another session immediately selects it, updates the URL and closes the mobile drawer", () => {
  const session = { id: "owned-session-2", cwd: "F:\\Piora" };
  const harness = createSelectionHarness("owned-session-1", { isMobile: true });
  void harness.select(session);

  assert.equal(new URL(harness.location.href).searchParams.get("session"), session.id);
  assert.equal(harness.context.selectedSessionIdRef.current, session.id);
  assert.deepEqual(harness.calls.get("setSelectedSession"), [session]);
  assert.equal(harness.calls.get("setSessionKey").length, 1);
  assert.equal(harness.calls.get("setSessionKey")[0](4), 5);
  assert.deepEqual(harness.calls.get("setSidebarOpen"), [false]);
  assert.equal(harness.context.suppressCwdBumpRef.current, false);
  harness.flushFrames();
  assert.equal(harness.calls.get("focus"), 1);
});

test("restoring a session from history never rewrites the URL", async () => {
  const session = { id: "owned-session-1", cwd: "F:\\Piora" };
  const href = `https://piora.test/?session=${session.id}&entry=owned-entry`;
  for (const selectedId of [session.id, "owned-session-2"]) {
    const harness = createSelectionHarness(selectedId, { href, isMobile: true });
    await harness.select(session, true);

    assert.equal(harness.location.href, href);
    assert.equal(harness.historyWrites.length, 0);
    assert.deepEqual(harness.calls.get("setSelectedSession"), [session]);
    assert.equal(harness.calls.get("setSessionKey").length, 1);
    assert.equal(harness.context.suppressCwdBumpRef.current, true);
    assert.equal(harness.calls.has("setHistoryLocation"), false);
    assert.equal(harness.calls.has("setFocusedEntryId"), false);
    assert.equal(harness.calls.has("setSidebarOpen"), false);
    assert.equal(harness.pendingFrames(), 0);
  }
});

test("a cold selection commits its search anchor in the click handler", () => {
  const h = createSelectionHarness("old");
  const session = { id: "next", modified: "sidebar-old", cwd: "C:/next" };
  void h.select(session, false, "target-entry");
  assert.deepEqual(h.calls.get("setSelectedSession"), [session]);
  assert.equal(h.calls.get("setSessionKey").length, 1);
  assert.deepEqual(h.calls.get("setFocusedEntryId"), ["target-entry"]);
  assert.equal(new URL(h.location.href).searchParams.get("entry"), "target-entry");
});

test("rapid selections update the target before a React render and invalidate older navigation", () => {
  const h = createSelectionHarness("old");
  const previousVersion = h.context.workspaceNavigationVersionRef.current;
  void h.select({ id: "first" });
  void h.select({ id: "last" });
  void h.select({ id: "last" });
  assert.deepEqual(h.calls.get("setSelectedSession").map(session => session.id), ["first", "last"]);
  assert.equal(h.calls.get("setSessionKey").length, 2);
  assert.equal(h.context.selectedSessionIdRef.current, "last");
  assert.equal(new URL(h.location.href).searchParams.get("session"), "last");
  assert.ok(h.context.workspaceNavigationVersionRef.current > previousVersion);
});

test("a search hit in the selected chat updates its anchor without remounting or reloading",async()=>{
  const h=createSelectionHarness("same");
  await h.select({id:"same"},false,"same-entry");
  assert.deepEqual(h.calls.get("setFocusedEntryId"),["same-entry"]);
  assert.equal(h.calls.has("setSessionKey"),false);
  assert.equal(new URL(h.location.href).searchParams.get("entry"),"same-entry");
});

test("returning through history to the current chat cancels an in-flight replacement", async () => {
  let release, restore;
  const fetches = [];
  const h = createSelectionHarness("current", { href: "https://piora.test/?session=next" });
  Object.defineProperty(h.location, "search", { get: () => new URL(h.location.href).search });
  Object.assign(h.context, {
    AbortController, URLSearchParams, handleSelectSession: h.select,
    resolveNavigationSession: (id, signal) => new Promise(resolve => {
      fetches.push({ id, signal });
      release = () => resolve({ id });
    }),
    readHistoryLocation: () => ({ open: false, leafId: null, entryId: null }),
  });
  h.context.window.addEventListener = (_type, callback) => { restore = callback; };
  h.context.window.removeEventListener = () => {};
  const cleanup = h.run(`(${historyRestorationCallback.getText(syntax)})`)();
  restore();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.context.selectedSessionIdRef.current, "current");
  assert.equal(fetches.length, 1);
  assert.equal(fetches[0].id, "next");
  h.location.href = "https://piora.test/?session=current";
  restore();
  assert.equal(fetches[0].signal.aborted, true);
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.context.selectedSessionIdRef.current, "current");
  assert.equal(h.calls.has("setSessionKey"), false);
  assert.equal(h.historyWrites.length, 0);
  cleanup();
});

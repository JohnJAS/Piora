import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const { webpack } = require("next/dist/compiled/webpack/webpack.js");
const repo = path.resolve(import.meta.dirname, "..");

test("FloatingStepProgressPill hides on Goal completion, supports manual dismiss, and auto-dismisses settled steps", { timeout: 180_000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "piora-step-pill-ui-"));
  let browser;
  try {
    await writeFile(
      path.join(dir, "ts.cjs"),
      `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText`,
    );
    await writeFile(
      path.join(dir, "css.cjs"),
      `module.exports=s=>'export default '+JSON.stringify(Object.fromEntries([...s.matchAll(/\\.([a-zA-Z][\\w-]*)/g)].map(m=>[m[1],m[1]])))`,
    );
    await writeFile(
      path.join(dir, "empty.tsx"),
      `import React from 'react';
export const ComposerPendingRequestPanel=()=>null;
export const EditGoalDialog=()=>null;
export const ReplaceGoalDialog=()=>null;
export const ResumePausedGoalDialog=()=>null;
export const AliIcon=({name})=><span>{name}</span>;`,
    );
    await writeFile(
      path.join(dir, "entry.tsx"),
      `import React from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '@/hooks/useI18n';
import { ChatWorkflowDock } from '@/components/workflow/ChatWorkflowDock';
import { FloatingStepProgressPill } from '@/components/workflow/FloatingStepProgressPill';

function App() {
  const [snapshot, setSnapshot] = React.useState({
    sessionId: 's1',
    revision: 1,
    mode: 'goal',
    turnBudget: 5,
    current: {
      id: 'goal-1',
      kind: 'goal',
      status: 'running',
      objective: 'Finish work',
      title: '',
      markdown: '',
      criteria: [],
      progress: 'Working',
      reason: '',
      turnBudget: 5,
      turnsUsed: 1,
      version: 1,
      createdAt: 1,
      updatedAt: 1,
      noProgressTurns: 0,
    },
    todoSteps: [
      { id: '1', label: 'Inspect', status: 'completed' },
      { id: '2', label: 'Verify', status: 'in_progress' },
    ],
    history: [],
  });
  const [running, setRunning] = React.useState(true);
  const [standaloneSteps, setStandaloneSteps] = React.useState([]);
  const [standaloneRunning, setStandaloneRunning] = React.useState(false);

  window.setDockState = ({ snapshot: nextSnapshot, running: nextRunning }) => {
    if (nextSnapshot !== undefined) setSnapshot(nextSnapshot);
    if (nextRunning !== undefined) setRunning(nextRunning);
  };
  window.setStandalone = ({ steps, running: nextRunning }) => {
    if (steps !== undefined) setStandaloneSteps(steps);
    if (nextRunning !== undefined) setStandaloneRunning(nextRunning);
  };

  return (
    <I18nProvider>
      <div data-testid="dock-host">
        <ChatWorkflowDock
          sessionId={snapshot?.sessionId ?? 's1'}
          snapshot={snapshot}
          busy={false}
          running={running}
          enabled={true}
          settingsReady={true}
          error={null}
          onRespondUserInput={() => {}}
          onAction={async () => true}
          onAcceptSnapshot={() => {}}
          onRefresh={async () => {}}
          onFocusComposer={() => {}}
          onEnterGoalDraft={() => {}}
          replaceGoalRequest={null}
          onClearReplaceGoalRequest={() => {}}
          pausedGoalSubmission={null}
          onClearPausedGoalSubmission={() => {}}
        />
      </div>
      <div data-testid="standalone-host">
        <FloatingStepProgressPill
          steps={standaloneSteps}
          sessionId="standalone-session"
          running={standaloneRunning}
          autoDismissMs={180}
        />
      </div>
    </I18nProvider>
  );
}
createRoot(document.getElementById('root')).render(<App />);`,
    );

    const compiler = webpack({
      mode: "development",
      target: "web",
      devtool: false,
      entry: path.join(dir, "entry.tsx"),
      output: { path: dir, filename: "bundle.js", publicPath: "/" },
      resolve: { extensions: [".tsx", ".ts", ".js"], modules: [path.join(repo, "node_modules")], alias: { "@": repo } },
      plugins: [
        new webpack.NormalModuleReplacementPlugin(
          /^(\.\/ComposerPendingRequestPanel|\.\/GoalDialogs|\.\.\/AliIcon)$/,
          path.join(dir, "empty.tsx"),
        ),
      ],
      module: {
        rules: [
          { test: /\.tsx?$/, exclude: /node_modules/, use: path.join(dir, "ts.cjs") },
          { test: /\.css$/, use: path.join(dir, "css.cjs") },
        ],
      },
    });
    await new Promise((resolve, reject) =>
      compiler.run((error, stats) =>
        compiler.close(() => (error || stats.hasErrors() ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve())),
      ),
    );

    browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : "chromium", headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.route("http://step-pill.test/**", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.endsWith(".js")) {
        return route.fulfill({ contentType: "text/javascript", body: await readFile(path.join(dir, path.basename(pathname))) });
      }
      if (pathname.startsWith("/api/agent/") && pathname.endsWith("/changes")) {
        return route.fulfill({ json: { files: [] } });
      }
      return route.fulfill({ contentType: "text/html", body: '<div id="root"></div><script src="/bundle.js"></script>' });
    });

    await page.goto("http://step-pill.test/");

    const dockPill = page.locator('[data-testid="dock-host"] [data-testid="floating-step-progress-pill"]');
    await dockPill.waitFor({ state: "visible" });

    // Completing Goal hides both GoalComposerRail and FloatingStepProgressPill immediately.
    await page.evaluate(() => {
      window.setDockState({
        running: true,
        snapshot: {
          sessionId: "s1",
          revision: 2,
          mode: "goal",
          turnBudget: 5,
          current: {
            id: "goal-1",
            kind: "goal",
            status: "completed",
            objective: "Finish work",
            title: "",
            markdown: "",
            criteria: [{ id: "c1", text: "Done", status: "verified", evidence: "ok" }],
            steps: [
              { id: "1", label: "Inspect", status: "completed" },
              { id: "2", label: "Verify", status: "completed" },
            ],
            progress: "All done",
            reason: "",
            turnBudget: 5,
            turnsUsed: 1,
            version: 1,
            createdAt: 1,
            updatedAt: 2,
            noProgressTurns: 0,
          },
          history: [],
        },
      });
    });
    await dockPill.waitFor({ state: "detached" });

    // Even legacy persisted completed snapshots with stale todoSteps hide once idle.
    await page.evaluate(() => {
      window.setDockState({
        running: false,
        snapshot: {
          sessionId: "s1",
          revision: 3,
          mode: "goal",
          turnBudget: 5,
          current: {
            id: "goal-1",
            kind: "goal",
            status: "completed",
            objective: "Finish work",
            title: "",
            markdown: "",
            criteria: [],
            steps: [{ id: "1", label: "Inspect", status: "completed" }],
            progress: "All done",
            reason: "",
            turnBudget: 5,
            turnsUsed: 1,
            version: 1,
            createdAt: 1,
            updatedAt: 3,
            noProgressTurns: 0,
          },
          todoSteps: [{ id: "1", label: "Inspect", status: "completed" }],
          history: [],
        },
      });
    });
    assert.equal(await dockPill.count(), 0);

    // Standalone pill supports manual dismiss on pill and inside popover, and reappears for new steps.
    const standaloneHost = page.getByTestId("standalone-host");
    const standalonePill = standaloneHost.getByTestId("floating-step-progress-pill");
    await page.evaluate(() => {
      window.setStandalone({
        running: true,
        steps: [
          { id: "a", label: "Step A", status: "completed" },
          { id: "b", label: "Step B", status: "completed" },
        ],
      });
    });
    await standalonePill.waitFor({ state: "visible" });
    await standaloneHost.getByTestId("step-progress-dismiss").click();
    await standalonePill.waitFor({ state: "detached" });

    await page.evaluate(() => {
      window.setStandalone({
        running: false,
        steps: [
          { id: "a", label: "Step A", status: "completed" },
          { id: "c", label: "Step C", status: "completed" },
        ],
      });
    });
    await standalonePill.waitFor({ state: "visible" });
    // Pin open so auto-dismiss pauses while inspecting the popover, then dismiss from popover button.
    await standalonePill.locator("button").first().click();
    const popover = standaloneHost.getByTestId("step-progress-popover");
    await popover.waitFor({ state: "visible" });
    await page.waitForTimeout(260);
    assert.equal(await popover.count(), 1, "pinned open popover pauses auto-dismiss");
    await standaloneHost.getByTestId("step-progress-popover-dismiss").click();
    await standalonePill.waitFor({ state: "detached" });

    // Unhovered/unpinned settled steps auto-dismiss after autoDismissMs.
    await page.mouse.move(0, 0);
    await page.evaluate(() => {
      window.setStandalone({
        running: false,
        steps: [{ id: "d", label: "Step D", status: "completed" }],
      });
    });
    await standalonePill.waitFor({ state: "visible" });
    await standalonePill.waitFor({ state: "detached", timeout: 2_000 });

    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await rm(dir, { recursive: true, force: true });
  }
});

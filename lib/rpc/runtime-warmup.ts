import { getAgentRuntimeProfile, type AgentRuntimeProfile } from "../agent-runtime-profile";
import { enabledFirstPartyExtensionPaths } from "../extension-config";

export interface RuntimeWarmupResult {
  warmed: boolean;
  skippedReason?: string;
  profile?: string;
  extensionCount?: number;
  durationMs?: number;
  error?: string;
}

export interface RuntimeWarmupDeps {
  getAgentDir(): string;
  initTheme(): void;
  enabledFirstPartyExtensionPaths(profile: AgentRuntimeProfile): string[];
  reloadResourceLoader(options: {
    cwd: string;
    agentDir: string;
    additionalExtensionPaths: string[];
  }): Promise<void>;
  getAgentRuntimeProfile(): AgentRuntimeProfile;
}

export interface RuntimeWarmupOptions {
  force?: boolean;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  deps?: RuntimeWarmupDeps;
}

let scheduled = false;
let inflight: Promise<RuntimeWarmupResult> | null = null;
let completedResult: RuntimeWarmupResult | null = null;

/** Determine whether automatic SDK/extension warm-up should run in this process. */
export function shouldRunRuntimeWarmup(env: NodeJS.ProcessEnv = process.env): { allowed: boolean; reason?: string } {
  if (env.PIORA_DISABLE_RUNTIME_WARMUP === "1") return { allowed: false, reason: "disabled_by_env" };
  if (Boolean(env.NODE_TEST_CONTEXT) || env.NODE_ENV === "test") return { allowed: false, reason: "test_env" };
  if (env.NODE_ENV !== "production" && env.PIORA_ENABLE_DEV_RUNTIME_WARMUP !== "1") {
    return { allowed: false, reason: "non_production" };
  }
  return { allowed: true };
}

async function loadDefaultWarmupDeps(): Promise<RuntimeWarmupDeps> {
  const sdk = await import("@earendil-works/pi-coding-agent");
  return {
    getAgentDir: sdk.getAgentDir,
    initTheme: sdk.initTheme,
    enabledFirstPartyExtensionPaths,
    reloadResourceLoader: async ({ cwd, agentDir, additionalExtensionPaths }) => {
      const loader = new sdk.DefaultResourceLoader({
        cwd,
        agentDir,
        // reload() resolves configured packages even when noExtensions is set.
        settingsManager: sdk.SettingsManager.inMemory(),
        additionalExtensionPaths,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        systemPrompt: "",
        appendSystemPrompt: [],
      });
      await loader.reload();
    },
    getAgentRuntimeProfile,
  };
}

/**
 * Warm up the SDK and enabled first-party extensions before a session starts.
 */
export async function runRuntimeWarmup(options: RuntimeWarmupOptions = {}): Promise<RuntimeWarmupResult> {
  if (!options.force) {
    const gate = shouldRunRuntimeWarmup(options.env);
    if (!gate.allowed) return { warmed: false, skippedReason: gate.reason };
    if (completedResult) return completedResult;
    if (inflight) return inflight;
  }

  const execute = (async (): Promise<RuntimeWarmupResult> => {
    const startedAt = Date.now();
    try {
      const deps = options.deps ?? await loadDefaultWarmupDeps();
      deps.initTheme();
      const profile = deps.getAgentRuntimeProfile();
      const agentDir = deps.getAgentDir();
      const cwd = options.cwd ?? process.cwd();
      const extensionPaths = deps.enabledFirstPartyExtensionPaths(profile);
      await deps.reloadResourceLoader({
        cwd,
        agentDir,
        additionalExtensionPaths: extensionPaths,
      });
      const result: RuntimeWarmupResult = {
        warmed: true,
        profile,
        extensionCount: extensionPaths.length,
        durationMs: Date.now() - startedAt,
      };
      if (!options.force) completedResult = result;
      return result;
    } catch (error) {
      return {
        warmed: false,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      inflight = null;
    }
  })();

  if (!options.force) inflight = execute;
  return execute;
}

/** Schedule a single idempotent background runtime warm-up after server startup settles. */
export function scheduleRuntimeWarmup(options: {
  delayMs?: number;
  force?: boolean;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  deps?: RuntimeWarmupDeps;
} = {}): boolean {
  if (scheduled && !options.force) return false;
  if (!options.force && !shouldRunRuntimeWarmup(options.env).allowed) return false;
  if (!options.force) scheduled = true;
  const timer = setTimeout(() => {
    void runRuntimeWarmup({ force: options.force, cwd: options.cwd, env: options.env, deps: options.deps });
  }, options.delayMs ?? 1_200);
  timer.unref?.();
  return true;
}

export function resetRuntimeWarmupForTest(): void {
  scheduled = false;
  inflight = null;
  completedResult = null;
}

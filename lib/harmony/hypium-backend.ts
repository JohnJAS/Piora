import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";

import { writePrivateFileAtomicSync } from "../atomic-file";
import { HarmonyError } from "./errors";
import { validateHarmonySelector } from "./selector";
import type {
  HarmonySemanticActionRequest,
  HarmonySemanticActionResult,
  HarmonyUiSelector,
} from "./types";

type HypiumModule = typeof import("hypium-driver");
type HypiumDriver = Awaited<ReturnType<HypiumModule["UiDriver"]["connect"]>>;
type HypiumBy = ReturnType<HypiumModule["BY"]["text"]>;
type HypiumComponent = ReturnType<HypiumDriver["findComponent"]>;

const CONNECT_TIMEOUT_MS = 20_000;
const DRIVER_COOLDOWN_MS = 30_000;

export interface HypiumAutomationDriverOptions {
  hdcPath: string;
  importDriver?: () => Promise<HypiumModule>;
  now?: () => number;
  preparePrivacy?: () => void;
}

export interface HypiumAutomationStatus {
  serial: string;
  state: "idle" | "connecting" | "ready" | "cooldown";
  retryAt?: string;
}

function disableHypiumTelemetry(): void {
  const directory = join(homedir(), ".hypium");
  const path = join(directory, ".hypium_driver_config");
  try {
    let disabled = false;
    try {
      disabled = (JSON.parse(readFileSync(path, "utf8")) as { telemetry?: unknown }).telemetry === false;
    } catch { /* Missing or malformed settings are replaced with the privacy-safe Piora policy. */ }
    if (disabled) return;
    mkdirSync(directory, { recursive: true });
    writePrivateFileAtomicSync(path, `${JSON.stringify({ telemetry: false })}\n`);
  } catch (error) {
    throw new HarmonyError(
      "AUTOMATION_DRIVER_UNAVAILABLE",
      "Hypium telemetry could not be disabled, so Piora refused to start the third-party driver",
      { cause: error, retryable: true },
    );
  }
}

function prependHdcDirectory(hdcPath: string): void {
  const key = Object.keys(process.env).find((name) => name.toLocaleLowerCase() === "path") ?? "PATH";
  const directory = dirname(hdcPath);
  const entries = (process.env[key] ?? "").split(delimiter).filter(Boolean);
  const normalized = process.platform === "win32" ? directory.toLocaleLowerCase() : directory;
  if (entries.some((entry) => (process.platform === "win32" ? entry.toLocaleLowerCase() : entry) === normalized)) return;
  process.env[key] = [directory, ...entries].join(delimiter);
}

function timeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new HarmonyError("AUTOMATION_DRIVER_UNAVAILABLE", message, { retryable: true })), milliseconds);
    timer.unref?.();
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined, onAbort: () => void): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    onAbort();
    return Promise.reject(new HarmonyError("COMMAND_ABORTED", "Harmony automation was cancelled", { retryable: true }));
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      onAbort();
      reject(new HarmonyError("COMMAND_ABORTED", "Harmony automation was cancelled", { retryable: true }));
    };
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener("abort", abort); resolve(value); },
      (error) => { signal.removeEventListener("abort", abort); reject(error); },
    );
  });
}

function matchPattern(module: HypiumModule, selector: HarmonyUiSelector): import("hypium-driver").MatchPattern {
  if (selector.match === "contains") return module.MatchPattern.CONTAINS;
  if (selector.match === "starts_with") return module.MatchPattern.STARTS_WITH;
  if (selector.match === "ends_with") return module.MatchPattern.ENDS_WITH;
  return module.MatchPattern.EQUALS;
}

function selectorBy(module: HypiumModule, selector: HarmonyUiSelector): HypiumBy {
  validateHarmonySelector(selector);
  if (selector.description !== undefined || selector.visible !== undefined) {
    throw new HarmonyError("CAPABILITY_UNAVAILABLE", "This selector requires Piora's layout fallback instead of Hypium semantic lookup");
  }
  const pattern = matchPattern(module, selector);
  let by: HypiumBy | undefined;
  const extend = (next: (source: HypiumBy) => HypiumBy, seed: () => HypiumBy): void => {
    by = by ? next(by) : seed();
  };
  if (selector.id) extend((source) => source.id(selector.id!, pattern), () => module.BY.id(selector.id!, pattern));
  if (selector.text) extend((source) => source.text(selector.text!, pattern), () => module.BY.text(selector.text!, pattern));
  if (selector.type) extend((source) => source.type(selector.type!, pattern), () => module.BY.type(selector.type!, pattern));
  if (selector.hint) extend((source) => source.hint(selector.hint!, pattern), () => module.BY.hint(selector.hint!, pattern));
  if (selector.inWindow) extend((source) => source.inWindow(selector.inWindow!), () => module.BY.inWindow(selector.inWindow!));
  for (const key of ["clickable", "scrollable", "enabled", "focused", "selected", "checked"] as const) {
    const value = selector[key];
    if (value === undefined) continue;
    extend((source) => source[key](value), () => module.BY[key](value));
  }
  if (!by) throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Hypium requires a supported semantic selector field");
  if (selector.within) by = by.within(selectorBy(module, selector.within));
  if (selector.before) by = by.isBefore(selectorBy(module, selector.before));
  if (selector.after) by = by.isAfter(selectorBy(module, selector.after));
  return by;
}

async function resolveSemanticComponent(
  driver: HypiumDriver,
  module: HypiumModule,
  selector: HarmonyUiSelector,
  timeoutMs: number,
): Promise<HypiumComponent> {
  const by = selectorBy(module, selector);
  const awaited = driver.findComponent(by, timeoutMs);
  if (!await awaited.exist()) {
    throw new HarmonyError("UI_TARGET_NOT_FOUND", "No UI element matched the requested selector", { retryable: true });
  }
  const matches = await driver.findComponents(by);
  if (selector.index !== undefined) {
    const indexed = matches[selector.index];
    if (!indexed) {
      throw new HarmonyError("UI_TARGET_NOT_FOUND", "The requested UI selector index was not found", {
        details: { matchCount: matches.length, requestedIndex: selector.index }, retryable: true,
      });
    }
    return indexed;
  }
  if (matches.length > 1) {
    throw new HarmonyError("UI_TARGET_AMBIGUOUS", "The UI selector matched more than one element; add a stable id, relationship, or index", {
      details: { matchCount: matches.length }, retryable: true,
    });
  }
  return matches[0] ?? awaited;
}

export class HypiumAutomationDriver {
  private readonly importDriver: () => Promise<HypiumModule>;
  private readonly now: () => number;
  private readonly preparePrivacy: () => void;
  private modulePromise?: Promise<HypiumModule>;
  private readonly sessions = new Map<string, Promise<HypiumDriver>>();
  private readonly ready = new Map<string, HypiumDriver>();
  private readonly cooldowns = new Map<string, number>();

  constructor(options: HypiumAutomationDriverOptions) {
    this.importDriver = options.importDriver ?? (async () => {
      const imported = await import("hypium-driver");
      return ((imported as { default?: HypiumModule }).default ?? imported) as HypiumModule;
    });
    this.now = options.now ?? Date.now;
    this.preparePrivacy = options.preparePrivacy ?? disableHypiumTelemetry;
    prependHdcDirectory(options.hdcPath);
  }

  private async module(): Promise<HypiumModule> {
    if (!this.modulePromise) {
      this.preparePrivacy();
      this.modulePromise = this.importDriver().catch((error) => {
        this.modulePromise = undefined;
        throw new HarmonyError("AUTOMATION_DRIVER_UNAVAILABLE", "Unable to load hypium-driver", { cause: error, retryable: true });
      });
    }
    return await this.modulePromise;
  }

  private async connect(serial: string): Promise<HypiumDriver> {
    const coolingUntil = this.cooldowns.get(serial) ?? 0;
    if (coolingUntil > this.now()) {
      throw new HarmonyError("AUTOMATION_DRIVER_UNAVAILABLE", "Hypium is cooling down after a connection failure", {
        details: { retryAt: new Date(coolingUntil).toISOString() }, retryable: true,
      });
    }
    const existing = this.sessions.get(serial);
    if (existing) return await existing;
    const connection = (async () => {
      const driverModule = await this.module();
      try {
        const rawConnection = driverModule.UiDriver.connect({
          deviceSn: serial,
          hdcExecTimeout: 15_000,
          rpcTimeout: 30_000,
          implicitWaitTime: 1_000,
          samplingTime: 15,
        });
        let driver: HypiumDriver;
        try {
          driver = await timeout(rawConnection, CONNECT_TIMEOUT_MS, "Timed out connecting the Hypium automation driver");
        } catch (error) {
          // UiDriver.connect has no cancellation API. If it completes after our
          // bounded wait, close the orphaned RPC session instead of leaking it.
          void rawConnection.then(async (lateDriver) => await lateDriver.disconnect()).catch(() => undefined);
          throw error;
        }
        this.ready.set(serial, driver);
        this.cooldowns.delete(serial);
        return driver;
      } catch (error) {
        this.cooldowns.set(serial, this.now() + DRIVER_COOLDOWN_MS);
        throw new HarmonyError("AUTOMATION_DRIVER_UNAVAILABLE", "Hypium could not connect to the Harmony device", {
          cause: error, retryable: true,
        });
      }
    })();
    this.sessions.set(serial, connection);
    try {
      return await connection;
    } catch (error) {
      if (this.sessions.get(serial) === connection) this.sessions.delete(serial);
      throw error;
    }
  }

  private async run<T>(serial: string, operation: string, signal: AbortSignal | undefined, task: (driver: HypiumDriver, module: HypiumModule) => Promise<T>): Promise<T> {
    const driver = await withAbort(this.connect(serial), signal, () => { void this.invalidate(serial); });
    const driverModule = await this.module();
    try {
      return await withAbort(task(driver, driverModule), signal, () => { void this.invalidate(serial); });
    } catch (error) {
      if (error instanceof HarmonyError) throw error;
      await this.invalidate(serial);
      throw new HarmonyError("AUTOMATION_DRIVER_FAILED", "Hypium automation failed", {
        cause: error, details: { operation }, retryable: true,
      });
    }
  }

  async tryRun<T>(serial: string, operation: string, signal: AbortSignal | undefined, task: (driver: HypiumDriver, module: HypiumModule) => Promise<T>): Promise<{ used: true; value: T } | { used: false }> {
    try {
      const value = await this.run(serial, operation, signal, task);
      return { used: true, value };
    } catch (error) {
      if (error instanceof HarmonyError && error.code === "AUTOMATION_DRIVER_UNAVAILABLE") return { used: false };
      throw error;
    }
  }

  async semanticAction(serial: string, request: HarmonySemanticActionRequest, signal?: AbortSignal): Promise<HarmonySemanticActionResult> {
    return await this.run(serial, request.action, signal, async (driver, module) => {
      const timeoutMs = Math.max(100, Math.min(60_000, Math.round(request.timeoutMs ?? 3_000)));
      let component: HypiumComponent;
      if (request.action === "scroll_find") {
        if (!request.container) {
          throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Hypium scroll search requires a semantic container selector");
        }
        if (request.selector.index !== undefined) {
          throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Indexed scroll search requires Piora's layout fallback");
        }
        const container = await resolveSemanticComponent(driver, module, request.container, timeoutMs);
        component = container.scrollSearch(selectorBy(module, request.selector));
      } else {
        component = await resolveSemanticComponent(driver, module, request.selector, timeoutMs);
      }
      if (!await component.exist()) throw new HarmonyError("UI_TARGET_NOT_FOUND", "No UI element matched the requested selector", { retryable: true });
      if (request.action === "tap" || (request.action === "scroll_find" && request.tapAfterScroll)) await component.click();
      else if (request.action === "double_tap") await component.doubleClick();
      else if (request.action === "long_press") await component.longClick();
      else if (request.action === "clear_text") await component.clearText();
      else if (request.action === "input_text") {
        if (typeof request.text !== "string" || request.text.length === 0) {
          throw new HarmonyError("INVALID_ARGUMENT", "Semantic text input requires non-empty text");
        }
        await component.inputText(request.text, request.append ? { addition: true } : undefined);
      }
      return { strategy: "hypium_semantic_rpc" };
    });
  }

  async waitForIdle(serial: string, idleMs: number, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
    const result = await this.tryRun(serial, "wait_for_idle", signal, async (driver) => {
      await driver.waitForIdle(idleMs, timeoutMs);
      return true;
    });
    return result.used;
  }

  status(): HypiumAutomationStatus[] {
    const serials = new Set([...this.sessions.keys(), ...this.cooldowns.keys()]);
    return [...serials].map((serial) => {
      if (this.ready.has(serial)) return { serial, state: "ready" as const };
      if (this.sessions.has(serial)) return { serial, state: "connecting" as const };
      const retryAt = this.cooldowns.get(serial);
      return retryAt && retryAt > this.now()
        ? { serial, state: "cooldown" as const, retryAt: new Date(retryAt).toISOString() }
        : { serial, state: "idle" as const };
    });
  }

  async invalidate(serial: string): Promise<void> {
    const promise = this.sessions.get(serial);
    this.sessions.delete(serial);
    const driver = this.ready.get(serial);
    this.ready.delete(serial);
    const resolved = driver ?? await promise?.catch(() => undefined);
    if (resolved) await timeout(Promise.resolve(resolved.disconnect()), 5_000, "Timed out disconnecting Hypium").catch(() => undefined);
  }

  async reset(serial?: string): Promise<void> {
    if (serial) {
      this.cooldowns.delete(serial);
      await this.invalidate(serial);
      return;
    }
    const serials = new Set([...this.sessions.keys(), ...this.ready.keys(), ...this.cooldowns.keys()]);
    this.cooldowns.clear();
    await Promise.all([...serials].map(async (value) => await this.invalidate(value)));
  }
}

import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { type CommandExecutor, runCommand } from "./command-runner";
import { HarmonyError, isHarmonyError } from "./errors";
import { readHarmonyConfig, resolveHdcPath, type ResolveHdcOptions } from "./runtime";
import { flattenUiTree } from "./ui-tree";
import type {
  BackendDevice,
  BackendSnapshot,
  HarmonyAutomationBackend,
  HarmonyCapabilities,
  HarmonyDeviceConnectionState,
  HarmonyScreenshot,
} from "./types";

const MAX_LAYOUT_BYTES = 16 * 1024 * 1024;
const MAX_SCREENSHOT_BYTES = 32 * 1024 * 1024;
const MAX_INPUT_TEXT_BYTES = 16 * 1024;
const SERIAL_PATTERN = /^[A-Za-z0-9._:\[\]-]{1,256}$/;
const APP_IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9_.]{0,255}$/;

const NO_UITEST_CAPABILITIES: HarmonyCapabilities = {
  uiTree: false,
  screenshot: false,
  tap: false,
  swipe: false,
  inputText: false,
  keys: false,
  launchApp: true,
};

const UITEST_CAPABILITIES: HarmonyCapabilities = {
  uiTree: true,
  screenshot: true,
  tap: false,
  swipe: false,
  // Text travels through a temporary file; it is never interpolated into a command.
  inputText: false,
  keys: false,
  launchApp: true,
};

export interface HdcBackendOptions {
  hdcPath?: string;
  resolve?: ResolveHdcOptions;
  execute?: CommandExecutor;
  commandTimeoutMs?: number;
}

function validateSerial(serial: string): void {
  if (!SERIAL_PATTERN.test(serial)) {
    throw new HarmonyError("INVALID_ARGUMENT", "Invalid Harmony device serial");
  }
}

function validateCoordinate(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 100_000) {
    throw new HarmonyError("INVALID_ARGUMENT", `${label} must be an integer between 0 and 100000`);
  }
  return value;
}

function parseDeviceLine(line: string): { serial: string; state: HarmonyDeviceConnectionState } | undefined {
  const trimmed = line.trim();
  if (!trimmed || /^\[?empty\]?$/i.test(trimmed) || /no targets/i.test(trimmed)) return undefined;
  if (/^\[(?:fail|error|e\d+)/i.test(trimmed)) return undefined;
  const parts = trimmed.split(/\s+/);
  const serial = parts[0];
  if (!SERIAL_PATTERN.test(serial) || /^(connect|list|targets|device)$/i.test(serial)) return undefined;
  const status = parts.slice(1).join(" ").toLowerCase();
  const state: HarmonyDeviceConnectionState = /unauthor|not.auth/.test(status)
    ? "unauthorized"
    : /offline|disconnect/.test(status)
      ? "offline"
      : "online";
  return { serial, state };
}

function cleanOutput(output: Buffer): string | undefined {
  const value = output.toString("utf8").replace(/\0/g, "").trim();
  return value && !/^(unknown|null|undefined)$/i.test(value) ? value.slice(0, 512) : undefined;
}

function versionAtLeast(version: string | undefined, minimum: readonly number[]): boolean {
  const match = version?.match(/(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return false;
  const current = match.slice(1, 5).map((value) => Number(value ?? 0));
  for (let index = 0; index < minimum.length; index += 1) {
    if (current[index] > minimum[index]) return true;
    if (current[index] < minimum[index]) return false;
  }
  return true;
}

function capabilitiesForUiTest(version: string | undefined): HarmonyCapabilities {
  if (!versionAtLeast(version, [1, 0, 0, 0])) return { ...NO_UITEST_CAPABILITIES };
  const supportsCliInput = versionAtLeast(version, [4, 1, 2, 0]);
  return {
    ...UITEST_CAPABILITIES,
    tap: supportsCliInput,
    swipe: supportsCliInput,
    keys: supportsCliInput,
    // Coordinate-free text input was added in UiTest 5.1.1.1.
    inputText: versionAtLeast(version, [5, 1, 1, 1]),
  };
}

function parsePng(data: Buffer): HarmonyScreenshot {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (data.length < 24 || !data.subarray(0, 8).equals(signature)) {
    throw new HarmonyError("INVALID_RESPONSE", "Harmony device returned an invalid screenshot");
  }
  return {
    mimeType: "image/png",
    data,
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
  };
}

export class HdcBackend implements HarmonyAutomationBackend {
  readonly kind = "hdc-uitest";
  readonly hdcPath: string;
  private readonly execute: CommandExecutor;
  private readonly commandTimeoutMs: number;
  private readonly capabilitiesBySerial = new Map<string, HarmonyCapabilities>();

  constructor(options: HdcBackendOptions = {}) {
    const config = readHarmonyConfig();
    const resolution = resolveHdcPath({
      ...options.resolve,
      explicitPath: options.hdcPath ?? options.resolve?.explicitPath,
      config: options.resolve?.config ?? config,
    });
    this.hdcPath = resolution.hdcPath;
    this.execute = options.execute ?? runCommand;
    this.commandTimeoutMs = options.commandTimeoutMs ?? 15_000;
  }

  private async run(args: readonly string[], operation: string, signal?: AbortSignal, timeoutMs?: number) {
    return await this.execute({
      executable: this.hdcPath,
      args,
      timeoutMs: timeoutMs ?? this.commandTimeoutMs,
      maxOutputBytes: 4 * 1024 * 1024,
      signal,
      operation,
    });
  }

  private async shell(serial: string, args: readonly string[], operation: string, signal?: AbortSignal) {
    validateSerial(serial);
    return await this.run(["-t", serial, "shell", ...args], operation, signal);
  }

  private async safeInfo(serial: string, args: readonly string[], signal?: AbortSignal): Promise<string | undefined> {
    try {
      return cleanOutput((await this.shell(serial, args, "device_info", signal)).stdout);
    } catch (error) {
      if (isHarmonyError(error) && error.code === "COMMAND_ABORTED") throw error;
      return undefined;
    }
  }

  async listDevices(signal?: AbortSignal): Promise<BackendDevice[]> {
    let result;
    try {
      result = await this.run(["list", "targets", "-v"], "list_devices", signal, 8_000);
    } catch (error) {
      if (!isHarmonyError(error) || error.code !== "COMMAND_FAILED") throw error;
      // Older SDK releases expose list targets but not the verbose flag.
      result = await this.run(["list", "targets"], "list_devices_legacy", signal, 8_000);
    }
    const parsed = result.stdout.toString("utf8").split(/\r?\n/).map(parseDeviceLine).filter(Boolean) as Array<{
      serial: string;
      state: HarmonyDeviceConnectionState;
    }>;
    const unique = [...new Map(parsed.map((device) => [device.serial, device])).values()];

    return await Promise.all(unique.map(async ({ serial, state }): Promise<BackendDevice> => {
      if (state !== "online") {
        return { serial, state, capabilities: { ...NO_UITEST_CAPABILITIES, launchApp: false } };
      }
      const [model, product, name, osVersion, apiVersion, uitestVersion] = await Promise.all([
        this.safeInfo(serial, ["param", "get", "const.product.model"], signal),
        this.safeInfo(serial, ["param", "get", "const.product.name"], signal),
        this.safeInfo(serial, ["param", "get", "const.product.devicename"], signal),
        this.safeInfo(serial, ["param", "get", "const.product.software.version"], signal),
        this.safeInfo(serial, ["param", "get", "const.ohos.apiversion"], signal),
        this.safeInfo(serial, ["uitest", "--version"], signal),
      ]);
      const capabilities = capabilitiesForUiTest(uitestVersion);
      this.capabilitiesBySerial.set(serial, capabilities);
      return {
        serial,
        state,
        model,
        product,
        name: name ?? model ?? product,
        osVersion,
        apiVersion,
        uitestVersion,
        capabilities,
      };
    }));
  }

  private async pullGeneratedFile(
    serial: string,
    remotePath: string,
    operation: string,
    maxBytes: number,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    const directory = await mkdtemp(join(tmpdir(), "piora-harmony-"));
    const localPath = join(directory, operation === "screenshot" ? "screen.png" : "layout.json");
    try {
      await this.shell(serial, ["chmod", "600", remotePath], `${operation}_protect`, signal);
      await this.run(["-t", serial, "file", "recv", remotePath, localPath], `${operation}_pull`, signal, 20_000);
      const info = await stat(localPath);
      if (info.size <= 0 || info.size > maxBytes) {
        throw new HarmonyError("INVALID_RESPONSE", `Harmony ${operation} file has an invalid size`, {
          details: { size: info.size, maxBytes },
        });
      }
      return await readFile(localPath);
    } finally {
      // This path is generated locally and never contains user input.
      await this.shell(serial, ["rm", remotePath], `${operation}_cleanup`).catch(() => undefined);
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async sendFile(serial: string, localPath: string, remotePath: string, operation: string, signal?: AbortSignal): Promise<void> {
    validateSerial(serial);
    if (!/^\/data\/local\/tmp\/piora-[a-z]+-[0-9a-f-]+\.(?:txt|json|png)$/.test(remotePath)) {
      throw new HarmonyError("INVALID_ARGUMENT", "Invalid generated Harmony temporary path");
    }
    await this.run(["-t", serial, "file", "send", localPath, remotePath], operation, signal, 20_000);
  }

  private async dumpTree(serial: string, signal?: AbortSignal): Promise<{ tree: unknown; nodes: ReturnType<typeof flattenUiTree> }> {
    const remotePath = `/data/local/tmp/piora-layout-${randomUUID()}.json`;
    await this.shell(serial, ["uitest", "dumpLayout", "-p", remotePath], "dump_layout", signal);
    const data = await this.pullGeneratedFile(serial, remotePath, "layout", MAX_LAYOUT_BYTES, signal);
    try {
      const tree = JSON.parse(data.toString("utf8")) as unknown;
      return { tree, nodes: flattenUiTree(tree) };
    } catch (error) {
      throw new HarmonyError("INVALID_RESPONSE", "Harmony UiTest returned invalid layout JSON", { cause: error });
    }
  }

  private async captureScreen(serial: string, signal?: AbortSignal): Promise<HarmonyScreenshot> {
    const remotePath = `/data/local/tmp/piora-screen-${randomUUID()}.png`;
    await this.shell(serial, ["uitest", "screenCap", "-p", remotePath], "screen_capture", signal);
    return parsePng(await this.pullGeneratedFile(serial, remotePath, "screenshot", MAX_SCREENSHOT_BYTES, signal));
  }

  async snapshot(
    serial: string,
    options: { includeTree: boolean; includeScreenshot: boolean; signal?: AbortSignal },
  ): Promise<BackendSnapshot> {
    validateSerial(serial);
    if (!options.includeTree && !options.includeScreenshot) {
      throw new HarmonyError("INVALID_ARGUMENT", "Snapshot must include a UI tree or screenshot");
    }
    const known = this.capabilitiesBySerial.get(serial);
    if ((options.includeTree && known?.uiTree === false) || (options.includeScreenshot && known?.screenshot === false)) {
      throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Harmony UiTest snapshot capability is unavailable on this device");
    }
    const snapshot: BackendSnapshot = {};
    // The manager serializes these operations. Sequential execution is more reliable on UiTest.
    if (options.includeTree) {
      const layout = await this.dumpTree(serial, options.signal);
      snapshot.tree = layout.tree;
      snapshot.nodes = layout.nodes;
    }
    if (options.includeScreenshot) snapshot.screenshot = await this.captureScreen(serial, options.signal);
    return snapshot;
  }

  async tap(serial: string, x: number, y: number, signal?: AbortSignal): Promise<void> {
    if (this.capabilitiesBySerial.get(serial)?.tap === false) {
      throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Harmony UiTest tap injection is unavailable on this device");
    }
    await this.shell(serial, ["uitest", "uiInput", "click", String(validateCoordinate(x, "x")), String(validateCoordinate(y, "y"))], "tap", signal);
  }

  async swipe(
    serial: string,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    durationMs = 500,
    signal?: AbortSignal,
  ): Promise<void> {
    if (this.capabilitiesBySerial.get(serial)?.swipe === false) {
      throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Harmony UiTest swipe injection is unavailable on this device");
    }
    const values = [
      validateCoordinate(fromX, "fromX"), validateCoordinate(fromY, "fromY"),
      validateCoordinate(toX, "toX"), validateCoordinate(toY, "toY"),
    ];
    if (!Number.isFinite(durationMs) || durationMs < 50 || durationMs > 30_000) {
      throw new HarmonyError("INVALID_ARGUMENT", "durationMs must be between 50 and 30000");
    }
    const distance = Math.hypot(toX - fromX, toY - fromY);
    const velocity = Math.max(200, Math.min(40_000, Math.round(distance / (durationMs / 1000))));
    await this.shell(serial, ["uitest", "uiInput", "swipe", ...values.map(String), String(velocity)], "swipe", signal);
  }

  async inputText(serial: string, text: string, signal?: AbortSignal): Promise<void> {
    validateSerial(serial);
    let capabilities = this.capabilitiesBySerial.get(serial);
    if (!capabilities) {
      capabilities = capabilitiesForUiTest(await this.safeInfo(serial, ["uitest", "--version"], signal));
      this.capabilitiesBySerial.set(serial, capabilities);
    }
    if (!capabilities.inputText) {
      throw new HarmonyError(
        "CAPABILITY_UNAVAILABLE",
        "Safe coordinate-free text input requires Harmony UiTest 5.1.1.1 or newer",
      );
    }
    if (typeof text !== "string" || text.length === 0) {
      throw new HarmonyError("INVALID_ARGUMENT", "Input text must not be empty");
    }
    if (text.includes("\0")) {
      throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Harmony text input does not support NUL characters");
    }
    const data = Buffer.from(text, "utf8");
    if (data.length > MAX_INPUT_TEXT_BYTES) {
      throw new HarmonyError("INVALID_ARGUMENT", `Input text exceeds ${MAX_INPUT_TEXT_BYTES} UTF-8 bytes`);
    }

    const id = randomUUID();
    const directory = await mkdtemp(join(tmpdir(), "piora-harmony-input-"));
    const localPath = join(directory, "input.txt");
    const remotePath = `/data/local/tmp/piora-input-${id}.txt`;
    try {
      await writeFile(localPath, data, { mode: 0o600 });
      await this.sendFile(serial, localPath, remotePath, "input_text_send", signal);
      await this.shell(serial, ["chmod", "600", remotePath], "input_text_protect", signal);
      // HDC joins shell argv with spaces and has historically not escaped embedded quotes.
      // Keep this generated command in one argv with no literal spaces. IFS expansion creates
      // the fixed argument boundaries on-device. A sentinel preserves trailing newlines; the
      // user-controlled bytes remain file data inside a quoted variable and are never reparsed.
      const command = `v="$(cat\${IFS}${remotePath};printf\${IFS}x)";v="\${v%x}";uitest\${IFS}uiInput\${IFS}text\${IFS}"$v"`;
      await this.shell(serial, [command], "input_text", signal);
    } finally {
      await this.shell(serial, ["rm", remotePath], "input_text_cleanup").catch(() => undefined);
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async pressKey(
    serial: string,
    key: "back" | "home" | "recents" | "enter",
    signal?: AbortSignal,
  ): Promise<void> {
    if (this.capabilitiesBySerial.get(serial)?.keys === false) {
      throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Harmony UiTest key injection is unavailable on this device");
    }
    const value = { back: "Back", home: "Home", recents: "2720", enter: "2054" }[key];
    if (!value) throw new HarmonyError("INVALID_ARGUMENT", "Unsupported key");
    await this.shell(serial, ["uitest", "uiInput", "keyEvent", value], "press_key", signal);
  }

  async launchApp(
    serial: string,
    bundleName: string,
    abilityName?: string,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!APP_IDENTIFIER_PATTERN.test(bundleName) || (abilityName !== undefined && !APP_IDENTIFIER_PATTERN.test(abilityName))) {
      throw new HarmonyError("INVALID_ARGUMENT", "Invalid Harmony bundle or ability name");
    }
    const args = ["aa", "start", "-b", bundleName];
    if (abilityName) args.push("-a", abilityName);
    await this.shell(serial, args, "launch_app", signal);
  }
}

export function createHdcBackend(options: HdcBackendOptions = {}): HdcBackend {
  try {
    return new HdcBackend(options);
  } catch (error) {
    if (isHarmonyError(error)) throw error;
    throw new HarmonyError("HDC_INVALID", "Unable to initialize HDC", { cause: error });
  }
}

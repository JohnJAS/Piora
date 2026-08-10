import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";

export interface Logger {
  info(message: string, details?: unknown): void;
  warn(message: string, details?: unknown): void;
  error(message: string, details?: unknown): void;
}

const MAX_LOG_BYTES = 5 * 1024 * 1024;

function formatDetails(details: unknown): string {
  if (details === undefined) return "";
  if (details instanceof Error) {
    return ` ${details.stack ?? details.message}`;
  }

  try {
    return ` ${JSON.stringify(details)}`;
  } catch {
    return ` ${String(details)}`;
  }
}

export class FileLogger implements Logger {
  readonly filePath: string;

  constructor(userDataDirectory: string) {
    const logDirectory = join(userDataDirectory, "logs");
    mkdirSync(logDirectory, { recursive: true });
    this.filePath = join(logDirectory, "piora.log");
  }

  info(message: string, details?: unknown): void {
    this.write("INFO", message, details);
  }

  warn(message: string, details?: unknown): void {
    this.write("WARN", message, details);
  }

  error(message: string, details?: unknown): void {
    this.write("ERROR", message, details);
  }

  private rotateIfNeeded(): void {
    if (!existsSync(this.filePath) || statSync(this.filePath).size < MAX_LOG_BYTES) {
      return;
    }

    const previousPath = `${this.filePath}.1`;
    if (existsSync(previousPath)) unlinkSync(previousPath);
    renameSync(this.filePath, previousPath);
  }

  private write(level: "INFO" | "WARN" | "ERROR", message: string, details?: unknown): void {
    const line = `${new Date().toISOString()} [${level}] ${message}${formatDetails(details)}\n`;

    try {
      this.rotateIfNeeded();
      appendFileSync(this.filePath, line, "utf8");
    } catch (error) {
      // Logging must never take the desktop application down.
      console.error("Unable to write desktop log", error);
    }

    const sink = level === "ERROR" ? console.error : level === "WARN" ? console.warn : console.log;
    sink(line.trimEnd());
  }
}

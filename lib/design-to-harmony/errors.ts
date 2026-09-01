export type DesignToHarmonyErrorCode =
  | "INVALID_ARGUMENT"
  | "PROJECT_ACCESS_DENIED"
  | "CREDENTIAL_MISSING"
  | "SOURCE_AUTH_FAILED"
  | "SOURCE_NOT_FOUND"
  | "SOURCE_RATE_LIMITED"
  | "SOURCE_ABORTED"
  | "SOURCE_REQUEST_FAILED"
  | "SOURCE_RESPONSE_TOO_LARGE"
  | "SOURCE_INVALID_RESPONSE"
  | "IMPORT_NOT_FOUND"
  | "RUN_NOT_FOUND"
  | "ANALYSIS_FAILED"
  | "ANALYSIS_TOO_LARGE"
  | "UNSUPPORTED_PROJECT"
  | "INTERNAL_ERROR";

export type DesignToHarmonyErrorStage = "source" | "import" | "analyze" | "project" | "plan" | "store";

export class DesignToHarmonyError extends Error {
  readonly code: DesignToHarmonyErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;
  readonly stage?: DesignToHarmonyErrorStage;

  constructor(
    code: DesignToHarmonyErrorCode,
    message: string,
    options: { status?: number; retryable?: boolean; details?: Record<string, unknown>; stage?: DesignToHarmonyErrorStage; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "DesignToHarmonyError";
    this.code = code;
    this.status = options.status ?? 500;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
    this.stage = options.stage;
  }

  toJSON(): { code: DesignToHarmonyErrorCode; message: string; retryable: boolean; stage?: DesignToHarmonyErrorStage; details?: Record<string, unknown> } {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.stage ? { stage: this.stage } : {}),
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

export function asDesignToHarmonyError(error: unknown): DesignToHarmonyError {
  if (error instanceof DesignToHarmonyError) return error;
  if (error instanceof DOMException && error.name === "AbortError") {
    return new DesignToHarmonyError("SOURCE_ABORTED", "Design import was cancelled", {
      status: 499,
      retryable: true,
      cause: error,
    });
  }
  return new DesignToHarmonyError("INTERNAL_ERROR", "Design import failed", {
    status: 500,
    cause: error,
  });
}

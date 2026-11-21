export type ErrorCode =
  | "ADB_NOT_FOUND"
  | "ADB_FAILED"
  | "NO_DEVICE"
  | "MULTIPLE_DEVICES"
  | "NO_PID"
  | "NOT_DEBUGGABLE"
  | "JDWP_FAILED"
  | "VIEW_DUMP_FAILED"
  | "SEMANTICS_FAILED"
  | "COMPOSE_FAILED"
  | "SCREENSHOT_FAILED"
  | "BAD_INPUT"
  | "TIMEOUT";

export class DliError extends Error {
  readonly code: ErrorCode;
  readonly hint?: string;

  constructor(code: ErrorCode, message: string, hint?: string) {
    super(message);
    this.name = "DliError";
    this.code = code;
    this.hint = hint;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error instanceof DliError && error.hint) {
      return `${error.message}\nHint: ${error.hint}`;
    }
    return error.message;
  }
  return String(error);
}

export function toDliError(error: unknown): DliError {
  if (error instanceof DliError) return error;
  return new DliError("VIEW_DUMP_FAILED", errorMessage(error));
}

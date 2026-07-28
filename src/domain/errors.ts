export type ToolErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "STALE_HANDOFF"
  | "STORAGE_ERROR"
  | "INTERNAL_ERROR";

export class ApplicationError extends Error {
  constructor(
    readonly code: ToolErrorCode,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "ApplicationError";
  }
}

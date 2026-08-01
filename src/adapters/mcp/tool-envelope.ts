// MCP tool envelope 包裝。
//
// 把 domain/service errors 包成每個 MCP tool 都會回傳的 JSON envelope。集中在
// 這裡處理，可以讓所有 tool handlers 的 error shape 保持一致。

import { ApplicationError } from "../../domain/errors.js";

export type ToolEnvelope= {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  audit_log_id?: string;
};

export function success(
  data: Record<string, unknown>,
  auditLogId?: string
): ToolEnvelope {
  return {
    ok: true,
    data,
    ...(auditLogId? { audit_log_id: auditLogId }:{})
  };
}

export function toToolResult(work: () => ToolEnvelope) {
  try {
    const envelope = work();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
      structuredContent: { ...envelope }
    };
  } catch (error) {
    const envelope = errorEnvelope(error);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
      isError: true
    };
  }
}

export function errorEnvelope(error: unknown): ToolEnvelope {
  if (error instanceof ApplicationError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined? {}:{ details: error.details })
      }
    };
  }
  if (isSqliteError(error)) {
    return {
      ok: false,
      error: {
        code: "STORAGE_ERROR",
        message: "SQLite operation failed.",
        details: { sqlite_code: error.code }
      }
    };
  }
  return {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message: error instanceof Error? error.message:"Unexpected error."
    }
  };
}

export function isSqliteError(error: unknown): error is { code: string } {
  return (
    typeof error === "object"&&
    error !== null&&
    "code" in error&&
    typeof error.code === "string"&&
    error.code.startsWith("SQLITE_")
  );
}

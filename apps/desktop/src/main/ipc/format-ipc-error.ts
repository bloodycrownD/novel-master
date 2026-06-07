/**
 * IPC error formatting — maps Core domain errors to serializable payloads.
 *
 * @module ipc/format-ipc-error
 */
import type { IpcErrorPayload } from "../../../shared/ipc-types.js";
import { ZodError } from "zod";

const FIELD_LABELS: Record<string, string> = {
  endDepth: "结束深度",
  startDepth: "起始深度",
  pattern: "正则表达式",
  name: "名称",
};

function formatZodIssues(err: ZodError): string {
  const parts = err.issues.map((issue) => {
    const pathKey = issue.path.map(String).join(".");
    const label = FIELD_LABELS[pathKey] ?? pathKey;
    const msg = issue.message;
    if (msg.includes("expected number") && msg.includes("null")) {
      return label ? `${label}须为非负整数或留空` : "须为非负整数或留空";
    }
    return label ? `${label}：${msg}` : msg;
  });
  return parts.filter(Boolean).join("；") || err.message;
}

const TYPED_ERROR_NAMES = new Set([
  "SessionFsError",
  "VfsError",
  "ChatError",
  "ProviderError",
]);

function typedDomainCode(err: Error): string | undefined {
  const coded = err as Error & { code?: unknown };
  if (typeof coded.code !== "string") {
    return undefined;
  }
  if (!TYPED_ERROR_NAMES.has(err.name)) {
    return undefined;
  }
  return coded.code;
}

/**
 * Maps a thrown value to an {@link IpcErrorPayload} for IPC responses.
 * Typed Core errors use their domain `code`; generic errors fall back to `name`.
 */
export function formatIpcError(err: unknown): IpcErrorPayload {
  if (err instanceof ZodError) {
    return { code: "VALIDATION", message: formatZodIssues(err) };
  }
  if (err instanceof Error) {
    const code = typedDomainCode(err);
    if (code != null) {
      return { code, message: err.message };
    }
    return { code: err.name || "ERROR", message: err.message };
  }
  return { code: "ERROR", message: String(err) };
}

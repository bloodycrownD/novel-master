/**
 * IPC error formatting — maps Core domain errors to serializable payloads.
 *
 * @module ipc/format-ipc-error
 */
import type { IpcErrorPayload } from "../../../shared/ipc-types.js";
import { isCloudSyncError } from "@novel-master/core";
import { AgentTurnError } from "@novel-master/core/agent";
import { ToolError } from "@novel-master/core";
import {
  AppError,
  VfsError,
  isVfsError,
} from "@novel-master/core/vfs";
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
  "ProviderError",
]);

/**
 * 旧 VfsError short code ↔ 新 AppError key 的兼容映射（phase 1）。
 *
 * 域逻辑（moveVfsPath 等）迁到 AppError 后，渲染层仍按旧 code 判
 * NOT_FOUND / ALREADY_EXISTS；在 IPC 边界翻回旧 code，避免行为回退。
 */
const VFS_APP_KEY_TO_CODE: Record<string, string> = {
  VFS_NOT_FOUND: "NOT_FOUND",
  VFS_REPLACE_NOT_FOUND: "REPLACE_NOT_FOUND",
  VFS_DIRECTORY_NOT_EMPTY: "DIRECTORY_NOT_EMPTY",
  VFS_INVALID_PATH: "INVALID_PATH",
  VFS_INVALID_NAME: "INVALID_NAME",
  VFS_IS_DIRECTORY: "IS_DIRECTORY",
  VFS_ALREADY_EXISTS: "ALREADY_EXISTS",
  VFS_NOT_A_DIRECTORY: "NOT_A_DIRECTORY",
  VFS_PARENT_NOT_FOUND: "PARENT_NOT_FOUND",
};

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

function sessionFsMissingPaths(
  err: Error,
): readonly string[] | undefined {
  const paths = (err as Error & { missingLogicalPaths?: readonly string[] })
    .missingLogicalPaths;
  return paths != null && paths.length > 0 ? paths : undefined;
}

/**
 * Maps a thrown value to an {@link IpcErrorPayload} for IPC responses.
 * Typed Core errors use their domain `code`; generic errors fall back to `name`.
 */
export function formatIpcError(err: unknown): IpcErrorPayload {
  if (isCloudSyncError(err)) {
    return { code: err.code, message: err.message };
  }
  if (err instanceof ZodError) {
    return { code: "VALIDATION", message: formatZodIssues(err) };
  }
  if (err instanceof VfsError) {
    return { code: err.code, message: err.message };
  }
  // 统一错误透出可读 key（AppError.key），不落成 Error.name；VFS 域在 phase 1
  // 仍对渲染层承诺旧 short code（NOT_FOUND / ALREADY_EXISTS 等）。
  if (err instanceof AppError) {
    return { code: VFS_APP_KEY_TO_CODE[err.key] ?? err.key, message: err.message };
  }
  if (err instanceof ToolError) {
    const cause = err.cause;
    if (cause instanceof VfsError || isVfsError(cause)) {
      const vfsCause = cause as VfsError;
      return { code: vfsCause.code, message: vfsCause.message };
    }
    const message = cause instanceof Error ? cause.message : err.message;
    return { code: err.code, message };
  }
  if (err instanceof AgentTurnError) {
    return { code: "AGENT_RUN_ERROR", message: err.message };
  }
  if (err instanceof Error) {
    const code = typedDomainCode(err);
    if (code != null) {
      const missingLogicalPaths = sessionFsMissingPaths(err);
      return {
        code,
        message: err.message,
        ...(missingLogicalPaths != null ? { missingLogicalPaths } : {}),
      };
    }
    return { code: err.name || "ERROR", message: err.message };
  }
  return { code: "ERROR", message: String(err) };
}

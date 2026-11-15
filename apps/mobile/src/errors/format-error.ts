/**
 * User-visible error messages for Core domain errors (VFS, chat, provider, tools, agent).
 */
import {CloudSyncError, TdbcError} from '@novel-master/core';
import {coreT} from '@/i18n/core';

import {isAppError} from '@novel-master/core/agent';

import {isVfsError, vfsUserMessage} from '@novel-master/core/vfs';

/** core vfsUserMessage（descriptor）→ 中文 string。 */
export function formatVfsErrorForUser(error: unknown, scope?: Parameters<typeof vfsUserMessage>[1]): string {
  return coreT(vfsUserMessage(error, scope));
}

function formatCause(cause: unknown): string | undefined {
  if (cause instanceof Error && cause.message) {
    return cause.message;
  }
  if (cause != null) {
    return String(cause);
  }
  return undefined;
}

function readCause(error: Error): unknown {
  return (error as Error & {cause?: unknown}).cause;
}

/** Formats an error for on-screen display; unwraps known Core error types. */
export function formatError(error: unknown): string {
  // mobile 两条硬编码 Provider 文案保留（进 catalog 是三期），类退役后改判 key。
  if (isAppError(error, 'PROVIDER_API_KEY_NOT_SET')) {
    return '请先在服务商设置中配置 API Key';
  }
  if (isAppError(error, 'PROVIDER_MODEL_NOT_SAVED')) {
    return '请先从远程拉取并保存模型';
  }
  // 旧 ToolError 的 cause 解包：类已退役，改判 TOOL_FAILED；cause 双写在
  // Error.cause 与 details.cause（spec §2.5）。须排在通用 AppError 分支前。
  if (isAppError(error, 'TOOL_FAILED')) {
    const cause = readCause(error) ?? (error.details as {cause?: unknown} | undefined)?.cause;
    if (isVfsError(cause)) {
      return formatVfsErrorForUser(cause);
    }
    const causeText = formatCause(cause);
    return causeText ? `${error.message}\n${causeText}` : error.message;
  }
  if (isVfsError(error)) {
    return formatVfsErrorForUser(error);
  }
  // AppError 走同一张 VFS 文案表（核心 formatter 已支持 AppError key 收窄），
  // 非 VFS key 兜底为 `操作失败：{detail}`。
  if (isAppError(error)) {
    return formatVfsErrorForUser(error);
  }
  if (error instanceof CloudSyncError) {
    return error.message;
  }
  if (error instanceof TdbcError) {
    const inner = formatCause(readCause(error));
    return inner ? `${error.message}\n${inner}` : error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * 暂留兼容，VFS 文案已改走 core 的 `formatVfsErrorForUser`（见
 * `formatError` 内 VFS 分支）——mobile 侧已无 VFS 调用点用它，
 * 保留只为旧 import 路径不炸。等调用点清零后随本文件一起删。
 *
 * @deprecated 请改用 {@link formatError}。
 */
export function formatVfsError(error: unknown): string {
  return formatError(error);
}

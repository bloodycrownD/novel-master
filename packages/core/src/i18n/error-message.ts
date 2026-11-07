/**
 * userMessageOf：错误 → 用户可见文案 descriptor（spec §3.3）。
 *
 * 分派优先级：错误自带 `messageKey` → 沿 cause 链向内找（ToolError 解包与
 * 事务/驱动包装两层都覆盖）→ code 子集表 → `null`（调用方回退 `message`）。
 * code 表只收「用户可见且消息无参数」的子集；带方向 / 原因 / 引用列表的
 * code（PUSH_MUTEX_TIMEOUT、ROLLBACK_UNDO_SEND_EMPTY_TARGET、
 * SAVED_MODEL_IN_USE、快照校验 14 条等）一律在抛错点带 messageKey
 * （G1/G2 逐点落位），不靠这里猜。
 *
 * @module i18n/error-message
 */

import { isAppError } from "@/errors/app-error.js";
import type { ErrorKey } from "@/errors/error-codes.js";
import { isVfsError, type VfsErrorCode } from "@/errors/vfs-errors.js";
import { isCloudSyncError, type CloudSyncErrorCode } from "@/infra/cloud-sync/errors/cloud-sync-errors.js";
import type { MessageParams } from "@/common/i18n.js";
import { CORE_MESSAGE_KEYS, type CoreMessageDescriptor, type CoreMessageKey } from "./keys.js";

const KNOWN_KEYS: ReadonlySet<string> = new Set<string>(CORE_MESSAGE_KEYS);

const USER_VISIBLE_VFS_CODES = ["NOT_FOUND", "REPLACE_NOT_FOUND", "ALREADY_EXISTS"] as const satisfies readonly VfsErrorCode[];
const VFS_CODE_TO_MESSAGE = {NOT_FOUND: "error.vfs.not_found", REPLACE_NOT_FOUND: "error.vfs.replace_not_found", ALREADY_EXISTS: "error.vfs.already_exists"} as const satisfies Record<(typeof USER_VISIBLE_VFS_CODES)[number], CoreMessageKey>;

const USER_VISIBLE_CLOUD_SYNC_CODES = ["ALREADY_UP_TO_DATE", "SNAPSHOT_MISSING", "CHECKSUM_MISMATCH", "NOT_CONFIGURED"] as const satisfies readonly CloudSyncErrorCode[];
const CLOUD_SYNC_CODE_TO_MESSAGE = {ALREADY_UP_TO_DATE: "error.cloud_sync.already_up_to_date", SNAPSHOT_MISSING: "error.cloud_sync.snapshot_missing", CHECKSUM_MISMATCH: "error.cloud_sync.download_checksum_mismatch", NOT_CONFIGURED: "error.cloud_sync.not_configured"} as const satisfies Record<(typeof USER_VISIBLE_CLOUD_SYNC_CODES)[number], CoreMessageKey>;

const USER_VISIBLE_APP_CODES = ["AGENT_DUPLICATE_NAME", "SESSION_FS_INVALID_ROLLBACK_OPTIONS"] as const satisfies readonly ErrorKey[];
const APP_CODE_TO_MESSAGE = {AGENT_DUPLICATE_NAME: "error.agent.duplicate_name", SESSION_FS_INVALID_ROLLBACK_OPTIONS: "error.session_fs.invalid_rollback_options"} as const satisfies Record<(typeof USER_VISIBLE_APP_CODES)[number], CoreMessageKey>;

// nm-style: keep-public — 递归入口：`new Set()` 播种 `seen` 链环检测状态；内联需把私有递归体 userMessageOfVisited 暴露给调用方。
export function userMessageOf(error: unknown): CoreMessageDescriptor | null {
  return userMessageOfVisited(error, new Set());
}

/**
 * 递归体：`seen` 防 cause 链环。沿 cause 链向内找是必须的——事务/驱动边界
 * 会把业务错误包一层（如 better-sqlite3 驱动把非 TdbcError 包成
 * `SQLITE_ERROR` 并保留 cause），`messageKey` 留在内层；外层无 key 时
 * 不向内找，被包过的错误（bootstrap 启动 fail-fast 等）就永远翻译不出来。
 */
// nm-style: keep-local — 递归载体：`seen` 就是 cause 链环检测的共享状态，函数自递归；内联会把环检测状态摊进 userMessageOf 的调用栈。
function userMessageOfVisited(error: unknown, seen: Set<unknown>): CoreMessageDescriptor | null {
  if (error == null || seen.has(error)) {
    return null;
  }
  seen.add(error);
  const messageKey = (error as {messageKey?: unknown} | null | undefined)?.messageKey;
  if (typeof messageKey === "string" && KNOWN_KEYS.has(messageKey)) {
    const params = (error as {messageParams?: unknown}).messageParams;
    return {key: messageKey as CoreMessageKey, ...(typeof params === "object" && params !== null ? {params: params as MessageParams} : {})};
  }
  const cause = (error as {cause?: unknown} | null | undefined)?.cause;
  if (cause != null) {
    const fromCause = userMessageOfVisited(cause, seen);
    if (fromCause != null) {
      return fromCause;
    }
  }
  if (isVfsError(error)) {
    return codeMessageOrNull(VFS_CODE_TO_MESSAGE, error.code);
  }
  if (isCloudSyncError(error)) {
    return codeMessageOrNull(CLOUD_SYNC_CODE_TO_MESSAGE, error.code);
  }
  if (isAppError(error)) {
    return codeMessageOrNull(APP_CODE_TO_MESSAGE, error.key);
  }
  return null;
}

function codeMessageOrNull(table: Record<string, CoreMessageKey>, code: string): CoreMessageDescriptor | null {
  const key = table[code];
  return key == null ? null : {key};
}

/**
 * Session KKV 域与键约定。
 *
 * @module domain/session-kkv/model/session-kkv-domains
 */

/** 规则快照域：常驻工作区规则引擎产物。 */
export const SESSION_KKV_DOMAIN_RULE_SNAPSHOT = "rule_snapshot" as const;

/** 文件缓存域：按展示档位缓存的正文。 */
export const SESSION_KKV_DOMAIN_FILE_CACHE = "file_cache" as const;

/** 用户 VFS pending 队列域（随 clearSession 清空）。 */
export const SESSION_KKV_DOMAIN_USER_VFS_PENDING = "user_vfs_pending" as const;

/**
 * Composer 无叉状态条相关、回滚可按域清空的 kkv 域。
 * - `file_cache` → workplace chip（相对已加载差集）
 * - `user_vfs_pending` → user_ops chip
 *
 * **不含** `rule_snapshot`：那是常驻工作区渲染快照，回滚不得清。
 */
export const SESSION_KKV_COMPOSER_STATUS_DOMAINS = [
  SESSION_KKV_DOMAIN_FILE_CACHE,
  SESSION_KKV_DOMAIN_USER_VFS_PENDING,
] as const;

/** 规则快照域单键：`canon`。 */
export const RULE_SNAPSHOT_CANON_KEY = "canon" as const;

/** user_vfs_pending 域单键：FIFO 队列 JSON。 */
export const USER_VFS_PENDING_QUEUE_KEY = "queue" as const;

export type SessionKkvDomain =
  | typeof SESSION_KKV_DOMAIN_RULE_SNAPSHOT
  | typeof SESSION_KKV_DOMAIN_FILE_CACHE
  | typeof SESSION_KKV_DOMAIN_USER_VFS_PENDING
  | (string & {});

/** 可写入 file_cache 的展示档位（不含 hidden）。 */
export type WorkplaceDisplayStatus = "full" | "header" | "filename";

/**
 * 生成 file_cache 键：`{status}:{path}`，如 `full:/a.md`。
 */
export function fileCacheKey(
  status: WorkplaceDisplayStatus,
  path: string,
): string {
  return `${status}:${path}`;
}

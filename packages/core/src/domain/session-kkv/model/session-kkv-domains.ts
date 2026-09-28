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
 * backfill 扫描游标域：记录上次扫描确认无空窗时的消息总数。
 *
 * 仅由 core 的 backfill 判定读写；任何删除消息的事务都必须清掉本域
 * （「发生删除即清游标」，seq 复用防线），残留只会导致一次保守回退全量。
 */
export const SESSION_KKV_DOMAIN_BACKFILL_CURSOR = "backfill_cursor" as const;

/**
 * 流式指标域：「上次生成」冻结的末值速率快照（JSON，见
 * `domain/format/stream-final-rate`）。
 *
 * 纯展示派生值：run 收尾时写一次，冻结态（含跨重启水合）读它拼速率段；
 * 行缺失/损坏即省略速率段，不影响任何账本语义，也不做兜底造数。
 * 置位/压缩只清 `rule_snapshot` + `file_cache`，本域不受其影响（上次生成
 * 的速率与工作区缓存无关）；会话删除走 `clearSession` 整表清。
 */
export const SESSION_KKV_DOMAIN_STREAM_METRICS = "stream_metrics" as const;

/** stream_metrics 域单键：run 收尾冻结的末值速率快照（JSON）。 */
export const STREAM_METRICS_FINAL_RATE_KEY = "finalRate" as const;

/**
 * prompt_tokens 域：最近一次 completed run 的 API prompt 占用（JSON，见
 * `infra/tokenizer/logic/session-api-prompt-token-store`）。
 *
 * 治本点：API 口径的 `promptTokens` 原先只存在进程内 Map，重启即丢——
 * 同一读口（`resolveCurrentPromptTokens`）重启前报 API 值（无 `~`）、
 * 重启后跌回本地估算（带 `~`），显示与压缩判定双双跳口径。落 session KKV
 * 后重启仍读到同一份 API 值。
 *
 * 失效口径：凡改变「当前可见 prompt」或模型绑定、且应丢弃陈旧 API 占用的
 * 路径，成功后必须调 `invalidateSessionApiPromptTokenEntry`（进程内层 +
 * 本域行双删）。会话/项目删除走 `clearSession` 整表清。
 */
export const SESSION_KKV_DOMAIN_PROMPT_TOKENS = "prompt_tokens" as const;

/** prompt_tokens 域单键：最近一次 completed run 的 prompt 占用（JSON）。 */
export const PROMPT_TOKENS_LAST_USAGE_KEY = "lastPromptUsage" as const;

/**
 * token_chunks 域：L2 块 token 平面缓存的持久化整表（JSON，见
 * `infra/tokenizer/logic/token-chunk-cache`）。
 *
 * 治理说明：块计数是纯派生加速数据——条目丢失 / 损坏只退化性能（下一轮
 * 计数现算回填），不影响任何账本语义，坏行一律静默按 miss 处理。写入口
 * 径：代际推进且源于**真实刷新**（非预热）时，把当前代整表覆盖写本域；
 * 读取口径：本地计数开始时若热层对该会话无种子，读本域载入为最旧可用代
 * 种子（不顶当前代）。会话删除随 session KKV `clearSession` 整表级联清理，
 * 无独立 GC。
 */
export const SESSION_KKV_DOMAIN_TOKEN_CHUNKS = "token_chunks" as const;

/** token_chunks 域单键：当前代块计数整表（紧凑 JSON）。 */
export const TOKEN_CHUNKS_CACHE_KEY = "chunkCache" as const;

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

/** backfill_cursor 域单键：上次确认无空窗时的消息总数（十进制字符串）。 */
export const BACKFILL_CURSOR_LAST_SCANNED_COUNT_KEY = "lastScannedCount" as const;

export type SessionKkvDomain =
  | typeof SESSION_KKV_DOMAIN_RULE_SNAPSHOT
  | typeof SESSION_KKV_DOMAIN_FILE_CACHE
  | typeof SESSION_KKV_DOMAIN_USER_VFS_PENDING
  | typeof SESSION_KKV_DOMAIN_BACKFILL_CURSOR
  | typeof SESSION_KKV_DOMAIN_STREAM_METRICS
  | typeof SESSION_KKV_DOMAIN_PROMPT_TOKENS
  | typeof SESSION_KKV_DOMAIN_TOKEN_CHUNKS
  | (string & {});

/** 可写入 file_cache 的展示档位（不含 hidden）。 */
export type WorkplaceDisplayStatus = "full" | "header" | "filename";

/**
 * 生成 file_cache 键：`{status}:{path}`，如 `full:/a.md`。
 */
export function fileCacheKey(
  status: WorkplaceDisplayStatus,
  path: string
): string {
  return `${status}:${path}`;
}

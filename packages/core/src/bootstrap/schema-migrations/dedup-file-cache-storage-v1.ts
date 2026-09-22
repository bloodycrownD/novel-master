/**
 * dedup-file-cache-storage-v1：清空 session_kkv_entry 的 file_cache 域存量行
 * （storage-cache-dedup-and-cleanup：提示词文件缓存去重的清空重填迁移）。
 *
 * 清空重填口径与依据：file_cache 是可再生的性能缓存（RULE.md 定位），清空
 * 无信息损失；PRD 风险节已拍板存量迁移采用清空重填——不把按会话复制的
 * 缓存行（用户实测库 21198 行 / 415MB）搬进新表（搬运需跨 boot 进度游标，
 * 撞 vfs-version-redesign 迭代已明确拒绝的 migration 框架突破），而是
 * 单条引擎内 DELETE 一次性清空；各会话下次组装提示词时按新结构
 * （session_file_cache_blob 单份内容 + session_file_cache_entry 轻量引用）
 * 重填，重填即天然去重。被清数据释放的页挂 freelist，物理空间由 feature B
 * 的数据清理（VACUUM）回收。
 *
 * 幂等性：DELETE 谓词只看 domain，重复执行删 0 行不报错；迁移跑在
 * bootstrap 事务内，中断即原子回滚，再次启动重跑。清空型迁移登记即完成，
 * 不涉及「空占位回填」禁令（无数据回填步骤）。
 *
 * @module bootstrap/schema-migrations/dedup-file-cache-storage-v1
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { SchemaMigration } from "./schema-migration.types.js";

export const DEDUP_FILE_CACHE_STORAGE_V1_ID = "dedup-file-cache-storage-v1";

/** file_cache 域名（与 SESSION_KKV_DOMAIN_FILE_CACHE 同源字面量）。 */
const FILE_CACHE_DOMAIN = "file_cache";

/** 供测试直接调用的迁移主体：单条引擎内 DELETE，不进 JS 堆。 */
export async function dedupFileCacheStorageV1Up(
  tx: TdbcConnection
): Promise<void> {
  await tx.execute(
    `DELETE FROM session_kkv_entry WHERE domain = '${FILE_CACHE_DOMAIN}'`
  );
}

/** 清空 file_cache 域存量缓存行的清空型 migration。 */
export const dedupFileCacheStorageV1Migration: SchemaMigration = {
  id: DEDUP_FILE_CACHE_STORAGE_V1_ID,
  up: dedupFileCacheStorageV1Up,
};

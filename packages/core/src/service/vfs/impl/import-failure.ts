/**
 * zip 与角色卡导入失败的统一错误包装。
 *
 * 只负责「原始失败 → `VFS_IMPORT_FAILED` 的 AppError」：测试钩子
 * （`"test import failure"` 直抛原形）与 `AppError` 是否透传都由调用方判——
 * 角色卡侧业务错走 `Result.err` 原形透传，zip 侧业务错一律包成本码，口径各自保留。
 *
 * 分片后**已提交片不再回滚** ⇒ 这是本条唯一的真实行为损失：旧内容在段 B0 就已
 * 删除，补偿只把半棵新树清掉、不恢复旧内容。
 *
 * @module service/vfs/impl/import-failure
 */

import { AppError } from "@/errors/app-error.js";

/** 导入失败包装集合（原始失败 → `VFS_IMPORT_FAILED`）。 */
export const ImportFailure = {
    /**
   * 把导入失败包成 `VFS_IMPORT_FAILED`：有分片进度时走 `.with_progress` descriptor
   * （已提交 N 片 / 失败在第 K 片），否则把原始 message 落 `detail`。
   */
    create(error: unknown, committedShards?: number, failedShard?: number): AppError {
        const base = error instanceof Error ? error.message : "import transaction failed";
        // 进度段拆独立 key（spec keyRule 可选片段）：有进度时 descriptor 随 messageKey 流动
        if (committedShards != null && failedShard != null) {
            return new AppError("VFS_IMPORT_FAILED", {
                descriptor: { key: "error.vfs.import_failed.with_progress", params: { committed: committedShards, failed_shard: failedShard } },
                base,
            });
        }
        return new AppError("VFS_IMPORT_FAILED", { detail: base });
    },
} as const;

/**
 * 按 SPEC「NULL content 读路径」解出明文（directory 显式分支）。
 *
 * 领域失败（active 文件双 NULL）与 ContentStore 的解码 / blob 缺失失败一并走
 * `Result`，本模块不抛。端口 `VfsContentStore` 的实现在 content-store/impl。
 *
 * @module domain/vfs/content-store/logic/resolve-stored-content
 */

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { VfsContentStore } from "../vfs-content-store.port.js";

// legacy-port: VfsContentStore — phase 4（get 失败走 Result，本层透传）

/** entry / revision 行上用于解正文的字段。 */
type StoredContentFields = {
    readonly content: string | null;
    readonly contentHash: string | null;
};

/** 本模块的失败载荷：active 文件正文损坏 + ContentStore 透传的解码失败。 */
type VfsContentError = AppError;

export const StoredContent = {
    /**
   * 解出文件明文；目录不走 ContentStore，返回空串。
   *
   * @remarks
   * 顺序钉死：directory → content_hash → 遗留明文 → 双 NULL 返回 `VFS_CONTENT_CORRUPT`。
   * 禁止 `String(null)` / `String(row.content)` 产出伪串 `"null"`。
   */
    async resolveEntry(contentStore: VfsContentStore, fields: StoredContentFields & { readonly entryKind: "file" | "directory" }): Promise<Result<string, VfsContentError>> {
        if (fields.entryKind === "directory") {
            return Result.ok("");
        }
        return StoredContent.resolveActiveFile(contentStore, fields);
    },

    /**
   * 解出 revision 明文；deleted 返回 null。
   */
    async resolveRevision(contentStore: VfsContentStore, fields: StoredContentFields & { readonly status: "active" | "deleted" }): Promise<Result<string | null, VfsContentError>> {
        if (fields.status === "deleted") {
            return Result.ok(null);
        }
        return StoredContent.resolveActiveFile(contentStore, fields);
    },

    async resolveActiveFile(contentStore: VfsContentStore, fields: StoredContentFields): Promise<Result<string, VfsContentError>> {
        if (fields.contentHash != null && fields.contentHash.length > 0) {
            return contentStore.get(fields.contentHash);
        }
        if (fields.content != null) {
            // 迁移窗口 / 遗留行：读旧明文
            return Result.ok(fields.content);
        }
        return Result.err(new AppError("VFS_CONTENT_CORRUPT", { detail: "vfs 正文损坏：active 文件 content 与 content_hash 均为 NULL" }));
    },
} as const;

/**
 * 按 SPEC「NULL content 读路径」解出明文（directory 显式分支）。
 *
 * 领域失败（active 文件双 NULL）走 `Result`（key `VFS_CONTENT_CORRUPT`），本模块
 * 不抛。端口 `VfsContentStore` 的实现在 content-store/impl（phase 1 冻结），其抛出
 * 的基础设施异常原样透传。
 *
 * @module domain/vfs/content-store/logic/resolve-stored-content
 */

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { VfsContentStore } from "../vfs-content-store.port.js";

// legacy-port: VfsContentStore — phase 2（实现仍抛旧异常，本层只透传）

/** entry / revision 行上用于解正文的字段。 */
type StoredContentFields = {
  readonly content: string | null;
  readonly contentHash: string | null;
};

/** 本模块的领域失败：active 文件正文损坏。 */
type VfsContentError = AppError<"VFS_CONTENT_CORRUPT">;

/**
 * 解出文件明文；目录不走 ContentStore，返回空串。
 *
 * @remarks
 * 顺序钉死：directory → content_hash → 遗留明文 → 双 NULL 返回 `VFS_CONTENT_CORRUPT`。
 * 禁止 `String(null)` / `String(row.content)` 产出伪串 `"null"`。
 */
export async function resolveEntryPlainContent(contentStore: VfsContentStore, fields: StoredContentFields & { readonly entryKind: "file" | "directory" }): Promise<Result<string, VfsContentError>> {
  if (fields.entryKind === "directory") {
    return Result.ok("");
  }
  return resolveActiveFilePlainContent(contentStore, fields);
}

/**
 * 解出 revision 明文；deleted 返回 null。
 */
export async function resolveRevisionPlainContent(contentStore: VfsContentStore, fields: StoredContentFields & { readonly status: "active" | "deleted" }): Promise<Result<string | null, VfsContentError>> {
  if (fields.status === "deleted") {
    return Result.ok(null);
  }
  return resolveActiveFilePlainContent(contentStore, fields);
}

async function resolveActiveFilePlainContent(contentStore: VfsContentStore, fields: StoredContentFields): Promise<Result<string, VfsContentError>> {
  if (fields.contentHash != null && fields.contentHash.length > 0) {
    return Result.ok(await contentStore.get(fields.contentHash));
  }
  if (fields.content != null) {
    // 迁移窗口 / 遗留行：读旧明文
    return Result.ok(fields.content);
  }
  return Result.err(new AppError("VFS_CONTENT_CORRUPT", "vfs 正文损坏：active 文件 content 与 content_hash 均为 NULL"));
}

/**
 * 按 SPEC「NULL content 读路径」解出明文（directory 显式分支）。
 *
 * @module domain/vfs/content-store/logic/resolve-stored-content
 */

import type { VfsContentStore } from "../vfs-content-store.port.js";

/** entry / revision 行上用于解正文的字段。 */
export type StoredContentFields = {
  readonly content: string | null;
  readonly contentHash: string | null;
};

/**
 * 解出文件明文；目录不走 ContentStore，返回空串。
 *
 * @remarks
 * 顺序钉死：deleted → directory → content_hash → 遗留明文 → 双 NULL 抛错。
 * 禁止 `String(null)` / `String(row.content)` 产出伪串 `"null"`。
 */
export async function resolveEntryPlainContent(
  contentStore: VfsContentStore,
  fields: StoredContentFields & { readonly entryKind: "file" | "directory" }
): Promise<string> {
  if (fields.entryKind === "directory") {
    return "";
  }
  return resolveActiveFilePlainContent(contentStore, fields);
}

/**
 * 解出 revision 明文；deleted 返回 null。
 */
export async function resolveRevisionPlainContent(
  contentStore: VfsContentStore,
  fields: StoredContentFields & {
    readonly status: "active" | "deleted";
  }
): Promise<string | null> {
  if (fields.status === "deleted") {
    return null;
  }
  return resolveActiveFilePlainContent(contentStore, fields);
}

async function resolveActiveFilePlainContent(
  contentStore: VfsContentStore,
  fields: StoredContentFields
): Promise<string> {
  if (fields.contentHash != null && fields.contentHash.length > 0) {
    return contentStore.get(fields.contentHash);
  }
  if (fields.content != null) {
    // 迁移窗口 / 遗留行：读旧明文
    return fields.content;
  }
  throw new Error(
    "vfs 正文损坏：active 文件 content 与 content_hash 均为 NULL"
  );
}

/**
 * 从 SQL 行安全取出可空 TEXT，禁止 `String(null)` → `"null"`。
 */
export function nullableText(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  return String(value);
}

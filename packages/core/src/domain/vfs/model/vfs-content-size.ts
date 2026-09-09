/**
 * VFS 文件 content 大小的轻量探测结果。
 *
 * @module domain/vfs/model/vfs-content-size
 */

/**
 * 按路径探测到的文件大小（不读正文）。
 *
 * - `inlineChars`：entry 行内联明文（遗留/迁移窗口行）的字符数，
 *   即正文 length，精确值。
 * - `blobCompressedBytes`：正文存放在 content store（`vfs_content_blob`）的
 *   行，仅有压缩侧长度（zlib 字节数，RN zlib-b64 编码行为 base64 文本长度）。
 *   两者都是明文大小的**下界**，作读取侧降级闸门足够（见
 *   `character-card-limits` 的 `CHARACTER_CARD_BLOB_COMPRESSED_GATE_BYTES`）。
 */
export type VfsContentSize =
  | { readonly kind: "inlineChars"; readonly size: number; readonly mtimeMs: number }
  | { readonly kind: "blobCompressedBytes"; readonly size: number; readonly mtimeMs: number };

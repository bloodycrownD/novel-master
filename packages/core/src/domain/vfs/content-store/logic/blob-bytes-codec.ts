/**
 * ContentStore 存量 base64 编码标记。
 *
 * 写侧已全面去 base64（RN 端同样落二进制 BLOB），本模块仅保留读侧存量兜底
 * 需要的 encoding 常量；base64 解码统一走 `@/common/base64.js`。
 *
 * @module domain/vfs/content-store/logic/blob-bytes-codec
 */

/** 存量落库 encoding：zlib 后再 base64，以 TEXT 形态写入 bytes 列。写侧已不再产出。 */
export const VFS_CONTENT_ENCODING_ZLIB_B64 = "zlib-b64" as const;

/**
 * ContentStore BLOB 字节 ↔ base64 文本编解码。
 *
 * 写侧已全面去 base64（RN 端同样落二进制 BLOB），本模块现仅服务**读侧存量
 * 兜底**：`decodeCompressedBytes` 要认出 quick-sqlite 时代写入的
 * `zlib-b64` 文本行，以及 `zlib` + base64 文本的历史脏形态。
 *
 * @module domain/vfs/content-store/logic/blob-bytes-codec
 */

/** 存量落库 encoding：zlib 后再 base64，以 TEXT 形态写入 bytes 列。写侧已不再产出。 */
export const VFS_CONTENT_ENCODING_ZLIB_B64 = "zlib-b64" as const;

/**
 * 将 base64 字符串解码为字节序列（对齐 sksp-android：纯 JS atob）。
 *
 * @remarks 仅供读侧存量解码使用；写路径不要引入新的 base64 形态。
 */
export function base64ToBytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

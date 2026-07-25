/**
 * ContentStore 专用 zlib 编解码（与 ZIP 的 deflate/inflate 模块边界分离）。
 *
 * @module domain/vfs/content-store/logic/zlib-codec
 */

import { unzlibSync, zlibSync } from "fflate";

/** ContentStore 落库 encoding 字面量。 */
export const VFS_CONTENT_ENCODING_ZLIB = "zlib" as const;

/**
 * zlib 压缩明文 UTF-8 字节。
 *
 * @remarks 仅供 ContentStore 使用；禁止 ZIP 路径调用本封装。
 */
export function compressZlib(plainUtf8: Uint8Array): Uint8Array {
  return zlibSync(plainUtf8);
}

/**
 * zlib 解压为 UTF-8 字节。
 *
 * @remarks 仅供 ContentStore 使用；禁止 ZIP 路径调用本封装。
 */
export function decompressZlib(compressed: Uint8Array): Uint8Array {
  return unzlibSync(compressed);
}

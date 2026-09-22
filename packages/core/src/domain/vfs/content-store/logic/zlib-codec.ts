/**
 * zlib 编解码与 blob 字节收整（三方共用：vfs content-store、session-kkv
 * file_cache、RN 平台存量口径；与 ZIP 的 deflate/inflate 模块边界分离）。
 *
 * @module domain/vfs/content-store/logic/zlib-codec
 */

import { unzlibSync, zlibSync } from "fflate";
import {
  base64ToBytes,
  VFS_CONTENT_ENCODING_ZLIB_B64,
} from "./blob-bytes-codec.js";

/**
 * ContentStore 落库 encoding：原始 zlib 字节（Node / Desktop）。
 *
 * @remarks RN 侧 put 使用 `VFS_CONTENT_ENCODING_ZLIB_B64`（见 blob-bytes-codec）；get 须同时支持二者。
 */
export const VFS_CONTENT_ENCODING_ZLIB = "zlib" as const;

/**
 * zlib 压缩明文 UTF-8 字节。
 *
 * @remarks ContentStore 与 file_cache blob 共用；禁止 ZIP 路径调用本封装。
 */
export function compressZlib(plainUtf8: Uint8Array): Uint8Array {
  return zlibSync(plainUtf8);
}

/**
 * zlib 解压为 UTF-8 字节。
 *
 * @remarks ContentStore 与 file_cache blob 共用；禁止 ZIP 路径调用本封装。
 */
export function decompressZlib(compressed: Uint8Array): Uint8Array {
  return unzlibSync(compressed);
}

/**
 * 确保 BLOB 绑定使用独立 ArrayBuffer（RN / better-sqlite3 约定）。
 *
 * @remarks vfs content-store put 与 session-kkv file_cache encode 落库前
 * 共用：源视图可能带 byteOffset，直接绑参会越界，拷贝成紧凑数组兜底。
 */
export function tightBytes(source: Uint8Array): Uint8Array {
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy;
}

/**
 * 将已知为二进制 BLOB 的列值收成 Uint8Array。
 *
 * @remarks string 不得经此函数；zlib-b64 / 存量 string 路径在
 * {@link decodeCompressedBytes} 的约定分支处理。`label` 为错误文案中的
 * 表.列 名（如 `vfs_content_blob.bytes`），由调用方传入。
 */
export function asUint8Array(value: unknown, label: string): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  // RN quick-sqlite / 部分绑定可能直接给出 ArrayBuffer。
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  throw new Error(
    `${label} 期望 Uint8Array/ArrayBuffer，实际 ${Object.prototype.toString.call(
      value
    )}`
  );
}

/**
 * 将 zlib-b64 列值（或 UTF-8 形态的 base64 字节）还原为 base64 文本。
 *
 * @remarks `label` 为错误文案中的表.列 名（如 `vfs_content_blob.bytes`）。
 */
export function asBase64Text(value: unknown, label: string): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    return new TextDecoder().decode(bytes);
  }
  throw new Error(
    `${label} 期望 base64 字符串或 UTF-8 字节，实际 ${Object.prototype.toString.call(
      value
    )}`
  );
}

/**
 * 按 encoding 将 blob 列值解成 zlib 压缩字节。
 *
 * 三形态兼容（vfs content-store 与 session-kkv file_cache 的 get 共用，
 * 含 RN 平台存量口径）：
 * - `zlib` + Uint8Array/ArrayBuffer：原样
 * - `zlib` + string：存量 RN 误存 base64，按 base64 解
 * - `zlib-b64`：取 base64 文本再解码
 *
 * @param label 错误文案中的表.列 名（如 `vfs_content_blob.bytes` /
 *   `session_file_cache_blob.bytes`），由调用方传入以区分两表。
 */
export function decodeCompressedBytes(
  encoding: string,
  bytes: unknown,
  label: string
): Uint8Array {
  if (encoding === VFS_CONTENT_ENCODING_ZLIB) {
    if (typeof bytes === "string") {
      // 存量：Mobile 曾写 encoding=zlib，但 quick-sqlite 读回为 base64 字符串。
      return base64ToBytes(bytes);
    }
    return asUint8Array(bytes, label);
  }

  if (encoding === VFS_CONTENT_ENCODING_ZLIB_B64) {
    const b64 = asBase64Text(bytes, label);
    return base64ToBytes(b64);
  }

  throw new Error(`不支持的 blob encoding: ${encoding}`);
}

/**
 * zlib 编解码与 blob 字节收整（三方共用：vfs content-store、session-kkv
 * file_cache、RN 平台存量口径；与 ZIP 的 deflate/inflate 模块边界分离）。
 *
 * 压缩/解压经 `zlib-accelerator` 的宿主注册加速器分派（Node 注册
 * `node:zlib` 提速；未注册恒走 fflate，现行为零变化）。
 *
 * 解压 / 按 encoding 解码 / 字节形态校验失败走 `Result`（key
 * `VFS_CONTENT_CORRUPT` / `VFS_CONTENT_UNSUPPORTED_FORMAT`），调用方按
 * `if (!r.ok)` 收窄后自行决定抛还是降级；`compressZlib` 是对任意字节都成立的
 * 纯编码，不套 Result。
 *
 * @module domain/vfs/content-store/logic/zlib-codec
 */

import { unzlibSync, zlibSync } from "fflate";
import { tryZlibDeflate, tryZlibInflate } from "./zlib-accelerator.js";
import { base64ToBytes } from "@/common/base64.js";
import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import { errorText } from "../../../../common/error-text.js";
import { VFS_CONTENT_ENCODING_ZLIB_B64 } from "./blob-bytes-codec.js";

/** 本模块的领域失败：blob 字节损坏或 encoding 不识别。 */
type VfsContentError = AppError<"VFS_CONTENT_CORRUPT" | "VFS_CONTENT_UNSUPPORTED_FORMAT">;

/**
 * ContentStore 落库 encoding：原始 zlib 字节（三端同形态：Node / Desktop / RN）。
 *
 * @remarks 写侧恒落本编码（二进制 BLOB，RN 与 Node 同一形态）；
 * `VFS_CONTENT_ENCODING_ZLIB_B64` 仅剩读侧存量兜底（见 blob-bytes-codec）；get 须同时支持二者。
 */
export const VFS_CONTENT_ENCODING_ZLIB = "zlib" as const;

/**
 * zlib 压缩明文 UTF-8 字节。
 *
 * @remarks ContentStore 与 file_cache blob 共用；禁止 ZIP 路径调用本封装。
 * 宿主注册了 zlib 加速器（Node `node:zlib`）时优先走加速器，未注册/加速器
 * 失败回落 fflate（行为与历史一致）。压缩是对任意 `Uint8Array` 都成立的纯编码，
 * 没有「输入/数据不合法」这类可恢复失败，故不套 Result。
 */
export function compressZlib(plainUtf8: Uint8Array): Uint8Array {
  return tryZlibDeflate(plainUtf8) ?? zlibSync(plainUtf8);
}

/**
 * zlib 解压为 UTF-8 字节；坏流返回 `VFS_CONTENT_CORRUPT`。
 *
 * @remarks ContentStore 与 file_cache blob 共用；禁止 ZIP 路径调用本封装。
 * 宿主注册了 zlib 加速器（Node `node:zlib`）时优先走加速器，未注册/加速器
 * 失败回落 fflate（行为与历史一致）。
 */
export function decompressZlib(compressed: Uint8Array): Result<Uint8Array, VfsContentError> {
  try {
    return Result.ok(tryZlibInflate(compressed) ?? unzlibSync(compressed));
  } catch (error) {
    return Result.err(new AppError("VFS_CONTENT_CORRUPT", `zlib 解压失败: ${errorText(error)}`, undefined, { cause: error }));
  }
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
 * 将已知为二进制 BLOB 的列值收成 Uint8Array；形态不符返回 `VFS_CONTENT_CORRUPT`。
 *
 * @remarks string 不得经此函数；zlib-b64 / 存量 string 路径在
 * {@link decodeCompressedBytes} 的约定分支处理。`label` 为错误文案中的
 * 表.列 名（如 `vfs_content_blob.bytes`），由调用方传入。
 */
export function asUint8Array(value: unknown, label: string): Result<Uint8Array, VfsContentError> {
  if (value instanceof Uint8Array) {
    return Result.ok(value);
  }
  // RN quick-sqlite / 部分绑定可能直接给出 ArrayBuffer。
  if (value instanceof ArrayBuffer) {
    return Result.ok(new Uint8Array(value));
  }
  return Result.err(new AppError("VFS_CONTENT_CORRUPT", `${label} 期望 Uint8Array/ArrayBuffer，实际 ${Object.prototype.toString.call(value)}`, { label, actualType: Object.prototype.toString.call(value) }));
}

/** base64 文本 → 字节；非法文本返回 `VFS_CONTENT_CORRUPT`（保留底层原因）。 */
function decodeBase64Text(text: string): Result<Uint8Array, VfsContentError> {
  try {
    return Result.ok(base64ToBytes(text));
  } catch (error) {
    return Result.err(new AppError("VFS_CONTENT_CORRUPT", `base64 解码失败: ${errorText(error)}`, undefined, { cause: error }));
  }
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
 * @returns 成功为 zlib 压缩字节；形态不符 / base64 非法返回 `VFS_CONTENT_CORRUPT`，
 *   encoding 不在值域返回 `VFS_CONTENT_UNSUPPORTED_FORMAT`。
 */
export function decodeCompressedBytes(encoding: string, bytes: unknown, label: string): Result<Uint8Array, VfsContentError> {
  if (encoding === VFS_CONTENT_ENCODING_ZLIB) {
    if (typeof bytes === "string") {
      // 存量：Mobile 曾写 encoding=zlib，但 quick-sqlite 读回为 base64 字符串。
      return decodeBase64Text(bytes);
    }
    return asUint8Array(bytes, label);
  }
  if (encoding === VFS_CONTENT_ENCODING_ZLIB_B64) {
    if (typeof bytes === "string") {
      return decodeBase64Text(bytes);
    }
    if (bytes instanceof Uint8Array || bytes instanceof ArrayBuffer) {
      return decodeBase64Text(new TextDecoder().decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)));
    }
    return Result.err(new AppError("VFS_CONTENT_CORRUPT", `${label} 期望 base64 字符串或 UTF-8 字节，实际 ${Object.prototype.toString.call(bytes)}`, { label, actualType: Object.prototype.toString.call(bytes) }));
  }
  return Result.err(new AppError("VFS_CONTENT_UNSUPPORTED_FORMAT", `不支持的 blob encoding: ${encoding}`, { encoding, label }));
}

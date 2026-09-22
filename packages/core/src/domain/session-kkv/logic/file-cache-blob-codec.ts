/**
 * file_cache 域 blob 编解码：FileCachePayload JSON 字符串 ↔ 两表写库字段。
 *
 * 压缩 / 哈希 / base64 全部复用 vfs ContentStore 现成模块（hash-content /
 * zlib-codec / blob-bytes-codec），平台分支与存量兼容口径对齐
 * SqliteVfsContentStore，不另起实现。
 *
 * @module domain/session-kkv/logic/file-cache-blob-codec
 */

import {
  base64ToBytes,
  bytesToBase64,
  isReactNativeRuntime,
  VFS_CONTENT_ENCODING_ZLIB_B64,
} from "@/domain/vfs/content-store/logic/blob-bytes-codec.js";
import { hashContent } from "@/domain/vfs/content-store/logic/hash-content.js";
import {
  compressZlib,
  decompressZlib,
  VFS_CONTENT_ENCODING_ZLIB,
} from "@/domain/vfs/content-store/logic/zlib-codec.js";
import { parseFileCachePayload } from "@/domain/workplace/logic/rule-snapshot-codec.js";

/** {@link encodeFileCacheValue} 产物：写 blob + entry 两表所需的全部字段。 */
export interface EncodedFileCacheValue {
  /** sha256(body)，blob 表主键（mtime 不参与哈希）。 */
  readonly contentHash: string;
  /** `zlib`（Node/Desktop）或 `zlib-b64`（RN）。 */
  readonly encoding: string;
  /** 压缩字节（zlib）或 base64 文本（zlib-b64，规避 quick-sqlite BLOB 绑参）。 */
  readonly bytes: Uint8Array | string;
  readonly byteLen: number;
  /** 留在 entry 引用行的 mtime——同 body 不同 mtime 共享 blob 且各自还原。 */
  readonly mtimeMs: number;
}

/**
 * 确保 BLOB 绑定使用独立 ArrayBuffer（照 SqliteVfsContentStore 的 tightBytes；
 * RN / better-sqlite3 约定，防止视图偏移导致绑参越界）。
 */
function tightBytes(source: Uint8Array): Uint8Array {
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy;
}

/**
 * 将已知为二进制 BLOB 的列值收成 Uint8Array。
 *
 * @remarks string 不得经此函数；zlib-b64 / 存量 string 路径在
 * {@link decodeCompressedBytes} 的约定分支处理。
 */
function asUint8Array(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  // RN quick-sqlite / 部分绑定可能直接给出 ArrayBuffer。
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  throw new Error(
    `session_file_cache_blob.bytes 期望 Uint8Array/ArrayBuffer，实际 ${Object.prototype.toString.call(
      value
    )}`
  );
}

/**
 * 将 zlib-b64 列值（或 UTF-8 形态的 base64 字节）还原为 base64 文本。
 */
function asBase64Text(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    return new TextDecoder().decode(bytes);
  }
  throw new Error(
    `session_file_cache_blob.bytes 期望 base64 字符串或 UTF-8 字节，实际 ${Object.prototype.toString.call(
      value
    )}`
  );
}

/**
 * 按 encoding 将 `session_file_cache_blob.bytes` 解成 zlib 压缩字节。
 *
 * 三形态兼容（对齐 SqliteVfsContentStore.decodeCompressedBytes 的口径）：
 * - `zlib` + Uint8Array/ArrayBuffer：原样
 * - `zlib` + string：存量 RN 误存 base64，按 base64 解
 * - `zlib-b64`：取 base64 文本再解码
 */
function decodeCompressedBytes(encoding: string, bytes: unknown): Uint8Array {
  if (encoding === VFS_CONTENT_ENCODING_ZLIB) {
    if (typeof bytes === "string") {
      // 存量：Mobile 曾写 encoding=zlib，但 quick-sqlite 读回为 base64 字符串。
      return base64ToBytes(bytes);
    }
    return asUint8Array(bytes);
  }

  if (encoding === VFS_CONTENT_ENCODING_ZLIB_B64) {
    const b64 = asBase64Text(bytes);
    return base64ToBytes(b64);
  }

  throw new Error(`不支持的 file cache blob encoding: ${encoding}`);
}

/**
 * 将 file_cache 域 value（FileCachePayload JSON）编码为两表写库字段。
 *
 * hash 只算 body：同 body 不同 mtime 的会话共享同一 blob 行。压缩编码照
 * SqliteVfsContentStore 的平台分支——RN 走 zlib-b64（TEXT 形态写入 bytes 列），
 * Node/Desktop 走 zlib 二进制 Uint8Array。
 *
 * @returns 非 FileCachePayload 形态的 value 返回 null。此为理论不发生路径
 * （上游一律写 serializeFileCachePayload 产物）：repository 对此类 value 退回
 * session_kkv_entry 原表存储，保证 get 逐字节还原的合同对任意字符串成立。
 */
export function encodeFileCacheValue(
  value: string
): EncodedFileCacheValue | null {
  const payload = parseFileCachePayload(value);
  if (payload == null) {
    return null;
  }
  const contentHash = hashContent(payload.body);
  const compressed = compressZlib(new TextEncoder().encode(payload.body));

  if (isReactNativeRuntime()) {
    // Hermes/RN：zlib 后再 base64，以 TEXT 写入，规避 quick-sqlite BLOB 绑参。
    const b64 = bytesToBase64(compressed);
    return {
      contentHash,
      encoding: VFS_CONTENT_ENCODING_ZLIB_B64,
      bytes: b64,
      byteLen: b64.length,
      mtimeMs: payload.mtimeMs,
    };
  }

  const bytes = tightBytes(compressed);
  return {
    contentHash,
    encoding: VFS_CONTENT_ENCODING_ZLIB,
    bytes,
    byteLen: bytes.byteLength,
    mtimeMs: payload.mtimeMs,
  };
}

/**
 * 将 blob 行解出 body 明文。
 *
 * @remarks 失败抛错（不支持的 encoding / 解压失败 / 字节形态异常）；
 * repository 捕获后按 miss 自愈返回 null（上层 parseFileCachePayload
 * 当 miss 重读，复用既有容错链路）。
 */
export function decodeFileCacheBlobBody(
  encoding: string,
  bytes: unknown
): string {
  const compressed = decodeCompressedBytes(encoding, bytes);
  const plainUtf8 = decompressZlib(compressed);
  return new TextDecoder().decode(plainUtf8);
}

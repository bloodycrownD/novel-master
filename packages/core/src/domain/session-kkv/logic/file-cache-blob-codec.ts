/**
 * file_cache 域 blob 编解码：FileCachePayload JSON 字符串 ↔ 两表写库字段。
 *
 * 压缩 / 哈希 / 字节收整（tightBytes、decodeCompressedBytes 等）
 * 全部复用 vfs ContentStore 侧共享模块（hash-content / zlib-codec），
 * 落库形态与存量兼容口径对齐
 * SqliteVfsContentStore，不另起实现。
 *
 * @module domain/session-kkv/logic/file-cache-blob-codec
 */

import { hashContent } from "@/domain/vfs/content-store/logic/hash-content.js";
import {
  compressZlib,
  decodeCompressedBytes,
  decompressZlib,
  tightBytes,
  VFS_CONTENT_ENCODING_ZLIB,
} from "@/domain/vfs/content-store/logic/zlib-codec.js";
import { parseFileCachePayload } from "@/domain/workplace/logic/rule-snapshot-codec.js";

/** {@link encodeFileCacheValue} 产物：写 blob + entry 两表所需的全部字段。 */
export interface EncodedFileCacheValue {
  /** sha256(body)，blob 表主键（mtime 不参与哈希）。 */
  readonly contentHash: string;
  /** 恒为 `zlib`（写侧已去 base64，RN 与 Node/Desktop 同一形态）。 */
  readonly encoding: string;
  /** zlib 压缩字节，紧凑 Uint8Array（blob 二进制落库）。 */
  readonly bytes: Uint8Array;
  /** 落库字节的物理长度，等于 `bytes.byteLength`。 */
  readonly byteLen: number;
  /** 留在 entry 引用行的 mtime——同 body 不同 mtime 共享 blob 且各自还原。 */
  readonly mtimeMs: number;
}

/**
 * 将 file_cache 域 value（FileCachePayload JSON）编码为两表写库字段。
 *
 * hash 只算 body：同 body 不同 mtime 的会话共享同一 blob 行。压缩编码恒为
 * `zlib` 二进制 Uint8Array（与 SqliteVfsContentStore 的 put 同一形态）；
 * 存量 `zlib-b64` / `zlib` + base64 文本行只由读侧 decodeFileCacheBlobBody 兜底。
 *
 * @param value 待编码的 FileCachePayload JSON 字符串。
 * @returns 非 FileCachePayload 形态的 value 返回 null。此为理论不发生路径
 *   （上游一律写 serializeFileCachePayload 产物）：repository 对此类 value 退回
 *   session_kkv_entry 原表存储，保证 get 逐字节还原的合同对任意字符串成立。
 */
export function encodeFileCacheValue(value: string): EncodedFileCacheValue | null {
  const payload = parseFileCachePayload(value);
  if (payload == null) {
    return null;
  }
  const contentHash = hashContent(payload.body);
  const compressed = compressZlib(new TextEncoder().encode(payload.body));
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
  const compressed = decodeCompressedBytes(
    encoding,
    bytes,
    "session_file_cache_blob.bytes"
  );
  const plainUtf8 = decompressZlib(compressed);
  return new TextDecoder().decode(plainUtf8);
}

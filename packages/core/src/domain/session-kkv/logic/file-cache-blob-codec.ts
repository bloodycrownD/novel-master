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
import { compressZlib, decodeCompressedBytes, decompressZlib, tightBytes, VFS_CONTENT_ENCODING_ZLIB } from "@/domain/vfs/content-store/logic/zlib-codec.js";
import { parseFileCachePayload } from "@/domain/workplace/logic/rule-snapshot-codec.js";
import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";

/** 本模块的领域失败：blob 字节损坏或 encoding 不识别（与 vfs content-store 同一语义）。 */
type FileCacheBlobError = AppError<"VFS_CONTENT_CORRUPT" | "VFS_CONTENT_UNSUPPORTED_FORMAT">;

/** {@link hashFileCachePayload} 产物：entry 引用行字段 + 待压缩明文。 */
interface HashedFileCachePayload {
  /** sha256(body)，blob 表主键（mtime 不参与哈希）。 */
  readonly contentHash: string;
  /** 留在 entry 引用行的 mtime——同 body 不同 mtime 共享 blob 且各自还原。 */
  readonly mtimeMs: number;
  /** body 明文（未压缩）：blob 行已存在时无需再压缩，直接丢弃。 */
  readonly body: string;
}

/**
 * 只哈希不压缩：set 侧「先查 blob 是否已存在、未命中才压缩」的前半段。
 * 压缩（尤其 Hermes 纯 JS deflate）远贵于哈希——压缩后回填（置位/压缩清
 * 域后的常规路径）内容多数未变，blob 已在库里时压缩产物会被 INSERT OR
 * IGNORE 整体丢弃，纯属浪费。
 */
export function hashFileCachePayload(value: string): HashedFileCachePayload | null {
  const payload = parseFileCachePayload(value);
  if (!payload.ok) {
    return null;
  }
  return {
    contentHash: hashContent(payload.value.body),
    mtimeMs: payload.value.mtimeMs,
    body: payload.value.body,
  };
}

/** 压缩 body 为 blob 行字段（blob 未命中时才调用）。 */
export function compressFileCacheBodyForBlob(body: string): {
  encoding: string;
  bytes: Uint8Array;
  byteLen: number;
} {
  const compressed = compressZlib(new TextEncoder().encode(body));
  const bytes = tightBytes(compressed);
  return {
    encoding: VFS_CONTENT_ENCODING_ZLIB,
    bytes,
    byteLen: bytes.byteLength,
  };
}

/**
 * 将 blob 行解出 body 明文。
 *
 * @remarks 失败返回 `Err`（不支持的 encoding / 解压失败 / 字节形态异常）；
 * repository 按 miss 自愈返回 null（上层 parseFileCachePayload 当 miss
 * 重读，复用既有容错链路）。
 */
export function decodeFileCacheBlobBody(encoding: string, bytes: unknown): Result<string, FileCacheBlobError> {
  const compressed = decodeCompressedBytes(encoding, bytes, "session_file_cache_blob.bytes");
  if (!compressed.ok) return Result.err(compressed.error);
  const plainUtf8 = decompressZlib(compressed.value);
  if (!plainUtf8.ok) return Result.err(plainUtf8.error);
  return Result.ok(new TextDecoder().decode(plainUtf8.value));
}

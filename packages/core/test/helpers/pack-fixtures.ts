/**
 * pack-codec 编码夹具：生产读侧只解码（后台打包任务已退役），
 * 两个 encode 原语仅供测试构造 pack 字节。
 *
 * @module test/helpers/pack-fixtures
 */

import { createDelta } from "fossil-delta";
import { VFS_PACK_FORMAT_FOSSIL_CHAIN_V1, VFS_PACK_FORMAT_ZLIB_CONCAT_V1, type VfsPackSpan } from "../../src/domain/vfs/content-store/logic/pack-codec.js";
import { compressZlib } from "../../src/domain/vfs/content-store/logic/zlib-codec.js";
import { AppError } from "../../src/errors/app-error.js";
import { Result } from "../../src/errors/either.js";

/** 编码产物：pack 流字节 + 各成员区间（pack 为明文切片区间；fossil 为段区间）。 */
export interface VfsPackEncodeResult {
  readonly bytes: Uint8Array;
  readonly spans: ReadonlyArray<VfsPackSpan>;
}

type VfsContentError = AppError<"VFS_CONTENT_CORRUPT">;

/**
 * 编码 zlib-concat 组：明文顺序拼接 → 单条 zlib 流。
 *
 * @param memberPlains 各成员明文 UTF-8 字节（去重后的成员序列，重复 hash 由调用方
 *   在数据层共享同一 member 行）
 * @returns 流字节 + 各成员在解压后明文里的切片区间；空组成员返回 `VFS_CONTENT_CORRUPT`
 */
export function encodeZlibConcatPack(memberPlains: ReadonlyArray<Uint8Array>): Result<VfsPackEncodeResult, VfsContentError> {
  if (memberPlains.length === 0) {
    return Result.err(new AppError("VFS_CONTENT_CORRUPT", { detail: "zlib-concat-v1 组至少需要 1 个成员", format: VFS_PACK_FORMAT_ZLIB_CONCAT_V1, memberCount: 0 }));
  }
  // 拼接顺序即成员顺序，区间 offset 按各成员明文长顺序累计。
  const concat = concatBytes(memberPlains);
  const spans: Array<{ offset: number; length: number }> = [];
  let cursor = 0;
  for (const plain of memberPlains) {
    spans.push({ offset: cursor, length: plain.byteLength });
    cursor += plain.byteLength;
  }
  return Result.ok({ bytes: compressZlib(concat), spans });
}

/**
 * 编码 fossil 链组：段 0 = zlib(首成员明文全量)，段 i = zlib(createDelta(前驱明文,
 * 当前明文))；段表（4B 段数 LE + N×4B 各段压缩长 LE）前置于段数据连排。
 *
 * @returns 流字节 + 各成员所在段的区间（spans[i] 即 member i 的 offset/length）；
 *   空组成员返回 `VFS_CONTENT_CORRUPT`
 */
export function encodeFossilChainPack(memberPlains: ReadonlyArray<Uint8Array>): Result<VfsPackEncodeResult, VfsContentError> {
  if (memberPlains.length === 0) {
    return Result.err(new AppError("VFS_CONTENT_CORRUPT", { detail: "fossil-chain-v1 组至少需要 1 个成员", format: VFS_PACK_FORMAT_FOSSIL_CHAIN_V1, memberCount: 0 }));
  }
  const segmentBytes = memberPlains.map((plain, index) => (index === 0 ? compressZlib(plain) : compressZlib(createDelta(memberPlains[index - 1]!, plain))));
  const header = new Uint8Array(4 + 4 * segmentBytes.length);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, segmentBytes.length, true);
  const parts: Uint8Array[] = [header];
  segmentBytes.forEach((segment, index) => {
    headerView.setUint32(4 + 4 * index, segment.byteLength, true);
    parts.push(segment);
  });
  const bytes = concatBytes(parts);
  const spans: VfsPackSpan[] = [];
  let cursor = header.byteLength;
  for (const segment of segmentBytes) {
    spans.push({ offset: cursor, length: segment.byteLength });
    cursor += segment.byteLength;
  }
  return Result.ok({ bytes, spans });
}

function concatBytes(parts: ReadonlyArray<Uint8Array>): Uint8Array {
  let total = 0;
  for (const part of parts) {
    total += part.byteLength;
  }
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.byteLength;
  }
  return out;
}

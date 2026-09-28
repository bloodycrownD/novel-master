/**
 * vfs_content_pack 容器两种 format 的编解码（zlib-concat-v1 / fossil-chain-v1）。
 *
 * 布局契约（SPEC binary-blob-and-vfs-pack Part B）：
 * - `zlib-concat-v1`：member.offset/length 是**组流解压后明文**的切片区间；组流为
 *   明文拼接后的单条 zlib 流，读侧整组只解压一次再按区间切片。
 * - `fossil-chain-v1`：member.offset/length 是**bytes 内的段区间**（length = 段压缩
 *   字节长）。段表布局：`4B 段数（LE）+ N×4B 各段压缩长（LE）+ 段数据连排`；段 0 =
 *   zlib(首成员明文全量)，段 i = zlib(createDelta(明文[i-1], 明文[i]))。读成员 k =
 *   解段表 → 解段 0 得 v0 → 沿链 applyDelta 到段 k（组内 ≤8 段，链式读放大有界）。
 *
 * 读侧（SqliteVfsContentStore 的 get/getMany member 分派）与写侧（后台打包任务）
 * 共用本模块，段表布局只有这一份实现。另附解压计数探针，供测试断言「pack 组整组
 * 只解压一次、fossil 组沿链复用中间结果」（见 `__getVfsPackDecodeCountersForTests`）。
 *
 * @module domain/vfs/content-store/logic/pack-codec
 */

import { unzlibSync, zlibSync } from "fflate";
import { applyDelta, createDelta } from "fossil-delta";

/** 小组 format：明文拼接、单流 zlib。 */
export const VFS_PACK_FORMAT_ZLIB_CONCAT_V1 = "zlib-concat-v1" as const;

/** 大组 format：首成员全量 zlib + 后续成员相对同组前驱的 delta 再 zlib。 */
export const VFS_PACK_FORMAT_FOSSIL_CHAIN_V1 = "fossil-chain-v1" as const;

/** vfs_content_pack.format 值域（与 DDL CHECK 一致）。 */
export type VfsPackFormat =
  | typeof VFS_PACK_FORMAT_ZLIB_CONCAT_V1
  | typeof VFS_PACK_FORMAT_FOSSIL_CHAIN_V1;

/** member 在其语义空间内的字节区间（pack：解压后明文空间；fossil：bytes 空间）。 */
export interface VfsPackSpan {
  readonly offset: number;
  readonly length: number;
}

/** 编码产物：pack 流字节 + 各成员区间（pack 为明文切片区间；fossil 为段区间）。 */
export interface VfsPackEncodeResult {
  readonly bytes: Uint8Array;
  readonly spans: ReadonlyArray<VfsPackSpan>;
}

// ---------------------------------------------------------------------------
// 解压计数探针（仅测试观测用；命名照 `__reset...ForTests` 既有先例）
// ---------------------------------------------------------------------------

/** 探针计数快照。 */
export interface VfsPackDecodeCounters {
  /** zlib-concat 组流解压次数（整组一次为正确形态）。 */
  readonly zlibConcatInflates: number;
  /** fossil 段解压次数（组内按段数一次为正确形态，不含链 apply）。 */
  readonly fossilSegmentInflates: number;
}

const decodeCounters = {
  zlibConcatInflates: 0,
  fossilSegmentInflates: 0,
};

/** 清零解压计数探针（测试钩子）。 */
export function __resetVfsPackDecodeCountersForTests(): void {
  decodeCounters.zlibConcatInflates = 0;
  decodeCounters.fossilSegmentInflates = 0;
}

/** 读取解压计数探针当前值（测试钩子）。 */
export function __getVfsPackDecodeCountersForTests(): VfsPackDecodeCounters {
  return { ...decodeCounters };
}

// ---------------------------------------------------------------------------
// zlib-concat-v1
// ---------------------------------------------------------------------------

/**
 * 编码 zlib-concat 组：明文顺序拼接 → 单条 zlib 流。
 *
 * @param memberPlains 各成员明文 UTF-8 字节（去重后的成员序列，重复 hash 由调用方
 *   在数据层共享同一 member 行）
 * @returns 流字节 + 各成员在解压后明文里的切片区间
 */
export function encodeZlibConcatPack(
  memberPlains: ReadonlyArray<Uint8Array>
): VfsPackEncodeResult {
  if (memberPlains.length === 0) {
    throw new Error("zlib-concat-v1 组至少需要 1 个成员");
  }
  // 拼接顺序即成员顺序，区间 offset 按各成员明文长顺序累计。
  const concat = concatBytes(memberPlains);
  const spans: Array<{ offset: number; length: number }> = [];
  let cursor = 0;
  for (const plain of memberPlains) {
    spans.push({ offset: cursor, length: plain.byteLength });
    cursor += plain.byteLength;
  }
  return { bytes: zlibSync(concat), spans };
}

/**
 * 解码 zlib-concat 组的若干成员：整组流只解压一次，再按区间切片明文。
 *
 * @returns 与 spans 同序的成员明文 UTF-8 字节（subarray 视图，调用方解码后即弃）
 */
export function decodeZlibConcatSpans(
  packBytes: Uint8Array,
  spans: ReadonlyArray<VfsPackSpan>
): Uint8Array[] {
  decodeCounters.zlibConcatInflates++;
  const plainAll = unzlibSync(packBytes);
  return spans.map((span) => {
    assertSpanWithin(span, plainAll.byteLength, "zlib-concat-v1");
    return plainAll.subarray(span.offset, span.offset + span.length);
  });
}

// ---------------------------------------------------------------------------
// fossil-chain-v1
// ---------------------------------------------------------------------------

/** fossil 段表解析结果：段数 + 各段在 bytes 内的区间（按链序）。 */
export interface FossilSegmentTable {
  readonly segmentCount: number;
  readonly segments: ReadonlyArray<VfsPackSpan>;
}

/**
 * 编码 fossil 链组：段 0 = zlib(首成员明文全量)，段 i = zlib(createDelta(前驱明文,
 * 当前明文))；段表（4B 段数 LE + N×4B 各段压缩长 LE）前置于段数据连排。
 *
 * @returns 流字节 + 各成员所在段的区间（spans[i] 即 member i 的 offset/length）
 */
export function encodeFossilChainPack(
  memberPlains: ReadonlyArray<Uint8Array>
): VfsPackEncodeResult {
  if (memberPlains.length === 0) {
    throw new Error("fossil-chain-v1 组至少需要 1 个成员");
  }
  const segmentBytes = memberPlains.map((plain, index) =>
    index === 0
      ? zlibSync(plain)
      : zlibSync(createDelta(memberPlains[index - 1]!, plain))
  );
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
  return { bytes, spans };
}

/**
 * 解析 fossil 段表（`4B 段数（LE）+ N×4B 各段压缩长（LE）+ 段数据连排`）。
 *
 * @remarks 严格校验：段表不完整或段长合计与流长不符（尾部残留/截断）均抛错，
 *   防止错位段区间静默解出脏明文。
 */
export function parseFossilSegmentTable(
  packBytes: Uint8Array
): FossilSegmentTable {
  if (packBytes.byteLength < 4) {
    throw new Error("fossil-chain-v1 流过短：连段数头都读不到");
  }
  const view = new DataView(
    packBytes.buffer,
    packBytes.byteOffset,
    packBytes.byteLength
  );
  const segmentCount = view.getUint32(0, true);
  if (segmentCount === 0) {
    throw new Error("fossil-chain-v1 段表段数为 0");
  }
  const headerLength = 4 + 4 * segmentCount;
  if (packBytes.byteLength < headerLength) {
    throw new Error("fossil-chain-v1 流过短：段表长度区不完整");
  }
  const segments: VfsPackSpan[] = [];
  let cursor = headerLength;
  for (let index = 0; index < segmentCount; index++) {
    const length = view.getUint32(4 + 4 * index, true);
    segments.push({ offset: cursor, length });
    cursor += length;
  }
  if (cursor !== packBytes.byteLength) {
    throw new Error(
      `fossil-chain-v1 段表与流长不符：段数据合计 ${cursor - headerLength}，实际剩余 ${
        packBytes.byteLength - headerLength
      }`
    );
  }
  return { segmentCount, segments };
}

/**
 * 解码 fossil 链组的若干成员：解段表 → 解段 0 得 v0 → 沿链 applyDelta 到所需最大
 * 段号，中间明文全组共享（一次链遍历喂所有成员，而非逐成员从段 0 重解）。
 *
 * @param spans 各成员所在段区间（offset/length 必须与段表推导一致，错位即抛错）
 * @returns 与 spans 同序的成员明文 UTF-8 字节
 */
export function decodeFossilChainSpans(
  packBytes: Uint8Array,
  spans: ReadonlyArray<VfsPackSpan>
): Uint8Array[] {
  if (spans.length === 0) {
    return [];
  }
  const table = parseFossilSegmentTable(packBytes);
  const segmentIndexByOffset = new Map<number, number>();
  table.segments.forEach((segment, index) => {
    segmentIndexByOffset.set(segment.offset, index);
  });
  const memberIndices = spans.map((span) => {
    assertSpanWithin(span, packBytes.byteLength, "fossil-chain-v1");
    const index = segmentIndexByOffset.get(span.offset);
    if (index == null) {
      throw new Error(
        `fossil-chain-v1 member offset 与段表不符: ${span.offset}`
      );
    }
    const segment = table.segments[index]!;
    if (segment.length !== span.length) {
      throw new Error(
        `fossil-chain-v1 member length 与段表不符: ${span.length} != ${segment.length}`
      );
    }
    return index;
  });

  // 沿链一次走到所需最大段号；fossil-delta 的 applyDelta 默认校验 delta 校验和。
  const chain: Uint8Array[] = [];
  let current = inflateFossilSegment(packBytes, table.segments[0]!);
  chain[0] = current;
  const maxIndex = Math.max(...memberIndices);
  for (let index = 1; index <= maxIndex; index++) {
    current = applyDelta(
      current,
      inflateFossilSegment(packBytes, table.segments[index]!)
    );
    chain[index] = current;
  }
  return memberIndices.map((index) => chain[index]!);
}

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

function inflateFossilSegment(
  packBytes: Uint8Array,
  segment: VfsPackSpan
): Uint8Array {
  decodeCounters.fossilSegmentInflates++;
  return unzlibSync(packBytes.subarray(segment.offset, segment.offset + segment.length));
}

function assertSpanWithin(
  span: VfsPackSpan,
  limit: number,
  label: string
): void {
  if (
    span.offset < 0 ||
    span.length < 0 ||
    span.offset + span.length > limit
  ) {
    throw new Error(
      `${label} member 区间越界: offset=${span.offset} length=${span.length} 界限=${limit}`
    );
  }
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

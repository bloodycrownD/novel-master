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
 * 共用本模块，段表布局只有这一份实现。压缩/解压复用 zlib-codec（宿主注册的
 * zlib 加速器分派；未注册恒 fflate）。另附解压计数探针，供测试断言「pack 组整组
 * 只解压一次、fossil 组沿链复用中间结果」（见 `__getVfsPackDecodeCountersForTests`）。
 *
 * 编解码失败走 `Result`（key `VFS_CONTENT_CORRUPT` / `VFS_CONTENT_UNSUPPORTED_FORMAT`），
 * 本模块不抛；调用方按 `if (!r.ok)` 收窄后自行决定抛还是降级。
 *
 * @module domain/vfs/content-store/logic/pack-codec
 */

import { applyDelta, createDelta, getDeltaTargetSize } from "fossil-delta";
import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import { errorText } from "../../../../common/error-text.js";
import { compressZlib, decompressZlib } from "./zlib-codec.js";

/** 小组 format：明文拼接、单流 zlib。 */
export const VFS_PACK_FORMAT_ZLIB_CONCAT_V1 = "zlib-concat-v1" as const;

/** 大组 format：首成员全量 zlib + 后续成员相对同组前驱的 delta 再 zlib。 */
export const VFS_PACK_FORMAT_FOSSIL_CHAIN_V1 = "fossil-chain-v1" as const;

/** vfs_content_pack.format 值域（与 DDL CHECK 一致）。 */
export type VfsPackFormat = typeof VFS_PACK_FORMAT_ZLIB_CONCAT_V1 | typeof VFS_PACK_FORMAT_FOSSIL_CHAIN_V1;

/** 本模块的领域失败：pack 数据损坏或 format 不在值域内。 */
type VfsContentError = AppError<"VFS_CONTENT_CORRUPT" | "VFS_CONTENT_UNSUPPORTED_FORMAT">;

/** member 在其语义空间内的字节区间（pack：解压后明文空间；fossil：bytes 空间）。 */
export interface VfsPackSpan {
  readonly offset: number;
  readonly length: number;
}

/** 编码产物：pack 流字节 + 各成员区间（pack 为明文切片区间；fossil 为段区间）。 */
interface VfsPackEncodeResult {
  readonly bytes: Uint8Array;
  readonly spans: ReadonlyArray<VfsPackSpan>;
}

// ---------------------------------------------------------------------------
// 解压计数探针（仅测试观测用；命名照 `__reset...ForTests` 既有先例）
// ---------------------------------------------------------------------------

/** 探针计数快照。 */
interface VfsPackDecodeCounters {
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
 * @returns 流字节 + 各成员在解压后明文里的切片区间；空组成员返回 `VFS_CONTENT_CORRUPT`
 */
export function encodeZlibConcatPack(memberPlains: ReadonlyArray<Uint8Array>): Result<VfsPackEncodeResult, VfsContentError> {
  if (memberPlains.length === 0) {
    return Result.err(new AppError("VFS_CONTENT_CORRUPT", "zlib-concat-v1 组至少需要 1 个成员", { format: VFS_PACK_FORMAT_ZLIB_CONCAT_V1, memberCount: 0 }));
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
 * 解码 zlib-concat 组的若干成员：整组流只解压一次，再按区间切片明文。
 *
 * @remarks `spans` 为空时**不碰流、不计探针**直接返回空数组（与 fossil 版同形）：
 *   空组的读请求没有明文要取，整组解压纯属白做，且会污染
 *   `zlibConcatInflates` 计数探针、让「整组只解压一次」这条断言失真。
 * @returns 与 spans 同序的成员明文 UTF-8 字节（subarray 视图，调用方解码后即弃）；
 *   `spans` 为空时返回空数组且不解压整组流；流损坏 / 区间越界返回 `VFS_CONTENT_CORRUPT`
 */
export function decodeZlibConcatSpans(packBytes: Uint8Array, spans: ReadonlyArray<VfsPackSpan>): Result<Uint8Array[], VfsContentError> {
  if (spans.length === 0) {
    return Result.ok([]);
  }
  decodeCounters.zlibConcatInflates++;
  const decompressed = decompressZlib(packBytes);
  if (!decompressed.ok) {
    return Result.err(decompressed.error);
  }
  const plainAll = decompressed.value;
  const plains: Uint8Array[] = [];
  for (const span of spans) {
    const within = assertSpanWithin(span, plainAll.byteLength, VFS_PACK_FORMAT_ZLIB_CONCAT_V1);
    if (!within.ok) {
      return Result.err(within.error);
    }
    plains.push(plainAll.subarray(span.offset, span.offset + span.length));
  }
  return Result.ok(plains);
}

// ---------------------------------------------------------------------------
// fossil-chain-v1
// ---------------------------------------------------------------------------

/** fossil 段表解析结果：段数 + 各段在 bytes 内的区间（按链序）。 */
interface FossilSegmentTable {
  readonly segmentCount: number;
  readonly segments: ReadonlyArray<VfsPackSpan>;
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
    return Result.err(new AppError("VFS_CONTENT_CORRUPT", "fossil-chain-v1 组至少需要 1 个成员", { format: VFS_PACK_FORMAT_FOSSIL_CHAIN_V1, memberCount: 0 }));
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

/**
 * 解析 fossil 段表（`4B 段数（LE）+ N×4B 各段压缩长（LE）+ 段数据连排`）。
 *
 * @remarks 段表自洽性校验：段表长度区不完整、段数为 0、段长合计与流长不符
 *   （尾部残留/截断）均返回 `VFS_CONTENT_CORRUPT`，防止错位段区间静默解出脏明文。**不含「段长 > 0」**
 *   ——零长段由写侧（`encodeFossilChainPack` 每段必有内容）保证，本解析层不拦；
 *   零长段的后果见 {@link decodeFossilChainSpans} 里的 offset 索引注释。
 */
export function parseFossilSegmentTable(packBytes: Uint8Array): Result<FossilSegmentTable, VfsContentError> {
  if (packBytes.byteLength < 4) {
    return Result.err(new AppError("VFS_CONTENT_CORRUPT", "fossil-chain-v1 流过短：连段数头都读不到", { byteLength: packBytes.byteLength }));
  }
  const view = new DataView(packBytes.buffer, packBytes.byteOffset, packBytes.byteLength);
  const segmentCount = view.getUint32(0, true);
  if (segmentCount === 0) {
    return Result.err(new AppError("VFS_CONTENT_CORRUPT", "fossil-chain-v1 段表段数为 0", { byteLength: packBytes.byteLength }));
  }
  const headerLength = 4 + 4 * segmentCount;
  if (packBytes.byteLength < headerLength) {
    return Result.err(new AppError("VFS_CONTENT_CORRUPT", "fossil-chain-v1 流过短：段表长度区不完整", { byteLength: packBytes.byteLength, headerLength }));
  }
  const segments: VfsPackSpan[] = [];
  let cursor = headerLength;
  for (let index = 0; index < segmentCount; index++) {
    const length = view.getUint32(4 + 4 * index, true);
    segments.push({ offset: cursor, length });
    cursor += length;
  }
  if (cursor !== packBytes.byteLength) {
    return Result.err(new AppError("VFS_CONTENT_CORRUPT", `fossil-chain-v1 段表与流长不符：段数据合计 ${cursor - headerLength}，实际剩余 ${packBytes.byteLength - headerLength}`, { byteLength: packBytes.byteLength, headerLength }));
  }
  return Result.ok({ segmentCount, segments });
}

/**
 * fossil delta 段的输出规模闸门（apply 前校验 delta 头自述的 targetSize）。
 *
 * 闸门依据不是「单成员必 < 1MB」——写侧对单成员超限有容错（`chunkCandidateGroups`
 * 的 `current.length > 0` 前置让首个成员再大也收进组）。真正成立的不变量是
 * 「**超限单成员必独占一组 → 只落段 0、永远不经 applyDelta**」，故任何进入
 * `applyDelta` 的段其 targetSize 必 < 写侧 `GROUP_PLAIN_BYTES_LIMIT`。
 *
 * 方向性提醒：**写侧若允许超限成员与他人同组，必须同步放宽本常量**（否则正常
 * 打包出的 pack 会在读侧被本闸门误伤）。两处常量互为交叉引用，耦合是隐式的
 * （不起共享常量模块）——改任一侧都必须同时看另一侧。
 *
 * 为什么需要它：fossil-delta 的 `applyDelta` 只信 delta 头自述的 `limit`（上界
 * 2^32-1），输出规模与 delta 字节数、source 长度无任何比例约束。几百字节的坏
 * 段（高度重复的 copy 指令流 + zlib 压缩比 ~1000:1）即可放大到数十 MB 输出、
 * 数百 MB 堆，一次 `contentStore.get()` 就能打死宿主进程（堆耗尽 catch 不掉）；
 * pack 永不重写 → 一次坏数据永久毒化每次读。
 */
const FOSSIL_SEGMENT_TARGET_SIZE_LIMIT_BYTES = 1024 * 1024;

/**
 * 解码 fossil 链组的若干成员：解段表 → 解段 0 得 v0 → 沿链 applyDelta 到所需最大
 * 段号，中间明文全组共享（一次链遍历喂所有成员，而非逐成员从段 0 重解）。
 *
 * @param spans 各成员所在段区间（offset/length 必须与段表推导一致，错位即返回 Err）
 * @returns 与 spans 同序的成员明文 UTF-8 字节；段表 / 段区间 / 解压 / apply 失败
 *   返回 `VFS_CONTENT_CORRUPT`
 */
export function decodeFossilChainSpans(packBytes: Uint8Array, spans: ReadonlyArray<VfsPackSpan>): Result<Uint8Array[], VfsContentError> {
  if (spans.length === 0) {
    return Result.ok([]);
  }
  const tableResult = parseFossilSegmentTable(packBytes);
  if (!tableResult.ok) {
    return Result.err(tableResult.error);
  }
  const table = tableResult.value;
  // offset → 段号索引的**唯一性前提**是「各段 length > 0」：零长段会让后一段的
  // offset 与前一段撞车，Map.set 后写覆盖前写，只保留最后一个同 offset 的段号。
  // 该前提由写侧保证（`encodeFossilChainPack` 每段都装了一整条 zlib 流，长度
  // 必 > 0），本解析层刻意不校验它（见 {@link parseFossilSegmentTable} 的
  // @remarks）。即便有坏 pack 带零长段撞车，后果**仍是响亮失败而非静默错读**：
  // 撞车时 member span 的 offset 命中的是另一个段号，随后 `segment.length !==
  // span.length` 的长度对账（或段边界解析）必然失败，不存在「解出别的成员明文
  // 并冒充返回」这条静默路径。
  const segmentIndexByOffset = new Map<number, number>();
  table.segments.forEach((segment, index) => {
    segmentIndexByOffset.set(segment.offset, index);
  });
  const memberIndices: number[] = [];
  for (const span of spans) {
    const within = assertSpanWithin(span, packBytes.byteLength, VFS_PACK_FORMAT_FOSSIL_CHAIN_V1);
    if (!within.ok) {
      return Result.err(within.error);
    }
    const index = segmentIndexByOffset.get(span.offset);
    if (index == null) {
      return Result.err(new AppError("VFS_CONTENT_CORRUPT", `fossil-chain-v1 member offset 与段表不符: ${span.offset}`, { offset: span.offset, length: span.length }));
    }
    const segment = table.segments[index]!;
    if (segment.length !== span.length) {
      return Result.err(new AppError("VFS_CONTENT_CORRUPT", `fossil-chain-v1 member length 与段表不符: ${span.length} != ${segment.length}`, { offset: span.offset, length: span.length, segmentLength: segment.length, segmentIndex: index }));
    }
    memberIndices.push(index);
  }

  // 沿链一次走到所需最大段号；fossil-delta 的 applyDelta 默认校验 delta 校验和。
  const chain: Uint8Array[] = [];
  const first = inflateFossilSegment(packBytes, table.segments[0]!, 0);
  if (!first.ok) {
    return Result.err(first.error);
  }
  let current = first.value;
  chain[0] = current;
  const maxIndex = Math.max(...memberIndices);
  for (let index = 1; index <= maxIndex; index++) {
    const segment = table.segments[index]!;
    const inflated = inflateFossilSegment(packBytes, segment, index);
    if (!inflated.ok) {
      return Result.err(inflated.error);
    }
    const delta = inflated.value;
    // applyDelta 输出规模闸门：坏段可自述 4GB 的 targetSize（几百字节 delta 放大
    // 数十 MB 输出、打死宿主堆），必须在 apply 之前拦（详见常量注释）。
    let targetSize: number;
    try {
      targetSize = getDeltaTargetSize(delta);
    } catch (error) {
      // delta 头本身损坏时 getDeltaTargetSize 会抛（段级包装补上段号与坐标）。
      return Result.err(segmentError(index, segment, "targetSize", error));
    }
    if (targetSize > FOSSIL_SEGMENT_TARGET_SIZE_LIMIT_BYTES) {
      return Result.err(new AppError("VFS_CONTENT_CORRUPT", `fossil-chain-v1 段 ${index} delta 声明的输出规模 ${targetSize} 字节超过上限 ${FOSSIL_SEGMENT_TARGET_SIZE_LIMIT_BYTES} 字节（坏段防御，拒绝 apply）`, { segmentIndex: index, targetSize, limit: FOSSIL_SEGMENT_TARGET_SIZE_LIMIT_BYTES }));
    }
    try {
      current = applyDelta(current, delta);
    } catch (error) {
      // 裸冒泡只有 `bad checksum` / `corrupt delta` 之类底层文案，链路末端（只拿到
      // 一串 hash 的 content store 调用方）完全无从判断是哪一段出的问题——段级
      // 包装补上段号与区间坐标。
      return Result.err(segmentError(index, segment, "applyDelta", error));
    }
    chain[index] = current;
  }
  return Result.ok(memberIndices.map((index) => chain[index]!));
}

// ---------------------------------------------------------------------------
// format 分派（读路径 / 校验 / 展开共用的唯一入口）
// ---------------------------------------------------------------------------

/**
 * 按 pack 的 `format` 分派解码组成员：**读路径（content store get/getMany）
 * 的唯一入口**。
 *
 * @remarks 此前读侧与打包任务各写一份逐字近似（两 if + 未知值抛错）的分派，
 *   新增 format 时漏改一处就会变成「写侧认得、读侧不认」的静默分叉，故收口于此
 *   （打包任务已随第七轮退役，本函数仍是 pack 数据的唯一解码入口）。
 *   形参取 `string` 而非 {@link VfsPackFormat}：库里的 `format` 列在 DDL CHECK
 *   之外仍可能读到脏值，未知值必须响亮失败而不是被类型断言掩过去。
 * @param packBytes pack 行的 bytes（fossil 为含段表的整段流）
 * @param spans 各成员区间（语义空间由 format 决定）
 * @returns 与 spans 同序的成员明文 UTF-8 字节；未知 format 返回
 *   `VFS_CONTENT_UNSUPPORTED_FORMAT`
 */
export function decodePackMembers(format: string, packBytes: Uint8Array, spans: ReadonlyArray<VfsPackSpan>): Result<Uint8Array[], VfsContentError> {
  if (format === VFS_PACK_FORMAT_ZLIB_CONCAT_V1) {
    return decodeZlibConcatSpans(packBytes, spans);
  }
  if (format === VFS_PACK_FORMAT_FOSSIL_CHAIN_V1) {
    return decodeFossilChainSpans(packBytes, spans);
  }
  return Result.err(new AppError("VFS_CONTENT_UNSUPPORTED_FORMAT", `不支持的 vfs_content_pack.format: ${format}`, { format }));
}

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

/**
 * 解单段 fossil 段（zlib 解压），失败按段级上下文包装。
 *
 * @param index 段号（链序，从 0 起）——仅用于错误上下文，不参与解压
 * @param segment 该段在 packBytes 内的区间
 */
function inflateFossilSegment(packBytes: Uint8Array, segment: VfsPackSpan, index: number): Result<Uint8Array, VfsContentError> {
  decodeCounters.fossilSegmentInflates++;
  const decompressed = decompressZlib(packBytes.subarray(segment.offset, segment.offset + segment.length));
  if (!decompressed.ok) {
    // 同 {@link decodeFossilChainSpans} 里 applyDelta 的包装理由：裸冒泡只有
    // fflate/zlib 的底层文案（如 `invalid zlib data`），看不出是哪一段坏了。
    return Result.err(segmentError(index, segment, "inflate", decompressed.error));
  }
  return decompressed;
}

/**
 * 段级错误包装：给底层失败补上「哪一段、在流的哪个区间、哪个阶段、什么原因」。
 *
 * @param index 段号（链序，从 0 起）
 * @param segment 该段在 packBytes 内的区间
 * @param phase 出错阶段：`inflate` = 该段 zlib 解不开；`targetSize` = delta 头损坏
 *   读不出输出规模；`applyDelta` = 该段解开了但沿链 apply 到它时炸（delta 自身损坏 /
 *   校验和不符）
 * @param error 底层抛出的值（任意类型，文案统一走 `errorText` 兜底）
 * @returns 带段号/区间/阶段/原因的 AppError，并以 `{ cause }` 挂住原始错误供上层
 *   取详情（`cause` 保底，不依赖它一定被消费）
 */
function segmentError(index: number, segment: VfsPackSpan, phase: "inflate" | "targetSize" | "applyDelta", error: unknown): AppError<"VFS_CONTENT_CORRUPT"> {
  return new AppError("VFS_CONTENT_CORRUPT", `fossil-chain-v1 段 ${index} ${phase} 失败: offset=${segment.offset} length=${segment.length} 原因=${errorText(error)}`, { segmentIndex: index, offset: segment.offset, length: segment.length, phase }, { cause: error });
}

function assertSpanWithin(span: VfsPackSpan, limit: number, label: string): Result<void, VfsContentError> {
  if (span.offset < 0 || span.length < 0 || span.offset + span.length > limit) {
    return Result.err(new AppError("VFS_CONTENT_CORRUPT", `${label} member 区间越界: offset=${span.offset} length=${span.length} 界限=${limit}`, { offset: span.offset, length: span.length, limit }));
  }
  return Result.ok(undefined);
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

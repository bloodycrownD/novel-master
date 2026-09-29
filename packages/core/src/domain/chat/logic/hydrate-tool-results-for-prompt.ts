/**
 * read 工具结果引用块的 view-time hydrate（read-tool-result-ref Step 4）。
 *
 * 含 `contentRef` 的 tool_result 块在发送提示词前按全局键
 * `(entryId, version)` 查 revision 元数据（`findMetaByEntryAndVersion`
 * 只取 status / content_hash 两列，**零解码**）与 `ref.contentHash` 比对
 * 冗余校验（不匹配 = 版本错位 / 错键，fail-fast 抛
 * {@link ReadResultHydrateError}——绝不静默把空 content 或错文发给 LLM），
 * 元数据通过后才解 blob 明文，再以 ref 自包含参数重放 read 的截断管线
 * （`sliceLinesFromOffset` + `capUtf8BytesFill`，与 read 执行时逐字节
 * 同参）经 `formatReadOutput`（冻结函数，演进须版本化）还原 wire 文本，
 * 填回块 `content`——**内存态，不写回 content_json**（prepare 的
 * attach hydrate 同款纪律）。legacy 块（无 contentRef）零处理。
 *
 * 单次调用内按 ref 键去重（同一批消息重复引用同一 revision / 同一
 * 重放参数只解码一次），**不跨调用持久缓存**——取舍见 {@link HydrateMemo}。
 *
 * 完整性校验降本（2026-09-29 性能修复）：旧实现把解出的明文整段重算
 * SHA-256 再与 `ref.contentHash` 比对（34KB/块 ≈ 0.27ms，100 块 ≈ 27ms，
 * 占单次 hydrate 约 1/4）。现在改为直接比对 revision 行的 `content_hash`
 * 元数据列（`findMetaByEntryAndVersion`，与取明文的键同源）：
 *
 * 1. 抗传输 / 落盘损坏由 zlib 解码器自带的 adler32 兜底
 *    （`decompressZlib`：校验和不符即抛错），位翻转不会变成「悄悄发错文」；
 * 2. 元数据比对挡的是版本错位 / 错键——行上的 `content_hash` 与 ref 记录的
 *    不一致时，`contentStore.get` 取出的根本是另一版 blob，这正是 fail-fast
 *    要防的事故；比对发生在解码之前，比旧实现更早失败；
 * 3. 「有人刻意同时改写 blob 明文字节与其 hash 字段」这种双改，等价于一条
 *    合法的另一版数据（引用键 `(entryId, version)` 也已指向该版），不再另行
 *    报错：这类双改同样能骗过旧实现的重算（重算只认明文，不认 blob 绑定），
 *    故语义等价——这也是 vfs 其余明文读路径（entry / revision 解析）一直
 *    采用的纪律，hydrate 不再是唯一重算方。
 *
 * 四种 fail-fast 语义（REPO_MISSING / REVISION_MISSING / CONTENT_DELETED /
 * HASH_MISMATCH）与判别码保持不变。
 *
 * @module domain/chat/logic/hydrate-tool-results-for-prompt
 */

import type {
  ContentBlock,
  ReadResultRef,
  ToolResultBlock,
} from "../model/content-block.js";
import type { ChatMessage } from "../model/message.js";
import { formatReadOutput } from "@/domain/tool/logic/format-tool-output.js";
import {
  capUtf8BytesFill,
  sliceLinesFromOffset,
  TOOL_OUTPUT_MAX_LINES,
} from "@/domain/tool/logic/tool-output-limits.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";

/** {@link ReadResultHydrateError} 的判别码。 */
export type ReadResultHydrateErrorCode =
  /** 消息含引用块但 revision 仓库未注入（装配缺口，拒绝静默降级）。 */
  | "READ_REF_REPO_MISSING"
  /** `(entryId, version)` 无 revision 行（引用悬空，保活链被破坏）。 */
  | "READ_REF_REVISION_MISSING"
  /** revision 行 status=deleted（明文不可再生）。 */
  | "READ_REF_CONTENT_DELETED"
  /** 元数据 hash 比对失败（版本错位 / 错键）。 */
  | "READ_REF_HASH_MISMATCH";

/**
 * read 引用块 hydrate 的类型化错误（fail-fast）。
 *
 * 引用块的 `content` 是占位空串：hydrate 任一环节失败时若静默放行，
 * LLM 会收到空 tool_result——这正是引用化要杜绝的「静默发错文」，
 * 所以这里统一抛本类型中断装配，由调用方暴露数据 / 装配问题。
 */
export class ReadResultHydrateError extends Error {
  readonly code: ReadResultHydrateErrorCode;

  constructor(code: ReadResultHydrateErrorCode, message: string) {
    super(message);
    this.name = "ReadResultHydrateError";
    this.code = code;
  }
}

/**
 * 单次 {@link hydrateToolResultsForPrompt} 调用的去重缓存（调用内 Map）。
 *
 * - `plainByRefKey`：键 `${entryId}:${version}:${ref.contentHash}` → 已通过
 *   元数据校验的 revision 明文；同一次装配里多个块引用同一 `(entryId, version)`
 *   时只查一次、只解一次 blob（长文件分段 read、同文件多轮 read 的重复引用是
 *   常态）。期望 hash 拼进键，篡改 ref 不会借缓存绕过校验。
 * - `wireByReplayKey`：键在上述基础上再加 `offset:limit:path` → 重放后的 wire
 *   文本；`replayReadWireText` 只依赖这四个量（ref 里的 returnedLines 等派生
 *   字段都是重放重算的），同参重复引用直接复用字符串。
 *
 * 刻意**不做跨调用持久缓存**：dangling / 已删除的 fail-fast 是保活链断裂的
 * 安全网——revision 被 GC 或 mark-deleted 后，同一内存消息下一次 hydrate 必须
 * 继续报 MISSING / DELETED。持久缓存会把已消失的 revision 明文继续发出去，
 * 把 fail-fast 悄悄盖住。缓存范围严格限定在「一次 prepare 装配内」，只省
 * 同一批消息的重复解码，不改变下一次调用的可观测行为。
 */
interface HydrateMemo {
  readonly plainByRefKey: Map<string, string>;
  readonly wireByReplayKey: Map<string, string>;
}

/**
 * 以 ref 自包含参数重放 read 截断管线并经 `formatReadOutput` 得 wire 文本。
 *
 * 与 vfs-tools read 分支逐字节同参：同样的 `split("\n")`、同样的
 * `sliceLinesFromOffset(lines, offset, limit ?? TOOL_OUTPUT_MAX_LINES)`、
 * 同样的 `capUtf8BytesFill`（50KB 预算）与同样的 nextOffset 推导——
 * 元数据 hash 校验已保证取到的明文就是 read 执行时的那一版，纯函数
 * 确定性重放即逐字节等值。
 */
function replayReadWireText(ref: ReadResultRef, plain: string): string {
  const lines = plain.split("\n");
  const { slice, nextOffset: lineNextOffset } = sliceLinesFromOffset(
    lines,
    ref.offset,
    ref.limit ?? TOOL_OUTPUT_MAX_LINES
  );
  const byteCapped = capUtf8BytesFill(slice);
  const returnedLines = byteCapped.lines.length;
  const truncated = byteCapped.truncated || lineNextOffset != null;

  let nextOffset: number | undefined;
  if (truncated) {
    if (byteCapped.truncated) {
      // 末行被截到预算点：nextOffset 跳过被截行；被截行是文件末行时
      // 跳过后无剩余内容，不给 nextOffset（与 read 分支同推论）。
      const candidate = ref.offset + returnedLines;
      if (candidate <= lines.length) {
        nextOffset = candidate;
      }
    } else {
      nextOffset = lineNextOffset;
    }
  }

  return formatReadOutput({
    path: ref.path,
    content: byteCapped.lines.join("\n"),
    offset: ref.offset,
    totalLines: lines.length,
    returnedLines,
    truncated,
    ...(byteCapped.lastLinePartial ? { lastLineTruncated: true } : {}),
    ...(nextOffset != null ? { nextOffset } : {}),
  });
}

/** 单个引用块的 hydrate：查 revision 元数据 → 校验 → 解明文 → 重放 → 填回 content。 */
async function hydrateReadResultBlock(
  block: ToolResultBlock,
  revisionRepo: VfsRevisionRepository | undefined,
  memo: HydrateMemo
): Promise<ToolResultBlock> {
  const ref = block.contentRef!;
  if (revisionRepo == null) {
    throw new ReadResultHydrateError(
      "READ_REF_REPO_MISSING",
      `read 引用块缺少 revision 仓库：${ref.path} (entryId=${ref.entryId}, version=${ref.version})——hydrate 未装配时引用块 content 为空串，静默放行会把空 tool_result 发给 LLM`
    );
  }
  // 明文缓存键含期望 hash：把它拼进键，篡改过的 ref（同 revision 但
  // contentHash 指别的 blob）不会命中缓存，校验一步都省不掉。
  const plainKey = `${ref.entryId}:${ref.version}:${ref.contentHash}`;
  let plain = memo.plainByRefKey.get(plainKey);
  if (plain == null) {
    // 元数据比对先行（不解 blob）：status / content_hash 就是明文解出的
    // 依据（见文件头「完整性校验降本」），不一致时连解码都不必做。
    const meta = await revisionRepo.findMetaByEntryAndVersion(
      ref.entryId,
      ref.version
    );
    if (meta == null) {
      throw new ReadResultHydrateError(
        "READ_REF_REVISION_MISSING",
        `read 引用悬空：${ref.path} 的 (entryId=${ref.entryId}, version=${ref.version}) 无 revision 行（ref_count 保活链被破坏或引用键被篡改）`
      );
    }
    if (meta.status === "deleted") {
      throw new ReadResultHydrateError(
        "READ_REF_CONTENT_DELETED",
        `read 引用指向已删除 revision：${ref.path} (entryId=${ref.entryId}, version=${ref.version}) status=${meta.status}，明文不可再生`
      );
    }
    if (meta.contentHash !== ref.contentHash) {
      throw new ReadResultHydrateError(
        "READ_REF_HASH_MISMATCH",
        `read 引用内容漂移：${ref.path} (entryId=${ref.entryId}, version=${ref.version}) 期望 contentHash=${ref.contentHash}，实际=${meta.contentHash}（版本错位或引用键错配：行上的 content_hash 指向了另一版明文）`
      );
    }
    const revision = await revisionRepo.findByEntryAndVersion(
      ref.entryId,
      ref.version
    );
    if (revision == null) {
      // 元数据命中后行被并发删/GC 的兜底（同 REVISION_MISSING 语义）。
      throw new ReadResultHydrateError(
        "READ_REF_REVISION_MISSING",
        `read 引用悬空：${ref.path} 的 (entryId=${ref.entryId}, version=${ref.version}) 无 revision 行（ref_count 保活链被破坏或引用键被篡改）`
      );
    }
    if (revision.content == null) {
      // port 层兜底：实现若在 active 行上给不出明文（blob 缺失），
      // 同样按「明文不可再生」fail-fast，不放空串过去。
      throw new ReadResultHydrateError(
        "READ_REF_CONTENT_DELETED",
        `read 引用指向已删除 revision：${ref.path} (entryId=${ref.entryId}, version=${ref.version}) status=${revision.status}，明文不可再生`
      );
    }
    plain = revision.content;
    memo.plainByRefKey.set(plainKey, plain);
  }
  // wire 文本是 (明文, path, offset, limit) 的确定性函数（replayReadWireText
  // 纯重放），同参重复引用直接复用，不再跑一遍切行 / 字节帽 / 格式化。
  const wireKey = `${plainKey}:${ref.offset}:${ref.limit ?? ""}:${ref.path}`;
  let wire = memo.wireByReplayKey.get(wireKey);
  if (wire == null) {
    wire = replayReadWireText(ref, plain);
    memo.wireByReplayKey.set(wireKey, wire);
  }
  // view-time：只填回内存态 content，contentRef 原样保留（块身份不变，
  // 不写回 content_json）。
  return { ...block, content: wire };
}

function messageHasReadResultRef(message: ChatMessage): boolean {
  return message.content.blocks.some(
    (b) => b.type === "tool_result" && b.contentRef != null
  );
}

/**
 * 对消息数组里的 read 引用块（tool_result + contentRef）做 view-time
 * hydrate：还原 wire 文本填回块 content（内存新对象，不变异入参、
 * 不写回 content_json）。
 *
 * 无引用块的消息原引用返回（legacy 零处理）；存在引用块但
 * `revisionRepo` 未注入（装配缺口）或校验失败时抛
 * {@link ReadResultHydrateError} fail-fast。
 */
export async function hydrateToolResultsForPrompt(
  messages: readonly ChatMessage[],
  revisionRepo?: VfsRevisionRepository
): Promise<ChatMessage[]> {
  if (!messages.some(messageHasReadResultRef)) {
    return [...messages];
  }
  const memo: HydrateMemo = {
    plainByRefKey: new Map(),
    wireByReplayKey: new Map(),
  };
  const out: ChatMessage[] = [];
  for (const message of messages) {
    if (!messageHasReadResultRef(message)) {
      out.push(message);
      continue;
    }
    const blocks: ContentBlock[] = [];
    for (const block of message.content.blocks) {
      blocks.push(
        block.type === "tool_result" && block.contentRef != null
          ? await hydrateReadResultBlock(block, revisionRepo, memo)
          : block
      );
    }
    out.push({ ...message, content: { blocks } });
  }
  return out;
}

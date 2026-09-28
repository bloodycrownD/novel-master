/**
 * read 工具结果引用块的 view-time hydrate（read-tool-result-ref Step 4）。
 *
 * 含 `contentRef` 的 tool_result 块在发送提示词前按全局键
 * `(entryId, version)` 查 revision（内部走 contentStore 解 blob 明文），
 * 先经 `hashContent` 与 `ref.contentHash` 冗余校验（不匹配 = 版本错位 /
 * 数据漂移，fail-fast 抛 {@link ReadResultHydrateError}——绝不静默把空
 * content 或错文发给 LLM），再以 ref 自包含参数重放 read 的截断管线
 * （`sliceLinesFromOffset` + `capUtf8BytesFill`，与 read 执行时逐字节
 * 同参）经 `formatReadOutput`（冻结函数，演进须版本化）还原 wire 文本，
 * 填回块 `content`——**内存态，不写回 content_json**（prepare 的
 * attach hydrate 同款纪律）。legacy 块（无 contentRef）零处理。
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
import { hashContent } from "@/domain/vfs/content-store/logic/hash-content.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";

/** {@link ReadResultHydrateError} 的判别码。 */
export type ReadResultHydrateErrorCode =
  /** 消息含引用块但 revision 仓库未注入（装配缺口，拒绝静默降级）。 */
  | "READ_REF_REPO_MISSING"
  /** `(entryId, version)` 无 revision 行（引用悬空，保活链被破坏）。 */
  | "READ_REF_REVISION_MISSING"
  /** revision 行 status=deleted（明文不可再生）。 */
  | "READ_REF_CONTENT_DELETED"
  /** hash 比对失败（版本错位 / blob 数据漂移）。 */
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
 * 以 ref 自包含参数重放 read 截断管线并经 `formatReadOutput` 得 wire 文本。
 *
 * 与 vfs-tools read 分支逐字节同参：同样的 `split("\n")`、同样的
 * `sliceLinesFromOffset(lines, offset, limit ?? TOOL_OUTPUT_MAX_LINES)`、
 * 同样的 `capUtf8BytesFill`（50KB 预算）与同样的 nextOffset 推导——
 * hash 校验已保证明文与 read 执行时一致，纯函数确定性重放即逐字节等值。
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

/** 单个引用块的 hydrate：查 revision → hash 校验 → 重放 → 填回 content。 */
async function hydrateReadResultBlock(
  block: ToolResultBlock,
  revisionRepo: VfsRevisionRepository | undefined
): Promise<ToolResultBlock> {
  const ref = block.contentRef!;
  if (revisionRepo == null) {
    throw new ReadResultHydrateError(
      "READ_REF_REPO_MISSING",
      `read 引用块缺少 revision 仓库：${ref.path} (entryId=${ref.entryId}, version=${ref.version})——hydrate 未装配时引用块 content 为空串，静默放行会把空 tool_result 发给 LLM`
    );
  }
  const revision = await revisionRepo.findByEntryAndVersion(
    ref.entryId,
    ref.version
  );
  if (revision == null) {
    throw new ReadResultHydrateError(
      "READ_REF_REVISION_MISSING",
      `read 引用悬空：${ref.path} 的 (entryId=${ref.entryId}, version=${ref.version}) 无 revision 行（ref_count 保活链被破坏或引用键被篡改）`
    );
  }
  if (revision.content == null) {
    throw new ReadResultHydrateError(
      "READ_REF_CONTENT_DELETED",
      `read 引用指向已删除 revision：${ref.path} (entryId=${ref.entryId}, version=${ref.version}) status=${revision.status}，明文不可再生`
    );
  }
  const actualHash = hashContent(revision.content);
  if (actualHash !== ref.contentHash) {
    throw new ReadResultHydrateError(
      "READ_REF_HASH_MISMATCH",
      `read 引用内容漂移：${ref.path} (entryId=${ref.entryId}, version=${ref.version}) 期望 contentHash=${ref.contentHash}，实际=${actualHash}（版本错位或 blob 数据漂移）`
    );
  }
  // view-time：只填回内存态 content，contentRef 原样保留（块身份不变，
  // 不写回 content_json）。
  return { ...block, content: replayReadWireText(ref, revision.content) };
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
          ? await hydrateReadResultBlock(block, revisionRepo)
          : block
      );
    }
    out.push({ ...message, content: { blocks } });
  }
  return out;
}

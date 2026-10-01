/**
 * `skill` read / load 的截断推导单源（skill-result-ref Part 4 ⑤）。
 *
 * WHY 独立文件：skill read 的截断管线与 vfs read **不同**（本模块走
 * `truncateLine` 逐行截到 2000 字符 + `capUtf8Bytes` 整行丢弃口径；
 * vfs read 走 `capUtf8BytesFill` 末行填满口径），wire 重放必须逐字节
 * 复刻本管线。而「执行时推导」与「hydrate 时重放」分处
 * `domain/tool/builtin` 与 `domain/chat/logic` 两个域——chat 侧不得反向
 * 依赖 builtin。故把推导抽成本模块的纯函数，两侧共用同一份（单源 = 共享
 * 函数，不是复制两份管线）。
 *
 * 纯函数性保证重放逐字节等值：输入（明文全文 + offset/limit）确定 ⇒
 * 输出（content/returnedLines/totalLines/truncated/nextOffset）确定，
 * 不读时钟、不读全局状态。hydrate 侧另有 revision 元数据 hash 比对兜底。
 *
 * @module domain/tool/logic/skill-read-truncation
 */

import {
  capUtf8Bytes,
  sliceLinesFromOffset,
  TOOL_OUTPUT_MAX_LINES,
  truncateLine,
} from "./tool-output-limits.js";

/** skill read 截断管线的全部派生量（content 已截断到预算内，可直接进 wire）。 */
export interface SkillReadTruncation {
  /** 截断后的正文（`byteCapped.lines.join("\n")`，wire 里逐行加行号）。 */
  readonly content: string;
  readonly returnedLines: number;
  readonly totalLines: number;
  readonly truncated: boolean;
  /** 仅 truncated 时可能存在（末行被整行丢弃 / 文件读完时缺省）。 */
  readonly nextOffset?: number;
}

/**
 * 以明文全文 + 分页参数重放 skill read 的截断推导。
 *
 * 与 `skill-tool` read 分支内联的推导逐行同参同序：同样的
 * `split("\n")` → `sliceLinesFromOffset(lines, offset, limit)` → 逐行
 * `truncateLine`（2000 字符）→ `capUtf8Bytes`（50KB 整行丢弃）→ 同样
 * 的 truncated / nextOffset 三分支。**改动此处必须同步改 wire 冻结函数
 * `formatReadOutput` 的版本语义**（引用块一旦落库，重放要与之逐字节一致）。
 *
 * `offset > totalLines`（越界）在内部短路：不跑截断推导，返回空正文 /
 * returnedLines=0 但**照常给出 totalLines**——调用方据此抛越界错误，文案与
 * 「推导前先判定」逐字一致（引用块不可能带越界 offset：落库前就被拒了）。
 *
 * @param plain 该 revision 的完整明文（hydrate 由 revision blob 解出）
 * @param offset 1-based 起始行号（与工具输入同参）
 * @param limit 最多返回行数（与工具输入同参）
 */
export function deriveSkillReadTruncation(
  plain: string,
  offset: number,
  limit: number = TOOL_OUTPUT_MAX_LINES
): SkillReadTruncation {
  const lines = plain.split("\n");
  const totalLines = lines.length;
  // 越界 offset（offset > totalLines）：**内部短路**，跳过切行 / truncateLine /
  // capUtf8Bytes 全套推导——这条路径的唯一出路是被调用方拒绝（skill-tool read
  // 分支据此抛 INVALID_ARGUMENT），跑完推导的结果必被丢弃，白跑一次。
  // 「越界即错」因此收进本单源函数，调用方不必再各自重复判定。
  // 返回的 totalLines 仍照常给出：报错文案要用它（与推导前判定逐字一致）。
  if (offset > totalLines) {
    return { content: "", returnedLines: 0, totalLines, truncated: false };
  }
  const { slice, nextOffset: lineNextOffset } = sliceLinesFromOffset(
    lines,
    offset,
    limit
  );
  const truncatedLines = slice.map((line) => truncateLine(line).line);
  const byteCapped = capUtf8Bytes(truncatedLines);
  const content = byteCapped.lines.join("\n");
  const returnedLines = byteCapped.lines.length;
  // 三条截断路径任一命中：字节预算（末行装不下被整行丢弃）、行数帽
  // （limit 截断且文件还有剩余行）。
  const truncated =
    byteCapped.truncated ||
    returnedLines < slice.length ||
    (lineNextOffset != null && returnedLines >= limit);
  let nextOffset: number | undefined;
  if (truncated) {
    if (byteCapped.truncated && returnedLines > 0) {
      nextOffset = offset + returnedLines;
    } else if (lineNextOffset != null) {
      nextOffset = lineNextOffset;
    }
  }
  return {
    content,
    returnedLines,
    totalLines,
    truncated,
    ...(nextOffset != null ? { nextOffset } : {}),
  };
}

/** skill load 的截断推导结果（load 无分页参数，从第 1 行起）。 */
export interface SkillLoadTruncation {
  readonly content: string;
  readonly truncated: boolean;
}

/**
 * 以明文全文重放 skill load 的截断推导。
 *
 * load 恒从第 1 行起、取 {@link TOOL_OUTPUT_MAX_LINES} 行（无 offset/limit
 * 入参），截断判定 = 字节预算命中 或 行数帽命中（`byteCapped.lines.length <
 * lines.length`）。load 输出**不带** totalLines/returnedLines（wire 侧
 * `formatSkillLoadOutput` 只吃 path/content/truncated/files），故这里也不返回。
 */
export function deriveSkillLoadTruncation(plain: string): SkillLoadTruncation {
  const lines = plain.split("\n");
  const { slice } = sliceLinesFromOffset(lines, 1, TOOL_OUTPUT_MAX_LINES);
  const truncatedLines = slice.map((line) => truncateLine(line).line);
  const byteCapped = capUtf8Bytes(truncatedLines);
  return {
    content: byteCapped.lines.join("\n"),
    truncated:
      byteCapped.truncated || byteCapped.lines.length < lines.length,
  };
}

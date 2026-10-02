/**
 * 提示词查看「轮聚合」：把 assembly 段折叠成轮（turn），供双端真实提示词面板直接消费。
 *
 * @module service/prompt/prompt-preview-turns
 */

import { isUserInputMessage } from "@/domain/chat/logic/message-content-helpers.js";
import type { AgentPromptLayout } from "@/domain/prompt/model/agent-prompt-layout.js";
import type { PromptRenderContext } from "@/domain/prompt/model/prompt-render-context.js";
import {
  buildPromptAssemblyFromLayout,
  type PromptAssemblyOptions,
  type PromptAssemblySegment,
  type PromptPreviewSegment,
} from "./render-prompt.js";

/**
 * 一轮提示词：模板段各占一轮，真用户输入开新轮，其余消息段归入当前 assistant 轮。
 *
 * - `template` 轮：system / skills 索引 / workplace 双段 / persist-* / dynamic-*，每轮一段；
 * - `user` 轮：一条真用户输入消息的全部段（至少一段，无空轮）；
 * - `assistant` 轮：紧跟其后的 assistant 文本 / thinking / tool_call / tool 段，正文在 `body` 一份字符串里。
 */
export interface PromptPreviewTurn {
  readonly id: string;
  readonly kind: "template" | "user" | "assistant";
  readonly items: PromptPreviewSegment[];
  readonly summary: string;
  readonly body: string;
}

/** 轮摘要文本位上限：首行**超** 70 字才截断（恰好 70 字原样保留）。 */
const TURN_SUMMARY_TEXT_LIMIT = 70;

function toPreviewSegment(
  segment: PromptAssemblySegment
): PromptPreviewSegment {
  return {
    id: segment.id,
    role: segment.role,
    title: segment.title,
    body: segment.body,
  };
}

/** 轮正文：各段按序拼接，段前加角色前缀行（如 `[#12 · tool_call]`）。 */
function joinTurnBody(items: readonly PromptPreviewSegment[]): string {
  return items.map((item) => `[${item.title}]\n${item.body}`).join("\n\n");
}

/** 首条 assistant 文本的首行；超上限截断为 `slice(0, 69) + "…"`。 */
function summarizeFirstLine(text: string): string {
  const firstLine = text.split("\n", 1)[0] ?? "";
  const trimmed = firstLine.trim();
  return trimmed.length > TURN_SUMMARY_TEXT_LIMIT
    ? `${trimmed.slice(0, TURN_SUMMARY_TEXT_LIMIT - 1)}…`
    : trimmed;
}

/**
 * assistant 轮摘要（core 侧钉死口径，双端不二次加工）：
 * 首条 assistant 文本首行 + 工具调用计数 + 总字符数。
 */
function buildAssistantTurnSummary(items: readonly PromptPreviewSegment[]): string {
  const firstText = items.find((item) => item.role === "assistant");
  const textPart = firstText == null ? "" : summarizeFirstLine(firstText.body);
  const toolCallCount = items.filter((item) => item.role === "tool_call").length;
  const charCount = items.reduce((sum, item) => sum + item.body.length, 0);
  const counts = `工具调用 ${toolCallCount} 次 · ${charCount} 字`;
  // 纯 thinking / 纯工具轮没有文本位，用段数占位，卡片标题不空白。
  return textPart === "" ? `${items.length} 段 · ${counts}` : `${textPart} · ${counts}`;
}

/** 分组中间形态：先按切轮规则归组，最后一步才补 summary / body。 */
interface TurnGroup {
  readonly kind: PromptPreviewTurn["kind"];
  /** 来源 ChatMessage id（user 组用于判断是否同一条消息的多段）。 */
  readonly messageId: string | undefined;
  /** 来源 ChatMessage seq：message 段入组时取首段的 seq，template 轮无此值。 */
  readonly seq?: number;
  readonly items: PromptPreviewSegment[];
}

/**
 * 按「模板段各自独立 / 真用户输入开新轮 / 其余归当前 assistant 轮」聚合提示词段。
 *
 * @remarks
 * 切轮判定回到 **ChatMessage 层**：user 且不含 tool_result 才是真用户输入
 * （`isUserInputMessage`）；含 tool_result 的 user 消息是工具结果回传，归 assistant 轮。
 * workplace / skills 合成段虽然 role 是 user，但 `source !== "message"`，天然不参与切轮。
 * hidden 消息已在 assembly 链上过滤，这里不再处理。
 */
export async function buildPromptPreviewTurnsFromLayout(
  layout: AgentPromptLayout,
  ctx: PromptRenderContext,
  options?: PromptAssemblyOptions
): Promise<PromptPreviewTurn[]> {
  const segments = await buildPromptAssemblyFromLayout(layout, ctx, options);
  const userInputMessageIds = new Set(
    ctx.messages.filter(isUserInputMessage).map((message) => message.id)
  );

  const groups: TurnGroup[] = [];
  let current: TurnGroup | null = null;

  const pushGroup = (
    kind: TurnGroup["kind"],
    messageId: string | undefined = undefined,
    seq: number | undefined = undefined
  ): TurnGroup => {
    const group: TurnGroup = { kind, messageId, seq, items: [] };
    groups.push(group);
    return group;
  };

  for (const segment of segments) {
    const item = toPreviewSegment(segment);
    if (segment.source !== "message") {
      groups.push({ kind: "template", messageId: undefined, items: [item] });
      // 模板段自成一轮，不并入前后 chat 轮：复位 current，断掉「模板段只出现在 chat 前后」的隐式假设。
      current = null;
      continue;
    }
    const isUserInput =
      segment.messageId != null && userInputMessageIds.has(segment.messageId);
    let target: TurnGroup;
    if (isUserInput) {
      // 同一条消息的多个段合成一轮；换一条真用户输入即开新轮。
      target =
        current !== null &&
        current.kind === "user" &&
        current.messageId === segment.messageId
          ? current
          : pushGroup("user", segment.messageId, segment.seq);
    } else {
      // 会话开头无 user 前缀时，assistant 段自成首个 assistant 轮。
      target =
        current !== null && current.kind === "assistant"
          ? current
          : pushGroup("assistant", undefined, segment.seq);
    }
    current = target;
    target.items.push(item);
  }

  return groups.map((group) => ({
    // message 轮用 `turn-${seq}`（跨段稳定、与段 id 解耦）；template 轮无 seq，沿用段 id。
    id: group.seq != null ? `turn-${group.seq}` : group.items[0]!.id,
    kind: group.kind,
    items: group.items,
    summary:
      group.kind === "assistant"
        ? buildAssistantTurnSummary(group.items)
        : group.items[0]!.title,
    body: joinTurnBody(group.items),
  }));
}
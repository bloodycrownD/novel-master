/**
 * 提示词查看「轮聚合」：把 assembly 段折叠成轮（turn），供双端真实提示词面板直接消费。
 *
 * @module service/prompt/prompt-preview-turns
 */

import { isUserInputMessage } from "@/domain/chat/logic/message-content-helpers.js";
import type { ChatMessage } from "@/domain/chat/model/message.js";
import type {
  ContentBlock,
  ToolResultBlock,
  ToolUseBlock,
} from "@/domain/chat/model/content-block.js";
import { messageBodyTextFromBlocks } from "@/domain/chat/content/message-body-text.js";
import { resolveToolResultOk } from "@/domain/tool/logic/build-tool-result-block.js";
import { formatToolResultContentForDisplay } from "@/domain/tool/logic/format-tool-output.js";
import type { AgentPromptLayout } from "@/domain/prompt/model/agent-prompt-layout.js";
import type { PromptRenderContext } from "@/domain/prompt/model/prompt-render-context.js";
import {
  buildPromptAssemblyFromLayout,
  type PromptAssemblyOptions,
  type PromptAssemblySegment,
  type PromptPreviewSegment,
} from "./render-prompt.js";

/** 工具组卡状态：`ok` 成功 / `error` 失败（显式 `ok:false` 或 legacy `Error:` 前缀）/ `lost` 悬挂未回结果。 */
export type PromptToolGroupStatus = "ok" | "error" | "lost";

/** 工具组卡的结果格数据；`null` 表示悬挂 use（丢失占位，槽位保留）。 */
export interface PromptToolGroupResultData {
  readonly toolUseId: string;
  /** `resolveToolResultOk` 产出（显式 `ok` 优先，legacy 回落 `Error:` 前缀）。 */
  readonly ok: boolean;
  readonly body: string;
}

/** 工具调用组卡：一次 `tool_use` 一张，跨消息按 `toolUseId` 与 `tool_result` 配对。 */
export interface PromptToolGroupCardData {
  readonly type: "toolGroup";
  readonly id: string;
  readonly toolName: string;
  /** `JSON.stringify(input, null, 2)`；`input` 为 `{}` 时退化为 `[tool_use name=… id=…]` 单行（与 CLI 形态一致）。 */
  readonly inputJson: string;
  readonly result: PromptToolGroupResultData | null;
  readonly status: PromptToolGroupStatus;
  /** 同一消息内多个 `tool_use`（并行调用徽标）。 */
  readonly parallel: boolean;
}

/** 文本 / thinking 卡：正文即「发给模型（或预览开关打开时的思考块）」的形态。 */
export interface PromptTextCardData {
  readonly type: "text" | "thinking";
  /** 独立命名空间 `card-${message.id}-${blockIndex}`（合成段轮卡用段 id）；仅要求轮内唯一。 */
  readonly id: string;
  /** 展示标签用（详情标题源）：user / assistant / 合成段名（system、skills、workplace…）。 */
  readonly role: string;
  readonly body: string;
}

/** workplace 单文件格：块内正文（行号格式原样）+ 展示档（快照条目原值）。 */
export interface PromptWorkplaceFileCardData {
  /** VFS 逻辑路径（规则快照条目原值）。 */
  readonly path: string;
  /** 块内正文（`N|行` 行号格式原样；header 档为 front-matter 行）。 */
  readonly body: string;
  /** 展示档：full（行号全文）/ filename（单行文件名）/ header（front-matter）。 */
  readonly display: "full" | "header" | "filename";
}

/**
 * workplace 组卡：常驻工作区段拆成的文件级二级卡（数据源是 ctx 的
 * `workplaceFiles`——`assembleWorkplaceDisplay` 从 session kkv 规则快照
 * 源头顺产，不从展示串反解）。
 * 组头收起（workplace · N 文件），展开后逐文件一张小卡（路径+展示档），
 * 点文件卡看该文件块内正文全屏（用户拍板的三级结构）。
 */
export interface PromptWorkplaceCardData {
  readonly type: "workplace";
  /** 段 id（`prompt-workplace`）。 */
  readonly id: string;
  readonly files: readonly PromptWorkplaceFileCardData[];
}

/** 轮内有序卡片流。 */
export type PromptTurnCardData =
  | PromptTextCardData
  | PromptToolGroupCardData
  | PromptWorkplaceCardData;

/**
 * 一轮提示词：合成段各占一轮，真用户输入开新轮，其余消息段归入当前 assistant 轮。
 *
 * - 合成段轮（system / skills 索引 / workplace 双段 / persist-* / dynamic-*）：
 *   **kind 用该段的真实消息 role**（system 段=system、skills/workplace=user、
 *   workplace·done=assistant、persist 按块自身 role）——不设 template 特殊分类
 *   （用户拍板：轮卡徽标统一 user/assistant/system 消息标记，不特殊区分
 *   workplace/persist），每轮一段；
 * - `user` 轮：一条真用户输入消息的全部段（至少一段，无空轮）；
 * - `assistant` 轮：紧跟其后的 assistant 文本 / thinking / tool_call / tool 段，正文在 `body` 一份字符串里。
 *
 * `items` / `summary` / `body` 是 CLI parity 冻结面（**段集合、段序、正文一字不动**）；
 * `cards` / `summaryText` / `metaText` 是渲染层旁路：由 `ctx.messages` 的 content blocks
 * 重建出结构化卡片流（工具调用一对一组卡），承载新 UI 的就地展开与全屏。
 */
export interface PromptPreviewTurn {
  readonly id: string;
  readonly kind: "system" | "user" | "assistant";
  readonly items: PromptPreviewSegment[];
  readonly summary: string;
  readonly body: string;
  /** 有序卡片流（就地展开与全屏的渲染源），顺序=消息块序重建的因果序，与 `items` 段序无关。 */
  readonly cards: ReadonlyArray<PromptTurnCardData>;
  /** 真摘要：单行语义（>70 字截断，三类轮统一）。 */
  readonly summaryText: string;
  /** 计数行（字数 / 工具调用次数 / 失败丢失计数 / 附件计数）。 */
  readonly metaText: string;
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
 *
 * @remarks 旧 `summary` 字段专用；新 UI 读 `summaryText` / `metaText`（见下方构建）。
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

/** 空摘要兜底文案（user 轮内层解析为空串时用）。 */
const EMPTY_SUMMARY_TEXT = "（无文本）";

/** `<user-input>` / `</user-input>` 标签（wrap 形态由 `wrapUserMessageForLlm` 产出）。 */
const USER_INPUT_OPEN = "<user-input>";
const USER_INPUT_CLOSE = "</user-input>";

/**
 * 取 `<user-input>…</user-input>` 内层原文；无该标签（未 wrap 的裸输入）时返回 null。
 *
 * @remarks wrap 形态实锤：`<attachment>…</attachment>\n<user-input>\n{plainText}\n</user-input>`，
 * 首尾各带一个换行，故调用方拿到内层后**先 trim 再取首行**。
 */
function extractUserInputInner(text: string): string | null {
  const start = text.indexOf(USER_INPUT_OPEN);
  if (start < 0) {
    return null;
  }
  const end = text.lastIndexOf(USER_INPUT_CLOSE);
  if (end < 0) {
    return null;
  }
  return text.slice(start + USER_INPUT_OPEN.length, end);
}

/** 单块的纯文本（复用 `messageBodyTextFromBlocks` 的清洗口径：剥离孤立闭合思考标签）。 */
function blockTextForCard(block: ContentBlock): string | null {
  if (block.type !== "text" && block.type !== "image") {
    return null;
  }
  const text = messageBodyTextFromBlocks([block]);
  return text === "" ? null : text;
}

/** `tool_use` 的 input 展示文本：美化 JSON；空对象退化为 CLI 同款单行头。 */
function formatToolUseInputJson(block: ToolUseBlock): string {
  const inputJson = JSON.stringify(block.input, null, 2);
  return inputJson === "{}"
    ? `[tool_use name=${block.name} id=${block.id}]`
    : inputJson;
}

/** 工具组卡的结果格 + 状态：一次判定同时产出两格，`ok` 不再判两遍。 */
function buildToolResultCell(
  block: ToolResultBlock | undefined
): {
  readonly result: PromptToolGroupResultData | null;
  readonly status: PromptToolGroupStatus;
} {
  // 无 result → 悬挂 use：`result` 留 null 占位，状态 `lost`。
  if (block === undefined) {
    return { result: null, status: "lost" };
  }
  const ok = resolveToolResultOk(block);
  return {
    result: {
      toolUseId: block.toolUseId,
      ok,
      body: formatToolResultContentForDisplay(block.content),
    },
    status: ok ? "ok" : "error",
  };
}

/**
 * `toolUseId` → `tool_result` 块：一次全量扫描。
 *
 * @remarks hidden 消息整条跳过（与段产出侧 `continue` 同一口径）：hidden 不进提示词，
 * 它的 tool_result 不该把 use 的组卡从「lost」救成「ok」，否则会出现「段里没有、卡里有」。
 */
function buildToolResultByUseId(
  messages: readonly ChatMessage[]
): Map<string, ToolResultBlock> {
  const map = new Map<string, ToolResultBlock>();
  for (const message of messages) {
    if (message.hidden) {
      continue;
    }
    for (const block of message.content.blocks) {
      if (block.type === "tool_result") {
        map.set(block.toolUseId, block);
      }
    }
  }
  return map;
}

/** 一张消息的卡片：文本缓冲卡（`\n\n` 连接）/ thinking 卡 / 工具组卡，顺序=块序（因果序）。 */
function buildMessageCards(
  message: ChatMessage,
  results: ReadonlyMap<string, ToolResultBlock>,
  includeThinking: boolean
): PromptTurnCardData[] {
  const blocks = message.content.blocks;
  const parallel = blocks.filter((block) => block.type === "tool_use").length > 1;
  const cards: PromptTurnCardData[] = [];
  let textBuffer: Array<{ index: number; text: string }> = [];

  const flushText = () => {
    if (textBuffer.length === 0) {
      return;
    }
    const first = textBuffer[0]!;
    cards.push({
      type: "text",
      id: cardId(message.id, first.index),
      role: message.role,
      body: textBuffer.map((part) => part.text).join("\n\n"),
    });
    textBuffer = [];
  };

  blocks.forEach((block, index) => {
    if (block.type === "tool_result") {
      // 结果不单独成卡：按 toolUseId 收进对应工具组卡的 result 格。
      return;
    }
    if (block.type === "tool_use") {
      flushText();
      const cell = buildToolResultCell(results.get(block.id));
      cards.push({
        type: "toolGroup",
        id: `group-${block.id}`,
        toolName: block.name,
        inputJson: formatToolUseInputJson(block),
        result: cell.result,
        status: cell.status,
        parallel,
      });
      return;
    }
    if (block.type === "thinking" || block.type === "redacted_thinking") {
      if (!includeThinking) {
        return;
      }
      flushText();
      cards.push({
        type: "thinking",
        id: cardId(message.id, index),
        role: message.role,
        body: block.type === "thinking" ? block.text : "[redacted thinking]",
      });
      return;
    }
    const text = blockTextForCard(block);
    if (text != null) {
      textBuffer.push({ index, text });
    }
  });
  flushText();

  return cards;
}

/** user 轮卡片：wrap 后的整条文本（发给模型的形态）直转一张 text 卡。 */
function buildUserTurnCards(message: ChatMessage): PromptTurnCardData[] {
  const blocks = message.content.blocks;
  const parts: Array<{ index: number; text: string }> = [];
  blocks.forEach((block, index) => {
    const text = blockTextForCard(block);
    if (text != null) {
      parts.push({ index, text });
    }
  });
  if (parts.length === 0) {
    return [];
  }
  const first = parts[0]!;
  return [
    {
      type: "text",
      id: cardId(message.id, first.index),
      role: message.role,
      body: parts.map((part) => part.text).join("\n\n"),
    },
  ];
}

/** 卡片 id 独立命名空间（与段 id `chat-<mid>-<全局K>` 无对应关系，仅要求轮内唯一）。 */
function cardId(messageId: string, blockIndex: number): string {
  return `card-${messageId}-${blockIndex}`;
}

/** 卡片计数字数：文本/thinking 取 `body`；工具组卡取 use 输入 + result 正文；workplace 取各文件块内正文之和。 */
function cardCharCount(card: PromptTurnCardData): number {
  if (card.type === "toolGroup") {
    return card.inputJson.length + (card.result?.body.length ?? 0);
  }
  if (card.type === "workplace") {
    return card.files.reduce((sum, file) => sum + file.body.length, 0);
  }
  return card.body.length;
}

/** 一轮全部卡片的字数之和（三类轮的 metaText 共用同一口径）。 */
function cardCharsOf(cards: readonly PromptTurnCardData[]): number {
  return cards.reduce((sum, card) => sum + cardCharCount(card), 0);
}

/** assistant 轮真摘要：首条 **assistant** 文本卡的首行；纯工具/纯思考轮用卡片数占位。 */
function buildAssistantSummaryText(cards: readonly PromptTurnCardData[]): string {
  const firstText = cards.find(
    (card): card is PromptTextCardData =>
      card.type === "text" && card.role === "assistant"
  );
  const textPart = firstText == null ? "" : summarizeFirstLine(firstText.body);
  return textPart === "" ? `${cards.length} 段` : textPart;
}

/** user 轮真摘要：`<user-input>` 内层首行（无标签时取正文首行）；空串兜底 `（无文本）`。 */
function buildUserSummaryText(card: PromptTextCardData): string {
  const inner = extractUserInputInner(card.body);
  const source = (inner === null ? card.body : inner).trim();
  if (source === "") {
    return EMPTY_SUMMARY_TEXT;
  }
  const firstLine = summarizeFirstLine(source);
  return firstLine === "" ? EMPTY_SUMMARY_TEXT : firstLine;
}

/** 计数行：字数 + 工具调用次数 + 失败/丢失计数（**分别计算**，不切旧 summary 拼串）。 */
function buildAssistantMetaText(
  seq: number | undefined,
  cards: readonly PromptTurnCardData[]
): string {
  const charCount = cardCharsOf(cards);
  const toolGroups = cards.filter(
    (card): card is PromptToolGroupCardData => card.type === "toolGroup"
  );
  const parts = [
    ...(seq === undefined ? [] : [`#${seq}`]),
    `工具调用 ${toolGroups.length} 次`,
    `${charCount} 字`,
  ];
  const failed = toolGroups.filter((card) => card.status === "error").length;
  const lost = toolGroups.filter((card) => card.status === "lost").length;
  if (failed > 0) {
    parts.push(`${failed} 失败`);
  }
  if (lost > 0) {
    parts.push(`${lost} 丢失`);
  }
  return parts.join(" · ");
}

/** user 轮计数行：`#N · M 字`（有附件追加 ` · 附件 K`）。 */
function buildUserMetaText(
  seq: number | undefined,
  charCount: number,
  attachmentCount: number
): string {
  const parts = [
    ...(seq === undefined ? [] : [`#${seq}`]),
    `${charCount} 字`,
  ];
  if (attachmentCount > 0) {
    parts.push(`附件 ${attachmentCount}`);
  }
  return parts.join(" · ");
}

/** 分组中间形态：先按切轮规则归组，最后一步才补 summary / body / cards / 新摘要字段。 */
interface TurnGroup {
  readonly kind: PromptPreviewTurn["kind"];
  /** 来源 ChatMessage id（user 组用于判断是否同一条消息的多段）。 */
  readonly messageId: string | undefined;
  /** 来源 ChatMessage seq：message 段入组时取首段的 seq，合成段轮无此值。 */
  readonly seq?: number;
  readonly items: PromptPreviewSegment[];
  /** 结构化卡片流（从 ctx.messages 的 blocks 重建，与 items 段序无关）。 */
  cards: PromptTurnCardData[];
  /** 已并入 cards 的消息 id：同一条消息的多个段只贡献一次卡片。 */
  readonly consumedMessageIds: Set<string>;
  /** user 轮附件计数（含 workplace 源附件）。 */
  attachmentCount: number;
}

/** 合成段的轮 kind：取段的真实消息 role，非三值（异常兜底）归 system。 */
function syntheticSegmentKind(role: string): TurnGroup["kind"] {
  return role === "user" || role === "assistant" ? role : "system";
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
  // cards 旁路的两个预扫：消息 id → 消息本体（段侧 messageId 回查），以及全量 toolUseId→result 配对表。
  const messageById = new Map<string, ChatMessage>();
  for (const message of ctx.messages) {
    messageById.set(message.id, message);
  }
  const toolResults = buildToolResultByUseId(ctx.messages);
  const includeThinking = options?.includeThinkingBlocks === true;

  const groups: TurnGroup[] = [];
  let current: TurnGroup | null = null;

  const pushGroup = (
    kind: TurnGroup["kind"],
    messageId: string | undefined = undefined,
    seq: number | undefined = undefined
  ): TurnGroup => {
    const group: TurnGroup = {
      kind,
      messageId,
      seq,
      items: [],
      cards: [],
      consumedMessageIds: new Set<string>(),
      attachmentCount: 0,
    };
    groups.push(group);
    return group;
  };

  for (const segment of segments) {
    const item = toPreviewSegment(segment);
    if (segment.source !== "message") {
      // 合成段轮：不在 ctx.messages 里，由该轮唯一段的 items 直转卡；
      // kind 取该段的真实消息 role（见接口注释——不设 template 特殊分类）。
      const group = pushGroup(syntheticSegmentKind(segment.role));
      group.items.push(item);
      // workplace 段拆文件级组卡（数据源 = ctx.workplaceFiles，kkv 规则快照
      // 源头直通）；无结构化数据（旧调用方/空快照）退普通 text 卡。
      const workplaceFiles =
        segment.id === "prompt-workplace" ? (ctx.workplaceFiles ?? []) : [];
      if (workplaceFiles.length > 0) {
        group.cards.push({
          type: "workplace",
          id: item.id,
          files: workplaceFiles,
        });
      } else {
        group.cards.push({
          type: "text",
          id: item.id,
          role: item.title,
          body: item.body,
        });
      }
      // 合成段自成一轮，不并入前后 chat 轮：复位 current，断掉「合成段只出现在 chat 前后」的隐式假设。
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
    // 卡片按消息挂载：同一条消息的多个段只贡献一次卡片流（段侧 tool_result 合并段不重复产卡）。
    const messageId = segment.messageId;
    if (messageId != null && !target.consumedMessageIds.has(messageId)) {
      target.consumedMessageIds.add(messageId);
      const message = messageById.get(messageId);
      if (message !== undefined) {
        target.cards.push(
          ...(isUserInput
            ? buildUserTurnCards(message)
            : buildMessageCards(message, toolResults, includeThinking))
        );
        if (isUserInput) {
          target.attachmentCount += message.attachments?.length ?? 0;
        }
      }
    }
  }

  return groups.map((group) => {
    // 分派键用「有无 seq」（消息轮必有 seq）而不是 kind：合成段轮的 kind
    // 已是段的真实消息 role（可能是 user/assistant），按 kind 分派会把合成轮
    // 错带进真消息轮的摘要口径。
    const summary =
      group.seq == null || group.kind !== "assistant"
        ? group.items[0]!.title
        : buildAssistantTurnSummary(group.items);
    // message 轮用 `turn-${seq}`（跨段稳定、与段 id 解耦）；合成段轮无 seq，沿用段 id。
    const id = group.seq != null ? `turn-${group.seq}` : group.items[0]!.id;
    const base = {
      id,
      kind: group.kind,
      items: group.items,
      summary,
      body: joinTurnBody(group.items),
      cards: group.cards,
    };
    if (group.seq == null) {
      // 合成段轮（原 template 分支口径逐字保留）：summaryText = 段标题、metaText = 字数。
      const charCount = cardCharsOf(group.cards);
      return {
        ...base,
        summaryText: group.items[0]!.title,
        metaText: `${charCount} 字`,
      };
    }
    if (group.kind === "assistant") {
      return {
        ...base,
        summaryText: buildAssistantSummaryText(group.cards),
        metaText: buildAssistantMetaText(group.seq, group.cards),
      };
    }
    const firstCard = group.cards[0];
    const charCount = cardCharsOf(group.cards);
    return {
      ...base,
      summaryText:
        firstCard != null && firstCard.type === "text"
          ? buildUserSummaryText(firstCard)
          : EMPTY_SUMMARY_TEXT,
      metaText: buildUserMetaText(group.seq, charCount, group.attachmentCount),
    };
  });
}

/**
 * 工具入参 JSON 的**格子预览**形态：保结构、截大值。
 *
 * 直接 `numberOfLines` 截断 pretty JSON 会把结构腰斩（第一屏只剩头一个 key），
 * 看不清调用形状。这里解析后递归收缩：超长字符串值截断、超长数组截项、
 * 超深嵌套折叠，再 `JSON.stringify(value, null, 2)` 铺开——顶层（和浅层）的
 * key 结构始终完整可读。全屏正文仍走 `inputJson` 原文（本函数只服务预览）。
 *
 * 兜底：`[tool_use name=… id=…]` 退化单行（CLI 形态，见 `inputJson` 注释）与
 * 任何 parse 失败串原样返回。
 */
const PREVIEW_STRING_LIMIT = 120;
const PREVIEW_ARRAY_LIMIT = 6;
const PREVIEW_DEPTH_LIMIT = 4;

function shrinkPreviewValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") {
    if (value.length <= PREVIEW_STRING_LIMIT) {
      return value;
    }
    const head = value.slice(0, PREVIEW_STRING_LIMIT).replace(/\s+/g, " ");
    return `${head}…（截断，全文 ${value.length} 字）`;
  }
  if (Array.isArray(value)) {
    const items = value
      .slice(0, PREVIEW_ARRAY_LIMIT)
      .map(item => shrinkPreviewValue(item, depth + 1));
    if (value.length > PREVIEW_ARRAY_LIMIT) {
      items.push(`…另有 ${value.length - PREVIEW_ARRAY_LIMIT} 项`);
    }
    return items;
  }
  if (value != null && typeof value === "object") {
    if (depth >= PREVIEW_DEPTH_LIMIT) {
      return "…";
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = shrinkPreviewValue(item, depth + 1);
    }
    return out;
  }
  return value;
}

/** tool use 格子预览：保结构截大 key（`inputJson` 退化形态原样返回）。 */
export function formatToolUsePreviewJson(inputJson: string): string {
  try {
    const parsed: unknown = JSON.parse(inputJson);
    if (parsed == null || typeof parsed !== "object") {
      return inputJson;
    }
    return JSON.stringify(shrinkPreviewValue(parsed, 0), null, 2);
  } catch {
    return inputJson;
  }
}
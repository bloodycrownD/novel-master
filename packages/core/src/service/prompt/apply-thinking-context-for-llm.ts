/**
 * View-time LLM history transform: 按全局偏好剥离历史 thinking / redacted_thinking。
 *
 * 规则（档位前置为全局门，先于开关判定）：
 * 1. `requestThinkingEnabled: false`（本次请求档位 off）时，无论开关开 / 关
 *    一律全剥（含最新轮与协议最低保留）——anthropic mapper 无条件映射 thinking 块，
 *    `body.thinking` 缺失时保留任何 thinking 块都会触发 400。
 * 2. 开关开：仅「最新一轮」（最后一条真实用户输入之后）的 assistant
 *    thinking / redacted_thinking 原样保留（含签名、不重排、不删改），更早轮次剥离。
 * 3. 开关关：全剥；仅当 `retainProtocolMinimum` 且协议为 anthropic / gemini 时，
 *    出站列表中最后一条 assistant 消息若含 tool_use 块（活跃工具循环），
 *    其全部 thinking / redacted_thinking 跳过剥离（协议最低保留，不回溯历史）。
 *
 * 边界判定不依赖 `LlmExportZones`：先排除 `id` 以 `"prompt:"` 为前缀的合成消息
 * （persist / dynamic / workplace / skills 区模板消息），再在剩余 chat 消息中取
 * 最后一条「含非 tool_result 块」的 user 消息（真实用户输入；tool_result 载体
 * 消息不算）。wire 侧（含合成消息）与预览侧（不含合成消息，排除规则为 no-op）
 * 共用本函数，保证两侧剥离集合一致。
 *
 * 不可变：无变更的消息返回原引用（同 `normalizeOrphanToolResultsForLlm` 模式），
 * 不修改入参数组与消息对象。
 *
 * @module service/prompt/apply-thinking-context-for-llm
 */

import type { ChatMessage } from "@/domain/chat/model/message.js";
import type { LlmProtocolKind } from "@/infra/llm-protocol/ports/adapter.port.js";

/** persist / dynamic / workplace / skills 区合成消息 id 前缀。 */
const SYNTHETIC_PROMPT_ID_PREFIX = "prompt:";

/** 剥离选项。 */
export interface ThinkingContextOptions {
  /** 「思考内容进入上下文」偏好开关。 */
  readonly enabled: boolean;
  /** LLM 协议种类（openai 无最低保留）。 */
  readonly protocol: LlmProtocolKind;
  /** 是否保留协议最低集合（wire 侧 true；预览侧 false——不向用户暴露）。 */
  readonly retainProtocolMinimum: boolean;
  /** 本次请求 thinking 档位是否启用（全局前置门，false 时一律全剥）。 */
  readonly requestThinkingEnabled: boolean;
}

/** 消息是否为真实用户输入：排除合成消息后，user 角色且含非 tool_result 块。 */
function isRealUserInput(message: ChatMessage): boolean {
  if (message.role !== "user") {
    return false;
  }
  if (message.id.startsWith(SYNTHETIC_PROMPT_ID_PREFIX)) {
    return false;
  }
  const blocks = message.content.blocks ?? [];
  // tool_result 载体消息（工具循环内以 user 角色落库）不算真实用户输入；
  // user_vfs_action 合成（user 角色、含 text 块）天然命中本规则、重置边界。
  return blocks.some((block) => block.type !== "tool_result");
}

/**
 * 边界下标：最后一条真实用户输入；找不到时返回 -1（整个历史视为历史轮）。
 * tool_turn_bridge 为 assistant 合成，天然不参与判定。
 */
function findRealUserBoundaryIndex(
  messages: readonly ChatMessage[],
): number {
  let boundary = -1;
  for (let i = 0; i < messages.length; i++) {
    if (isRealUserInput(messages[i]!)) {
      boundary = i;
    }
  }
  return boundary;
}

/**
 * 协议最低保留下标：出站列表中最后一条 assistant 消息且含 tool_use 块
 * （活跃工具循环，其 tool_result 作为 trailing user 消息待回传）；不回溯
 * 更早的 assistant 消息。找不到时返回 -1。
 */
function findProtocolMinimumRetainIndex(
  messages: readonly ChatMessage[],
): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role !== "assistant") {
      continue;
    }
    const hasToolUse = (message.content.blocks ?? []).some(
      (block) => block.type === "tool_use",
    );
    return hasToolUse ? i : -1;
  }
  return -1;
}

/** 消息是否含 thinking / redacted_thinking 块。 */
function hasThinkingBlocks(message: ChatMessage): boolean {
  return (message.content.blocks ?? []).some(
    (block) =>
      block.type === "thinking" || block.type === "redacted_thinking",
  );
}

/** 剥掉消息内全部 thinking / redacted_thinking 块（无变更时返回原引用）。 */
function stripThinkingBlocks(message: ChatMessage): ChatMessage {
  if (!hasThinkingBlocks(message)) {
    return message;
  }
  const blocks = (message.content.blocks ?? []).filter(
    (block) =>
      block.type !== "thinking" && block.type !== "redacted_thinking",
  );
  return { ...message, content: { blocks } };
}

/**
 * 按偏好与协议剥离历史 thinking / redacted_thinking（view-time transform，
 * 不回写数据库）。规则与顺序见模块注释。
 */
export function applyThinkingContextForLlm(
  messages: readonly ChatMessage[],
  options: ThinkingContextOptions,
): ChatMessage[] {
  const { enabled, protocol, retainProtocolMinimum, requestThinkingEnabled } =
    options;

  // 档位前置全局门：本次请求未启用 thinking 时一律全剥，
  // 最低保留分支不可达（保留集合发给未启用 thinking 的请求会触发 400）。
  if (!requestThinkingEnabled) {
    return stripAllAssistantThinking(messages);
  }

  if (enabled) {
    const boundary = findRealUserBoundaryIndex(messages);
    // 边界后（最新一轮）保留；找不到真实用户输入（-1）时整个历史视为历史轮全剥
    const keepFromIndex =
      boundary === -1 ? Number.POSITIVE_INFINITY : boundary + 1;
    return messages.map((message, index) =>
      message.role === "assistant" && index < keepFromIndex
        ? stripThinkingBlocks(message)
        : message,
    );
  }

  // 关态：全剥，仅协议最低保留（anthropic / gemini）跳过。
  const retainIndex =
    retainProtocolMinimum &&
    (protocol === "anthropic" || protocol === "gemini")
      ? findProtocolMinimumRetainIndex(messages)
      : -1;
  return messages.map((message, index) =>
    message.role === "assistant" && index !== retainIndex
      ? stripThinkingBlocks(message)
      : message,
  );
}

function stripAllAssistantThinking(
  messages: readonly ChatMessage[],
): ChatMessage[] {
  return messages.map((message) =>
    message.role === "assistant" ? stripThinkingBlocks(message) : message,
  );
}

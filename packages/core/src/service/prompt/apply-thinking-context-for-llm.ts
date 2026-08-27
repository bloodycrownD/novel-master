/**
 * View-time LLM history transform: 按全局偏好剥离历史 thinking / redacted_thinking。
 *
 * 规则（档位前置为全局门，先于开关判定）：
 * 1. `requestThinkingEnabled: false`（本次请求档位 off）时，无论开关开 / 关
 *    一律全剥（含最新一条与协议最低保留）——anthropic mapper 无条件映射 thinking 块，
 *    `body.thinking` 缺失时保留任何 thinking 块都会触发 400。
 * 2. 开关开：**容量 1**——仅保留「最后一条含 thinking / redacted_thinking 块的
 *    assistant 消息」的全部思考块（整条消息原样：含签名、不重排、不删改，
 *    thinking 与 redacted_thinking 混合时一起保留，避免单独剥 redacted 撞验签），
 *    其余 assistant 消息的思考块全部剥离。容量 1 天然覆盖跨轮：上一轮回复的
 *    思考对新一轮可见、新一轮思考生成后自动刷新；工具循环内多步也只保留
 *    最新一步（与关态协议最低保留命中的是同一条消息，自动满足协议下限）。
 * 3. 开关关：全剥；仅当 `retainProtocolMinimum` 且协议为 anthropic / gemini 时，
 *    出站列表中最后一条 assistant 消息若含 tool_use 块（活跃工具循环），
 *    其全部 thinking / redacted_thinking 跳过剥离（协议最低保留，不回溯历史）。
 *
 * 容量 1 判定只看 assistant 消息，不依赖「真实用户输入」边界：wire 侧（含
 * `"prompt:"` 前缀合成消息）与预览侧（不含合成消息）两侧剥离集合天然一致，
 * 无需额外排除规则。
 *
 * 不可变：无变更的消息返回原引用（同 `normalizeOrphanToolResultsForLlm` 模式），
 * 不修改入参数组与消息对象。
 *
 * @module service/prompt/apply-thinking-context-for-llm
 */

import type { ChatMessage } from "@/domain/chat/model/message.js";
import type { LlmProtocolKind } from "@/infra/llm-protocol/ports/adapter.port.js";

/** 剥离选项。 */
export interface ThinkingContextOptions {
  /** 「思考提示词」偏好开关。 */
  readonly enabled: boolean;
  /** LLM 协议种类（openai 无最低保留）。 */
  readonly protocol: LlmProtocolKind;
  /** 是否保留协议最低集合（wire 侧 true；预览侧 false——不向用户暴露）。 */
  readonly retainProtocolMinimum: boolean;
  /** 本次请求 thinking 档位是否启用（全局前置门，false 时一律全剥）。 */
  readonly requestThinkingEnabled: boolean;
}

/**
 * 容量 1 下标：最后一条含 thinking / redacted_thinking 块的 assistant 消息；
 * 找不到时返回 -1（整个历史无思考块，无需保留）。
 */
function findCapacityOneRetainIndex(
  messages: readonly ChatMessage[],
): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "assistant" && hasThinkingBlocks(messages[i]!)) {
      return i;
    }
  }
  return -1;
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
    // 容量 1：仅保留最后一条含思考块的 assistant（整条消息的思考块原样），
    // 其余 assistant 剥离；无任何思考块时输出与全剥一致。
    const retainIndex = findCapacityOneRetainIndex(messages);
    return messages.map((message, index) =>
      message.role === "assistant" && index !== retainIndex
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

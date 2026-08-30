/**
 * View-time LLM history transform: 按全局偏好剥离历史 thinking / redacted_thinking。
 *
 * 规则（档位前置为全局门，先于开关判定）：
 * 1. `requestThinkingEnabled: false`（本次请求档位 off）时，无论开关开 / 关
 *    一律全剥（含协议最低保留）——anthropic mapper 无条件映射 thinking 块，
 *    `body.thinking` 缺失时保留任何 thinking 块都会触发 400。
 * 2. 开关开：**全量保留**（标准方案，对齐 opencode / deepseek-harness 实践）——
 *    所有 assistant 消息的 thinking / redacted_thinking 原样回传（含签名、
 *    不重排、不删改），历史消息数组与入参一致。
 * 3. 开关关：全剥；仅当 `retainProtocolMinimum` 且协议为 anthropic / gemini 时，
 *    出站列表中最后一条 assistant 消息若含 tool_use 块（活跃工具循环），
 *    其全部 thinking / redacted_thinking 跳过剥离（协议最低保留，不回溯历史）。
 *
 * 全量保留不涉及任何边界/容量判定：wire 侧（含 `"prompt:"` 合成消息）与
 * 预览侧（不含合成消息）输出一致，无需额外排除规则。
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
 * 协议最低保留下标：出站列表中最后一条 assistant 消息且含 tool_use 块
 * （活跃工具循环，其 tool_result 作为 trailing user 消息待回传）；不回溯
 * 更早的 assistant 消息。找不到时返回 -1。
 */
function findProtocolMinimumRetainIndex(
  messages: readonly ChatMessage[]
): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role !== "assistant") {
      continue;
    }
    const hasToolUse = (message.content.blocks ?? []).some(
      (block) => block.type === "tool_use"
    );
    return hasToolUse ? i : -1;
  }
  return -1;
}

/** 消息是否含 thinking / redacted_thinking 块。 */
function hasThinkingBlocks(message: ChatMessage): boolean {
  return (message.content.blocks ?? []).some(
    (block) => block.type === "thinking" || block.type === "redacted_thinking"
  );
}

/** 剥掉消息内全部 thinking / redacted_thinking 块（无变更时返回原引用）。 */
function stripThinkingBlocks(message: ChatMessage): ChatMessage {
  if (!hasThinkingBlocks(message)) {
    return message;
  }
  const blocks = (message.content.blocks ?? []).filter(
    (block) => block.type !== "thinking" && block.type !== "redacted_thinking"
  );
  return { ...message, content: { blocks } };
}

/**
 * 按偏好与协议剥离历史 thinking / redacted_thinking（view-time transform，
 * 不回写数据库）。规则与顺序见模块注释。
 */
export function applyThinkingContextForLlm(
  messages: readonly ChatMessage[],
  options: ThinkingContextOptions
): ChatMessage[] {
  const { enabled, protocol, retainProtocolMinimum, requestThinkingEnabled } =
    options;

  // 档位前置全局门：本次请求未启用 thinking 时一律全剥，
  // 最低保留分支不可达（保留集合发给未启用 thinking 的请求会触发 400）。
  if (!requestThinkingEnabled) {
    return stripAllAssistantThinking(messages);
  }

  if (enabled) {
    // 标准方案：全量保留（含全部 thinking / redacted_thinking 与签名）。
    // 开关开的保留集合 ⊇ 协议最低保留，无需叠加判定；
    // 浅拷贝满足可变返回类型，元素保持原引用（不可变惯例）。
    return [...messages];
  }

  // 关态：全剥，仅协议最低保留（anthropic / gemini）跳过。
  const retainIndex =
    retainProtocolMinimum && (protocol === "anthropic" || protocol === "gemini")
      ? findProtocolMinimumRetainIndex(messages)
      : -1;
  return messages.map((message, index) =>
    message.role === "assistant" && index !== retainIndex
      ? stripThinkingBlocks(message)
      : message
  );
}

function stripAllAssistantThinking(
  messages: readonly ChatMessage[]
): ChatMessage[] {
  return messages.map((message) =>
    message.role === "assistant" ? stripThinkingBlocks(message) : message
  );
}

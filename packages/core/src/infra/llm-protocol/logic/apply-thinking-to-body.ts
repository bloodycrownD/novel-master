/**
 * 将 {@link ModelThinkingParams} 写入各协议 HTTP 请求 body。
 *
 * @module infra/llm-protocol/logic/apply-thinking-to-body
 */

import type { ModelThinkingParams } from "@/domain/provider/model/model-thinking-params.js";
import type { LlmProtocolKind } from "../ports/adapter.port.js";

type ThinkingOf<P extends LlmProtocolKind> = Extract<ModelThinkingParams, { protocol: P }>;

/** 各协议 thinking 的 wire 落点：父字段（可选，已存在则浅合并）+ 写入键 + 值投影。 */
type ThinkingBodyField<P extends LlmProtocolKind> = {
  readonly parent?: string;
  readonly key: string;
  readonly project: (thinking: ThinkingOf<P>) => unknown;
};

const ANTHROPIC_THINKING_FIELD: ThinkingBodyField<"anthropic"> = { key: "thinking", project: (t) => ({ type: t.anthropic.type, budget_tokens: t.anthropic.budget_tokens }) };
const OPENAI_THINKING_FIELD: ThinkingBodyField<"openai"> = { key: "reasoning_effort", project: (t) => t.openai.reasoning_effort };
const GEMINI_THINKING_FIELD: ThinkingBodyField<"gemini"> = { parent: "generationConfig", key: "thinkingConfig", project: (t) => ({ ...t.gemini.thinkingConfig }) };

export const ThinkingBody = {
  writeField<P extends LlmProtocolKind>(body: Record<string, unknown>, field: ThinkingBodyField<P>, thinking: ThinkingOf<P>): void {
    const value = field.project(thinking);
    if (field.parent == null) {
      body[field.key] = value;
      return;
    }
    // 父字段与采样参数共用（gemini 的 generationConfig）：浅合并，保留已有键。
    const existing = (body[field.parent] ?? {}) as Record<string, unknown>;
    body[field.parent] = { ...existing, [field.key]: value };
  },

  /**
   * 按 adapter 期望协议写入 thinking 字段；thinking 缺失或协议不一致时不写。
   *
   * 判别用 adapter 侧协议而非 `thinking.protocol`：两者不一致时宁可不写，
   * 也不把别的协议字段塞进当前 body。
   */
  apply(protocol: LlmProtocolKind, body: Record<string, unknown>, thinking: ModelThinkingParams | undefined): void {
    if (thinking?.protocol !== protocol) {
      return;
    }
    if (thinking.protocol === "anthropic") {
      ThinkingBody.writeField(body, ANTHROPIC_THINKING_FIELD, thinking);
    } else if (thinking.protocol === "openai") {
      ThinkingBody.writeField(body, OPENAI_THINKING_FIELD, thinking);
    } else {
      ThinkingBody.writeField(body, GEMINI_THINKING_FIELD, thinking);
    }
  },
} as const;

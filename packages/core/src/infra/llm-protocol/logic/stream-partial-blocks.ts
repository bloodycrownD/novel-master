/**
 * Abort-time partial blocks for streaming LLM adapters.
 *
 * On user cancel we keep thinking without promoting it into visible text.
 * Empty text blocks are omitted (content_json requires non-empty text strings).
 *
 * @module infra/llm-protocol/logic/stream-partial-blocks
 */

import type { ContentBlock } from "@/domain/chat/model/content-block.js";
import type { LlmStreamEvent } from "../ports/adapter.port.js";

export type StreamPartialToolUse = {
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
  /**
   * 不透明 round-trip 签名（Gemini `thought_signature` / Anthropic `signature`）。
   *
   * ⚠️ 正常收尾路径的 blocks **本来就带**这个字段；缺了它，同一份输入在「正常收尾」
   * 与「用户中断」两条路产出的块形状不同，回传时无签名的 thought/thinking 块会被 400。
   */
  readonly thinkingSignature?: string;
};

export type StreamPartialInput = {
  readonly text: string;
  readonly thinking: string;
  /**
   * thinking 文本级签名（取该流最后一个非空签名）。
   *
   * ⚠️ 该字段**仅由 gemini / anthropic 两个 partial 收尾函数**提供；openai 的调用点
   * （`openai-content-mapper.ts`）既不传 `toolUses` 也不传本字段——OpenAI 侧无签名概念。
   */
  readonly thinkingSignature?: string;
  readonly toolUses?: readonly StreamPartialToolUse[];
};

/**
 * Build NM blocks from stream accumulators when the request was aborted.
 * Returns `[]` when nothing was streamed.
 */
export function buildStreamPartialBlocks(
  input: StreamPartialInput,
  onStream?: (event: LlmStreamEvent) => void
): ContentBlock[] {
  const text = input.text;
  const thinking = input.thinking;
  const blocks: ContentBlock[] = [];
  // 守卫与正常路径对齐：上游两处建 thinking 块的判据都是「文本非空 **或** 签名非空」
  // （`anthropic-sse-parser` / `gemini-sse-parser` 的 finish 路径），
  // 而「只有签名、没有文本」正是 Claude 4+ 的常态形态——不拓宽守卫，partial 侧
  // 对这类块根本不 push，两条路就此不对称。
  if (thinking.trim() !== "" || input.thinkingSignature != null) {
    blocks.push({
      type: "thinking",
      text: thinking,
      ...(input.thinkingSignature != null
        ? { thinkingSignature: input.thinkingSignature }
        : {}),
    });
  }
  if (text.length > 0) {
    blocks.push({ type: "text", text });
  }
  for (const tu of input.toolUses ?? []) {
    blocks.push({
      type: "tool_use",
      id: tu.id,
      name: tu.name,
      input: tu.input,
      ...(tu.thinkingSignature != null
        ? { thinkingSignature: tu.thinkingSignature }
        : {}),
    });
    // 流事件侧不带签名：`LlmStreamEvent` 的 tool-use 变体没有该字段（不扩它）。
    onStream?.({
      type: "tool-use",
      id: tu.id,
      name: tu.name,
      input: tu.input,
    });
  }
  return blocks;
}

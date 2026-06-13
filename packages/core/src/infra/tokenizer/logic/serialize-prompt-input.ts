/**
 * 将完整 Prompt LLM 输入序列化为 token 计数字符串。
 *
 * @module infra/tokenizer/logic/serialize-prompt-input
 */

import type { AgentPromptLayout } from "@/domain/prompt/model/agent-prompt-layout.js";
import type { PromptRenderContext } from "@/domain/prompt/model/prompt-render-context.js";
import {
  formatPromptLlmInputForCliFromLayout,
  type PromptAssemblyOptions,
} from "@/service/prompt/render-prompt.js";

/** 与 CLI 预览相同的序列化字符串（token 计数 parity）。 */
export async function serializePromptLlmInput(
  layout: AgentPromptLayout,
  ctx: PromptRenderContext,
  options?: PromptAssemblyOptions,
): Promise<string> {
  return formatPromptLlmInputForCliFromLayout(layout, ctx, options);
}

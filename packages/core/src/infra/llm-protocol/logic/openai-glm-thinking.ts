/**
 * 智谱 GLM（OpenAI 兼容）thinking 默认行为与显式关断检测。
 *
 * @module infra/llm-protocol/logic/openai-glm-thinking
 */

/**
 * 判断厂商模型是否属于「未显式关闭则默认开启 thinking」的 GLM 系列。
 *
 * 依据 Z.AI 文档：GLM-4.7 / GLM-5 系列默认开启 thinking，须发送
 * `thinking.type = "disabled"` 才能关闭；GLM-4.6 等为混合/auto，不在此列。
 *
 * @param vendorModelId Provider 侧模型 id。
 */
export function isGlmDefaultThinkingOnModel(vendorModelId: string): boolean {
  const id = vendorModelId.toLowerCase();
  if (id.includes("glm-4.7")) {
    return true;
  }
  // glm-5、glm-5.1、glm-5.2 等
  return /glm-5(?:\.|$|-)/.test(id);
}

/**
 * 向 OpenAI 兼容 body 写入 GLM 显式关闭 thinking 的字段。
 *
 * 同时写入官方 `thinking.type` 与部分端点实际生效的 `enable_thinking`。
 */
export function applyGlmThinkingDisabledToBody(body: Record<string, unknown>): void {
  body.thinking = { type: "disabled" };
  body.enable_thinking = false;
}

/**
 * 向 OpenAI 兼容 body 写入 GLM 显式开启 thinking 的字段。
 *
 * @param reasoningEffort 产品档位映射的 reasoning_effort（GLM-5.2+ 可识别）。
 */
export function applyGlmThinkingEnabledToBody(
  body: Record<string, unknown>,
  reasoningEffort: "low" | "medium" | "high",
): void {
  body.thinking = { type: "enabled" };
  body.enable_thinking = true;
  body.reasoning_effort = reasoningEffort;
}

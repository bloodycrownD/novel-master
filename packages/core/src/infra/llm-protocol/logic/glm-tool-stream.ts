/**
 * 智谱 GLM 流式 tool_calls 型号判定。
 *
 * 流式 chat/completions 且携带 tools 时，GLM OpenAPI 要求请求体设置 `tool_stream: true`
 * 才会增量推送 tool 参数，否则整包缓冲。
 *
 * @module infra/llm-protocol/logic/glm-tool-stream
 */

/**
 * 判断 vendorModelId 是否为需启用 `tool_stream` 的 GLM 型号（4.6 / 4.7 / 5.x）。
 */
export function isGlmToolStreamModel(vendorModelId: string): boolean {
  const id = vendorModelId.toLowerCase().replace(/^models\//, "");
  if (id.includes("glm-4.6") || id.includes("glm-4.7")) {
    return true;
  }
  return /glm-5(?:\.|$|-)/.test(id);
}

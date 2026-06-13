/**
 * 智谱 Z.AI GLM 流式工具调用参数增量输出判定。
 *
 * Z.AI OpenAPI 文档要求：流式请求且携带 tools 时须设置 `tool_stream=true`，
 * 才会增量推送 `tool_calls[].function.arguments`；否则大参数整包到达前无 delta。
 *
 * @see https://open.bigmodel.cn/dev/api#glm-4-tool-stream
 */

/** 去掉可选的 `models/` 前缀并转小写，便于型号匹配。 */
function normalizeVendorModelId(vendorModelId: string): string {
  return vendorModelId.replace(/^models\//i, "").toLowerCase();
}

/**
 * 是否为须启用 `tool_stream` 的 GLM 型号（4.6 / 4.7 / 5 系列）。
 *
 * 匹配示例：`glm-4.7`、`GLM-4.7-Flash`、`models/glm-5`。
 */
export function isGlmToolStreamModel(vendorModelId: string): boolean {
  const id = normalizeVendorModelId(vendorModelId);
  return /^glm-4\.(?:6|7)(?:[-.]|$)/.test(id) || /^glm-5(?:[-.]|$)/.test(id);
}

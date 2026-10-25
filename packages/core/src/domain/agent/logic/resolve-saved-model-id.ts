/**
 * 解析对话 Agent 使用的 savedModelId（UUID 或 legacy path）。
 *
 * 优先级：agent model pin → session 覆盖。两者都空时返回 undefined，
 * 由调用方决定如何报错（不再回退 workspace 全局模型——workspace 层已移除）。
 *
 * 纯 `??`：空串不视作「无覆盖」，归一化由调用方负责。
 * Core 不读 PersistentState；宿主传入已解析字符串。
 *
 * @module domain/agent/resolve-saved-model-id
 */

/**
 * 解析 Agent 运行时的 savedModelId。
 * @returns 无可用来源时 undefined（由宿主报错）。
 */
export function resolveSavedModelId(agentModelId?: string, sessionModelId?: string): string | undefined {
  return agentModelId ?? sessionModelId;
}

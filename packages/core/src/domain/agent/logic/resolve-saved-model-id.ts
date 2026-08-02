/**
 * 纯函数：解析对话/压缩摘要 Agent 使用的 savedModelId（UUID 或 legacy path）。
 *
 * 优先级（对话）：agent model pin → session 覆盖 → workspace 当前模型。
 * 优先级（摘要）：summary agent pin → workspace 当前模型（摘要不读 session 绑定）。
 *
 * Core 不读 PersistentState；宿主传入已解析字符串。
 * CLI-only 的 `cliModelId` 入参已在 chat-session-detail-page 迭代 Phase 0 移除，
 * core 只认 project/session/workspace 三层。
 *
 * @module domain/agent/resolve-saved-model-id
 */

export interface ResolveSavedModelIdInput {
  readonly agentModelId?: string;
  /**
   * 会话级模型覆盖（`SessionAgentConfig` 的 `modelId`，仅 `bind` 模式存在）。
   * 优先级介于 agent pin 与 workspace 之间。
   */
  readonly sessionModelId?: string;
  readonly workspaceModelId?: string;
}

/**
 * 解析 Agent 运行时的 savedModelId。
 * @returns 无可用来源时 undefined（由宿主报错）。
 */
export function resolveSavedModelId(
  input: ResolveSavedModelIdInput,
): string | undefined {
  return (
    input.agentModelId ??
    input.sessionModelId ??
    input.workspaceModelId ??
    undefined
  );
}

export interface ResolveSummarySavedModelIdInput {
  readonly summaryModelId?: string;
  readonly workspaceModelId: string;
}

/** 解析压缩摘要 Agent LLM 调用的 savedModelId。 */
export function resolveSummarySavedModelId(
  input: ResolveSummarySavedModelIdInput,
): string {
  return input.summaryModelId ?? input.workspaceModelId;
}

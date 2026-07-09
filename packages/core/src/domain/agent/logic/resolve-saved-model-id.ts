/**
 * 纯函数：解析对话/压缩摘要 Agent 使用的 savedModelId（UUID 或 legacy path）。
 *
 * 优先级（对话）：CLI flag → agent model pin → workspace 当前模型。
 * 优先级（摘要）：CLI flag → summary agent pin → workspace 当前模型。
 *
 * Core 不读 PersistentState；宿主传入已解析字符串。
 *
 * @module domain/agent/resolve-saved-model-id
 */

export interface ResolveSavedModelIdInput {
  readonly cliModelId?: string;
  readonly agentModelId?: string;
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
    input.cliModelId ??
    input.agentModelId ??
    input.workspaceModelId ??
    undefined
  );
}

export interface ResolveSummarySavedModelIdInput {
  readonly cliModelId?: string;
  readonly summaryModelId?: string;
  readonly workspaceModelId: string;
}

/** 解析压缩摘要 Agent LLM 调用的 savedModelId。 */
export function resolveSummarySavedModelId(
  input: ResolveSummarySavedModelIdInput,
): string {
  return (
    input.cliModelId ??
    input.summaryModelId ??
    input.workspaceModelId
  );
}

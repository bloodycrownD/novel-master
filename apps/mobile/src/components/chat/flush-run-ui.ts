/**
 * Reload persisted messages then clear ephemeral stream overlay.
 * `onStreamReset` should flush any pending stream buffer before clearing UI state.
 */
export async function flushRunUi(
  onMessagesChanged: () => void | Promise<void>,
  onStreamReset: () => void,
): Promise<void> {
  await onMessagesChanged();
  onStreamReset();
}

/**
 * Incremental list refresh after one agent loop step is persisted.
 * Clears the stream overlay only when an assistant turn was committed (content now in DB).
 */
export async function flushAgentStepUi(
  phase: 'assistant' | 'tool_results',
  onMessagesChanged: () => void | Promise<void>,
  onStreamReset: () => void,
): Promise<void> {
  if (phase === 'assistant') {
    onStreamReset();
  }
  await onMessagesChanged();
}

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
 * Reload first, then drop the stream overlay when assistant text is in DB (avoids double bubbles).
 */
export async function flushAgentStepUi(
  phase: 'assistant' | 'tool_results',
  onMessagesChanged: () => void | Promise<void>,
  onStreamReset: () => void,
): Promise<void> {
  await onMessagesChanged();
  if (phase === 'assistant') {
    onStreamReset();
  }
}

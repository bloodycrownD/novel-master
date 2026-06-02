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

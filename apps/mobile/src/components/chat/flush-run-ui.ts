import type { ChatMessage } from '@novel-master/core/chat';

/** 流式收尾 reload；`immediate` 绕过 run 内 200ms 合并并 await DB 拉取。 */
export type FlushMessagesChanged = (
  options?: { immediate?: boolean },
) => void | Promise<readonly ChatMessage[] | void>;

export type FlushStreamEndContext = {
  readonly messages: readonly ChatMessage[];
  readonly prevCount: number;
};

/**
 * Reload persisted messages then clear ephemeral stream overlay.
 * `onStreamEnd` should flush any pending stream buffer before clearing UI state.
 */
export async function flushRunUi(
  onMessagesChanged: FlushMessagesChanged,
  onStreamEnd: (ctx: FlushStreamEndContext) => void,
  prevCount: number,
): Promise<void> {
  const messages = (await onMessagesChanged({ immediate: true })) ?? [];
  onStreamEnd({ messages, prevCount });
}

/**
 * Incremental list refresh after one agent loop step is persisted.
 * Reload first, then drop the stream overlay when assistant text is in DB (avoids double bubbles).
 */
export async function flushAgentStepUi(
  phase: 'assistant' | 'tool_results',
  onMessagesChanged: FlushMessagesChanged,
  onAssistantStreamEnd: (ctx: FlushStreamEndContext) => void,
  prevCount: number,
): Promise<void> {
  const messages = (await onMessagesChanged({ immediate: true })) ?? [];
  if (phase === 'assistant') {
    onAssistantStreamEnd({ messages, prevCount });
  }
}
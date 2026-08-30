/**
 * Paired hide/delete for assistant tool_use turns and their tool_results user message.
 */
import {type ChatMessage} from '@novel-master/core/chat';
import type {MobileNovelMasterRuntime} from '@/runtime/types';
import {messageHasToolUse, resolveToolResultsMessageId} from './message-blocks';

export type MessageRuntime = Pick<MobileNovelMasterRuntime, 'messages'>;

export async function hideToolTurn(
  runtime: MessageRuntime,
  messages: readonly ChatMessage[],
  assistantMessageId: string,
  hidden: boolean,
): Promise<void> {
  // hide / show 镜像分支收敛单路径（comp-chat/C-9）：同一操作闭包，
  // tool_use 轮次的成对 tool_result 一并同步。
  const setVisibility = hidden
    ? async (id: string) => runtime.messages.hide(id)
    : async (id: string) => runtime.messages.show(id);

  const assistant = messages.find(m => m.id === assistantMessageId);
  const resultsId =
    assistant != null && messageHasToolUse(assistant)
      ? resolveToolResultsMessageId(messages, assistant)
      : null;

  await setVisibility(assistantMessageId);
  if (resultsId != null) {
    await setVisibility(resultsId);
  }
}

export async function deleteToolTurn(
  runtime: MessageRuntime,
  messages: readonly ChatMessage[],
  assistantMessageId: string,
): Promise<void> {
  const assistant = messages.find(m => m.id === assistantMessageId);
  if (assistant != null && messageHasToolUse(assistant)) {
    const resultsId = resolveToolResultsMessageId(messages, assistant);
    if (resultsId != null) {
      await runtime.messages.delete(resultsId);
    }
  }
  await runtime.messages.delete(assistantMessageId);
}

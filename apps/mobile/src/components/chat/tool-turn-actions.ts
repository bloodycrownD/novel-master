/**
 * Paired hide/delete for assistant tool_use turns and their tool_results user message.
 */
import { type ChatMessage } from "@novel-master/core/chat";
import type {MobileNovelMasterRuntime} from '../../runtime/types';
import {messageHasToolUse, resolveToolResultsMessageId} from './message-blocks';

export type MessageRuntime = Pick<MobileNovelMasterRuntime, 'messages'>;

export async function hideToolTurn(
  runtime: MessageRuntime,
  messages: readonly ChatMessage[],
  assistantMessageId: string,
  hidden: boolean,
): Promise<void> {
  const assistant = messages.find(m => m.id === assistantMessageId);
  if (assistant == null || !messageHasToolUse(assistant)) {
    if (hidden) {
      await runtime.messages.hide(assistantMessageId);
    } else {
      await runtime.messages.show(assistantMessageId);
    }
    return;
  }

  if (hidden) {
    await runtime.messages.hide(assistantMessageId);
    const resultsId = resolveToolResultsMessageId(messages, assistant);
    if (resultsId != null) {
      await runtime.messages.hide(resultsId);
    }
  } else {
    await runtime.messages.show(assistantMessageId);
    const resultsId = resolveToolResultsMessageId(messages, assistant);
    if (resultsId != null) {
      await runtime.messages.show(resultsId);
    }
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

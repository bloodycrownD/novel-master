/**
 * Paired hide/delete for assistant tool_use turns and their tool_results user message.
 */
import type { ChatMessageDto } from "../../../shared/ipc-types";
import {
  ipcMessagesDelete,
  ipcMessagesHide,
  ipcMessagesShow,
} from "../../ipc/client";
import { messageHasToolUse, resolveToolResultsMessageId } from "./message-blocks";

export async function hideToolTurn(
  messages: readonly ChatMessageDto[],
  assistantMessageId: string,
  hidden: boolean,
): Promise<void> {
  const assistant = messages.find((m) => m.id === assistantMessageId);
  if (assistant == null || !messageHasToolUse(assistant)) {
    if (hidden) {
      await ipcMessagesHide({ messageId: assistantMessageId });
    } else {
      await ipcMessagesShow({ messageId: assistantMessageId });
    }
    return;
  }

  if (hidden) {
    await ipcMessagesHide({ messageId: assistantMessageId });
    const resultsId = resolveToolResultsMessageId(messages, assistant);
    if (resultsId != null) {
      await ipcMessagesHide({ messageId: resultsId });
    }
  } else {
    await ipcMessagesShow({ messageId: assistantMessageId });
    const resultsId = resolveToolResultsMessageId(messages, assistant);
    if (resultsId != null) {
      await ipcMessagesShow({ messageId: resultsId });
    }
  }
}

export async function deleteToolTurn(
  messages: readonly ChatMessageDto[],
  assistantMessageId: string,
): Promise<void> {
  const assistant = messages.find((m) => m.id === assistantMessageId);
  if (assistant != null && messageHasToolUse(assistant)) {
    const resultsId = resolveToolResultsMessageId(messages, assistant);
    if (resultsId != null) {
      await ipcMessagesDelete({ messageId: resultsId });
    }
  }
  await ipcMessagesDelete({ messageId: assistantMessageId });
}

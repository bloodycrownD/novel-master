/**
 * Composer 三分支发送状态（基于 core message-content-helpers）。
 */
import { hasToolResult, isPlainUserText, type ChatMessage } from "@novel-master/core/chat";

export type ComposerSendState = {
  /** 末条为 user 时可空发续跑。 */
  readonly canResumeWithoutInput: boolean;
  /** 末条 user 含 tool_result（maxSteps 截断场景）。 */
  readonly lastMessageHasToolResult: boolean;
  /** 末条为 plain user 文本（禁止带文字发送）。 */
  readonly lastMessageIsPlainUserText: boolean;
};

/** 取会话列表中末条未隐藏消息（对应 spec `lastVisible`）。 */
export function findLastVisibleMessage(
  messages: readonly ChatMessage[],
): ChatMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg != null && !msg.hidden) {
      return msg;
    }
  }
  return undefined;
}

/** 由末条可见消息推导 Composer 发送规则。 */
export function deriveComposerSendState(
  lastMessage: ChatMessage | undefined,
): ComposerSendState {
  if (lastMessage == null) {
    return {
      canResumeWithoutInput: false,
      lastMessageHasToolResult: false,
      lastMessageIsPlainUserText: false,
    };
  }
  return {
    canResumeWithoutInput: lastMessage.role === 'user',
    lastMessageHasToolResult: hasToolResult(lastMessage),
    lastMessageIsPlainUserText: isPlainUserText(lastMessage),
  };
}

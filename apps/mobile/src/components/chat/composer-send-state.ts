/**
 * Composer 三分支发送状态（基于 core ChatMessage）。
 */
import {ChatMessage, type ChatMessageData} from '@novel-master/core/chat';

export type ComposerSendState = {
  /** 末条为 user 时可空发续跑。 */
  readonly canResumeWithoutInput: boolean;
  /** 末条为 plain user 文本（禁止带文字发送）。 */
  readonly lastMessageIsPlainUserText: boolean;
};

/** 取会话列表中末条未隐藏消息（对应 spec `lastVisible`）。 */
export function findLastVisibleMessage(
  messages: readonly ChatMessageData[],
): ChatMessageData | undefined {
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
  lastMessage: ChatMessageData | undefined,
): ComposerSendState {
  if (lastMessage == null) {
    return {
      canResumeWithoutInput: false,
      lastMessageIsPlainUserText: false,
    };
  }
  return {
    canResumeWithoutInput: lastMessage.role === 'user',
    lastMessageIsPlainUserText: ChatMessage.from(lastMessage).isPlainUserText(),
  };
}

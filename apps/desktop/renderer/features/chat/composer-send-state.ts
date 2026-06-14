/**
 * Composer 三分支发送状态（基于 core message-content-helpers）。
 */
import {
  hasToolResult,
  isPlainUserText,
  type ChatMessage,
  type ContentBlock,
} from "@novel-master/core";
import type { ChatMessageDto, ContentBlockDto } from "../../../shared/ipc-types";

function blockFromDto(dto: ContentBlockDto): ContentBlock | null {
  switch (dto.type) {
    case "text":
      return { type: "text", text: dto.text };
    case "thinking":
      return { type: "thinking", text: dto.text };
    case "tool_use":
      return {
        type: "tool_use",
        id: dto.id,
        name: dto.name,
        input: dto.input,
      };
    case "tool_result":
      return {
        type: "tool_result",
        toolUseId: dto.toolUseId,
        content: dto.content,
        ...(dto.ok !== undefined ? { ok: dto.ok } : {}),
        ...(dto.summary !== undefined ? { summary: dto.summary } : {}),
      };
    default:
      return null;
  }
}

/** 将 IPC DTO 转为 {@link ChatMessage} 供 helpers 使用。 */
export function chatMessageFromDto(dto: ChatMessageDto): ChatMessage {
  return {
    id: dto.id,
    sessionId: dto.sessionId,
    role: dto.role,
    seq: dto.seq,
    hidden: dto.hidden,
    createdAtMs: dto.createdAtMs,
    provider: null,
    raw: null,
    content: {
      blocks: dto.contentBlocks
        .map(blockFromDto)
        .filter((b): b is ContentBlock => b != null),
    },
  };
}

export type ComposerSendState = {
  /** 末条为 user 时可空发续跑。 */
  readonly canResumeWithoutInput: boolean;
  /** 末条 user 含 tool_result（maxSteps 截断场景）。 */
  readonly lastMessageHasToolResult: boolean;
  /** 末条为 plain user 文本（禁止带文字发送）。 */
  readonly lastMessageIsPlainUserText: boolean;
};

/** 取会话列表中末条未隐藏消息（对应 spec `lastVisible`）。 */
export function findLastVisibleMessageDto(
  messages: readonly ChatMessageDto[],
): ChatMessageDto | undefined {
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
  lastMessage: ChatMessageDto | undefined,
): ComposerSendState {
  if (lastMessage == null) {
    return {
      canResumeWithoutInput: false,
      lastMessageHasToolResult: false,
      lastMessageIsPlainUserText: false,
    };
  }
  const msg = chatMessageFromDto(lastMessage);
  return {
    canResumeWithoutInput: lastMessage.role === "user",
    lastMessageHasToolResult: hasToolResult(msg),
    lastMessageIsPlainUserText: isPlainUserText(msg),
  };
}

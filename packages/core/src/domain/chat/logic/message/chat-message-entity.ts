/**
 * ChatMessage 领域对象实验：把单条消息的自有行为收回实体。
 *
 * `ChatMessage` 仍是持久化/IPC 的纯数据结构；本类只做领域行为包装，
 * 不参与序列化。需要跨进程时仍用 DTO，由边界 mapper 构造本对象。
 *
 * @module domain/chat/logic/message/chat-message-entity
 */

import type { ChatMessage } from "../../model/message.js";
import { readMessageMetadata } from "../../model/message-metadata.js";

/** 单条消息的行为视图（组合而非继承，避免污染 wire DTO）。 */
export class ChatMessageEntity {
  private constructor(private readonly message: ChatMessage) {}

  static from(message: ChatMessage): ChatMessageEntity {
    return new ChatMessageEntity(message);
  }

  /** 消息是否含 `tool_result` 块。 */
  hasToolResult(): boolean {
    return (this.message.content.blocks ?? []).some((block) => block.type === "tool_result");
  }

  /** 是否为用户在输入框里输入的消息（排除工具结果回传）。 */
  isUserInput(): boolean {
    return this.message.role === "user" && !this.hasToolResult();
  }

  /** 是否携带批注附件。 */
  hasAnnotateAttachment(): boolean {
    return (this.message.attachments ?? []).some((attachment) => attachment.action === "annotate");
  }

  /** 是否为 plain user 文本（含「只有批注、无正文」）。 */
  isPlainUserText(): boolean {
    if (this.message.role !== "user" || this.hasToolResult()) {
      return false;
    }
    const hasText = (this.message.content.blocks ?? []).some((block) => block.type === "text" && block.text.trim().length > 0);
    return hasText || this.hasAnnotateAttachment();
  }

  /** 提取可编辑正文（仅 text 块；多段以双换行拼接）。 */
  editableText(): string | null {
    const parts: string[] = [];
    for (const block of this.message.content.blocks ?? []) {
      if (block.type !== "text") {
        continue;
      }
      const text = block.text.trim();
      if (text !== "") {
        parts.push(text);
      }
    }
    return parts.length > 0 ? parts.join("\n\n") : null;
  }

  /** 是否为 plain text user Undo Send 锚点。 */
  isUndoSendEligible(): boolean {
    if (this.message.role !== "user" || this.hasToolResult()) {
      return false;
    }
    if (readMessageMetadata(this.message.raw)?.kind === "user_vfs_action") {
      return false;
    }
    return this.editableText() != null || this.hasAnnotateAttachment();
  }
}

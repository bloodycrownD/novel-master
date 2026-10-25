/**
 * ChatMessage 领域类。
 *
 * `ChatMessageData` 是 DB / IPC 的纯数据形状；本类在进程内提供单条消息的
 * 派生行为，不参与序列化。跨进程仍走 `ChatMessageDto`，边界用 {@link ChatMessage.from}
 * 重新构造。
 *
 * @module domain/chat/logic/message/chat-message
 */

import type {ChatMessageData} from "../../model/message.js";
import type {MessageAttachment} from "../../model/message-attachment.schema.js";
import type {MessageContent} from "../../model/content-block.js";
import type {MessageUsage} from "../../model/message-usage.js";
import {readMessageMetadata} from "../../model/message-metadata.js";

/** 单条消息的领域对象。 */
export class ChatMessage {
    readonly id: string;
    readonly sessionId: string;
    readonly seq: number;
    readonly role: string;
    readonly content: MessageContent;
    readonly provider: string | null;
    declare readonly providerId?: string | null;
    declare readonly modelName?: string | null;
    readonly raw: Record<string, unknown> | null;
    readonly createdAtMs: number;
    readonly hidden: boolean;
    declare readonly attachments?: readonly MessageAttachment[];
    declare readonly usage?: MessageUsage;

    private constructor(data: ChatMessageData) {
        this.id = data.id;
        this.sessionId = data.sessionId;
        this.seq = data.seq;
        this.role = data.role;
        this.content = data.content;
        this.provider = data.provider;
        if (data.providerId !== undefined) this.providerId = data.providerId;
        if (data.modelName !== undefined) this.modelName = data.modelName;
        this.raw = data.raw;
        this.createdAtMs = data.createdAtMs;
        this.hidden = data.hidden;
        if (data.attachments !== undefined) this.attachments = data.attachments;
        if (data.usage !== undefined) this.usage = data.usage;
    }

    static from(data: ChatMessageData | ChatMessage): ChatMessage {
        return data instanceof ChatMessage ? data : new ChatMessage(data);
    }

    /** 消息是否含 `tool_result` 块。 */
    hasToolResult(): boolean {
        return (this.content.blocks ?? []).some((block) => block.type === "tool_result");
    }

    /** 是否为用户在输入框里输入的消息（排除工具结果回传）。 */
    isUserInput(): boolean {
        return this.role === "user" && !this.hasToolResult();
    }

    /** 是否携带批注附件。 */
    hasAnnotateAttachment(): boolean {
        return (this.attachments ?? []).some((attachment) => attachment.action === "annotate");
    }

    /** 是否为 plain user 文本（含「只有批注、无正文」）。 */
    isPlainUserText(): boolean {
        if (this.role !== "user" || this.hasToolResult()) return false;
        const hasText = (this.content.blocks ?? []).some((block) => block.type === "text" && block.text.trim().length > 0);
        return hasText || this.hasAnnotateAttachment();
    }

    /** 提取可编辑正文（仅 text 块；多段以双换行拼接）。 */
    editableText(): string | null {
        const parts: string[] = [];
        for (const block of this.content.blocks ?? []) {
            if (block.type !== "text") continue;
            const text = block.text.trim();
            if (text !== "") parts.push(text);
        }
        return parts.length > 0 ? parts.join("\n\n") : null;
    }

    /** 是否为 plain text user Undo Send 锚点。 */
    isUndoSendEligible(): boolean {
        if (this.role !== "user" || this.hasToolResult()) return false;
        if (readMessageMetadata(this.raw)?.kind === "user_vfs_action") return false;
        return this.editableText() != null || this.hasAnnotateAttachment();
    }

    /** 数 content blocks 里的 tool_use 块数。 */
    toolUseCount(): number {
        let count = 0;
        for (const block of this.content.blocks) {
            if (block.type === "tool_use") count += 1;
        }
        return count;
    }
}

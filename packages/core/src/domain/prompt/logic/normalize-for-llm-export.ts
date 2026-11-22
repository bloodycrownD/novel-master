/**
 * LLM export 区内 merge：persist / chat / dynamic 各区内合并连续纯文本，跨区永不 merge。
 *
 * @module domain/prompt/logic/normalize-for-llm-export
 */

import { MessageBodyText } from "../../chat/content/message-body-text.js";
import { TextBlocks } from "../../chat/content/text-blocks.js";
import type { ChatMessageData } from "../../chat/model/message.js";
import { MessageMetadata, VFS_SEMANTIC_KINDS } from "../../chat/model/message-metadata.js";
import type { LlmProtocolKind } from "../../../infra/llm-protocol/ports/adapter.port.js";

/** 组装三区边界（相对 `buildPromptLlmInputFromLayout` 的 messages 数组）。 */
export interface LlmExportZones {
    /** persist 区消息数（数组前缀）。 */
    readonly persistCount: number;
    /** dynamic 区消息数（数组后缀）。 */
    readonly dynamicCount: number;
}

type LlmExportZone = "persist" | "chat" | "dynamic";

export const LlmExport = {
    resolveZone(index: number, total: number, zones: LlmExportZones | undefined): LlmExportZone {
        if (zones == null) {
            return "chat";
        }
        if (index < zones.persistCount) {
            return "persist";
        }
        if (index >= total - zones.dynamicCount) {
            return "dynamic";
        }
        return "chat";
    },

    /** 消息是否仅含 text 块（无 tool / thinking）。 */
    isPlainTextOnly(message: ChatMessageData): boolean {
        const blocks = message.content.blocks ?? [];
        return blocks.every((b) => b.type === "text");
    },

    /** VFS 语义段：不得与 plain chat 文本 merge。 */
    isVfsSemanticSegment(message: ChatMessageData): boolean {
        const kind = MessageMetadata.read(message.raw)?.kind;
        return kind != null && VFS_SEMANTIC_KINDS.has(kind);
    },

    /** 带非空 attachments 的 user：禁与相邻 plain chat merge（同 VFS semantic）。 */
    hasNonEmptyAttachments(message: ChatMessageData): boolean {
        return (message.attachments?.length ?? 0) > 0;
    },

    /**
   * 在 zone 内 merge 连续同 role 纯文本；跨区、VFS 段、带 attachments、含 tool 块均不 merge。
   * **保持 sync**：不在此做 async hydrate（须由上游 `prepareUserMessagesForPrompt` 先 wrap）。
   * 不拆分 VFS 语义段（各条不满足 merge 条件时原样保留）。
   *
   * @param messages 通常为已 wrap 的内存 messages（`prepareUserMessagesForPrompt` 输出）
   * @param provider LLM 协议种类（per-provider 后处理）
   * @param zones 三区边界；缺省时整段视为 chat 区
   */
    normalize(messages: readonly ChatMessageData[], provider: LlmProtocolKind, zones?: LlmExportZones): ChatMessageData[] {
        const merged: ChatMessageData[] = [];
        if (messages.length > 0) {
            let buffer = messages[0]!;
            let bufferZone = LlmExport.resolveZone(0, messages.length, zones);
            for (let i = 1; i < messages.length; i++) {
                const current = messages[i]!;
                const currentZone = LlmExport.resolveZone(i, messages.length, zones);
                const canMerge = bufferZone === currentZone && buffer.role === current.role && LlmExport.isPlainTextOnly(buffer) && LlmExport.isPlainTextOnly(current) && !LlmExport.isVfsSemanticSegment(buffer) && !LlmExport.isVfsSemanticSegment(current) && !LlmExport.hasNonEmptyAttachments(buffer) && !LlmExport.hasNonEmptyAttachments(current);
                if (canMerge) {
                    const leftText = MessageBodyText.fromBlocks(buffer.content.blocks);
                    const rightText = MessageBodyText.fromBlocks(current.content.blocks);
                    let combined = leftText;
                    if (rightText !== "") {
                        combined = combined === "" ? rightText : `${combined}\n\n${rightText}`;
                    }
                    buffer = { ...buffer, content: TextBlocks.of(combined) };
                    continue;
                }
                merged.push(buffer);
                buffer = current;
                bufferZone = currentZone;
            }
            merged.push(buffer);
        }
        // OpenAI：可剔除空内容的 tool_turn_bridge synthetic。
        if (provider !== "openai") {
            return [...merged];
        }
        return merged.filter((message) => {
            const kind = MessageMetadata.read(message.raw)?.kind;
            if (kind !== "tool_turn_bridge") {
                return true;
            }
            return !(LlmExport.isPlainTextOnly(message) && MessageBodyText.fromBlocks(message.content.blocks).trim() === "");
        });
    },
} as const;

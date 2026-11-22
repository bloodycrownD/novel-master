/**
 * Plain-text extraction from content blocks for prompts and provider fallbacks.
 *
 * @module domain/chat/content/message-body-text
 */

import { ToolOutput } from "@/domain/tool/logic/format-tool-output.js";
import type { ContentBlock } from "../model/content-block.js";
import type { ChatMessageData } from "../model/message.js";

/**
 * 文本缓冲刷成一张卡（本文件 CLI 预览与 service/prompt 卡片投影的 flushText 同构收敛）：
 * 空缓冲返回 null（无卡可建）；非空把全部 `text` 按 `\n\n` 连接交给 build，
 * `first` 是缓冲首元素（render-prompt 的卡 id 挂首段 index 用）。
 */
export const flushTextCard = <E extends { readonly text: string }, T>(buffer: ReadonlyArray<E>, build: (joined: string, first: E) => T): T | null => {
    if (buffer.length === 0) {
        return null;
    }
    return build(buffer.map((entry) => entry.text).join("\n\n"), buffer[0]!);
};

export const MessageBodyText = {
    blockBodyText(block: ContentBlock): string | null {
        switch (block.type) {
            case "text": {
                // 剥离模型泄漏的孤立闭合思考标签（GLM / 代理网关常见）。
                const text = block.text.replace(/<\/(?:thought|thinking|think|redacted_thinking)\b[^>]*>/gi, "").trim();
                return text === "" ? null : text;
            }
            case "image":
                return "[image]";
            case "tool_use": {
                const head = `[tool_use name=${block.name} id=${block.id}]`;
                const inputJson = JSON.stringify(block.input, null, 2);
                return inputJson === "{}" ? head : `${head}\n${inputJson}`;
            }
            case "tool_result": {
                const head = `[tool_result id=${block.toolUseId}]`;
                const body = ToolOutput.formatContentForDisplay(block.content);
                return body === "" ? head : `${head}\n\n${body}`;
            }
            case "thinking":
            case "redacted_thinking":
                // Omitted from LLM prompt body by design.
                return null;
        }
    },

    /** Extract readable plain text from content blocks (skips thinking blocks). */
    fromBlocks(blocks: readonly ContentBlock[]): string {
        const parts: string[] = [];
        for (const block of blocks) {
            const text = MessageBodyText.blockBodyText(block);
            if (text != null) {
                parts.push(text);
            }
        }
        return parts.join("\n\n");
    },

    /** Role-prefixed segments for CLI / real-prompt preview (tool_result → `tool`; tool_use → `tool_call`). */
    formatForCliPreview(message: ChatMessageData, options?: { readonly includeThinking?: boolean }): ReadonlyArray<{ readonly role: string; readonly body: string }> {
        const segments: Array<{ role: string; body: string }> = [];
        const toolResultBodies: string[] = [];
        let textBuffer: Array<{ text: string }> = [];

        for (const block of message.content.blocks) {
            if (block.type === "tool_result") {
                const body = ToolOutput.formatContentForDisplay(block.content);
                if (body !== "") {
                    toolResultBodies.push(body);
                }
                continue;
            }
            if (block.type === "thinking" || block.type === "redacted_thinking") {
                // opt-in：仅预览（includeThinking）时产出 thinking 段，块序保持在消息内位置；
                // 默认 false 保持 CLI 文本与 token 计数 parity 现状。
                if (options?.includeThinking !== true) {
                    continue;
                }
                const flushed = flushTextCard(textBuffer, (joined) => ({ role: message.role, body: joined }));
                if (flushed != null) segments.push(flushed);
                textBuffer = [];
                segments.push({
                    role: "thinking",
                    body: block.type === "thinking" ? block.text : "[redacted thinking]",
                });
                continue;
            }
            if (block.type === "tool_use") {
                const flushed = flushTextCard(textBuffer, (joined) => ({ role: message.role, body: joined }));
                if (flushed != null) segments.push(flushed);
                textBuffer = [];
                const body = MessageBodyText.blockBodyText(block);
                if (body != null) {
                    segments.push({ role: "tool_call", body });
                }
                continue;
            }
            const text = MessageBodyText.blockBodyText(block);
            if (text != null) {
                textBuffer.push({ text });
            }
        }
        const flushed = flushTextCard(textBuffer, (joined) => ({ role: message.role, body: joined }));
        if (flushed != null) segments.push(flushed);
        textBuffer = [];

        if (toolResultBodies.length > 0) {
            segments.unshift({ role: "tool", body: toolResultBodies.join("\n\n") });
        }
        return segments;
    },
} as const;

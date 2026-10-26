/**
 * LLM export 区内 merge：persist / chat / dynamic 各区内合并连续纯文本，跨区永不 merge。
 *
 * @module domain/prompt/logic/normalize-for-llm-export
 */

import { messageBodyTextFromBlocks } from "../../chat/content/message-body-text.js";
import { textBlocks } from "../../chat/content/text-blocks.js";
import type { ChatMessageData } from "../../chat/model/message.js";
import { readMessageMetadata } from "../../chat/model/message-metadata.js";
import type { LlmProtocolKind } from "../../../infra/llm-protocol/ports/adapter.port.js";

/** 组装三区边界（相对 `buildPromptLlmInputFromLayout` 的 messages 数组）。 */
export interface LlmExportZones {
  /** persist 区消息数（数组前缀）。 */
  readonly persistCount: number;
  /** dynamic 区消息数（数组后缀）。 */
  readonly dynamicCount: number;
}

export type LlmExportZone = "persist" | "chat" | "dynamic";

const VFS_SEMANTIC_KINDS = new Set(["user_vfs_action", "user_vfs_ack", "tool_turn_bridge"]);

function resolveZone(index: number, total: number, zones: LlmExportZones | undefined): LlmExportZone {
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
}

/** 消息是否仅含 text 块（无 tool / thinking）。 */
function isPlainTextOnly(message: ChatMessageData): boolean {
  const blocks = message.content.blocks ?? [];
  return blocks.every((b) => b.type === "text");
}

/** VFS 语义段：不得与 plain chat 文本 merge。 */
function isVfsSemanticSegment(message: ChatMessageData): boolean {
  const kind = readMessageMetadata(message.raw)?.kind;
  return kind != null && VFS_SEMANTIC_KINDS.has(kind);
}

/** 带非空 attachments 的 user：禁与相邻 plain chat merge（同 VFS semantic）。 */
function hasNonEmptyAttachments(message: ChatMessageData): boolean {
  return (message.attachments?.length ?? 0) > 0;
}

/**
 * 在 zone 内 merge 连续同 role 纯文本；跨区、VFS 段、带 attachments、含 tool 块均不 merge。
 * **保持 sync**：不在此做 async hydrate（须由上游 `prepareUserMessagesForPrompt` 先 wrap）。
 * 不拆分 VFS 语义段（各条不满足 merge 条件时原样保留）。
 *
 * @param messages 通常为已 wrap 的内存 messages（`prepareUserMessagesForPrompt` 输出）
 * @param provider LLM 协议种类（per-provider 后处理）
 * @param zones 三区边界；缺省时整段视为 chat 区
 */
export function normalizeForLlmExport(messages: readonly ChatMessageData[], provider: LlmProtocolKind, zones?: LlmExportZones): ChatMessageData[] {
  const merged: ChatMessageData[] = [];
  if (messages.length > 0) {
    let buffer = messages[0]!;
    let bufferZone = resolveZone(0, messages.length, zones);
    for (let i = 1; i < messages.length; i++) {
      const current = messages[i]!;
      const currentZone = resolveZone(i, messages.length, zones);
      const canMerge = bufferZone === currentZone && buffer.role === current.role && isPlainTextOnly(buffer) && isPlainTextOnly(current) && !isVfsSemanticSegment(buffer) && !isVfsSemanticSegment(current) && !hasNonEmptyAttachments(buffer) && !hasNonEmptyAttachments(current);
      if (canMerge) {
        const leftText = messageBodyTextFromBlocks(buffer.content.blocks);
        const rightText = messageBodyTextFromBlocks(current.content.blocks);
        let combined = leftText;
        if (rightText !== "") {
          combined = combined === "" ? rightText : `${combined}\n\n${rightText}`;
        }
        buffer = { ...buffer, content: textBlocks(combined) };
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
    const kind = readMessageMetadata(message.raw)?.kind;
    if (kind !== "tool_turn_bridge") {
      return true;
    }
    return !(isPlainTextOnly(message) && messageBodyTextFromBlocks(message.content.blocks).trim() === "");
  });
}

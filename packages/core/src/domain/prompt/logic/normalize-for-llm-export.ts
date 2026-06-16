/**
 * LLM export 区内 merge：persist / chat / dynamic 各区内合并连续纯文本，跨区永不 merge。
 *
 * @module domain/prompt/logic/normalize-for-llm-export
 */

import { messageBodyTextFromBlocks } from "../../chat/content/message-body-text.js";
import { textBlocks } from "../../chat/content/text-blocks.js";
import type { ChatMessage } from "../../chat/model/message.js";
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

const VFS_SEMANTIC_KINDS = new Set(["user_vfs_action", "tool_turn_bridge"]);

function resolveZone(
  index: number,
  total: number,
  zones: LlmExportZones | undefined,
): LlmExportZone {
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
function isPlainTextOnly(message: ChatMessage): boolean {
  const blocks = message.content.blocks ?? [];
  return blocks.every((b) => b.type === "text");
}

/** VFS 语义段：不得与 plain chat 文本 merge。 */
function isVfsSemanticSegment(message: ChatMessage): boolean {
  const kind = readMessageMetadata(message.raw)?.kind;
  return kind != null && VFS_SEMANTIC_KINDS.has(kind);
}

function canMergeAdjacent(
  left: ChatMessage,
  right: ChatMessage,
  leftZone: LlmExportZone,
  rightZone: LlmExportZone,
): boolean {
  if (leftZone !== rightZone) {
    return false;
  }
  if (left.role !== right.role) {
    return false;
  }
  if (!isPlainTextOnly(left) || !isPlainTextOnly(right)) {
    return false;
  }
  if (isVfsSemanticSegment(left) || isVfsSemanticSegment(right)) {
    return false;
  }
  return true;
}

function mergePlainTextMessages(
  left: ChatMessage,
  right: ChatMessage,
): ChatMessage {
  const leftText = messageBodyTextFromBlocks(left.content.blocks);
  const rightText = messageBodyTextFromBlocks(right.content.blocks);
  let combined = leftText;
  if (rightText !== "") {
    combined = combined === "" ? rightText : `${combined}\n\n${rightText}`;
  }
  return {
    ...left,
    content: textBlocks(combined),
  };
}

function mergeWithinZones(
  messages: readonly ChatMessage[],
  zones: LlmExportZones | undefined,
): ChatMessage[] {
  if (messages.length === 0) {
    return [];
  }

  const result: ChatMessage[] = [];
  let buffer = messages[0]!;
  let bufferZone = resolveZone(0, messages.length, zones);

  for (let i = 1; i < messages.length; i++) {
    const current = messages[i]!;
    const currentZone = resolveZone(i, messages.length, zones);
    if (canMergeAdjacent(buffer, current, bufferZone, currentZone)) {
      buffer = mergePlainTextMessages(buffer, current);
      continue;
    }
    result.push(buffer);
    buffer = current;
    bufferZone = currentZone;
  }
  result.push(buffer);
  return result;
}

function isEmptyTextMessage(message: ChatMessage): boolean {
  if (!isPlainTextOnly(message)) {
    return false;
  }
  return messageBodyTextFromBlocks(message.content.blocks).trim() === "";
}

/** OpenAI：可剔除空内容的 tool_turn_bridge synthetic。 */
function applyProviderPostProcess(
  messages: readonly ChatMessage[],
  provider: LlmProtocolKind,
): ChatMessage[] {
  if (provider !== "openai") {
    return [...messages];
  }
  return messages.filter((message) => {
    const kind = readMessageMetadata(message.raw)?.kind;
    if (kind !== "tool_turn_bridge") {
      return true;
    }
    return !isEmptyTextMessage(message);
  });
}

/**
 * 在 zone 内 merge 连续同 role 纯文本；跨区、VFS 段、含 tool 块均不 merge。
 * 不拆分 U-A-U-A 四条（各条不满足 merge 条件时原样保留）。
 *
 * @param messages `buildPromptLlmInputFromLayout` 输出（未 merge）
 * @param provider LLM 协议种类（per-provider 后处理）
 * @param zones 三区边界；缺省时整段视为 chat 区
 */
export function normalizeForLlmExport(
  messages: readonly ChatMessage[],
  provider: LlmProtocolKind,
  zones?: LlmExportZones,
): ChatMessage[] {
  const merged = mergeWithinZones(messages, zones);
  return applyProviderPostProcess(merged, provider);
}

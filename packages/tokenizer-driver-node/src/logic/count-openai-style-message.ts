/**
 * OpenAI-style single-message token count (ST `/openai/count` path).
 *
 * @module logic/count-openai-style-message
 */

import { countTokens } from "@novel-master/core/provider";
import type { Tiktoken } from "tiktoken";

export interface OpenAiStyleMessage {
  readonly role: string;
  readonly content: string;
  readonly name?: string;
}

export interface CountOpenAiStyleMessageOptions {
  /** Claude web path uses full prompt conversion without `-2` name adjustment. */
  readonly full?: boolean;
}

/**
 * Counts tokens for chat-style messages using OpenAI billing overhead.
 *
 * 骨架走 core 公共纯函数 {@link countTokens}（`precise` 档），
 * 这里只负责把 tiktoken encoding 适配成 `ChatTokenEncoder`。
 * 与 SillyTavern `/api/tokenizers/openai/count` 行为一致。
 */
export function countOpenAiStyleMessages(
  encoding: Tiktoken,
  messages: readonly OpenAiStyleMessage[],
  tiktokenModel: string,
): number {
  return countTokens(
    (text) => encoding.encode(text).length,
    messages,
    "precise",
    { tiktokenModel },
  );
}

/**
 * Wraps serialized prompt as a single system message for ST-aligned counting.
 */
export function wrapSerializedPromptAsSystemMessage(
  serialized: string,
): OpenAiStyleMessage {
  return { role: "system", content: serialized };
}

/** Converts messages to a Claude-style prompt string for web tokenizers. */
export function convertMessagesForWebTokenizer(
  messages: readonly OpenAiStyleMessage[],
): string {
  const parts: string[] = [];
  for (const msg of messages) {
    const role = msg.role.toLowerCase();
    const content = msg.content ?? "";
    if (role === "system") {
      parts.push(content);
    } else if (role === "user" || role === "human") {
      parts.push(`\n\nHuman: ${content}`);
    } else if (role === "assistant") {
      parts.push(`\n\nAssistant: ${content}`);
    } else {
      parts.push(`\n\n${msg.role}: ${content}`);
    }
  }
  if (!parts.some((p) => p.includes("Assistant:"))) {
    parts.push("\n\nAssistant:");
  }
  return parts.join("").trimStart();
}

/**
 * Web tokenizer count aligned with ST `countWebTokenizerTokens`.
 */
export function countWebTokenizerMessages(
  encode: (text: string) => { length: number },
  messages: readonly OpenAiStyleMessage[],
): number {
  const converted = convertMessagesForWebTokenizer(messages);
  return encode(converted).length;
}

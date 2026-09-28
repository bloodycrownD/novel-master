/**
 * OpenAI-style single-message token count (ST `/openai/count` path).
 *
 * 自 node 驱动 `tokenizer-driver-node/src/logic/` 下沉（fallback-caliber-align
 * D 线）：逻辑逐字节保持原样，node 驱动原路径改为本模块的 re-export，RN 侧
 * 复用同一份实现。注意 encode 的分块包装**不在本模块**——由 message-token-cache
 * feature 在此基础上统一认领，当前保持整串 encode 原样。
 *
 * @module infra/tokenizer/logic/count-openai-style-message
 */

import { countTokens } from "./count-tokens.js";

/**
 * tiktoken 系编码表的最小结构契约（下沉时的类型修正，P1-2）：core 运行时
 * dependencies 无 tiktoken 包，原 `import type { Tiktoken } from "tiktoken"`
 * 在 core 解析不了。这里只依赖「能把文本 encode 成带长度的序列」这一结构——
 * WASM tiktoken 与 js-tiktoken 的 `Tiktoken` 都满足。
 */
export interface TokenEncoder {
  encode(text: string): { readonly length: number };
}

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
  encoding: TokenEncoder,
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

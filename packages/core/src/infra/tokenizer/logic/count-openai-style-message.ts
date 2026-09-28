/**
 * OpenAI-style single-message token count (ST `/openai/count` path).
 *
 * 自 node 驱动 `tokenizer-driver-node/src/logic/` 下沉（fallback-caliber-align
 * D 线）：node 驱动原路径改为本模块的 re-export，RN 侧复用同一份实现。
 *
 * encode 的分块包装**唯一落点在本模块**（message-token-cache Step 3 认领，
 * spec「分块接入」定稿：fa 下沉时保持原样，本步统一包上——rn 调用侧不另包，
 * 避免双重包装）。只包「文本 encode」这一层，per-message overhead 公式不动。
 *
 * @module infra/tokenizer/logic/count-openai-style-message
 */

import { countTextWithIncrementalTokenizer } from "./count-text-with-tokenizer.js";
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
  // message-token-cache 分块接入（唯一落点）：传入 countTokens 的 encode 函数
  // 包上 {@link countTextWithIncrementalTokenizer}——单次 encode 被内部切成
  // ≤64 字符的自然边界段逐段求和，「无空白长中文串」的 O(len²) 病态由这里
  // 兜住（实测 12K 字符 88s → 亚秒级）。per-message overhead 公式不动：
  // role / content / name 每段**文本**各自走包装，+3/+9/0301 调整保持原样。
  // 数值口径因此从「整串 encode」变为「边界段加和」——正常文本误差
  // -0.02%~+0.35%（spec 实测），T-FA2 的逐字节基准已按 spec 时序迁移至
  // T-TC5 的 ≤1% 容差口径。
  const baseEncode = (text: string): number => encoding.encode(text).length;
  return countTokens(
    (text) => countTextWithIncrementalTokenizer(baseEncode, text),
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

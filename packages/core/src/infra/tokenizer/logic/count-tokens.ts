/**
 * OpenAI chat 风格 token 计数纯函数（三端共用）。
 *
 * 把「每条消息 +perMessage、按字段 encode、name 调整、尾部 +3/+9」这套
 * 与 SillyTavern `/api/tokenizers/openai/count` 对齐的包装算法抽到 core，
 * 让 Node（tiktoken）/ RN（js-tiktoken）/ 测试各自注入 encode 实现，
 * 计数骨架不再各写一份、也不再各自硬编码 +3+3。
 *
 * @module infra/tokenizer/logic/count-tokens
 */

import { isGpt0301TiktokenModel } from "./resolve-tokenizer-family.js";

/**
 * 注入的编码器：把文本变成 token 数。
 * Node 传 tiktoken 的 `encoding.encode(text).length`，
 * RN 传 js-tiktoken 的 `enc.encode(text).length`，
 * 测试可传 mock。签名统一，三端互换。
 */
export type ChatTokenEncoder = (text: string) => number;

/** OpenAI chat 风格消息（role / content 必填，name 可选）。 */
export interface ChatTokenMessage {
  readonly role: string;
  readonly content: string;
  readonly name?: string;
}

/**
 * 计数算法档位，决定包装开销的精细程度。
 *
 * - `precise`：完整 ST 对齐——encode role+content+name，区分 0301 的 +4/-1/+9。
 *   Node tiktoken 路径用这档，counterKind 上报真实 family（如 `tiktoken`）。
 * - `heuristic`：简化 +3+3——只 encode content，固定按非 0301 处理。
 *   RN js-tiktoken 路径用这档；因为包装粗糙、又不区分模型，
 *   counterKind 应诚实标 `heuristic`，不能冒充精确。
 */
export type ChatTokenCountKind = "precise" | "heuristic";

export interface CountTokensOptions {
  /**
   * tiktoken 模型名，仅在 `kind === "precise"` 时用于判断 0301 额外开销。
   * `kind === "heuristic"` 时忽略，恒按非 0301 处理。
   */
  readonly tiktokenModel?: string;
}

/**
 * 按消息列表统计 token，套 OpenAI chat 包装。
 *
 * 三端共用入口：调用方注入 {@link ChatTokenEncoder} 与 {@link ChatTokenCountKind}，
 * 函数本身是纯函数、无副作用、不持有 encoding 资源。
 */
export function countTokens(
  encode: ChatTokenEncoder,
  messages: readonly ChatTokenMessage[],
  kind: ChatTokenCountKind,
  options?: CountTokensOptions
): number {
  if (kind === "heuristic") {
    return countHeuristic(encode, messages);
  }
  return countPrecise(encode, messages, options?.tiktokenModel);
}

/**
 * 简化 +3+3：每条消息 +3、只 encode content、尾部 +3。
 * 不区分 0301，因为 heuristic 本就是粗估，区分模型开销没意义。
 */
function countHeuristic(
  encode: ChatTokenEncoder,
  messages: readonly ChatTokenMessage[]
): number {
  let numTokens = 0;
  for (const msg of messages) {
    numTokens += 3;
    numTokens += encode(msg.content);
  }
  numTokens += 3;
  return numTokens;
}

/**
 * 完整 ST 对齐：每条消息 +perMessage（0301: 4 / 否则 3），
 * encode role+content+name，name 额外 +tokensPerName（0301: -1 / 否则 1），
 * 尾部 +3（0301 再 +9）。
 */
function countPrecise(
  encode: ChatTokenEncoder,
  messages: readonly ChatTokenMessage[],
  tiktokenModel?: string
): number {
  const is0301 =
    tiktokenModel != null ? isGpt0301TiktokenModel(tiktokenModel) : false;
  const tokensPerMessage = is0301 ? 4 : 3;
  const tokensPerName = is0301 ? -1 : 1;

  let numTokens = 0;
  for (const msg of messages) {
    numTokens += tokensPerMessage;
    numTokens += encode(msg.role);
    numTokens += encode(msg.content);
    if (msg.name != null) {
      numTokens += encode(msg.name);
      numTokens += tokensPerName;
    }
  }
  numTokens += 3;
  if (is0301) {
    numTokens += 9;
  }
  return numTokens;
}

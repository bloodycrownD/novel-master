/**
 * string | CoreMessageDescriptor 的统一解包（spec §3.2）。
 *
 * 错误类的构造参数放宽为二者联合后，`Error.message` 的取值口径在这里单点：
 * 字符串原样透传；descriptor 用 key 原文（稳定、可 grep，绝不是
 * `[object Object]`——AppError 例外，用英文 desc，由 G1.1 落位）。
 *
 * @module i18n/localized-message
 */

import type { MessageLike, MessageParams } from "@/common/i18n.js";
import { CORE_MESSAGE_KEYS, type CoreMessageDescriptor, type CoreMessageKey } from "./keys.js";

/** 解包结果：`text` 给日志，`messageKey/messageParams` 给 translator。 */
interface LocalizedMessage {
  readonly text: string;
  readonly messageKey?: CoreMessageKey;
  readonly messageParams?: MessageParams;
}

export function resolveLocalizedMessage(input: string | CoreMessageDescriptor): LocalizedMessage {
  if (typeof input === "string") {
    return {text: input};
  }
  return {text: input.key, messageKey: input.key, ...(input.params == null ? {} : {messageParams: input.params})};
}

const KNOWN_KEYS: ReadonlySet<string> = new Set<string>(CORE_MESSAGE_KEYS);

/**
 * 字符串 → 可翻译参数值：文本恰为已知 key（如 zod message 填 key 的通道）时包
 * 成 descriptor 供 translator 递归渲染，否则原样透传（诊断串不吞）。
 */
export function messageParamOf(text: string): MessageLike {
  return KNOWN_KEYS.has(text) ? {key: text as CoreMessageKey} : text;
}

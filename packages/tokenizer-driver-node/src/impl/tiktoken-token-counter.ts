/**
 * Tiktoken-based token counter for OpenAI-protocol models.
 *
 * @module impl/tiktoken-token-counter
 */

import { type ChatMessage } from "@novel-master/core/chat";

import { type TokenCounter } from "@novel-master/core/provider";
import { mapVendorModelIdToTiktokenModel } from "@novel-master/core/provider";
import { countOpenAiMessages } from "../logic/openai-message-token-count.js";
import { getNodeEncodingForModel } from "./encoding-cache.js";

/**
 * 取模型对应的编码表（进程级单例，见 `encoding-cache`）。
 *
 * 编码表建不起来时抛错而不是静默返回 0：本计数器的契约是「同步 port 拿真读数」，
 * 拿不到表时抛给调用方，由驱动层决定降级口径（那里会退回默认 cl100k 近似）。
 */
function getEncoding(tiktokenModel: string) {
  const enc = getNodeEncodingForModel(tiktokenModel);
  if (enc == null) {
    throw new Error(`tiktoken encoding unavailable: ${tiktokenModel}`);
  }
  return enc;
}

/** OpenAI chat token counter using tiktoken encodings. */
export class TiktokenTokenCounter implements TokenCounter {
  readonly kind = "tiktoken" as const;

  constructor(vendorModelId: string, private readonly tiktokenModel: string = mapVendorModelIdToTiktokenModel(vendorModelId)) {}

  countText(text: string): number {
    return getEncoding(this.tiktokenModel).encode(text).length;
  }

  /** nm-style: keep-public — TokenCounter 端口实现（经接口分发调用，检查器按方法名计数漏计）。 */
  countMessages(messages: readonly ChatMessage[]): number {
    return countOpenAiMessages(getEncoding(this.tiktokenModel), messages, this.tiktokenModel);
  }
}

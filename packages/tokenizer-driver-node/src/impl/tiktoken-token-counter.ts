/**
 * Tiktoken-based token counter for OpenAI-protocol models.
 *
 * @module impl/tiktoken-token-counter
 */

import { type ChatMessage } from "@novel-master/core/chat";
import { MessageBodyText } from "@novel-master/core/prompt";

import { type TokenCounter } from "@novel-master/core/tokenizer";
import { TokenizerFamilyResolver } from "@novel-master/core/tokenizer";
import { EncodingCache } from "./encoding-cache.js";

/**
 * 取模型对应的编码表（进程级单例，见 `encoding-cache`）。
 *
 * 编码表建不起来时抛错而不是静默返回 0：本计数器的契约是「同步 port 拿真读数」，
 * 拿不到表时抛给调用方，由驱动层决定降级口径（那里会退回默认 cl100k 近似）。
 */
function getEncoding(tiktokenModel: string) {
  const enc = EncodingCache.forModel(tiktokenModel);
  if (enc == null) {
    // nm-throw: keep — 跨包协议：TokenCounter port 同步契约（countText(): number）无 Result 通道（接口在 core/infra/tokenizer），编码表缺失按设计抛给驱动层降级。
    throw new Error(`tiktoken encoding unavailable: ${tiktokenModel}`);
  }
  return enc;
}

/** OpenAI chat token counter using tiktoken encodings. */
export class TiktokenTokenCounter implements TokenCounter {
  readonly kind = "tiktoken" as const;

  constructor(vendorModelId: string, private readonly tiktokenModel: string = TokenizerFamilyResolver.mapVendorModelIdToTiktokenModel(vendorModelId)) {}

  countText(text: string): number {
    return getEncoding(this.tiktokenModel).encode(text).length;
  }

  /** nm-style: keep-public — TokenCounter 端口实现（经接口分发调用，检查器按方法名计数漏计）。 */
  countMessages(messages: readonly ChatMessage[]): number {
    // OpenAI chat 计费口径（SillyTavern 对齐）：每条消息 +3（0301 模型 +4），
    // 正文逐条 encode，结尾 +3（0301 再 +9）。原 logic/openai-message-token-count 单点内联至此。
    const encoding = getEncoding(this.tiktokenModel);
    const is0301 = TokenizerFamilyResolver.isGpt0301TiktokenModel(this.tiktokenModel);
    const perMessageOverhead = is0301 ? 4 : 3;
    let tokens = 0;
    for (const m of messages) {
      tokens += perMessageOverhead;
      tokens += encoding.encode(MessageBodyText.fromBlocks(m.content.blocks)).length;
    }
    tokens += 3;
    if (is0301) {
      tokens += 9;
    }
    return tokens;
  }
}

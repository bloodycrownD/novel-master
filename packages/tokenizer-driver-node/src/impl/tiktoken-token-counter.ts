/**
 * Tiktoken-based token counter for OpenAI-protocol models.
 *
 * @module impl/tiktoken-token-counter
 */

import { type ChatMessage } from "@novel-master/core/chat";


import { type TokenCounter } from "@novel-master/core/provider";
import { mapVendorModelIdToTiktokenModel } from "@novel-master/core/provider";
import { countOpenAiMessages } from "../logic/openai-message-token-count.js";
import {
  clearNodeEncodingCacheForTests,
  getNodeEncodingForModel,
} from "./encoding-cache.js";

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

  constructor(
    vendorModelId: string,
    private readonly tiktokenModel: string = mapVendorModelIdToTiktokenModel(vendorModelId),
  ) {}

  countText(text: string): number {
    return getEncoding(this.tiktokenModel).encode(text).length;
  }

  countMessages(messages: readonly ChatMessage[]): number {
    return countOpenAiMessages(
      getEncoding(this.tiktokenModel),
      messages,
      this.tiktokenModel,
    );
  }
}

/**
 * 清空进程级编码表缓存（测试用）。
 *
 * 与旧实现的差别：**不再 `free()`**。缓存表现在由 `encoding-cache` 统一持有、可能
 * 被精确档与兜底档同时引用，提前 `free()` 会让其它持有者拿到已释放的 WASM 句柄。
 * 编码表数量以「模型名 + 编码名」为界（有上界的小集合），WASM 内存随进程退出回收。
 */
export function clearTiktokenEncodingCache(): void {
  clearNodeEncodingCacheForTests();
}

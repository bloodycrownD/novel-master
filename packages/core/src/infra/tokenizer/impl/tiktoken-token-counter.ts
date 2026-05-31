/**
 * Tiktoken-based token counter for OpenAI-protocol models.
 *
 * @module infra/tokenizer/impl/tiktoken-token-counter
 */

import type { ChatMessage } from "@/domain/chat/model/message.js";
import { encoding_for_model, type Tiktoken } from "tiktoken";
import type { TokenCounter } from "../ports/token-counter.port.js";
import { countOpenAiMessages } from "../logic/openai-message-token-count.js";
import { mapVendorModelIdToTiktokenModel } from "../logic/tiktoken-model-map.js";

const encodingCache = new Map<string, Tiktoken>();

function getEncoding(tiktokenModel: string): Tiktoken {
  let enc = encodingCache.get(tiktokenModel);
  if (enc == null) {
    enc = encoding_for_model(tiktokenModel as Parameters<typeof encoding_for_model>[0]);
    encodingCache.set(tiktokenModel, enc);
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

/** Clears module-level encoding cache (tests). */
export function clearTiktokenEncodingCache(): void {
  for (const enc of encodingCache.values()) {
    enc.free();
  }
  encodingCache.clear();
}

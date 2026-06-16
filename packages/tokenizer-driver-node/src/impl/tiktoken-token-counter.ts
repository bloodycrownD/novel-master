/**
 * Tiktoken-based token counter for OpenAI-protocol models.
 *
 * @module impl/tiktoken-token-counter
 */

import { type ChatMessage } from "@novel-master/core/chat";


import { type TokenCounter } from "@novel-master/core/provider";
import { mapVendorModelIdToTiktokenModel } from "@novel-master/core/provider";
import { encoding_for_model, type Tiktoken } from "tiktoken";
import { countOpenAiMessages } from "../logic/openai-message-token-count.js";

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

/**
 * SentencePiece tokenizer counter (@agnai/sentencepiece-js) for Llama / Gemma / Mistral families.
 *
 * @module impl/sentencepiece-token-counter
 */

import { SentencePieceProcessor } from "@agnai/sentencepiece-js";
import { type ChatMessage } from "@novel-master/core/chat";

import { type TokenCounter, type TokenizerFamily } from "@novel-master/core/provider";
import { messageBodyText } from "@novel-master/core/prompt";

import { CHARACTERS_PER_TOKEN_RATIO, HeuristicTokenCounter, tokenizerAssetPaths } from "@novel-master/core/provider";
import { getNodeTokenizerLoader } from "../node-tokenizer-loader.js";

const heuristic = new HeuristicTokenCounter();

/** SentencePiece `.model` counter — encodes plain serialized prompt text (ST body path). */
export class SentencePieceTokenCounter implements TokenCounter {
  readonly kind: TokenizerFamily;
  private processor: SentencePieceProcessor | null = null;
  private loadError = false;

  constructor(
    private readonly family: Extract<
      TokenizerFamily,
      "llama" | "mistral" | "yi" | "gemma" | "jamba"
    >,
  ) {
    this.kind = family;
  }

  private async getProcessor(): Promise<SentencePieceProcessor | null> {
    if (this.processor != null) {
      return this.processor;
    }
    if (this.loadError) {
      return null;
    }
    const paths = tokenizerAssetPaths(this.family);
    if (paths == null || paths.kind !== "model") {
      this.loadError = true;
      return null;
    }
    try {
      const loader = getNodeTokenizerLoader();
      const proc = new SentencePieceProcessor();
      await proc.load(loader.readModel(paths.primary));
      this.processor = proc;
      return proc;
    } catch {
      this.loadError = true;
      return null;
    }
  }

  countText(text: string): number {
    return Math.ceil(text.length / CHARACTERS_PER_TOKEN_RATIO);
  }

  countMessages(messages: readonly ChatMessage[]): number {
    let chars = 0;
    for (const m of messages) {
      chars += messageBodyText(m).length;
    }
    return Math.ceil(chars / CHARACTERS_PER_TOKEN_RATIO);
  }

  /** Encodes serialized prompt body (ST `countSentencepieceArrayTokens` on plain text). */
  async countSerializedPrompt(serialized: string): Promise<number> {
    const proc = await this.getProcessor();
    if (proc == null) {
      return heuristic.countText(serialized);
    }
    return proc.encodeIds(serialized).length;
  }

  get failedLoad(): boolean {
    return this.loadError;
  }
}

export async function countSentencePieceFamilyPrompt(
  family: TokenizerFamily,
  serialized: string,
): Promise<{ readonly count: number; readonly estimated: boolean }> {
  const counter = new SentencePieceTokenCounter(
    family as Extract<TokenizerFamily, "llama" | "mistral" | "yi" | "gemma" | "jamba">,
  );
  const count = await counter.countSerializedPrompt(serialized);
  return { count, estimated: counter.failedLoad };
}

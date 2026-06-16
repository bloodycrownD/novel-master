/**
 * Web tokenizer counter (@agnai/web-tokenizers) for Claude / Llama3 / Command / Qwen families.
 *
 * @module impl/web-tokenizer-counter
 */

import { Tokenizer } from "@agnai/web-tokenizers";
import { type ChatMessage } from "@novel-master/core/chat";

import { type TokenCounter, type TokenizerFamily } from "@novel-master/core/provider";
import { messageBodyText } from "@novel-master/core/prompt";

import { CHARACTERS_PER_TOKEN_RATIO, HeuristicTokenCounter, tokenizerAssetPaths } from "@novel-master/core/provider";
import {
  countWebTokenizerMessages,
  wrapSerializedPromptAsSystemMessage,
  type OpenAiStyleMessage,
} from "../logic/count-openai-style-message.js";
import { getNodeTokenizerLoader } from "../node-tokenizer-loader.js";

const heuristic = new HeuristicTokenCounter();

/** Loads JSON assets and counts via ST web-tokenizer message conversion. */
export class WebTokenizerCounter implements TokenCounter {
  readonly kind: TokenizerFamily;
  private instance: Tokenizer | null = null;
  private loadError = false;

  constructor(private readonly family: Exclude<TokenizerFamily, "heuristic" | "tiktoken">) {
    this.kind = family;
  }

  private async getInstance(): Promise<Tokenizer | null> {
    if (this.instance != null) {
      return this.instance;
    }
    if (this.loadError) {
      return null;
    }
    const paths = tokenizerAssetPaths(this.family);
    if (paths == null || paths.kind !== "json") {
      this.loadError = true;
      return null;
    }
    const loader = getNodeTokenizerLoader();
    try {
      const primary = loader.readJson(paths.primary);
      this.instance = await Tokenizer.fromJSON(primary);
      return this.instance;
    } catch {
      if (paths.fallback != null) {
        try {
          const fallback = loader.readJson(paths.fallback);
          this.instance = await Tokenizer.fromJSON(fallback);
          return this.instance;
        } catch {
          this.loadError = true;
          return null;
        }
      }
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

  /** ST-aligned prompt count; falls back to heuristic when load fails. */
  async countSerializedPrompt(serialized: string): Promise<number> {
    const instance = await this.getInstance();
    if (instance == null) {
      return heuristic.countText(serialized);
    }
    const wrapped = wrapSerializedPromptAsSystemMessage(serialized);
    return countWebTokenizerMessages(
      (t) => instance.encode(t),
      [wrapped],
    );
  }

  /** Whether the last load attempt failed (for `estimated` flag). */
  get failedLoad(): boolean {
    return this.loadError;
  }
}

/** Claude family alias — same web tokenizer path as ST `/openai/count?model=claude`. */
export class ClaudeWebTokenCounter extends WebTokenizerCounter {
  constructor() {
    super("claude");
  }
}

export async function countWebFamilyPrompt(
  family: TokenizerFamily,
  serialized: string,
): Promise<{ readonly count: number; readonly estimated: boolean }> {
  const counter = new WebTokenizerCounter(
    family as Exclude<TokenizerFamily, "heuristic" | "tiktoken">,
  );
  const count = await counter.countSerializedPrompt(serialized);
  return { count, estimated: counter.failedLoad };
}

/** @internal test helper */
export function messagesToOpenAiStyle(
  messages: readonly { role: string; content: string }[],
): OpenAiStyleMessage[] {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

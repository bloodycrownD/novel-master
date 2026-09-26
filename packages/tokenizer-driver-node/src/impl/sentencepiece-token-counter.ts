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
import { countTextWithDefaultEncoding } from "./encoding-cache.js";

const heuristic = new HeuristicTokenCounter();

/**
 * 真 tokenizer 加载失败时的**兜底计数**（stream-metrics-native ④）。
 *
 * 与 web 家族同一条口径：字符折算 `ceil(字符数 / 3.35)` 是英文口径，对中文正文
 * 低估 82%~84%；而 `countSentencePieceFamilyPrompt` 在加载失败时本就会把
 * `estimated` 置 true、`counterKind` 置 `heuristic`（上层已声明这是估算），
 * 所以此时用默认 cl100k 近似（误差 0.5% 量级）严格优于折算。
 *
 * 只有 cl100k 表也建不起来（环境级故障）才退回字符折算。
 */
function fallbackCount(text: string): number {
  const real = countTextWithDefaultEncoding(text);
  return real ?? heuristic.countText(text);
}

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

  // 同步 port 实现保持字符折算不变（原因同 `WebTokenizerCounter` 的同名注释）：
  // 契约是同步的，而真编码表只能惰性异步构造；需要读数的路径都在 async 侧。
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

  /**
   * Encodes serialized prompt body (ST `countSentencepieceArrayTokens` on plain text);
   * 加载失败时兜底到默认 cl100k 真计数（见 {@link fallbackCount}）。
   */
  async countSerializedPrompt(serialized: string): Promise<number> {
    const proc = await this.getProcessor();
    if (proc == null) {
      return fallbackCount(serialized);
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

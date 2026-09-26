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
import { countTextWithDefaultEncoding } from "./encoding-cache.js";
import { getNodeTokenizerLoader } from "../node-tokenizer-loader.js";

const heuristic = new HeuristicTokenCounter();

/**
 * 真 tokenizer 加载失败时的**兜底计数**（stream-metrics-native ④）。
 *
 * 为什么不直接 `heuristic.countText`（即 `ceil(字符数 / 3.35)`）：3.35 是**英文**
 * 口径，cl100k 实际约 1.64 字符/token，折算对中文正文系统性低估 82%~84%。这里的
 * 调用方（`countWebFamilyPrompt`）会在加载失败时把 `estimated` 置 true、`counterKind`
 * 置 `heuristic`，也就是说**上层已经知道这是估算**——在已知是估算的前提下，没理由
 * 再用误差八成的折算，用默认 cl100k 近似（误差 0.5% 量级）明显更划算。
 *
 * 只有「连 cl100k 表都建不起来」才退回字符折算：那是环境级故障（ranks 资源缺失），
 * 别无选择，且失败被缓存、本进程不再重试。
 */
function fallbackCount(text: string): number {
  const real = countTextWithDefaultEncoding(text);
  return real ?? heuristic.countText(text);
}

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

  // 以下两个是**同步** `TokenCounter` port 的实现，保持字符折算不变（stream-metrics-native ④）：
  // port 契约是同步的，而真 tiktoken 的编码表是 WASM 对象、只能惰性异步构造；
  // 把同步方法改成「同步构造编码表」会在每次调用上白付一张 ranks 表的建表代价。
  // 真正需要读数的路径都走 async `countSerializedPrompt` / 驱动的
  // `countPromptLlmInput`，那里已经全部换成真计数。
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
   * ST-aligned prompt count; 加载失败时兜底到默认 cl100k 真计数
   * （cl100k 也建不起来才退字符折算，见 {@link fallbackCount}）。
   */
  async countSerializedPrompt(serialized: string): Promise<number> {
    const instance = await this.getInstance();
    if (instance == null) {
      return fallbackCount(serialized);
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

/**
 * 兜底计数（stream-metrics-native ④）：真 tokenizer 加载失败 / 编码表建不起来时，
 * 读数到底从哪来。
 *
 * 这组用例守的是**两级降级顺序**：
 * 1. 家族 tokenizer 加载失败 → 退到默认 cl100k **真计数**（不再直接折算）；
 * 2. 连 cl100k 表都建不起来 → 才退到最后一级的字符折算。
 * 两级都容易被「顺手改回去」，所以都显式钉住。
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import {
  CHARACTERS_PER_TOKEN_RATIO,
  countPromptLlmInput,
  createDefaultTokenCounterRegistry,
  serializePromptLlmInput,
  serializeToolsForTokenCount,
  type TokenizerFamily,
} from "@novel-master/core/provider";
import {
  __setNodeEncodingFactoryForTests,
  countTextWithDefaultEncoding,
} from "../src/impl/encoding-cache.js";
import { countSentencePieceFamilyPrompt } from "../src/impl/sentencepiece-token-counter.js";
import {
  countWebFamilyPrompt,
  WebTokenizerCounter,
} from "../src/impl/web-tokenizer-counter.js";
import { registerTokenizerNodeDriverForTests } from "../src/register-for-tests.js";

/** 一段中文正文：字符折算在它上面低估得最明显。 */
const CHINESE =
  "他把伞收了，窗外的雨顺着玻璃往下淌，街灯在水洼里碎成一片橙。".repeat(20);

/** core 的 tokenizerAssetPaths 对这个家族返回 null ⇒ 加载必然失败 ⇒ 必走兜底。 */
const UNKNOWN_FAMILY = "no-such-family" as unknown as TokenizerFamily;

describe("兜底计数口径", () => {
  before(() => {
    registerTokenizerNodeDriverForTests();
  });

  it("F1: web 家族加载失败 → 默认 cl100k 真计数（非字符折算）", async () => {
    const result = await countWebFamilyPrompt(UNKNOWN_FAMILY, CHINESE);
    assert.equal(result.estimated, true);
    assert.equal(result.count, countTextWithDefaultEncoding(CHINESE));
    assert.ok(
      result.count > Math.ceil(CHINESE.length / CHARACTERS_PER_TOKEN_RATIO) * 3,
      `web 兜底 ${result.count} 应远大于字符折算`,
    );
  });

  it("F2: sentencepiece 家族加载失败 → 默认 cl100k 真计数（非字符折算）", async () => {
    const result = await countSentencePieceFamilyPrompt(UNKNOWN_FAMILY, CHINESE);
    assert.equal(result.estimated, true);
    assert.equal(result.count, countTextWithDefaultEncoding(CHINESE));
    assert.ok(
      result.count > Math.ceil(CHINESE.length / CHARACTERS_PER_TOKEN_RATIO) * 3,
      `sentencepiece 兜底 ${result.count} 应远大于字符折算`,
    );
  });

  it("F3: 同步 countText / countMessages 仍是字符折算（同步 port 不改）", () => {
    const counter = new WebTokenizerCounter(UNKNOWN_FAMILY as never);
    const charRatio = Math.ceil(CHINESE.length / CHARACTERS_PER_TOKEN_RATIO);
    assert.equal(counter.countText(CHINESE), charRatio);
    assert.equal(counter.countMessages([]), 0);
  });

  it("F4: 连 cl100k 表都建不起来 → 才退到最后一级的字符折算", async () => {
    // 注入「构造必失败」的编码表工厂，复现 ranks 资源缺失这类环境级故障。
    __setNodeEncodingFactoryForTests(() => {
      throw new Error("boom: encoding table unavailable");
    });
    try {
      assert.equal(countTextWithDefaultEncoding(CHINESE), null);

      const layout = { system: CHINESE, persist: [], dynamic: [] };
      const ctx = { workplaceDisplay: "", messages: [] };
      const result = await countPromptLlmInput({
        layout,
        ctx,
        savedModelId: "openai/my-custom/foo",
        registry: createDefaultTokenCounterRegistry({} as Record<string, never>),
      });
      const serialized =
        (await serializePromptLlmInput(layout, ctx)) +
        serializeToolsForTokenCount(undefined);

      assert.equal(result.counterKind, "heuristic");
      assert.equal(result.estimated, true);
      assert.equal(
        result.tokenCount,
        Math.ceil(serialized.length / CHARACTERS_PER_TOKEN_RATIO),
      );
    } finally {
      // 还原真实构造器（会顺带作废缓存），别把故障留给后续用例。
      __setNodeEncodingFactoryForTests(null);
    }
  });
});

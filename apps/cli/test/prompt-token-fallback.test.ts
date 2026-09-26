/**
 * `nm prompt render --tokens` 在「拿不到模型」那档的计数兜底分支单测。
 *
 * 为什么单独开这个文件：这段分支原先只被 `prompt-tokens-e2e.test.ts` 覆盖，
 * 而那个套件是**长期基线 5/5 红**（失败点在 `session create`），所以这段
 * 逻辑在 CI 里从未真正跑过。这里直接对抽出来的纯函数断言，**不依赖**那个
 * 基线红的 e2e。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCliNoModelTokenDiagnostic,
  resolveCliPromptTokens,
} from "../src/prompt/commands.js";

/** 字符折算那级的固定返回值（真实实现是 `ceil(chars / 3.35)`，这里只验分支选择）。 */
const CHAR_RATIO_COUNT = 7;

const charRatioCount = (): number => CHAR_RATIO_COUNT;

describe("resolveCliPromptTokens", () => {
  it("拿到真计数时就用它，不退折算", () => {
    const seen: string[] = [];
    const count = resolveCliPromptTokens(
      "序列化后的提示词",
      (text) => {
        seen.push(text);
        return 1234;
      },
      charRatioCount,
    );
    assert.equal(count, 1234);
    assert.notEqual(count, CHAR_RATIO_COUNT);
    // 真计数器拿到的必须就是传进去的原文。
    assert.deepEqual(seen, ["序列化后的提示词"]);
  });

  it("真计数返回 null 时才退字符折算", () => {
    const count = resolveCliPromptTokens(
      "序列化后的提示词",
      () => null,
      charRatioCount,
    );
    assert.equal(count, CHAR_RATIO_COUNT);
  });

  it("真计数为 0 不会被当成 null（0 是合法读数）", () => {
    const count = resolveCliPromptTokens(
      "序列化后的提示词",
      () => 0,
      charRatioCount,
    );
    assert.equal(count, 0);
  });
});

describe("buildCliNoModelTokenDiagnostic", () => {
  it("兜底切换读数不改 counter / estimated 的口径", () => {
    // 真计数档。
    const real = buildCliNoModelTokenDiagnostic(1234);
    // 字符折算档。
    const fallback = buildCliNoModelTokenDiagnostic(CHAR_RATIO_COUNT);

    for (const payload of [real, fallback]) {
      assert.equal(payload.counter, "heuristic");
      assert.equal(payload.estimated, true);
      assert.equal(payload.model, null);
      assert.equal(payload.tokenizerFamily, "heuristic");
    }

    // 两档之间只有读数本身不同，字段名与字段值逐个一致。
    assert.deepEqual(Object.keys(real), Object.keys(fallback));
    assert.deepEqual(
      { ...real, tokenCount: 0 },
      { ...fallback, tokenCount: 0 },
    );
  });

  it("序列化后的 JSON 形状与字段顺序不变", () => {
    const json = JSON.stringify(
      buildCliNoModelTokenDiagnostic(CHAR_RATIO_COUNT),
    );
    assert.equal(
      json,
      '{"tokenCount":7,"model":null,"counter":"heuristic","estimated":true,"tokenizerFamily":"heuristic"}',
    );
  });

  it("端到端串一次：真计数档与折算档都只改读数", () => {
    const fromReal = JSON.parse(
      JSON.stringify(
        buildCliNoModelTokenDiagnostic(
          resolveCliPromptTokens("提示词", () => 1234, charRatioCount),
        ),
      ),
    );
    const fromFallback = JSON.parse(
      JSON.stringify(
        buildCliNoModelTokenDiagnostic(
          resolveCliPromptTokens("提示词", () => null, charRatioCount),
        ),
      ),
    );
    assert.equal(fromReal.tokenCount, 1234);
    assert.equal(fromFallback.tokenCount, CHAR_RATIO_COUNT);
    assert.equal(fromReal.counter, fromFallback.counter);
    assert.equal(fromReal.estimated, fromFallback.estimated);
  });
});

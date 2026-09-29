/**
 * T-TC4：分块计数误差护栏（真 cl100k 基准）。
 *
 * - 中文叙事长文（≥2 段夹具）：splitTextIntoChunks 分块加和 vs 整串一次
 *   encode，误差 ≤1%（实测基准 -0.02% ~ +0.35%，余量充足）；
 * - 12K 无空白中文串经「逐块 encode」路径（块来自 splitTextIntoChunks，
 *   即 L2 全 miss 的最坏路径）总耗时 ≤1s——64 兜底切分防 O(len²) 的
 *   性能护栏。
 *
 * 真 cl100k 编解码器按提升后的根 node_modules 引入（同
 * `count-text-with-tokenizer.test.ts` 夹具先例）：core 自身不依赖
 * js-tiktoken，但本护栏正是要拿**真**词表断误差。
 */
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { beforeEach, describe, it } from "node:test";
import { Tiktoken } from "js-tiktoken/lite";
import * as cl100kRanksModule from "js-tiktoken/ranks/cl100k_base";
import { splitTextIntoChunks } from "../../../src/infra/tokenizer/logic/chunk-splitter.js";
import {
  chunkHash16,
  tokenChunkCache,
} from "../../../src/infra/tokenizer/logic/token-chunk-cache.js";

/** ranks 命名空间取默认导出兼容形态（ESM default vs CJS 命名导出）。 */
function unwrapRanks(mod: unknown): unknown {
  return (mod as { default?: unknown }).default ?? mod;
}

/** 真 cl100k 编码器；整份 ranks 表只建一次。 */
const cl100k = new Tiktoken(unwrapRanks(cl100kRanksModule) as never);
const cl100kEncode = (text: string): number => cl100k.encode(text).length;

/** 第一段叙事（真实正文形态：多句成段，句读自然）。 */
const PARAGRAPH_A =
  "夜色如水，林间小径上落满了枯叶，风一吹便沙沙作响。她停下脚步，" +
  "抬头望向远处那片朦胧的灯火，心里忽然涌起一阵说不清的情绪。" +
  "也许是倦了，也许只是夜太静，静得能听见自己的心跳。";

/** 第二段叙事（换场景，避免同段复读拉高块重复度）。 */
const PARAGRAPH_B =
  "翌日清晨，山雾未散，队伍已经整装出发。老猎人走在最前面，" +
  "手中的柴刀不时拨开挡路的荆棘。没人说话，只有脚步声与露水滴落叶面的轻响。" +
  "日头爬到半山时，他们终于望见了那座废弃已久的驿站。";

/** 中文叙事长文夹具：两段叙事，段间换行。 */
const ZH_NARRATIVE = `${PARAGRAPH_A}\n${PARAGRAPH_B}`;

/** 12K 无空白中文串（病态输入：64 兜底硬切路径）。 */
const NO_WHITESPACE_12K = "漢".repeat(12_000);

describe("T-TC4 分块计数误差护栏（真 cl100k）", () => {
  beforeEach(() => {
    tokenChunkCache.clearForTests();
  });

  it("中文叙事长文：分块加和 vs 整串 encode 误差 ≤1%", () => {
    const truth = cl100kEncode(ZH_NARRATIVE);
    const chunks = splitTextIntoChunks(ZH_NARRATIVE);
    // 夹具自检：确为多块多段（防夹具退化成单块导致护栏失真）
    assert.ok(chunks.length >= 4, `夹具应切出多块，实际 ${chunks.length}`);
    assert.ok(ZH_NARRATIVE.includes("\n"), "夹具应为多段叙事");

    // 分块加和走 L2 全 miss 路径（逐块现算 + record）
    const sum = chunks.reduce((acc, chunk) => {
      const h = chunkHash16(chunk);
      const hit = tokenChunkCache.lookup(h, "t-tc4-scope");
      const count = hit ?? cl100kEncode(chunk);
      if (hit === undefined) {
        tokenChunkCache.record(h, "t-tc4-scope", count);
      }
      return acc + count;
    }, 0);

    const errorRate = Math.abs(sum - truth) / truth;
    assert.ok(
      errorRate <= 0.01,
      `分块加和 ${sum} 相对整串真值 ${truth} 误差 ${(errorRate * 100).toFixed(3)}%，应 ≤1%`
    );
  });

  it("分块求和的缓存口径：同文本二轮全命中，读数与一轮一致", () => {
    const chunks = splitTextIntoChunks(ZH_NARRATIVE);
    const sumVia = (): number =>
      chunks.reduce((acc, chunk) => {
        const h = chunkHash16(chunk);
        const hit = tokenChunkCache.lookup(h, "t-tc4-round2");
        const count = hit ?? cl100kEncode(chunk);
        if (hit === undefined) {
          tokenChunkCache.record(h, "t-tc4-round2", count);
        }
        return acc + count;
      }, 0);
    const first = sumVia();
    const second = sumVia();
    assert.equal(second, first, "缓存命中轮读数不得漂移");
  });

  it("12K 无空白中文串：逐块 encode（块来自 splitTextIntoChunks）总耗时 ≤1s", () => {
    const chunks = splitTextIntoChunks(NO_WHITESPACE_12K);
    // 夹具自检：64 兜底硬切，块数 ≈ ceil(12000/64)
    assert.ok(chunks.length >= Math.ceil(12_000 / 64) - 1);
    for (const chunk of chunks) {
      assert.ok(chunk.length <= 64);
    }

    const startedAt = performance.now();
    let total = 0;
    for (const chunk of chunks) {
      total += cl100kEncode(chunk);
    }
    const elapsedMs = performance.now() - startedAt;
    assert.ok(total > 0, "逐块 encode 应产出正计数");
    assert.ok(
      elapsedMs <= 1_000,
      `12K 无空白串逐块 encode 耗时 ${elapsedMs.toFixed(1)}ms，应 ≤1s`
    );
  });
});

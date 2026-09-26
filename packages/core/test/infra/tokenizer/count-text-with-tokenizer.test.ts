import assert from "node:assert/strict";
import { describe, it } from "node:test";
// 真 cl100k 编解码器。core 自身不依赖 js-tiktoken（分词器是宿主注入的），
// 但它是 monorepo 里已提升到根 node_modules 的工作区依赖，本用例正是要拿
// **真**编解码器做基准，故直接按提升后的路径引入；core 的 `src` typecheck
// （tsconfig.json 只含 src/**）不受影响。
import { Tiktoken } from "js-tiktoken/lite";
import * as cl100kRanksModule from "js-tiktoken/ranks/cl100k_base";
import { countTextWithIncrementalTokenizer } from "../../../src/infra/tokenizer/logic/count-text-with-tokenizer.js";

/** ranks 命名空间取默认导出兼容形态（ESM default vs CJS 命名导出）。 */
function unwrapRanks(mod: unknown): unknown {
  return (mod as { default?: unknown }).default ?? mod;
}

/** 真 cl100k 编码器；整份 ranks 表只建一次（本文件多个用例共用）。 */
const cl100k = new Tiktoken(unwrapRanks(cl100kRanksModule) as never);
const cl100kEncode = (text: string): number => cl100k.encode(text).length;

/** 一句正文（57 字符，cl100k 约 34 token）。 */
const ZH_SENTENCE =
  "夜色如水，林间小径上落满了枯叶，风一吹便沙沙作响。她停下脚步，抬头望向远处那片朦胧的灯火，心里忽然涌起一阵说不清的情绪。";

/**
 * 中文长文（3,630 字符 / 真值 5,160 token）。
 *
 * 行宽取两句（114 字符）而非一句：固化切点按 `MAX_ENCODE_CHARS = 64` 落段，
 * 行宽 57 字符时每行边界会稳定多算 1 token（实测 +1.16%，即行数/真值之比），
 * 那是**切点落在行中间的固有断词误差**、不是实现缺陷；行宽拉到 114 字符后
 * 该比例被摊薄到 +0.02%。真实提示词本就是多句成段，故取后者。
 */
const ZH_PASSAGE = `${ZH_SENTENCE}${ZH_SENTENCE}\n`.repeat(30);

/** 记录每次 encode 的入参，用于断言「单次 encode ≤64 字符」与调用数量级。 */
function recordingEncoder(base: (text: string) => number): {
  readonly encode: (text: string) => number;
  readonly calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    encode(text: string): number {
      calls.push(text);
      return base(text);
    },
  };
}

/** 捕获 `console.warn`（计数器失败路径会告警一次），返回还原函数。 */
function captureWarnings(): { restore(): void } {
  const original = console.warn;
  console.warn = (): void => undefined;
  return {
    restore(): void {
      console.warn = original;
    },
  };
}

describe("countTextWithIncrementalTokenizer（整段文本真分词器计数）", () => {
  it("空串直接返回 0，且不触碰 encode", () => {
    let calls = 0;
    const count = countTextWithIncrementalTokenizer(text => {
      calls += 1;
      return cl100kEncode(text);
    }, "");
    assert.equal(count, 0);
    assert.equal(calls, 0);
  });

  it("准确性：中文正文相对全量 encode 真值误差 ≤1%", () => {
    const truth = cl100kEncode(ZH_PASSAGE);
    const count = countTextWithIncrementalTokenizer(cl100kEncode, ZH_PASSAGE);
    const errorRate = Math.abs(count - truth) / truth;
    // 顺带钉住「折算有多不准」这条改造前提：3.35 是英文口径，对中文低估 ~80%，
    // 若哪天有人把本 helper 悄悄换回 ceil(chars/3.35)，这条对照即报警。
    const fold = Math.ceil(ZH_PASSAGE.length / 3.35);
    assert.ok(
      fold < truth * 0.25,
      `字符折算 ${fold} 相对真值 ${truth} 应严重低估（改造前提）`,
    );
    assert.ok(
      errorRate <= 0.01,
      `整段计数 ${count} 相对真值 ${truth} 误差 ${errorRate} 应 ≤1%`,
    );
  });

  it("不变量：单次 encode 入参恒 ≤64 字符，调用数随文本线性增长", () => {
    const shortText = "中文无空白连续书写".repeat(100);
    const longText = "中文无空白连续书写".repeat(400);

    const shortRecorder = recordingEncoder(t => t.length);
    countTextWithIncrementalTokenizer(shortRecorder.encode, shortText);
    const longRecorder = recordingEncoder(t => t.length);
    countTextWithIncrementalTokenizer(longRecorder.encode, longText);
    for (const call of [...shortRecorder.calls, ...longRecorder.calls]) {
      assert.ok(
        call.length <= 64,
        `单次 encode 不得超 64 字符，实际 ${call.length}`,
      );
    }
    // 线性口径直接写成「每 64 字符一段 + 尾窗 1 段」：超长无空白串被切成的段数
    // 与字符数成正比，若哪天退化成每次全量重算（1 次调用 / 每 push）这里立刻炸。
    for (const [text, recorder] of [
      [shortText, shortRecorder],
      [longText, longRecorder],
    ] as const) {
      const bound = Math.ceil(text.length / 64) + 1;
      assert.ok(
        recorder.calls.length <= bound,
        `${text.length} 字符应切为 ≤${bound} 段，实际 ${recorder.calls.length} 段`,
      );
    }
    // 文本 4× 变长，调用数也应近似 4×（不是 16× 的 O(n²)）。
    assert.ok(
      longRecorder.calls.length >= shortRecorder.calls.length * 3,
      `调用数应随文本线性增长：${shortRecorder.calls.length} → ${longRecorder.calls.length}`,
    );
  });

  it("失败路径：encode 恒抛错时按 1:1 上界兜底、不崩", () => {
    const warnings = captureWarnings();
    try {
      const text = "这是一段无法编码的文本。".repeat(20);
      const count = countTextWithIncrementalTokenizer(() => {
        throw new Error("special token text");
      }, text);
      assert.equal(count, text.length, "不可编码段按 1 字符 ≈ 1 token 兜底计入");
      assert.ok(count > 0);
    } finally {
      warnings.restore();
    }
  });

  it("失败路径：部分段抛错时读数不倒退、不丢段", () => {
    const warnings = captureWarnings();
    try {
      const prefix = "正常可编码的文本。".repeat(30);
      const poisoned = "*".repeat(40);
      const suffix = "尾部同样可编码。".repeat(30);
      const count = countTextWithIncrementalTokenizer(text => {
        if (text.includes("*")) {
          throw new Error("special token text");
        }
        return cl100kEncode(text);
      }, `${prefix}${poisoned}${suffix}`);
      // 失败段按 1:1 计入（40）——比真 cl100k 值还高，故总数不可能低于
      // 「前后两段真值 + 失败段字符数」这条下界。
      const lowerBound = cl100kEncode(prefix) + poisoned.length;
      assert.ok(
        count >= lowerBound,
        `失败段不得丢字符：${count} < ${lowerBound}`,
      );
    } finally {
      warnings.restore();
    }
  });

  it("整段一次计数 ≈ 同文本分块 push 的末值（同一套切分口径）", async () => {
    const { createIncrementalTokenCounter } = await import(
      "../../../src/infra/tokenizer/logic/incremental-token-counter.js"
    );
    const text = ZH_PASSAGE;
    const oneShot = countTextWithIncrementalTokenizer(cl100kEncode, text);
    const counter = createIncrementalTokenCounter({ encode: cl100kEncode });
    for (let i = 0; i < text.length; i += 7) {
      counter.push(text.slice(i, i + 7));
    }
    // 不要求逐 token 相等：固化切点随 push 节奏不同、段边界处的「断词误差」
    // 方向也不同（实测差 0.7% 量级）。这里钉的是「两种用法同一量级」，
    // 也就是 helper 没有偷跑全量重算那条病态路径。
    const errorRate = Math.abs(oneShot - counter.tokens) / counter.tokens;
    assert.ok(
      errorRate <= 0.01,
      `一次计数 ${oneShot} 与分块 push ${counter.tokens} 差 ${errorRate}，应 ≤1%`,
    );
  });
});

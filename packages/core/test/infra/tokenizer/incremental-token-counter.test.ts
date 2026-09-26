import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createIncrementalTokenCounter,
  type IncrementalTokenCounterDeps,
} from "../../../src/infra/tokenizer/logic/incremental-token-counter.js";

/**
 * 假 encode：按空白切词计数。对「断词切分」敏感——被切成两半的词会被算成
 * 两个 token，正好用来证明边界回看（lookbackChars）消除断词误差。
 */
function wordCount(text: string): number {
  return text.split(/\s+/).filter(part => part.length > 0).length;
}

/** 记录每次 encode 的入参长度，便于断言「单次 encode 有界」。 */
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

function makeCounter(
  deps: Partial<IncrementalTokenCounterDeps> = {},
): ReturnType<typeof createIncrementalTokenCounter> {
  return createIncrementalTokenCounter({ encode: wordCount, ...deps });
}

describe("createIncrementalTokenCounter（尾窗增量计数）", () => {
  it("分批 push 与一次 push 结果一致（默认参数下的正文流）", () => {
    const text =
      "夜色如水，林间小径上落满了枯叶，风一吹便沙沙作响。 The night was quiet and the path was covered with leaves. ".repeat(
        3,
      );
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += 7) {
      chunks.push(text.slice(i, i + 7));
    }

    const batched = makeCounter();
    for (const chunk of chunks) {
      batched.push(chunk);
    }
    const single = makeCounter();
    single.push(text);

    // 分批与一次 push 的差值只来自固化切点（允许 ±1 token 的边界差）。
    assert.ok(
      Math.abs(batched.tokens - single.tokens) <= 1,
      `分批 ${batched.tokens} 与一次 ${single.tokens} 应基本一致`,
    );
  });

  it("尾窗未满时读值等于整段 encode（逐字推入也不抖）", () => {
    const counter = makeCounter({ tailChars: 64, lookbackChars: 8 });
    const text = "abc def ghi jkl";
    let expected = "";
    for (const ch of text) {
      counter.push(ch);
      expected += ch;
      assert.equal(counter.tokens, wordCount(expected));
    }
  });

  it("tokens 单调不减（常规文本流）", () => {
    const counter = makeCounter();
    const text = "one two three four five six seven eight nine ten ".repeat(40);
    let previous = 0;
    for (let i = 0; i < text.length; i += 3) {
      counter.push(text.slice(i, i + 3));
      assert.ok(
        counter.tokens >= previous,
        `tokens 不得回退：${counter.tokens} < ${previous}`,
      );
      previous = counter.tokens;
    }
  });

  it("空 delta 是 no-op；reset 归零后可继续累计", () => {
    const counter = makeCounter();
    counter.push("");
    assert.equal(counter.tokens, 0);
    counter.push("hello world");
    const before = counter.tokens;
    assert.ok(before > 0);
    counter.push("");
    assert.equal(counter.tokens, before);

    counter.reset();
    assert.equal(counter.tokens, 0);
    counter.push("hello world");
    assert.equal(counter.tokens, before);
  });

  it("encode 抛错被吞掉：保持上一次读值、不崩；恢复后继续增长", () => {
    let calls = 0;
    const counter = createIncrementalTokenCounter({
      encode: text => {
        calls += 1;
        if (calls === 1) {
          throw new Error("special token text");
        }
        return wordCount(text);
      },
      tailChars: 256,
    });
    // 首次读值 encode 抛错 → 保持初值 0（不崩）。
    counter.push("hello world");
    assert.equal(counter.tokens, 0);
    // 下一次读值（新 delta 置脏后重算）恢复。
    counter.push(" again");
    assert.equal(counter.tokens, 3);
  });

  it("固化切点优先落自然边界：断词误差被 lookbackChars 消除", () => {
    // 场景：一次 push 后需要固化，目标切点正好落在词中间。
    // 无回看：切在 "aaaa b|bbb" → 多算 1 token；有回看：切在 "aaaa| bbbb" → 精确。
    const text = "aaaa bbbb";
    const noLookback = makeCounter({
      tailChars: 3,
      lookbackChars: 0,
      commitStepChars: 2,
    });
    noLookback.push(text);
    const withLookback = makeCounter({
      tailChars: 3,
      lookbackChars: 3,
      commitStepChars: 2,
    });
    withLookback.push(text);

    assert.equal(wordCount(text), 2);
    assert.equal(
      withLookback.tokens,
      2,
      "切在空白边界上应与全量计数一致",
    );
    assert.ok(
      noLookback.tokens > withLookback.tokens,
      `断词切分应多算：${noLookback.tokens} > ${withLookback.tokens}`,
    );
  });

  it("单次 encode 入参长度有界（≤64 字符），超长无空白串被拆段自保", () => {
    const recorder = recordingEncoder(text => text.length);
    const counter = createIncrementalTokenCounter({
      encode: recorder.encode,
    });
    // 12,000 字符纯中文无空白（真实 tiktoken 下整段 encode 要数十秒）。
    counter.push("中".repeat(12_000));
    void counter.tokens;
    for (const call of recorder.calls) {
      assert.ok(
        call.length <= 64,
        `单次 encode 不得超 64 字符，实际 ${call.length}`,
      );
    }
    assert.ok(recorder.calls.length > 100, "超长串应被切成多段");
  });

  it("有界内存：encode 消耗的总字符数远小于「每次全量重算」口径", () => {
    const recorder = recordingEncoder(text => text.length);
    const counter = createIncrementalTokenCounter({
      encode: recorder.encode,
    });
    const total = 100_000;
    for (let i = 0; i < total; i += 5) {
      counter.push("x".repeat(5));
      void counter.tokens;
    }
    const encodedChars = recorder.calls.reduce(
      (sum, text) => sum + text.length,
      0,
    );
    // 每 push 只重算尾窗（≤ tailChars+commitStepChars 量级）+ 摊薄的固化段：
    // 总量随输入**线性**增长；若退化成每次全量重算则是 O(n²)（10 万字符量级
    // 会到 10^10 字符）——40× 的宽松上界足以区分两者。
    assert.ok(
      encodedChars < total * 40,
      `累计 encode 字符数 ${encodedChars} 应远低于全量重算量级`,
    );
    assert.equal(counter.tokens, total);
  });

  it("性能护栏：10 万字符流的分桶均摊耗时线性（末桶 ≤ 首桶 × 3）", () => {
    const counter = makeCounter();
    const chunk = "字".repeat(20);
    const pushes = 5_000; // 10 万字符
    const buckets = 4;
    const perBucket = pushes / buckets;
    const bucketMs: number[] = [];
    for (let bucket = 0; bucket < buckets; bucket += 1) {
      const start = performance.now();
      for (let i = 0; i < perBucket; i += 1) {
        counter.push(chunk);
        void counter.tokens;
      }
      bucketMs.push(performance.now() - start);
    }
    const amortized = bucketMs.map(ms => ms / (perBucket * 20));
    const first = amortized[0]!;
    const last = amortized[buckets - 1]!;
    assert.ok(
      last <= first * 3 + 1e-6,
      `耗时曲线疑似超线性：首桶 ${first * 1e6}ns/char，末桶 ${last * 1e6}ns/char`,
    );
  });
});

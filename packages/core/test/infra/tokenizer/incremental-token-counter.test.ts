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

/**
 * 捕获 `console.warn`（失败降级路径的可观测落点，见 B-1 改法 #2/#3）。
 *
 * 返回 `[读到的文案数组, 还原函数]`——用 try/finally 保证还原，避免污染同进程
 * 的其它用例。
 */
function captureWarnings(): {
  readonly warnings: string[];
  restore(): void;
} {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]): void => {
    warnings.push(args.map(arg => String(arg)).join(' '));
  };
  return {
    warnings,
    restore(): void {
      console.warn = original;
    },
  };
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
    const warnings = captureWarnings();
    try {
      let calls = 0;
      const counter = createIncrementalTokenCounter({
        encode: text => {
          calls += 1;
          if (calls === 1) {
            throw new Error("special token text");
          }
          return wordCount(text);
        },
        // 尾窗够大：整条用例只走**读值路径**的失败，固化分支永不触发。
        tailChars: 256,
      });
      // 首次读值 encode 抛错 → 保持初值 0（不崩）。
      counter.push("hello world");
      assert.equal(counter.tokens, 0);
      // 下一次读值（新 delta 置脏后重算）恢复。
      counter.push(" again");
      assert.equal(counter.tokens, 3);

      // 读值路径首次失败要留告警信号（「尾窗不可编码，保持上一次读值」）——
      // 该路径此前完全静默，「指标条卡在某个数上」在真机上零线索。
      assert.equal(warnings.warnings.length, 1);
      assert.match(warnings.warnings[0]!, /保持上一次读值/);
      // 口径钉死：读值路径失败时尾窗没被消费、没丢字，不得计入诊断计数
      // （`unencodableChars` 只表达「已按 1:1 兜底计入 tokens 的字符数」）。
      assert.equal(counter.unencodableChars, 0);
    } finally {
      warnings.restore();
    }
  });

  it("固化段 encode 抛错：按 1:1 兜底计入，tokens 不倒退、总量不缺段", () => {
    const warnings = captureWarnings();
    try {
      // 1 字符 = 1 token（口径可手算）；文本里带 "*" 的段模拟特殊 token 文本，
      // js-tiktoken 对它默认抛错。
      const counter = createIncrementalTokenCounter({
        encode: text => {
          if (text.includes("*")) {
            throw new Error("special token text");
          }
          return text.length;
        },
        // 小尾窗 + 小固化步长 → normalLimit = 8，推入即触发固化。
        tailChars: 4,
        lookbackChars: 0,
        commitStepChars: 4,
      });
      assert.equal(counter.unencodableChars, 0);

      // 第 1 段：21 字符，固化切走前 17（含 "*"）→ 该段按 1:1 兜底计入 17，
      // 尾窗留 4 → 读值 17 + 4 = 21（旧实现在此读值会从 21 掉到 4）。
      counter.push(`*${"a".repeat(20)}`);
      const afterFirst = counter.tokens;
      assert.equal(afterFirst, 21, "固化段失败不得丢字符、不得使读值倒退");
      assert.equal(counter.unencodableChars, 17);

      // 第 2 段：再触发一次固化失败（累计兜底 17 + 21 = 38，尾窗 4 → 42）。
      counter.push(`*${"b".repeat(20)}`);
      const afterSecond = counter.tokens;
      assert.equal(afterSecond, 42, "第二次固化失败同样按 1:1 兜底");
      assert.equal(
        counter.unencodableChars,
        38,
        "unencodableChars 累计每次兜底的字符数",
      );

      // 后续正常段继续增长：tokens 单调不减。
      const beforeNormal = counter.tokens;
      counter.push("c".repeat(30));
      assert.ok(
        counter.tokens > beforeNormal,
        `恢复后读值应继续增长：${counter.tokens} <= ${beforeNormal}`,
      );

      // 固化失败只告警一次（后续同类失败静默，防每段刷屏）；告警文案带兜底计数
      // ——`unencodableChars` 的可观测落点就写在这条文案里，不是只写字段。
      assert.equal(warnings.warnings.length, 1);
      assert.match(warnings.warnings[0]!, /不可编码 17 字符/);
      assert.match(warnings.warnings[0]!, /1:1 兜底计入/);

      // reset 不清零该诊断计数：它是跨 run 的累计量（清零会让「切模型后又开始
      // 丢字」在日志里消失）。
      const swallowed = counter.unencodableChars;
      counter.reset();
      assert.equal(counter.tokens, 0);
      assert.equal(counter.unencodableChars, swallowed);
    } finally {
      warnings.restore();
    }
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

  it("性能护栏：10 万字符流的分桶均摊耗时线性（末桶 ≤ 首桶 × 8）", () => {
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
    // 阈值取 8×（原为 3×，2026-09-27 起放宽）：这是**数量级回归线**，不是精度基准
    // ——全量套件并行负载下同一次运行实测出现过 3.02×（首桶 77ns/char、末桶 232ns/char），
    // 而退化的形态「每次 push 全量重算」是 ~100× 量级（12,000 字符 88s vs 0.5s），
    // 中间隔着两个数量级。卡在 3× 等于拿机器噪声当回归（与 RULE「性能护栏取数量级
    // 回归线」同款口径）；精确不变量由上面「单次 encode 入参 ≤64 字符」「累计 encode
    // 字符量线性」两条计数式断言守着，与负载无关。
    assert.ok(
      last <= first * 8 + 1e-6,
      `耗时曲线疑似超线性：首桶 ${first * 1e6}ns/char，末桶 ${last * 1e6}ns/char`,
    );
  });
});

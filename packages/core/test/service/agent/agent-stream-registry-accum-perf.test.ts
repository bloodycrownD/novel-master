/**
 * AgentStreamRegistry 累积数组化的性能护栏测试（llm-stream-native Step 5，T-N5）。
 *
 * 背景：registry 的 append 原实现是 per-delta 的 `text + delta` 字符串重建，
 * 随流长增长产生超线性累积与 GC 垃圾；Step 5 数组化后 append 变为 parts
 * 数组 push，物化收敛到 get（读频低，join 一次）。
 *
 * 护栏断言（10 万字符模拟流）：
 * - 线性断言：按累计长度分四桶（0-25k / 25k-50k / 50k-75k / 75k-100k）测
 *   每桶的 append + 桶末一次 get 物化的均摊耗时（每字符），末桶均摊不超过
 *   首桶的 3 倍——线性实现下比值应接近 1，超线性（O(n²)）实现按桶中点
 *   累计长度估算会到 ~7×，3× 阈值可稳定区分；
 * - 正确性断言：物化结果（get）与逐段 `+=` 参照完全一致（text 与 thinking
 *   两路）。
 *
 * @module test/service/agent/agent-stream-registry-accum-perf
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { performance } from "node:perf_hooks";
import {
  createAgentStreamRegistry,
} from "@novel-master/core/agent";

const SESSION_ID = "perf-session";

/** 模拟流总量（字符）。 */
const TOTAL_CHARS = 100_000;
/** 每段 delta 字符数（等长段：段数分桶 = 累计长度分桶）。 */
const SEGMENT_CHARS = 20;
const TOTAL_SEGMENTS = TOTAL_CHARS / SEGMENT_CHARS; // 5000
/** 分桶数：0-25k / 25k-50k / 50k-75k / 75k-100k。 */
const BUCKETS = 4;
const SEGMENTS_PER_BUCKET = TOTAL_SEGMENTS / BUCKETS; // 1250
/** 末桶均摊耗时相对首桶的容忍倍数（线性 ≈1×；O(n²) ≈7×，3× 居中区分）。 */
const AMORTIZED_RATIO_LIMIT = 3;
/** 计时轮数：每桶取各轮最小值（最小值法吸收调度抖动，护栏进常规套件长跑）。 */
const ROUNDS = 3;

/** 生成一段可区分的等长 delta（序号嵌入正文，避免重复同引用字符串）。 */
function makeSegment(index: number): string {
  const head = `s${index % 10_000}-`;
  return head + "x".repeat(SEGMENT_CHARS - head.length);
}

describe("AgentStreamRegistry 累积数组化性能护栏（T-N5）", () => {
  it("T-N5-REG-LINEAR：10 万字符模拟流的 append+物化耗时曲线线性（末桶均摊 ≤ 首桶 × 3）", () => {
    const registry = createAgentStreamRegistry();
    registry.register(SESSION_ID);

    // 预生成全部段，生成成本不得混入计时。
    const segments: string[] = new Array(TOTAL_SEGMENTS);
    for (let i = 0; i < TOTAL_SEGMENTS; i++) {
      segments[i] = makeSegment(i);
    }

    // 多轮计时：每桶取各轮最小值（首轮含 JIT 预热偏慢只会让最小值更干净，
    // 抖动尖峰被剔除；线性实现的桶间比值应稳定在 1 附近）。
    const bucketMinMs: number[] = new Array(BUCKETS).fill(Infinity);
    for (let round = 0; round < ROUNDS; round++) {
      registry.reset(SESSION_ID);
      for (let bucket = 0; bucket < BUCKETS; bucket++) {
        const start = performance.now();
        for (let s = 0; s < SEGMENTS_PER_BUCKET; s++) {
          registry.append(SESSION_ID, {
            text: segments[bucket * SEGMENTS_PER_BUCKET + s],
          });
        }
        // 桶末一次物化读取（真实消费点：UI 进入 / 快照），计入桶耗时。
        // 长度读取同时防止 append 被优化掉。
        const snap = registry.get(SESSION_ID);
        assert.ok(snap != null && snap.text.length > 0);
        const elapsed = performance.now() - start;
        if (elapsed < bucketMinMs[bucket]) {
          bucketMinMs[bucket] = elapsed;
        }
      }
    }

    const charsPerBucket = SEGMENTS_PER_BUCKET * SEGMENT_CHARS;
    const amortized = bucketMinMs.map(ms => ms / charsPerBucket);
    console.log(
      `T-N5-REG 分桶均摊耗时(ns/char)：${amortized
        .map(v => (v * 1e6).toFixed(2))
        .join(" / ")}`,
    );

    const first = amortized[0];
    const last = amortized[BUCKETS - 1];
    assert.ok(
      last <= first * AMORTIZED_RATIO_LIMIT,
      `累积耗时曲线疑似超线性：首桶均摊 ${(first * 1e6).toFixed(2)}ns/char，` +
        `末桶均摊 ${(last * 1e6).toFixed(2)}ns/char，比值 ${(last / first).toFixed(2)} 超过 ${AMORTIZED_RATIO_LIMIT}×`,
    );
  });

  it("T-N5-REG-CORRECT：物化结果与逐段 += 参照一致（text 与 thinking 两路）", () => {
    const registry = createAgentStreamRegistry();
    registry.register(SESSION_ID);

    const segments: string[] = new Array(TOTAL_SEGMENTS);
    for (let i = 0; i < TOTAL_SEGMENTS; i++) {
      segments[i] = makeSegment(i);
    }

    // 逐段 += 参照（独立于 registry 的朴素实现）。
    let expectedText = "";
    let expectedThinking = "";
    for (let i = 0; i < TOTAL_SEGMENTS; i++) {
      registry.append(SESSION_ID, { text: segments[i] });
      expectedText += segments[i];
      // thinking 每 3 段混入一路，覆盖两路交替追加。
      if (i % 3 === 0) {
        const thinkSeg = `t${i}-` + "y".repeat(SEGMENT_CHARS - `t${i}-`.length);
        registry.append(SESSION_ID, { thinking: thinkSeg });
        expectedThinking += thinkSeg;
      }
    }

    const snap = registry.get(SESSION_ID);
    assert.ok(snap != null);
    assert.equal(snap.text.length, TOTAL_CHARS, "text 总长应为 10 万字符");
    assert.equal(snap.text, expectedText, "text 物化结果应与逐段 += 参照一致");
    assert.equal(
      snap.thinking,
      expectedThinking,
      "thinking 物化结果应与逐段 += 参照一致",
    );

    // reset 后从空开始（数组清空语义回归）。
    registry.reset(SESSION_ID);
    assert.deepEqual(registry.get(SESSION_ID), { text: "", thinking: "" });
    registry.append(SESSION_ID, { text: "next-step" });
    assert.equal(registry.get(SESSION_ID)?.text, "next-step");
  });
});

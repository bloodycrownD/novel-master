/**
 * SessionStreamUnit partial 数组化的性能护栏测试（llm-stream-native
 * Step 5，T-N5 mobile 面）。
 *
 * 背景：unit 的 applyStreamSegments 原实现是 64ms 节拍下的
 * `partialTextValue += seg.delta` 全量字符串重建；Step 5 数组化后变为
 * segments push + dirty 物化缓存——物化频率受 apply 节拍约束，而非
 * manager 的 delta 事件频率（appendWritethroughSnapshot 逐事件调
 * snapshot）。
 *
 * 护栏断言（10 万字符模拟流，fake timers 驱动 32ms ingress + 64ms apply）：
 * - 线性断言：按累计长度分四桶（0-25k / 25k-50k / 50k-75k / 75k-100k）测
 *   每桶的「ingest + 逐 delta 快照读（模拟写通载荷消费）+ 定时推进触发
 *   apply」均摊耗时（每字符），末桶均摊不超过首桶的 3 倍；
 * - 正确性断言：snapshot 物化结果与逐段 += 参照完全一致。
 * - 物化收敛断言：同一节拍内多次 snapshot 只 join 一次（dirty 缓存生效，
 *   快照读取的边际成本不随读取次数增长）。
 *
 * fake timers 以 doNotFake 保留 performance 真实计时。
 *
 * @module test/session-stream-unit-accum-perf
 */
import {describe, expect, it, beforeEach, afterEach} from '@jest/globals';
import {SessionStreamUnit} from '@/services/session-stream-unit';
import {
  SESSION_STREAM_APPLY_INTERVAL_MS,
  SESSION_STREAM_INGRESS_COALESCE_MS,
} from '@/services/session-stream-unit';

/** 模拟流总量（字符）。 */
const TOTAL_CHARS = 100_000;
/** 每段 delta 字符数（等长段：段数分桶 = 累计长度分桶）。 */
const SEGMENT_CHARS = 20;
const TOTAL_SEGMENTS = TOTAL_CHARS / SEGMENT_CHARS; // 5000
/** 每个 apply 窗口（64ms 节拍）承载的段数：模拟高速流下 32ms 合并的多段。 */
const SEGMENTS_PER_WINDOW = 50;
const TOTAL_WINDOWS = TOTAL_SEGMENTS / SEGMENTS_PER_WINDOW; // 100
/** 分桶数：0-25k / 25k-50k / 50k-75k / 75k-100k。 */
const BUCKETS = 4;
const WINDOWS_PER_BUCKET = TOTAL_WINDOWS / BUCKETS; // 25
/** 末桶均摊耗时相对首桶的容忍倍数（线性 ≈1×；O(n²) ≈7×，3× 居中区分）。 */
const AMORTIZED_RATIO_LIMIT = 3;

const SESSION_ID = 'perf-session';
const PROJECT_ID = 'perf-project';
const RUN_ID = 'run-1';

/** 生成一段可区分的等长 delta（序号嵌入正文，避免重复同引用字符串）。 */
function makeSegment(index: number): string {
  const head = `s${index % 10_000}-`;
  return head + 'x'.repeat(SEGMENT_CHARS - head.length);
}

/** 构造 running 态单元（React 树外、零句柄——partial 照常累积，T-U2 路径）。 */
function createRunningUnit(): SessionStreamUnit {
  const unit = new SessionStreamUnit({sessionId: SESSION_ID, projectId: PROJECT_ID});
  expect(unit.begin()).toBe(true);
  expect(unit.markRunning(RUN_ID)).toBe(true);
  return unit;
}

describe('SessionStreamUnit partial 数组化性能护栏（T-N5）', () => {
  beforeEach(() => {
    // performance/hrtime 保持真实：分桶耗时需要真实计时；定时器 fake 化驱动节拍。
    jest.useFakeTimers({doNotFake: ['performance', 'hrtime']});
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('T-N5-UNIT-LINEAR：10 万字符模拟流的累积+快照读取耗时曲线线性（末桶均摊 ≤ 首桶 × 3）', () => {
    const unit = createRunningUnit();

    const segments: string[] = new Array(TOTAL_SEGMENTS);
    for (let i = 0; i < TOTAL_SEGMENTS; i++) {
      segments[i] = makeSegment(i);
    }

    const bucketMs: number[] = [];
    let segIndex = 0;
    for (let bucket = 0; bucket < BUCKETS; bucket++) {
      const start = performance.now();
      for (let w = 0; w < WINDOWS_PER_BUCKET; w++) {
        for (let s = 0; s < SEGMENTS_PER_WINDOW; s++) {
          expect(unit.ingestTextDelta(RUN_ID, segments[segIndex])).toBe(true);
          segIndex++;
          // 模拟 manager 的 appendWritethroughSnapshot：逐 delta 事件读快照。
          // dirty 缓存下同节拍多次读取共享一次 join——这是护栏要守住的路径。
          unit.snapshot();
        }
        // 推过 32ms ingress + 64ms apply（同步触发 applyStreamSegments）。
        jest.advanceTimersByTime(
          SESSION_STREAM_INGRESS_COALESCE_MS + SESSION_STREAM_APPLY_INTERVAL_MS,
        );
      }
      bucketMs.push(performance.now() - start);
    }

    const charsPerBucket = WINDOWS_PER_BUCKET * SEGMENTS_PER_WINDOW * SEGMENT_CHARS;
    const amortized = bucketMs.map(ms => ms / charsPerBucket);
    console.log(
      `T-N5-UNIT 分桶均摊耗时(ns/char)：${amortized
        .map(v => (v * 1e6).toFixed(2))
        .join(' / ')}`,
    );

    const first = amortized[0];
    const last = amortized[BUCKETS - 1];
    if (last > first * AMORTIZED_RATIO_LIMIT) {
      throw new Error(
        `累积耗时曲线疑似超线性：首桶均摊 ${(first * 1e6).toFixed(2)}ns/char，` +
          `末桶均摊 ${(last * 1e6).toFixed(2)}ns/char，比值 ${(last / first).toFixed(2)} 超过 ${AMORTIZED_RATIO_LIMIT}×`,
      );
    }

    // step 边界清零回归：冲刷后 partial 归空，新 step 从零累积。
    expect(unit.handleStepCommitted(RUN_ID)).toBe(true);
    const cleared = unit.snapshot();
    expect(cleared.partialText).toBe('');
    expect(cleared.partialThinking).toBe('');
    unit.destroy();
  });

  it('T-N5-UNIT-CORRECT：snapshot 物化结果与逐段 += 参照一致（text/thinking/水合回填）', () => {
    const unit = createRunningUnit();

    const segments: string[] = new Array(TOTAL_SEGMENTS);
    for (let i = 0; i < TOTAL_SEGMENTS; i++) {
      segments[i] = makeSegment(i);
    }

    let expectedText = '';
    let expectedThinking = '';
    let segIndex = 0;
    for (let w = 0; w < TOTAL_WINDOWS; w++) {
      for (let s = 0; s < SEGMENTS_PER_WINDOW; s++) {
        unit.ingestTextDelta(RUN_ID, segments[segIndex]);
        expectedText += segments[segIndex];
        segIndex++;
        if (segIndex % 3 === 0) {
          const thinkSeg =
            `t${segIndex}-` + 'y'.repeat(SEGMENT_CHARS - `t${segIndex}-`.length);
          unit.ingestThinkingDelta(RUN_ID, thinkSeg);
          expectedThinking += thinkSeg;
        }
      }
      jest.advanceTimersByTime(
        SESSION_STREAM_INGRESS_COALESCE_MS + SESSION_STREAM_APPLY_INTERVAL_MS,
      );
    }

    const snap = unit.snapshot();
    expect(snap.partialText.length).toBe(TOTAL_CHARS);
    expect(snap.partialText).toBe(expectedText);
    expect(snap.partialThinking).toBe(expectedThinking);
    unit.destroy();

    // 水合回填路径：回填字符串直接充当物化缓存，快照原样返回。
    const hydrated = new SessionStreamUnit({
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
    });
    expect(hydrated.settleAsInterrupted()).toBe(true);
    expect(
      hydrated.hydrateFromRunState({
        runId: RUN_ID,
        startedAtMs: 0,
        settledAtMs: 1,
        metrics: {
          textChars: TOTAL_CHARS,
          thinkingChars: 0,
          completionTokens: 0,
          tokenSource: 'heuristic',
        },
        partialText: expectedText,
        partialThinking: '',
        pendingChildren: [],
      }),
    ).toBe(true);
    expect(hydrated.snapshot().partialText).toBe(expectedText);
    hydrated.destroy();
  });

  it('T-N5-UNIT-MATERIALIZE-ONCE：同一节拍内多次 snapshot 共享一次物化（dirty 缓存）', () => {
    const unit = createRunningUnit();
    // 预置 2.5 万字符（首桶量级），物化一次。
    const chunk = 'x'.repeat(25_000);
    unit.ingestTextDelta(RUN_ID, chunk);
    jest.advanceTimersByTime(
      SESSION_STREAM_INGRESS_COALESCE_MS + SESSION_STREAM_APPLY_INTERVAL_MS,
    );
    expect(unit.snapshot().partialText).toBe(chunk);

    // 同节拍内（未再置脏）连续读快照：边际成本应为常量（缓存直读）。
    const reads = 5_000;
    const start = performance.now();
    for (let i = 0; i < reads; i++) {
      unit.snapshot();
    }
    const elapsed = performance.now() - start;
    // 5000 次全量快照读取的总额预算：每次含对象构造 + 缓存直读，均摊远低于
    // 一次 25k 字符 join；若每次读取都重新 join（缓存失效），5000×25k =
    // 1.25 亿字符的 join 远超预算。
    expect(elapsed).toBeLessThan(500);
    expect(unit.snapshot().partialText).toBe(chunk);
    unit.destroy();
  });
});

/**
 * T-M：流式指标按会话归属存储（stream-metrics-store）。
 *
 * 背景（真机双症状）：旧实现是绑在 provider 上的单例累加器，切会话只靠
 * running 翻转碰运气重置（React 批处理常把翻转塌掉）——统计条串到别的
 * 会话的字数；重进运行中会话从零计时。
 *
 * 用户拍板语义：新 run 开始 → 重置该会话指标；终止/结束 → 冻结为该会话
 * 「上次生成」；切会话/重进 → 只换看哪份，不重置；重进运行中会话显示
 * 真实历时（startedAtMs 连续）。
 */
import {
  __resetStreamMetricsStoreForTests,
  finishRun,
  getLastRunMetrics,
  getLiveMetrics,
  noteRunStarted,
  noteTextDelta,
  noteThinkingDelta,
} from '../src/services/stream-metrics-store';

describe('T-M: 流式指标会话归属存储', () => {
  beforeEach(() => {
    __resetStreamMetricsStoreForTests();
  });

  it('新 run 重置该会话指标；同一 runId 的重复 STARTED（回填）不重置', () => {
    noteRunStarted('s1', 'r1');
    noteTextDelta('s1', 'r1', 100);
    noteThinkingDelta('s1', 'r1', 50);
    // 回填：同一 run 再次 STARTED（真机日志常见双发）
    noteRunStarted('s1', 'r1');
    expect(getLiveMetrics('s1').textChars).toBe(100);

    // 新 run（不同 runId）→ 重置
    noteRunStarted('s1', 'r2');
    const live = getLiveMetrics('s1');
    expect(live.textChars).toBe(0);
    expect(live.thinkingChars).toBe(0);
    expect(live.runId).toBe('r2');
    expect(live.startedAtMs).toBeGreaterThan(0);
  });

  it('增量按 sessionId 归账，会话间互不污染（切会话不串字数）', () => {
    noteRunStarted('sA', 'rA');
    noteRunStarted('sB', 'rB');
    // 看着 B 时 A 的增量照样记到 A 头上（归账与展示绑定解耦）
    noteTextDelta('sA', 'rA', 450);
    noteTextDelta('sB', 'rB', 30);
    expect(getLiveMetrics('sA').textChars).toBe(450);
    expect(getLiveMetrics('sB').textChars).toBe(30);
  });

  it('runId 不符的增量（陈旧事件）忽略', () => {
    noteRunStarted('s1', 'r2');
    noteTextDelta('s1', 'r1', 999);
    expect(getLiveMetrics('s1').textChars).toBe(0);
  });

  it('finish 冻结为该会话上次生成；runId 不符时不动（保护新 run）', () => {
    noteRunStarted('s1', 'r1');
    noteTextDelta('s1', 'r1', 200);
    noteThinkingDelta('s1', 'r1', 80);

    finishRun('s1', 'r0'); // 陈旧 finish：不生效
    expect(getLiveMetrics('s1').textChars).toBe(200);
    expect(getLastRunMetrics('s1')).toBeNull();

    finishRun('s1', 'r1');
    const last = getLastRunMetrics('s1');
    expect(last?.textChars).toBe(200);
    expect(last?.thinkingChars).toBe(80);
    expect(last?.elapsedMs).toBeGreaterThanOrEqual(0);
    // live 清空
    expect(getLiveMetrics('s1').startedAtMs).toBe(0);
  });

  it('重进运行中会话：startedAtMs 保持 run 开始时刻（连续计时，不从零）', async () => {
    noteRunStarted('s1', 'r1');
    const startedAt = getLiveMetrics('s1').startedAtMs;
    await new Promise(resolve => setTimeout(resolve, 30));
    // 会话切换/重进不触发任何 store API——时刻不变
    expect(getLiveMetrics('s1').startedAtMs).toBe(startedAt);
  });
});

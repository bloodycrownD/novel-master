/**
 * ChatStreamMetricsBarLive 双源数据测试（cr-func MF-2）：
 * - 重启水合的 interrupted 单元常驻（agentRunning=false、无 settled 投影）：
 *   快照优先——指标条显示恢复的冻结历时/字数（PRD「杀进程重进……指标恢复」）；
 * - starting 阶段被杀的 interrupted（计时与字数皆零）：无内容不显示空指标条；
 * - 无单元（宽限销毁后）：退 manager 级 settled 投影「上次生成」不断源；
 * - 活跃 run：快照 live 计时显示「生成中」（既有行为不回归）。
 * - metric-detail-sheet：指标条 onPress 打开用量 sheet（visible 翻真自取），
 *   弹窗状态独立于 250ms tick（metrics props 引用不随弹窗开关变化）。
 */
import React from 'react';
import {afterEach, beforeEach, describe, expect, it, jest} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {Text} from 'react-native';
import {SimpleEventBus} from '@novel-master/core/events';
import {
  EVENT_AGENT_RUN_FINISHED,
  EVENT_AGENT_RUN_STARTED,
  EVENT_AGENT_STREAM_TEXT_DELTA,
  EVENT_AGENT_STREAM_USAGE,
} from '@novel-master/core/events';
import {setMobileAgentActive} from '@/runtime/agent-activity';
import {SessionStreamUnitManager} from '@/services/session-stream-unit-manager.service';

const mockRunAgentTurn = jest.fn(
  () => new Promise(() => undefined) as Promise<unknown>,
);

let mockManager: SessionStreamUnitManager | undefined;
/** MetricDetailSheet 经 useRuntime().usageStats 自取（弹窗用例注入 stub）。 */
const mockGetSessionUsageDetail = jest.fn();

jest.mock('../src/hooks/useRuntime', () => ({
  useRuntime: () => ({
    sessionStreamUnitManager: mockManager,
    usageStats: {getSessionUsageDetail: mockGetSessionUsageDetail},
  }),
}));

jest.mock('../src/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {bgSecondary: '#111', textSecondary: '#ccc'},
  }),
}));

// AppModal 走 RN 原生 Modal，jest 环境渲染不出内容，换透传 View
// （metric-detail-sheet 的 sheet 用例需要，范式同 directory-rule-sheet.test）。
jest.mock('../src/components/ui/AppModal', () => {
  const mockReact = require('react');
  return {
    AppModal: ({
      children,
      visible,
    }: {
      children?: React.ReactNode;
      visible?: boolean;
    }) =>
      visible
        ? mockReact.createElement('View', {testID: 'app-modal'}, children)
        : null,
  };
});

// eslint-disable-next-line import/first
import {ChatStreamMetricsBarLive} from '../src/components/chat/ChatStreamMetricsBarLive';
// eslint-disable-next-line import/first
import {ChatStreamMetricsBar} from '../src/components/chat/ChatStreamMetricsBar';

function buildHarness(): {
  manager: SessionStreamUnitManager;
  eventBus: SimpleEventBus;
} {
  const eventBus = new SimpleEventBus();
  const manager = new SessionStreamUnitManager({
    runtime: {
      eventBus,
      abortRegistry: {has: () => false, abort: jest.fn()},
      sessions: {get: async () => ({id: 's1', title: '会话'})},
      projects: {get: async () => ({id: 'p1', name: '项目'})},
      messages: {
        listBySessionTail: jest.fn(async () => []),
        listBySessionPage: jest.fn(async () => []),
      },
    } as never,
    runAgentTurn: mockRunAgentTurn as never,
  });
  manager.markHydrated();
  return {manager, eventBus};
}

/** 挂载指标条并读取其全部文案（含 Step 7 中断徽标；无 Text 节点返回 null）。 */
function renderMetricsLine(
  agentRunning: boolean,
  sessionId: string,
): string | null {
  let tree: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <ChatStreamMetricsBarLive
        agentRunning={agentRunning}
        sessionId={sessionId}
      />,
    );
  });
  const textNodes = tree!.root.findAllByType(Text);
  const line =
    textNodes.length > 0
      ? textNodes.map(node => String(node.props.children)).join(' | ')
      : null;
  act(() => {
    tree!.unmount();
  });
  return line;
}

describe('ChatStreamMetricsBarLive 双源（快照优先 / settled 投影兜底）', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    setMobileAgentActive(false);
    mockRunAgentTurn.mockClear();
  });

  afterEach(() => {
    mockManager?.dispose();
    mockManager = undefined;
    mockGetSessionUsageDetail.mockClear();
    jest.useRealTimers();
    setMobileAgentActive(false);
  });

  it('水合 interrupted 单元：显示恢复的冻结历时与字数（无 settled 投影可退）', () => {
    const h = buildHarness();
    mockManager = h.manager;
    // 重启水合现场：run 被杀时持久层只有 running 行——水合建 interrupted
    // 单元（agentRunning=false），settled 投影不存在。
    const unit = mockManager.adoptInterruptedUnit('s1', 'p1');
    unit.hydrateFromRunState({
      runId: 'run-old',
      startedAtMs: 2_000,
      settledAtMs: 5_000,
      metrics: {
        textChars: 123,
        thinkingChars: 45,
        completionTokens: 88,
        tokenSource: 'usage',
      },
      partialText: '中断正文',
      partialThinking: '',
      pendingChildren: [],
    });
    expect(mockManager.getSettledProjection('s1')).toBe(null);

    const line = renderMetricsLine(false, 's1');
    // Step 7 中断正面标识：interrupted 冻结指标前带「已中断」徽标。
    expect(line).toContain('已中断');
    expect(line).toContain('上次生成');
    expect(line).toContain('3.0s'); // 冻结历时 = 5000 - 2000
    // T-M6/T-M8：中断现场恢复 token 数与 source（水合后 token 不归零）。
    expect(line).toContain('输出 88 t');
  });

  it('starting 阶段被杀的 interrupted（计时与字数皆零）：不显示空指标条', () => {
    const h = buildHarness();
    mockManager = h.manager;
    const unit = mockManager.adoptInterruptedUnit('s1', 'p1');
    unit.hydrateFromRunState({
      runId: '',
      startedAtMs: 0,
      settledAtMs: 5_000,
      metrics: {
        textChars: 0,
        thinkingChars: 0,
        completionTokens: 0,
        tokenSource: 'heuristic',
      },
      partialText: '',
      partialThinking: '',
      pendingChildren: [],
    });

    expect(renderMetricsLine(false, 's1')).toBe(null);
  });

  it('无单元（宽限销毁后）：退 settled 投影显示「上次生成」', () => {
    const h = buildHarness();
    mockManager = h.manager;
    mockManager.startRun('s1', 'p1', 'hi');
    h.eventBus.publish(EVENT_AGENT_RUN_STARTED, {
      sessionId: 's1',
      projectId: 'p1',
      runId: 'r1',
    });
    h.eventBus.publish(EVENT_AGENT_STREAM_TEXT_DELTA, {
      sessionId: 's1',
      runId: 'r1',
      text: 'abcde',
    });
    act(() => {
      jest.advanceTimersByTime(96 + 1_000);
    });
    h.eventBus.publish(EVENT_AGENT_RUN_FINISHED, {
      sessionId: 's1',
      projectId: 'p1',
      runId: 'r1',
      stopReason: 'end_turn',
    } as never);
    // 宽限到期：单元销毁出表，settled 投影常驻兜底。
    act(() => {
      jest.advanceTimersByTime(30_000);
    });
    expect(mockManager.snapshot('s1')).toBe(null);
    expect(mockManager.getSettledProjection('s1')).not.toBe(null);

    const line = renderMetricsLine(false, 's1');
    expect(line).toContain('上次生成');
    // 5 字符 heuristic 折算 ceil(5/3.35)=2：settled 投影带 token 冻结值。
    expect(line).toContain('输出 2 t');
    expect(line).not.toContain('0.0s'); // 历时 ≥ 1096ms，非零起点
  });

  it('冻结态显示末值速率段（「上次生成 … · N t/s」）', () => {
    const h = buildHarness();
    mockManager = h.manager;
    mockManager.startRun('s1', 'p1', 'hi');
    h.eventBus.publish(EVENT_AGENT_RUN_STARTED, {
      sessionId: 's1',
      projectId: 'p1',
      runId: 'r1',
    });
    for (let i = 0; i < 6; i += 1) {
      h.eventBus.publish(EVENT_AGENT_STREAM_TEXT_DELTA, {
        sessionId: 's1',
        runId: 'r1',
        text: 'x'.repeat(50),
      });
      act(() => {
        jest.advanceTimersByTime(250);
      });
    }
    h.eventBus.publish(EVENT_AGENT_RUN_FINISHED, {
      sessionId: 's1',
      projectId: 'p1',
      runId: 'r1',
      stopReason: 'end_turn',
    } as never);

    const line = renderMetricsLine(false, 's1');
    expect(line).toContain('上次生成');
    expect(line).toContain('输出 90 t'); // ceil(300/3.35)
    // 末值速率段（此前冻结态整段省略）：有样本即显示，且不是衰减后的零头。
    expect(line).toMatch(/\d+(\.\d)? t\/s/);
    expect(line).not.toMatch(/(^| )0 t\/s/);
  });

  it('活跃 run：快照 live 计时显示「生成中」（agentRunning=true）', () => {
    const h = buildHarness();
    mockManager = h.manager;
    mockManager.startRun('s1', 'p1', 'hi');
    h.eventBus.publish(EVENT_AGENT_RUN_STARTED, {
      sessionId: 's1',
      projectId: 'p1',
      runId: 'r1',
    });
    h.eventBus.publish(EVENT_AGENT_STREAM_TEXT_DELTA, {
      sessionId: 's1',
      runId: 'r1',
      text: 'abcde',
    });
    act(() => {
      jest.advanceTimersByTime(96);
    });

    const line = renderMetricsLine(true, 's1');
    expect(line).toContain('生成中');
    // 5 字符 heuristic 折算 ceil(5/3.35)=2（首秒样本不足省略速率段）。
    expect(line).toContain('输出 2 t');
  });

  it('无单元且无 settled 投影：不渲染指标条', () => {
    const h = buildHarness();
    mockManager = h.manager;
    expect(renderMetricsLine(false, 's1')).toBe(null);
  });

  it('T-M10: heuristic→usage 覆盖瞬间滑窗重 seed，速率无尖刺', () => {
    const h = buildHarness();
    mockManager = h.manager;
    mockManager.startRun('s1', 'p1', 'hi');
    h.eventBus.publish(EVENT_AGENT_RUN_STARTED, {
      sessionId: 's1',
      projectId: 'p1',
      runId: 'r1',
    });

    let tree!: TestRenderer.ReactTestRenderer;
    const readLine = (): string | null => {
      const textNodes = tree.root.findAllByType(Text);
      return textNodes.length > 0
        ? textNodes.map(node => String(node.props.children)).join(' | ')
        : null;
    };

    act(() => {
      tree = TestRenderer.create(
        <ChatStreamMetricsBarLive agentRunning={true} sessionId="s1" />,
      );
    });

    // heuristic 阶段：慢速积累（每秒 ~3 字符 ≈ 1 t）。
    for (let i = 0; i < 6; i += 1) {
      h.eventBus.publish(EVENT_AGENT_STREAM_TEXT_DELTA, {
        sessionId: 's1',
        runId: 'r1',
        text: 'abc',
      });
      act(() => {
        jest.advanceTimersByTime(1_000);
      });
    }
    const beforeCorrection = readLine();
    expect(beforeCorrection).toContain('生成中');
    expect(beforeCorrection).toContain('输出 6 t'); // ceil(18/3.35)

    // usage 校正：真值跳变到 1200（中文低估约半的典型幅度）。
    h.eventBus.publish(EVENT_AGENT_STREAM_USAGE, {
      sessionId: 's1',
      runId: 'r1',
      completionTokens: 1_200,
      source: 'usage',
    });
    act(() => {
      jest.advanceTimersByTime(500);
    });
    const atCorrection = readLine();
    expect(atCorrection).toContain('输出 1,200 t');
    // 重 seed 后窗口仅 1 个样本：速率段省略（绝无 4800 t/s 之类的尖刺数字）。
    expect(atCorrection).not.toMatch(/\d+ t\/s/);

    // 校正后从真值起算：继续 usage 递增，速率回到平滑小值。
    h.eventBus.publish(EVENT_AGENT_STREAM_USAGE, {
      sessionId: 's1',
      runId: 'r1',
      completionTokens: 1_206,
      source: 'usage',
    });
    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    const afterRecovery = readLine();
    expect(afterRecovery).toMatch(/输出 1,206 t/);
    expect(afterRecovery).not.toMatch(/\d{3,} t\/s/); // 无三位数以上尖刺

    act(() => {
      tree.unmount();
    });
  });

  it('metric-detail-sheet：onPress 打开用量 sheet（按 sessionId 自取）；弹窗开关不改指标条 metrics props 引用', async () => {
    const h = buildHarness();
    mockManager = h.manager;
    // 冻结指标现场（settled 投影兜底也行，这里用快照优先路径）。
    const unit = mockManager.adoptInterruptedUnit('s1', 'p1');
    unit.hydrateFromRunState({
      runId: 'run-old',
      startedAtMs: 2_000,
      settledAtMs: 5_000,
      metrics: {
        textChars: 10,
        thinkingChars: 0,
        completionTokens: 8,
        tokenSource: 'usage',
      },
      partialText: 'x',
      partialThinking: '',
      pendingChildren: [],
    });
    mockGetSessionUsageDetail.mockResolvedValue({
      last: {
        seq: 3,
        modelName: 'claude-x',
        provider: 'anthropic',
        promptTokens: 100,
        completionTokens: 40,
        cacheReadTokens: 2048,
        cacheCreationTokens: null,
        atMs: 1,
      },
      totals: {
        promptTokens: 300,
        completionTokens: 80,
        cacheReadTokens: 2048,
        cacheCreationTokens: 512,
        billedInputTokens: 2860,
        assistantRows: 3,
      },
      visibleMessageCount: 5,
      toolUseCount: 2,
    });

    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <ChatStreamMetricsBarLive agentRunning={false} sessionId="s1" />,
      );
    });
    const barBefore = tree.root.findByType(ChatStreamMetricsBar);
    const metricsBefore = barBefore.props.metrics;
    // 打开前 sheet 不可见（AppModal mock visible=false 渲 null，无取数）。
    expect(mockGetSessionUsageDetail).not.toHaveBeenCalled();

    await act(async () => {
      barBefore.props.onPress();
    });
    // sheet 打开：按 Live 层的 sessionId 自取并渲染两段内容。
    expect(mockGetSessionUsageDetail).toHaveBeenCalledWith('s1');
    const texts = tree.root
      .findAllByType(Text)
      .map(node => String(node.props.children));
    expect(texts.join()).toContain('用量详情');
    expect(texts.join()).toContain('claude-x');
    // 指标条 metrics props 值未变（弹窗状态独立 state，不进 metrics 快照；
    // 引用每帧重建是 Live 既有行为——250ms tick 亦然，隔离语义取值相等）。
    const barAfter = tree.root.findByType(ChatStreamMetricsBar);
    expect(barAfter.props.metrics).toStrictEqual(metricsBefore);
    expect(barAfter.props.interrupted).toBe(true);

    act(() => {
      tree.unmount();
    });
  });
});

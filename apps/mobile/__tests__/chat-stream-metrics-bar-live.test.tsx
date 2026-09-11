/**
 * ChatStreamMetricsBarLive 双源数据测试（cr-func MF-2）：
 * - 重启水合的 interrupted 单元常驻（agentRunning=false、无 settled 投影）：
 *   快照优先——指标条显示恢复的冻结历时/字数（PRD「杀进程重进……指标恢复」）；
 * - starting 阶段被杀的 interrupted（计时与字数皆零）：无内容不显示空指标条；
 * - 无单元（宽限销毁后）：退 manager 级 settled 投影「上次生成」不断源；
 * - 活跃 run：快照 live 计时显示「生成中」（既有行为不回归）。
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
} from '@novel-master/core/events';
import {setMobileAgentActive} from '@/runtime/agent-activity';
import {SessionStreamUnitManager} from '@/services/session-stream-unit-manager.service';

const mockRunAgentTurn = jest.fn(
  () => new Promise(() => undefined) as Promise<unknown>,
);

let mockManager: SessionStreamUnitManager | undefined;

jest.mock('../src/hooks/useRuntime', () => ({
  useRuntime: () => ({sessionStreamUnitManager: mockManager}),
}));

jest.mock('../src/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {bgSecondary: '#111', textSecondary: '#ccc'},
  }),
}));

// eslint-disable-next-line import/first
import {ChatStreamMetricsBarLive} from '../src/components/chat/ChatStreamMetricsBarLive';

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

/** 挂载指标条并读取其文案行（metrics 为 null 时无 Text 节点，返回 null）。 */
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
    textNodes.length > 0 ? String(textNodes[0]!.props.children) : null;
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
      metrics: {textChars: 123, thinkingChars: 45},
      partialText: '中断正文',
      partialThinking: '',
      pendingChildren: [],
    });
    expect(mockManager.getSettledProjection('s1')).toBe(null);

    const line = renderMetricsLine(false, 's1');
    expect(line).toContain('上次生成');
    expect(line).toContain('3.0s'); // 冻结历时 = 5000 - 2000
    expect(line).toContain('正文 123 字');
    expect(line).toContain('思考 45 字');
  });

  it('starting 阶段被杀的 interrupted（计时与字数皆零）：不显示空指标条', () => {
    const h = buildHarness();
    mockManager = h.manager;
    const unit = mockManager.adoptInterruptedUnit('s1', 'p1');
    unit.hydrateFromRunState({
      runId: '',
      startedAtMs: 0,
      settledAtMs: 5_000,
      metrics: {textChars: 0, thinkingChars: 0},
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
    expect(line).toContain('正文 5 字');
    expect(line).not.toContain('0.0s'); // 历时 ≥ 1096ms，非零起点
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
    expect(line).toContain('正文 5 字');
  });

  it('无单元且无 settled 投影：不渲染指标条', () => {
    const h = buildHarness();
    mockManager = h.manager;
    expect(renderMetricsLine(false, 's1')).toBe(null);
  });
});

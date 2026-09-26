/**
 * 子会话屏（SubagentSessionScreen）指标条渲染护栏（cr-fix-spec
 * mobile-metrics/G-2）：7a63a779 新增的子会话指标条此前零测试。
 *
 * 三态覆盖：
 * - 活跃：消费型单元的 running 快照 → 「生成中」；
 * - 终态：FINISHED 收尾后的冻结快照 → 「上次生成 · 历时 · 输出 N t · N t/s」；
 * - 中断：水合 interrupted 单元 → 「已中断」在屏上**只出现一次**
 *   （cr-fix-spec mobile-metrics/C-4：指标条能显示时不再叠屏级横幅；
 *   指标条不可见时由横幅兜底，仍是单标识）。
 *
 * 屏幕的 webview 与中断注入 hook 在此套件只作哑元（本用例只锁指标条
 * 屏级装配，不重复 webview 引擎的既有覆盖）。
 *
 * @module test/subagent-session-screen-metrics
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

const CHILD_SESSION_ID = 'child-1';

let mockManager: SessionStreamUnitManager | undefined;
let mockRuntime: unknown;

jest.mock('../src/hooks/useRuntime', () => ({
  useRuntime: () => mockRuntime,
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({navigate: jest.fn(), setOptions: jest.fn()}),
  useRoute: () => ({
    params: {
      projectId: 'p1',
      sessionId: 'child-1',
      parentSessionId: 's1',
    },
  }),
}));

jest.mock('../src/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#000',
      textSecondary: '#ccc',
      danger: '#f00',
      border: '#222',
    },
  }),
}));

jest.mock('../src/components/chrome/ToastHost', () => ({
  useToast: () => ({showToast: jest.fn()}),
}));

jest.mock('../src/runtime/novel-master-context', () => ({
  useNovelMaster: () => ({appUi: null}),
}));

// 指标条链路之外的哑元：webview 引擎与中断注入 hook 不属本套件覆盖面。
// 工厂内 require（jest.mock 提升到 import 之前，工厂引用模块级绑定会报
// "Invalid variable access"）。
jest.mock('../src/components/chat/ChatTranscriptWebView', () => {
  const ReactModule = require('react');
  return {ChatTranscriptWebView: ReactModule.forwardRef(() => null)};
});

jest.mock('../src/screens/tabs/chat-tab/useInterruptedPartialCommit', () => ({
  useInterruptedPartialCommit: jest.fn(),
}));

import {SubagentSessionScreen} from '../src/screens/stack/SubagentSessionScreen';

function buildHarness(): {
  manager: SessionStreamUnitManager;
  eventBus: SimpleEventBus;
} {
  const eventBus = new SimpleEventBus();
  const manager = new SessionStreamUnitManager({
    runtime: {
      eventBus,
      abortRegistry: {has: () => false, abort: jest.fn()},
      sessions: {get: async () => ({id: CHILD_SESSION_ID, title: '子会话'})},
      projects: {get: async () => ({id: 'p1', name: '项目'})},
      messages: {
        listBySession: jest.fn(async () => []),
        listBySessionTail: jest.fn(async () => []),
        listBySessionPage: jest.fn(async () => []),
      },
    } as never,
    settledGraceMs: 30_000,
    runAgentTurn: jest.fn() as never,
  });
  manager.markHydrated();
  return {manager, eventBus};
}

/** 挂载子会话屏并收集全部 Text 文案（异步水合 flush 后返回）。 */
async function renderScreen(): Promise<{
  texts: string[];
  unmount: () => void;
}> {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<SubagentSessionScreen />);
  });
  const texts = tree.root
    .findAllByType(Text)
    .map(node =>
      Array.isArray(node.props.children)
        ? node.props.children.join('')
        : String(node.props.children),
    );
  return {
    texts,
    unmount: () => {
      act(() => {
        tree.unmount();
      });
    },
  };
}

/** 某段文案在屏上出现的次数（C-4 的单标识断言用）。 */
function countText(texts: string[], target: string): number {
  return texts.filter(text => text === target).length;
}

/** 推进消费型 run：RUN_STARTED + 若干带间隔的 delta。 */
function driveConsumptiveRun(eventBus: SimpleEventBus, deltaCount = 6): void {
  eventBus.publish(EVENT_AGENT_RUN_STARTED, {
    sessionId: CHILD_SESSION_ID,
    projectId: 'p1',
    runId: 'rc',
  });
  for (let i = 0; i < deltaCount; i += 1) {
    eventBus.publish(EVENT_AGENT_STREAM_TEXT_DELTA, {
      sessionId: CHILD_SESSION_ID,
      runId: 'rc',
      text: 'x'.repeat(50),
    });
    jest.advanceTimersByTime(250);
  }
}

function finishRun(eventBus: SimpleEventBus): void {
  eventBus.publish(EVENT_AGENT_RUN_FINISHED, {
    sessionId: CHILD_SESSION_ID,
    projectId: 'p1',
    runId: 'rc',
    stopReason: 'end_turn',
  } as never);
}

describe('SubagentSessionScreen 指标条渲染（G-2）', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    setMobileAgentActive(false);
  });

  afterEach(() => {
    mockManager?.dispose();
    mockManager = undefined;
    mockRuntime = undefined;
    jest.useRealTimers();
    setMobileAgentActive(false);
  });

  it('活跃：消费型 run 运行中显示「生成中 · 输出 N t」', async () => {
    const h = buildHarness();
    mockManager = h.manager;
    mockRuntime = {sessionStreamUnitManager: h.manager};
    driveConsumptiveRun(h.eventBus, 3);

    const {texts, unmount} = await renderScreen();
    expect(texts.join(' | ')).toContain('生成中');
    // 3 × 50 字符 heuristic 折算 ceil(150/3.35)=45。
    expect(texts.join(' | ')).toContain('输出 45 t');
    expect(texts.join(' | ')).not.toContain('上次生成');
    unmount();
  });

  it('终态：FINISHED 后冻结为「上次生成 · 历时 · 输出 N t · N t/s」', async () => {
    const h = buildHarness();
    mockManager = h.manager;
    mockRuntime = {sessionStreamUnitManager: h.manager};
    driveConsumptiveRun(h.eventBus, 6);
    finishRun(h.eventBus);

    const {texts, unmount} = await renderScreen();
    const line = texts.join(' | ');
    expect(line).toContain('上次生成');
    expect(line).toContain('输出 90 t'); // ceil(300/3.35)
    expect(line).toMatch(/\d+(\.\d)? t\/s/);
    expect(line).not.toContain('生成中');
    unmount();
  });

  it('中断（指标条可见）：「已中断」只在条上出现一次（不叠屏级横幅）', async () => {
    const h = buildHarness();
    mockManager = h.manager;
    mockRuntime = {sessionStreamUnitManager: h.manager};
    // 重启水合现场：run 被杀 → interrupted 单元（常驻，无 settled 投影）。
    const unit = h.manager.adoptInterruptedUnit(CHILD_SESSION_ID, 'p1');
    unit.hydrateFromRunState({
      runId: 'rc-old',
      startedAtMs: 1_000,
      settledAtMs: 4_000,
      metrics: {
        textChars: 100,
        thinkingChars: 0,
        completionTokens: 30,
        tokenSource: 'usage',
      },
      partialText: '中断正文',
      partialThinking: '',
      pendingChildren: [],
    });

    const {texts, unmount} = await renderScreen();
    // C-4：屏级横幅与指标条徽标不再同时出现——「已中断」恰好一次。
    expect(countText(texts, '已中断')).toBe(1);
    expect(texts.join(' | ')).toContain('上次生成');
    expect(texts.join(' | ')).toContain('输出 30 t');
    unmount();
  });

  it('中断（指标条不可见）：「已中断」由屏级横幅兜底，仍是单标识', async () => {
    const h = buildHarness();
    mockManager = h.manager;
    mockRuntime = {sessionStreamUnitManager: h.manager};
    // starting 阶段被杀：起点与指标皆零 → 指标条全零守卫不渲染。
    const unit = h.manager.adoptInterruptedUnit(CHILD_SESSION_ID, 'p1');
    unit.hydrateFromRunState({
      runId: '',
      startedAtMs: 0,
      settledAtMs: 4_000,
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

    const {texts, unmount} = await renderScreen();
    expect(countText(texts, '已中断')).toBe(1);
    expect(texts.join(' | ')).not.toContain('上次生成');
    unmount();
  });
});

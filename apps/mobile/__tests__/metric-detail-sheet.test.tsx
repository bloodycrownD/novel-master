/**
 * MetricDetailSheet（mobile，metric-detail-sheet Step 4，T-MD5）：
 * - 打开自取：visible 翻真调 runtime.usageStats.getSessionUsageDetail(sessionId)，
 *   加载态「加载中…」→ 数据落地渲染两段（最近请求 / 会话累计）+ 口径脚注；
 * - cache_creation 缺失（协议无此概念）显示「—」；命中率复用统计页公式；
 * - 空态：last/totals 为 null 出占位行；
 * - 「上下文占用」行直渲染传入的 contextTokenLabel（与 chip 同源，不取新数）；
 * - visible=false 不触取数。
 *
 * mock 范式照 directory-rule-sheet.test.tsx（AppModal 换透传 View）；
 * useRuntime 定向 stub usageStats。
 *
 * @module test/metric-detail-sheet
 */
import React from 'react';
import {describe, expect, it, jest} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {Text} from 'react-native';
import type {SessionUsageDetail} from '@novel-master/core/chat';

const mockGetSessionUsageDetail = jest.fn();

jest.mock('@/hooks/useRuntime', () => ({
  useRuntime: () => ({
    usageStats: {getSessionUsageDetail: mockGetSessionUsageDetail},
  }),
}));

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#fff',
      bgSecondary: '#eee',
      surface: '#f8f8f8',
      surfaceElevated: '#f0f0f0',
      text: '#111',
      textSecondary: '#666',
      textTertiary: '#999',
      border: '#ccc',
      primary: '#007aff',
      danger: '#f00',
    },
  }),
}));

// AppModal 走 RN 原生 Modal，jest 环境渲染不出内容，换透传 View。
jest.mock('@/components/ui/AppModal', () => {
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
import {MetricDetailSheet} from '@/components/sheet/MetricDetailSheet';
// eslint-disable-next-line import/first
import {ChatStreamMetricsBar} from '@/components/chat/ChatStreamMetricsBar';

/** 与 AgentStreamMetricsView 同构的最小指标（文案可渲染即可）。 */
const METRICS = {
  running: false,
  elapsedMs: 1500,
  completionTokens: 10,
  tokenSource: 'usage' as const,
  tokensPerSecond: null,
};

const DETAIL: SessionUsageDetail = {
  last: {
    seq: 7,
    modelName: 'claude-x',
    provider: 'anthropic',
    promptTokens: 1000,
    completionTokens: 4200,
    cacheReadTokens: 2048,
    // 协议缺失（openai/gemini 类）→ 展示「—」
    cacheCreationTokens: null,
    atMs: 1_800_000_000_000,
  },
  totals: {
    promptTokens: 12_000,
    completionTokens: 8000,
    cacheReadTokens: 2048,
    cacheCreationTokens: 512,
    billedInputTokens: 3600,
    assistantRows: 6,
  },
  visibleMessageCount: 11,
  toolUseCount: 4,
};

/** 渲染 sheet 并 flush 异步取数，返回文案全集与 unmount。 */
async function renderSheet(
  props: Partial<React.ComponentProps<typeof MetricDetailSheet>> = {}
): Promise<{texts: string[]; tree: TestRenderer.ReactTestRenderer}> {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(
      <MetricDetailSheet
        visible
        sessionId="s1"
        contextTokenLabel="远程 = 24k / 128k (19%)"
        onClose={jest.fn()}
        {...props}
      />
    );
  });
  const texts = tree.root
    .findAllByType(Text)
    .map(node =>
      Array.isArray(node.props.children)
        ? node.props.children.join('')
        : String(node.props.children),
    );
  return {texts, tree};
}

describe('MetricDetailSheet (mobile) — 打开自取与两段渲染', () => {
  it('visible 翻真时按 sessionId 自取一次，渲染最近请求段（cache_creation 缺失出「—」）', async () => {
    mockGetSessionUsageDetail.mockResolvedValue(DETAIL);
    const {texts} = await renderSheet();
    expect(mockGetSessionUsageDetail).toHaveBeenCalledWith('s1');
    expect(mockGetSessionUsageDetail).toHaveBeenCalledTimes(1);
    const line = texts.join('');
    expect(line).toContain('用量详情');
    expect(line).toContain('claude-x');
    expect(line).toContain('输入');
    expect(line).toContain('缓存读取');
    // cache_creation 为 null：值列是「—」而非 0。
    expect(line).toContain('缓存写入—');
    // 命中率 = 2048 / (1000+2048) ≈ 67%（统计页同公式）。
    expect(line).toContain('缓存命中率67%');
  });

  it('会话累计段：可见消息数 / 工具调用 / 累计输入输出 + 口径脚注', async () => {
    mockGetSessionUsageDetail.mockResolvedValue(DETAIL);
    const {texts} = await renderSheet();
    const line = texts.join('');
    expect(line).toContain('消息数（可见）11');
    expect(line).toContain('工具调用4');
    expect(line).toContain('累计输入12K');
    expect(line).toContain('累计输出8K');
    expect(line).toContain('累计含隐藏消息 · 消息数为可见口径');
  });

  it('「上下文占用」行直渲染传入读数（与 chip 同源，不取新数）', async () => {
    mockGetSessionUsageDetail.mockResolvedValue(DETAIL);
    const {texts} = await renderSheet();
    expect(texts.join('')).toContain('上下文占用远程 = 24k / 128k (19%)');
  });

  it('空态：last/totals 为 null 时出占位行，contextTokenLabel 缺省出「—」', async () => {
    mockGetSessionUsageDetail.mockResolvedValue({
      last: null,
      totals: null,
      visibleMessageCount: 0,
      toolUseCount: 0,
    });
    const {texts} = await renderSheet({contextTokenLabel: undefined});
    const line = texts.join('');
    expect(line).toContain('暂无请求记录');
    expect(line).toContain('暂无累计数据');
    expect(line).toContain('上下文占用—');
  });

  it('加载态：promise 未落地时显示「加载中…」', async () => {
    let resolveDetail: (d: SessionUsageDetail) => void = () => undefined;
    mockGetSessionUsageDetail.mockImplementation(
      () =>
        new Promise<SessionUsageDetail>(resolve => {
          resolveDetail = resolve;
        })
    );
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <MetricDetailSheet
          visible
          sessionId="s1"
          onClose={jest.fn()}
        />
      );
    });
    const pendingTexts = tree.root
      .findAllByType(Text)
      .map(node => String(node.props.children));
    expect(pendingTexts.join()).toContain('加载中');
    await act(async () => {
      resolveDetail(DETAIL);
    });
    const readyTexts = tree.root
      .findAllByType(Text)
      .map(node => String(node.props.children));
    expect(readyTexts.join()).toContain('claude-x');
  });

  it('visible=false 不触取数', async () => {
    mockGetSessionUsageDetail.mockClear();
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <MetricDetailSheet visible={false} sessionId="s1" onClose={jest.fn()} />
      );
    });
    expect(mockGetSessionUsageDetail).not.toHaveBeenCalled();
    act(() => {
      tree.unmount();
    });
  });

  it('sheet 触发：指标条 Pressable onPress 打开 sheet（Bar → Sheet 装配）；弹窗开关不改指标条 metrics props', async () => {
    mockGetSessionUsageDetail.mockResolvedValue(DETAIL);
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<TriggerHarness />);
    });
    const pressables = tree.root.findAll(
      node => node.props?.accessibilityRole === 'button' && node.props?.onPress
    );
    expect(pressables.length).toBeGreaterThan(0);
    await act(async () => {
      pressables[0].props.onPress();
    });
    const texts = tree.root
      .findAllByType(Text)
      .map(node => String(node.props.children));
    expect(texts.join()).toContain('用量详情');
    expect(texts.join()).toContain('claude-x');
    // 指标条 metrics props 未变（引用不变——弹窗状态独立 state，
    // 不污染指标条渲染入参，250ms tick 隔离不破，T-MD5）。
    const bar = tree.root.findByType(ChatStreamMetricsBar);
    expect(bar.props.metrics).toBe(METRICS);
  });
});

/** 触发装配的最小 harness：Bar onPress → sheet visible（Live 层同构）。 */
function TriggerHarness() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <ChatStreamMetricsBar
        metrics={METRICS}
        onPress={() => setOpen(true)}
      />
      <MetricDetailSheet
        visible={open}
        sessionId="s1"
        onClose={() => setOpen(false)}
      />
    </>
  );
}

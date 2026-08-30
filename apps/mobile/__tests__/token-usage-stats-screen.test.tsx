/**
 * 数据统计页（TokenUsageStatsScreen）mobile UI 测试（T-S7）。
 *
 * - 入口：ProfileTabScreen CONFIG_MENU「数据统计」项 navigate TokenUsageStats；
 * - 「汇总 / 明细」双页签：筛选栏置顶共享（切页签不重查、筛选状态跨页签
 *   保留）；汇总页签五指标卡 + 今日卡（命中率无数据显示「暂无数据」）
 *   + 分模型列表（聚合数据归汇总）；明细页签只留柱状图 / 小时钻取；
 * - 筛选切换重查：时间范围 / 模型筛选切换后 stub 的 usageStats 方法收到新
 *   filter 参数；
 * - 柱状图数据映射：样例桶数据 → 柱高顺序 / 标签文本；
 * - 空态文案；
 * - 刷新单通道（mobile/B-2）：挂载与筛选切换各只触发一轮三连查询；
 * - 主查询竞态（cross/B-1）：旧响应后到不覆盖新数据；
 * - 空态区分（mobile/A-1）：库全空冷启动引导 vs 范围内无数据保留今日卡；
 * - 加载失败（mobile/C-orch-2）：常驻错误条 + 不渲染 0 兜底卡片；
 * - MonthRangePickerSheet 组件级选值回调 + 自定义区间正常路径与 366 天上限。
 *
 * 照 session-detail-screen.test.tsx 范式：mock useRuntime 返回固定引用 runtime
 * （新对象字面量会导致 effect 无限重跑）；AppModal 只在 visible 时渲染 children。
 */
import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';

const mockGetSummary = jest.fn();
const mockGetDailyBuckets = jest.fn();
const mockGetHourlyBuckets = jest.fn();
const mockGetModelBreakdown = jest.fn();
const mockListModels = jest.fn();
const mockListRequestUsage = jest.fn();

const mockRuntime = {
  usageStats: {
    getSummary: mockGetSummary,
    getDailyBuckets: mockGetDailyBuckets,
    getHourlyBuckets: mockGetHourlyBuckets,
    getModelBreakdown: mockGetModelBreakdown,
    listModels: mockListModels,
    listRequestUsage: mockListRequestUsage,
  },
  state: {
    getCurrentModelId: jest.fn(async () => null),
    getCurrentAgentId: jest.fn(async () => null),
  },
};

jest.mock('@/hooks/useRuntime', () => ({
  // 固定引用：runtime 每次渲染都是新对象的话 reload 的 useCallback 会重建，
  // effect 就会无限重跑（session-detail-screen 范式）。
  useRuntime: () => mockRuntime,
}));

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#fff',
      bgSecondary: '#eee',
      surface: '#f8f8f8',
      surfaceElevated: '#fff',
      text: '#111',
      textSecondary: '#666',
      textTertiary: '#999',
      border: '#ccc',
      borderLight: '#e0e0e0',
      primary: '#007aff',
      selection: '#007aff55',
      success: '#34c759',
      warning: '#f80',
      danger: '#f00',
    },
  }),
}));

const mockShowToast = jest.fn();

jest.mock('@/components/chrome/ToastHost', () => ({
  useToast: () => ({showToast: mockShowToast}),
}));

jest.mock('@/errors/toast-message', () => ({
  toastMessage: (_title: string, err: unknown) => String(err),
}));

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

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => {
  const mockReact = require('react');
  return {
    useNavigation: () => ({
      navigate: mockNavigate,
      goBack: jest.fn(),
      getParent: () => ({navigate: mockNavigate}),
    }),
    // 近似真实 focus 行为（mobile/B-2）：挂载时执行一次；回调标识变化
    // （reload 引用随筛选刷新）时重跑。页面已收敛为 useFocusEffect 单通道，
    // 筛选变化的重查由这里驱动——mock 须锁定该真实行为而非绕开它。
    useFocusEffect: (cb: () => void | (() => void)) => {
      mockReact.useEffect(cb, [cb]);
    },
    useIsFocused: () => true,
  };
});

jest.mock('@/components/chrome/AppHeader', () => {
  const mockReact = require('react');
  return {
    AppHeader: () => mockReact.createElement('View', {testID: 'app-header'}),
  };
});

jest.mock('@/components/agent/AgentPickerModal', () => {
  const mockReact = require('react');
  return {
    AgentPickerModal: () =>
      mockReact.createElement('View', {testID: 'agent-picker'}),
  };
});

jest.mock('@/components/provider/ModelPickerModal', () => {
  const mockReact = require('react');
  return {
    ModelPickerModal: () =>
      mockReact.createElement('View', {testID: 'model-picker'}),
  };
});

jest.mock('@/services/agent-display-label', () => ({
  resolveCurrentAgentDisplayLabel: jest.fn(async () => 'Agent'),
}));

import {TokenUsageStatsScreen} from '@/screens/stack/TokenUsageStatsScreen';
import {isCustomRangeValid} from '@/screens/stack/token-usage/format';
import {MonthRangePickerSheet} from '@/components/ui/MonthRangePickerSheet';
import {ProfileTabScreen} from '@/screens/tabs/ProfileTabScreen';

const MS_PER_DAY = 86_400_000;

function dayMs(year: number, month: number, day: number): number {
  return new Date(year, month, day).getTime();
}

const SAMPLE_SUMMARY = {
  calls: 6,
  promptTokens: 1350,
  completionTokens: 200,
  totalTokens: 1550,
  cacheReadTokens: 800,
  cacheCreationTokens: 0,
  billedInputTokens: 1000,
  avgFirstTokenMs: 1200,
  avgTokensPerSecond: 45.5,
  today: {totalTokens: 500, calls: 2},
};

// 三天样例：总用量递减（900+100 / 400+100 / 50+0），柱高随之递减；
// 首桶带速率/TTFT 均值（选中天汇总行用），后两桶为存量 null 形态。
const SAMPLE_BUCKETS = [
  {
    bucketStartMs: dayMs(2026, 7, 21),
    calls: 2,
    promptTokens: 900,
    completionTokens: 100,
    cacheReadTokens: 500,
    cacheCreationTokens: 0,
    billedInputTokens: 600,
    avgFirstTokenMs: 900,
    avgTokensPerSecond: 25,
  },
  {
    bucketStartMs: dayMs(2026, 7, 22),
    calls: 2,
    promptTokens: 400,
    completionTokens: 100,
    cacheReadTokens: 300,
    cacheCreationTokens: 0,
    billedInputTokens: 500,
    avgFirstTokenMs: null,
    avgTokensPerSecond: null,
  },
  {
    bucketStartMs: dayMs(2026, 7, 23),
    calls: 2,
    promptTokens: 50,
    completionTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    billedInputTokens: 0,
    avgFirstTokenMs: null,
    avgTokensPerSecond: null,
  },
];

const SAMPLE_MODEL_ROWS = [
  {
    modelName: null,
    calls: 2,
    promptTokens: 500,
    completionTokens: 100,
    totalTokens: 600,
    cacheReadTokens: 0,
    billedInputTokens: 500,
  },
  {
    modelName: 'gpt-4o',
    calls: 4,
    promptTokens: 850,
    completionTokens: 100,
    totalTokens: 950,
    cacheReadTokens: 800,
    billedInputTokens: 600,
  },
];

// 流水样例：两行（有 timing / 存量 null），total=60 → 50/页 共 2 页。
const SAMPLE_REQUEST_ROWS = [
  {
    createdAtMs: dayMs(2026, 7, 23) + 3_600_000,
    modelName: 'gpt-4o',
    promptTokens: 900,
    completionTokens: 100,
    totalTokens: 1000,
    cacheReadTokens: 500,
    cacheCreationTokens: 0,
    firstTokenMs: 900,
    durationMs: 8_000,
  },
  {
    createdAtMs: dayMs(2026, 7, 22) + 7_200_000,
    modelName: null,
    promptTokens: 400,
    completionTokens: 100,
    totalTokens: 500,
    cacheReadTokens: null,
    cacheCreationTokens: null,
    firstTokenMs: null,
    durationMs: null,
  },
];

function flushPromises(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

/** 可控 promise：竞态测试用它手动控制每轮查询的 resolve 时机。 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return {promise, resolve};
}

function findByTestId(
  root: TestRenderer.ReactTestInstance,
  testID: string,
): TestRenderer.ReactTestInstance | undefined {
  return root.findAll(node => node.props.testID === testID)[0];
}

/** 从（可能是数组的）style 里取指定键值。 */
function styleValue(style: unknown, key: string): unknown {
  const arr = Array.isArray(style) ? style : [style];
  for (const entry of arr) {
    if (entry && typeof entry === 'object' && key in entry) {
      return (entry as Record<string, unknown>)[key];
    }
  }
  return undefined;
}

function nodeText(node: TestRenderer.ReactTestInstance): string {
  let out = '';
  for (const child of node.children) {
    if (typeof child === 'string') {
      out += child;
    } else {
      out += nodeText(child);
    }
  }
  return out;
}

/** 找子树文本包含 text 且自身挂 onPress 的可点击节点。 */
function findClickableByText(
  root: TestRenderer.ReactTestInstance,
  text: string,
): TestRenderer.ReactTestInstance | undefined {
  return root.findAll(node => {
    if (typeof node.props.onPress !== 'function') {
      return false;
    }
    return nodeText(node).includes(text);
  })[0];
}

async function renderScreen() {
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<TokenUsageStatsScreen />);
    await flushPromises();
  });
  return renderer!;
}

/** 切到「明细」页签（按天柱状图与 24 小时钻取在明细页签）。 */
async function switchToDetailTab(
  renderer: TestRenderer.ReactTestRenderer,
): Promise<void> {
  await act(async () => {
    findByTestId(renderer.root, 'stats-tab-detail')!.props.onPress();
    await flushPromises();
  });
}

beforeEach(() => {
  mockGetSummary.mockReset().mockResolvedValue(SAMPLE_SUMMARY);
  mockGetDailyBuckets.mockReset().mockResolvedValue(SAMPLE_BUCKETS);
  mockGetHourlyBuckets.mockReset().mockResolvedValue(
    Array.from({length: 24}, (_, hour) => ({
      bucketStartMs: dayMs(2026, 7, 22) + hour * 3_600_000,
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      billedInputTokens: 0,
      avgFirstTokenMs: null,
      avgTokensPerSecond: null,
    })),
  );
  mockGetModelBreakdown.mockReset().mockResolvedValue(SAMPLE_MODEL_ROWS);
  mockListModels.mockReset().mockResolvedValue(['gpt-4o']);
  mockListRequestUsage.mockReset().mockResolvedValue({
    rows: SAMPLE_REQUEST_ROWS,
    total: 60,
  });
  mockShowToast.mockClear();
  mockNavigate.mockClear();
});

describe('T-S7 ProfileTabScreen 数据统计入口', () => {
  it('CONFIG_MENU 渲染「数据统计」项，点击 navigate 到 TokenUsageStats', async () => {
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<ProfileTabScreen />);
      await flushPromises();
    });
    const item = findClickableByText(renderer!.root, '数据统计');
    expect(item).toBeTruthy();
    await act(async () => {
      item!.props.onPress();
    });
    // navigateTo 经 parent.navigate（Tab 内跳 stack）。
    expect(mockNavigate).toHaveBeenCalledWith('TokenUsageStats');
  });
});

describe('T-S7 TokenUsageStatsScreen 筛选与渲染', () => {
  it('初始加载以 last7 查询，切近 30 天后以 last30 重查', async () => {
    const renderer = await renderScreen();
    expect(mockGetDailyBuckets).toHaveBeenCalledWith({
      range: {kind: 'last7'},
      model: undefined,
    });
    await act(async () => {
      findByTestId(renderer.root, 'range-last30')!.props.onPress();
      await flushPromises();
    });
    expect(mockGetDailyBuckets).toHaveBeenLastCalledWith({
      range: {kind: 'last30'},
      model: undefined,
    });
  });

  it('模型筛选：「其他模型」选项由 UI 补上，选中具体模型后 filter.model 生效', async () => {
    const renderer = await renderScreen();
    await act(async () => {
      findByTestId(renderer.root, 'model-filter-entry')!.props.onPress();
    });
    // DEV-1：listModels 只返回非 NULL 模型名，「其他模型」（NULL + 非当前配置历史模型归并）必须由 UI 侧补上。
    expect(findByTestId(renderer.root, 'model-option-gpt-4o')).toBeTruthy();
    expect(
      findByTestId(renderer.root, 'model-option-__unlogged__'),
    ).toBeTruthy();
    await act(async () => {
      findByTestId(renderer.root, 'model-option-gpt-4o')!.props.onPress();
      await flushPromises();
    });
    expect(mockGetSummary).toHaveBeenLastCalledWith({
      range: {kind: 'last7'},
      model: 'gpt-4o',
    });
    // 语义断言：选中「其他模型」时 filter.model 传 null，归并筛选由 core 侧解释。
    await act(async () => {
      findByTestId(renderer.root, 'model-filter-entry')!.props.onPress();
    });
    await act(async () => {
      findByTestId(renderer.root, 'model-option-__unlogged__')!.props.onPress();
      await flushPromises();
    });
    expect(mockGetSummary).toHaveBeenLastCalledWith({
      range: {kind: 'last7'},
      model: null,
    });
  });

  it('柱状图数据映射：柱高随桶用量递减，标签为日期文本', async () => {
    const renderer = await renderScreen();
    await switchToDetailTab(renderer);
    const bar1 = findByTestId(renderer.root, 'bar-2026-08-21');
    const bar2 = findByTestId(renderer.root, 'bar-2026-08-22');
    const bar3 = findByTestId(renderer.root, 'bar-2026-08-23');
    expect(bar1).toBeTruthy();
    expect(bar2).toBeTruthy();
    expect(bar3).toBeTruthy();
    const h1 = styleValue(bar1!.props.style, 'height');
    const h2 = styleValue(bar2!.props.style, 'height');
    const h3 = styleValue(bar3!.props.style, 'height');
    expect(h1).toBe(140); // 1000/1000 满高
    expect(h2).toBe(70); // 500/1000
    expect(h3).toBe(7); // 50/1000
    expect(Number(h1) > Number(h2) && Number(h2) > Number(h3)).toBe(true);
    expect(nodeText(findByTestId(renderer.root, 'bar-label-2026-08-22')!)).toBe(
      '22',
    );
  });

  it('页签切换共享筛选：切页签不重查，明细页签改范围后回汇总保留', async () => {
    const renderer = await renderScreen();
    const callsBefore = mockGetDailyBuckets.mock.calls.length;
    await switchToDetailTab(renderer);
    // 切页签只切展示，不触发重查。
    expect(mockGetDailyBuckets.mock.calls.length).toBe(callsBefore);
    await act(async () => {
      findByTestId(renderer.root, 'range-last30')!.props.onPress();
      await flushPromises();
    });
    expect(mockGetDailyBuckets).toHaveBeenLastCalledWith({
      range: {kind: 'last30'},
      model: undefined,
    });
    await act(async () => {
      findByTestId(renderer.root, 'stats-tab-summary')!.props.onPress();
      await flushPromises();
    });
    // 回汇总页签：筛选状态保留（总览标题仍为近 30 天，未重置回近 7 天）。
    expect(JSON.stringify(renderer.toJSON())).toContain('近 30 天');
  });

  it('汇总页签：五指标卡与今日卡，命中率 80%', async () => {
    const renderer = await renderScreen(); // 默认汇总页签
    expect(findByTestId(renderer.root, 'summary-metric-total')).toBeTruthy();
    expect(findByTestId(renderer.root, 'summary-metric-input')).toBeTruthy();
    expect(findByTestId(renderer.root, 'summary-metric-output')).toBeTruthy();
    expect(findByTestId(renderer.root, 'summary-metric-calls')).toBeTruthy();
    expect(
      nodeText(findByTestId(renderer.root, 'summary-metric-output')!),
    ).toContain('200');
    expect(
      nodeText(findByTestId(renderer.root, 'summary-metric-calls')!),
    ).toContain('6');
    // 命中率 = 800/1000 = 80%。
    expect(
      nodeText(findByTestId(renderer.root, 'summary-metric-hitRate')!),
    ).toContain('80%');
    // 今日卡独立于筛选：today 子对象数值。
    const today = nodeText(findByTestId(renderer.root, 'today-card')!);
    expect(today).toContain('500');
    expect(today).toContain('2');
  });

  it('汇总页签：命中率无 cache 数据时显示「—」而非 0%', async () => {
    mockGetSummary.mockResolvedValue({
      ...SAMPLE_SUMMARY,
      cacheReadTokens: 0,
      billedInputTokens: 0,
    });
    const renderer = await renderScreen();
    const hitTile = nodeText(
      findByTestId(renderer.root, 'summary-metric-hitRate')!,
    );
    expect(hitTile).toContain('—');
    expect(hitTile).not.toContain('0%');
  });

  it('点选某天加载 24 小时桶并渲染该天汇总行（含命中率）', async () => {
    const renderer = await renderScreen();
    await switchToDetailTab(renderer);
    await act(async () => {
      findByTestId(renderer.root, 'bar-col-2026-08-21')!.props.onPress();
      await flushPromises();
    });
    expect(mockGetHourlyBuckets).toHaveBeenCalledWith('2026-08-21', {
      range: {kind: 'last7'},
      model: undefined,
    });
    expect(findByTestId(renderer.root, 'hourly-chart')).toBeTruthy();
    const chart = findByTestId(renderer.root, 'hourly-chart')!;
    // 24 桶全渲染（小时标签 0时…23时；findAll 会同时命中组件层与 host 层，去重）。
    const hourLabels = [
      ...new Set(
        chart
          .findAll(
            node =>
              typeof node.props.testID === 'string' &&
              node.props.testID.startsWith('bar-label-'),
          )
          .map(node => nodeText(node)),
      ),
    ];
    expect(hourLabels).toHaveLength(24);
    // 该天汇总行保留命中率出口：500/600 ≈ 83%。
    const json = JSON.stringify(renderer.toJSON());
    expect(json).toContain('命中率');
    expect(json).toContain('83%');
  });

  it('汇总页签分模型列表：其他行按用量降序在前，不提供命中率列', async () => {
    const renderer = await renderScreen(); // 默认汇总页签，无需切页签
    const json = JSON.stringify(renderer.toJSON());
    // 降序：gpt-4o（950）在其他（600）前。
    const gptIndex = json.indexOf('gpt-4o');
    const otherIndex = json.indexOf('其他');
    expect(gptIndex).toBeGreaterThanOrEqual(0);
    expect(gptIndex).toBeLessThan(otherIndex);
    // 分模型列表提供模型名/用量/占比/调用次数。
    expect(json).toContain('占比');
    expect(json).toContain('用量');
    expect(json).toContain('调用');
  });

  it('明细页签不含分模型列表，未选天时无命中率出口', async () => {
    const renderer = await renderScreen();
    await switchToDetailTab(renderer);
    const json = JSON.stringify(renderer.toJSON());
    expect(json).not.toContain('分模型汇总');
    expect(json).not.toContain('占比');
    expect(json).not.toContain('命中率');
  });

  it('刷新单通道：挂载与筛选切换各只触发一轮三连查询（mobile/B-2）', async () => {
    const renderer = await renderScreen();
    // 挂载只跑一轮（不再 useEffect + useFocusEffect 双通道各一轮）。
    expect(mockGetSummary).toHaveBeenCalledTimes(1);
    expect(mockGetDailyBuckets).toHaveBeenCalledTimes(1);
    expect(mockGetModelBreakdown).toHaveBeenCalledTimes(1);
    await act(async () => {
      findByTestId(renderer.root, 'range-last30')!.props.onPress();
      await flushPromises();
    });
    // 筛选切换也只重查一轮（三连查询各恰好 2 次，而非 3 次）。
    expect(mockGetSummary).toHaveBeenCalledTimes(2);
    expect(mockGetDailyBuckets).toHaveBeenCalledTimes(2);
    expect(mockGetModelBreakdown).toHaveBeenCalledTimes(2);
  });

  it('主查询竞态：旧响应后到不覆盖新数据（cross/B-1）', async () => {
    // 每轮三连查询各自挂到可控 promise 上，按调用序号取轮次。
    const rounds = Array.from({length: 2}, () => ({
      summary: deferred<unknown>(),
      buckets: deferred<unknown>(),
      rows: deferred<unknown>(),
    }));
    let summaryCalls = 0;
    let bucketCalls = 0;
    let rowCalls = 0;
    mockGetSummary.mockImplementation(
      () => rounds[summaryCalls++].summary.promise,
    );
    mockGetDailyBuckets.mockImplementation(
      () => rounds[bucketCalls++].buckets.promise,
    );
    mockGetModelBreakdown.mockImplementation(
      () => rounds[rowCalls++].rows.promise,
    );

    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<TokenUsageStatsScreen />);
    });
    // 第一轮（last7）仍在途时立刻切 last30，触发第二轮。
    await act(async () => {
      findByTestId(renderer!.root, 'range-last30')!.props.onPress();
    });
    // 第二轮先 resolve：落地新数据。
    const round1Summary = {
      ...SAMPLE_SUMMARY,
      promptTokens: 800,
      completionTokens: 88,
      totalTokens: 888,
      calls: 42,
    };
    await act(async () => {
      rounds[1].summary.resolve(round1Summary);
      rounds[1].buckets.resolve([]);
      rounds[1].rows.resolve([]);
      await flushPromises();
    });
    expect(
      nodeText(findByTestId(renderer!.root, 'summary-metric-total')!),
    ).toContain('888');
    expect(
      nodeText(findByTestId(renderer!.root, 'summary-metric-calls')!),
    ).toContain('42');
    // 第一轮（旧响应）后到：应被序号守卫丢弃，新数据不被覆盖回旧值。
    await act(async () => {
      rounds[0].summary.resolve(SAMPLE_SUMMARY);
      rounds[0].buckets.resolve(SAMPLE_BUCKETS);
      rounds[0].rows.resolve(SAMPLE_MODEL_ROWS);
      await flushPromises();
    });
    expect(
      nodeText(findByTestId(renderer!.root, 'summary-metric-total')!),
    ).toContain('888');
    expect(
      nodeText(findByTestId(renderer!.root, 'summary-metric-total')!),
    ).not.toContain('1550');
    expect(
      nodeText(findByTestId(renderer!.root, 'summary-metric-calls')!),
    ).toContain('42');
  });

  it('空态区分：库全空显示冷启动引导文案（mobile/A-1）', async () => {
    // listModels 为空 → 库全空信号：冷启动引导而非「该区间无数据」。
    mockListModels.mockResolvedValue([]);
    mockGetSummary.mockResolvedValue({
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      billedInputTokens: 0,
      today: {totalTokens: 0, calls: 0},
    });
    mockGetDailyBuckets.mockResolvedValue([]);
    mockGetModelBreakdown.mockResolvedValue([]);
    const renderer = await renderScreen();
    expect(findByTestId(renderer.root, 'empty-cold-start')).toBeTruthy();
    const json = JSON.stringify(renderer.toJSON());
    expect(json).toContain('自记录功能上线起开始积累');
    expect(json).not.toContain('该区间无数据');
    // 库全空时今日也必然无数据，不渲染今日卡。
    expect(findByTestId(renderer.root, 'today-card')).toBeUndefined();
  });

  it('空态区分：范围内无数据提示该区间，今日卡仍渲染（mobile/A-1）', async () => {
    // 库非空（listModels 返回模型）但当前范围空：区间提示 + 保留今日卡。
    mockGetSummary.mockResolvedValue({
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      billedInputTokens: 0,
      today: {totalTokens: 500, calls: 2},
    });
    mockGetDailyBuckets.mockResolvedValue([]);
    mockGetModelBreakdown.mockResolvedValue([]);
    const renderer = await renderScreen();
    expect(findByTestId(renderer.root, 'empty-range')).toBeTruthy();
    const json = JSON.stringify(renderer.toJSON());
    expect(json).toContain('该区间无数据');
    expect(json).not.toContain('自记录功能上线起开始积累');
    // 今日卡独立于筛选：范围空态下仍渲染且数值来自 today 子对象。
    const today = nodeText(findByTestId(renderer.root, 'today-card')!);
    expect(today).toContain('500');
    expect(today).toContain('2');
  });

  it('首查失败渲染常驻错误条而非 0 值卡片，成功后清除（mobile/C-orch-2）', async () => {
    mockGetSummary.mockRejectedValueOnce(new Error('db locked'));
    const renderer = await renderScreen();
    // 常驻错误条在场且带错误信息；toast 仍然提示。
    const errorBar = findByTestId(renderer.root, 'load-error');
    expect(errorBar).toBeTruthy();
    expect(nodeText(errorBar!)).toContain('db locked');
    expect(mockShowToast).toHaveBeenCalledTimes(1);
    // 无旧数据时不渲染 0 兑底卡片（误导性的「一排 0」）。
    expect(findByTestId(renderer.root, 'summary-metric-total')).toBeUndefined();
    expect(findByTestId(renderer.root, 'today-card')).toBeUndefined();
    // 切范围重查成功（mock 回落 resolvedValue）→ 错误条清除、数据恢复。
    await act(async () => {
      findByTestId(renderer.root, 'range-last30')!.props.onPress();
      await flushPromises();
    });
    expect(findByTestId(renderer.root, 'load-error')).toBeUndefined();
    expect(findByTestId(renderer.root, 'summary-metric-total')).toBeTruthy();
  });

  it('自定义区间：sheet 选起止日后以 custom range 重查', async () => {
    const renderer = await renderScreen();
    await act(async () => {
      findByTestId(renderer.root, 'range-custom')!.props.onPress();
    });
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    // 两次点选分开 act：state 更新需要落定后下一次点选才能读到。
    await act(async () => {
      findByTestId(renderer.root, 'month-range-day-3')!.props.onPress();
    });
    await act(async () => {
      findByTestId(renderer.root, 'month-range-day-10')!.props.onPress();
    });
    await act(async () => {
      findByTestId(renderer.root, 'month-range-confirm')!.props.onPress();
      await flushPromises();
    });
    expect(mockGetDailyBuckets).toHaveBeenLastCalledWith({
      range: {
        kind: 'custom',
        fromMs: dayMs(year, month, 3),
        toMs: dayMs(year, month, 10) + MS_PER_DAY,
      },
      model: undefined,
    });
  });

  it('自定义区间结束日跨 DST 边界：toMs 为次日本地 0 点日历加法（cross/B-2）', async () => {
    // 照 desktop test 的做法：运行时切纽约时区再断言；TZ 不可控则跳过
    // （new Date(y, m, d + 1) 的日历推进天然正确，固定 +86400000 在
    // 23 小时日会晚 1 小时）。jest 没有 node:test 的 t.skip，这里以
    // 探测失败即返回兼底，避免假失败。
    const prevTz = process.env.TZ;
    process.env.TZ = 'America/New_York';
    // 2026 年纽约春季拨快在 03-08（3 月第二个周日）：当天本地只有 23 小时。
    // 结束日选在切换日本身，锢定起始日或结束日的固定加法回归都能被抓住。
    const dstActive = dayMs(2026, 2, 9) - dayMs(2026, 2, 8) !== MS_PER_DAY;
    if (!dstActive) {
      process.env.TZ = prevTz;
      console.warn('当前环境 TZ 不可控，跳过 DST 边界断言（cross/B-2）');
      return;
    }
    try {
      const renderer = await renderScreen();
      await act(async () => {
        findByTestId(renderer.root, 'range-custom')!.props.onPress();
      });
      // 从当前月翻回 2026 年 3 月。
      const now = new Date();
      const monthsBack = (now.getFullYear() - 2026) * 12 + (now.getMonth() - 2);
      for (let i = 0; i < Math.abs(monthsBack); i++) {
        await act(async () => {
          findByTestId(
            renderer.root,
            monthsBack >= 0 ? 'month-range-prev' : 'month-range-next',
          )!.props.onPress();
        });
      }
      // 两次点选分开 act：state 更新需要落定后下一次点选才能读到。
      await act(async () => {
        findByTestId(renderer.root, 'month-range-day-7')!.props.onPress();
      });
      await act(async () => {
        findByTestId(renderer.root, 'month-range-day-8')!.props.onPress();
      });
      await act(async () => {
        findByTestId(renderer.root, 'month-range-confirm')!.props.onPress();
        await flushPromises();
      });
      expect(mockGetDailyBuckets).toHaveBeenLastCalledWith({
        range: {
          kind: 'custom',
          fromMs: dayMs(2026, 2, 7),
          // 03-08 本地只有 23 小时：固定 +86400000 会得到 03-09 01:00，
          // 日历加法 new Date(2026, 2, 9) 恰为 03-09 本地 0 点。
          toMs: dayMs(2026, 2, 9),
        },
        model: undefined,
      });
    } finally {
      process.env.TZ = prevTz;
    }
  });
});

describe('T-S7 MonthRangePickerSheet 组件级', () => {
  async function renderSheet() {
    const onClose = jest.fn();
    const onConfirm = jest.fn();
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <MonthRangePickerSheet
          visible
          onClose={onClose}
          onConfirm={onConfirm}
          tokens={{
            background: '#fff',
            bgSecondary: '#eee',
            surface: '#f8f8f8',
            surfaceElevated: '#fff',
            text: '#111',
            textSecondary: '#666',
            textTertiary: '#999',
            border: '#ccc',
            borderLight: '#e0e0e0',
            primary: '#007aff',
            selection: '#007aff55',
            success: '#34c759',
            warning: '#f80',
            danger: '#f00',
          }}
        />,
      );
    });
    return {renderer: renderer!, onClose, onConfirm};
  }

  it('两次点选确定区间，确认回调给起止日本地 0 点（倒序点选自动排序）', async () => {
    const {renderer, onConfirm} = await renderSheet();
    const now = new Date();
    // 两次点选分开 act：state 更新需要落定后下一次点选才能读到。
    await act(async () => {
      // 先点 10 再点 3：仍应输出 from=3、to=10。
      findByTestId(renderer.root, 'month-range-day-10')!.props.onPress();
    });
    await act(async () => {
      findByTestId(renderer.root, 'month-range-day-3')!.props.onPress();
    });
    await act(async () => {
      findByTestId(renderer.root, 'month-range-confirm')!.props.onPress();
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const [from, to] = onConfirm.mock.calls[0] as [Date, Date];
    expect(from.getTime()).toBe(dayMs(now.getFullYear(), now.getMonth(), 3));
    expect(to.getTime()).toBe(dayMs(now.getFullYear(), now.getMonth(), 10));
  });

  it('未选完整区间时确定不触发回调', async () => {
    const {renderer, onConfirm} = await renderSheet();
    await act(async () => {
      findByTestId(renderer.root, 'month-range-day-3')!.props.onPress();
      findByTestId(renderer.root, 'month-range-confirm')!.props.onPress();
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('月份翻页可跨月，1 月翻到上一年 12 月', async () => {
    const {renderer, onConfirm} = await renderSheet();
    const now = new Date();
    // 翻到上月（当前月为 1 月时跨到上一年 12 月）。
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    await act(async () => {
      findByTestId(renderer.root, 'month-range-prev')!.props.onPress();
    });
    await act(async () => {
      findByTestId(renderer.root, 'month-range-day-5')!.props.onPress();
    });
    await act(async () => {
      findByTestId(renderer.root, 'month-range-day-15')!.props.onPress();
    });
    await act(async () => {
      findByTestId(renderer.root, 'month-range-confirm')!.props.onPress();
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const [from] = onConfirm.mock.calls[0] as [Date, Date];
    expect(from.getTime()).toBe(dayMs(prev.getFullYear(), prev.getMonth(), 5));
  });
});

describe('T-S7 自定义区间上限校验', () => {
  it('366 天（含首尾）合法，367 天与倒序非法', () => {
    const from = new Date(2026, 0, 1);
    expect(isCustomRangeValid(from, new Date(2026, 11, 31))).toBe(true); // 365 天
    expect(isCustomRangeValid(from, new Date(2027, 0, 1))).toBe(true); // 366 天
    expect(isCustomRangeValid(from, new Date(2027, 0, 2))).toBe(false); // 367 天
    expect(
      isCustomRangeValid(new Date(2026, 0, 10), new Date(2026, 0, 1)),
    ).toBe(false);
  });
});

describe('T-MB 新指标卡与长按详情', () => {
  it('汇总页出现平均速率 / 平均首字延迟卡（T-MB4）', async () => {
    const renderer = await renderScreen();
    const rateTile = findByTestId(
      renderer.root,
      'summary-metric-avgTokensPerSecond',
    );
    expect(rateTile).toBeTruthy();
    expect(nodeText(rateTile!)).toContain('45.5 tok/s');
    const ttftTile = findByTestId(
      renderer.root,
      'summary-metric-avgFirstTokenMs',
    );
    expect(ttftTile).toBeTruthy();
    expect(nodeText(ttftTile!)).toContain('1.2 s');
  });

  it('新指标空态：null 时显示「—」而非 0（T-MB4）', async () => {
    mockGetSummary.mockResolvedValue({
      ...SAMPLE_SUMMARY,
      avgFirstTokenMs: null,
      avgTokensPerSecond: null,
    });
    const renderer = await renderScreen();
    const rateTile = findByTestId(
      renderer.root,
      'summary-metric-avgTokensPerSecond',
    );
    expect(nodeText(rateTile!)).toContain('—');
    const ttftTile = findByTestId(
      renderer.root,
      'summary-metric-avgFirstTokenMs',
    );
    expect(nodeText(ttftTile!)).toContain('—');
  });

  it('选中天汇总行含当日均值（有值与 null 两形态）（T-MB4）', async () => {
    const renderer = await renderScreen();
    await switchToDetailTab(renderer);
    // 有值形态：首天 avgTokensPerSecond=25、avgFirstTokenMs=900
    await act(async () => {
      renderer.root
        .findAll(node => node.props.testID === 'bar-col-2026-08-21')[0]
        .props.onPress();
      await flushPromises();
    });
    let json = JSON.stringify(renderer.toJSON());
    expect(json).toContain('25.0 tok/s');
    expect(json).toContain('900 ms');

    // null 形态：第二天为存量 null
    await act(async () => {
      renderer.root
        .findAll(node => node.props.testID === 'bar-col-2026-08-22')[0]
        .props.onPress();
      await flushPromises();
    });
    json = JSON.stringify(renderer.toJSON());
    expect(json).toContain('平均速率');
    expect(json).toContain('平均首字延迟');
    expect(json).toContain('平均速率');
    expect(json).toContain('"—"');
  });

  it('长按柱子后图下方显示 bar-inspect 详情行（输入/输出/调用）（T-MB3）', async () => {
    const renderer = await renderScreen();
    await switchToDetailTab(renderer);
    expect(findByTestId(renderer.root, 'bar-inspect')).toBeUndefined();
    await act(async () => {
      renderer.root
        .findAll(node => node.props.testID === 'bar-col-2026-08-21')[0]
        .props.onLongPress();
      await flushPromises();
    });
    const inspect = findByTestId(renderer.root, 'bar-inspect');
    expect(inspect).toBeTruthy();
    const text = nodeText(inspect!);
    expect(text).toContain('输入 900');
    expect(text).toContain('输出 100');
    expect(text).toContain('调用 2 次');
  });
});

describe('T-S7 请求流水页签（分页）', () => {
  it('切到流水页签拉第一页；页码条常驻，点页码/前后按钮按页号取整页', async () => {
    const renderer = await renderScreen();
    await act(async () => {
      findByTestId(renderer.root, 'stats-tab-requests')!.props.onPress();
      await flushPromises();
    });
    expect(mockListRequestUsage).toHaveBeenCalledTimes(1);
    expect(mockListRequestUsage.mock.calls[0]![1]).toEqual({
      offset: 0,
      limit: 10,
    });
    // 页码条常驻：首页上一页禁用、页码按钮 1/2 可见；行内首字延迟/总时间与时间同行
    expect(findByTestId(renderer.root, 'req-prev-page')!.props.disabled).toBe(
      true,
    );
    expect(findByTestId(renderer.root, 'req-page-1')).toBeTruthy();
    expect(findByTestId(renderer.root, 'req-page-2')).toBeTruthy();
    expect(nodeText(renderer.root)).toContain('首字延迟 900 ms');
    expect(nodeText(renderer.root)).toContain('首字延迟 —');

    // 点页码 2 跳页：offset 10（60 条 / 10 页 = 6 页，第 2 页非末页）
    await act(async () => {
      findByTestId(renderer.root, 'req-page-2')!.props.onPress();
      await flushPromises();
    });
    expect(mockListRequestUsage.mock.calls[1]![1]).toEqual({
      offset: 10,
      limit: 10,
    });
    expect(findByTestId(renderer.root, 'req-next-page')!.props.disabled).toBe(
      false,
    );

    // 点尾页 6：末页下一页禁用；前一页按钮回到第 5 页
    await act(async () => {
      findByTestId(renderer.root, 'req-page-6')!.props.onPress();
      await flushPromises();
    });
    expect(mockListRequestUsage.mock.calls[2]![1]).toEqual({
      offset: 50,
      limit: 10,
    });
    expect(findByTestId(renderer.root, 'req-next-page')!.props.disabled).toBe(
      true,
    );
    await act(async () => {
      findByTestId(renderer.root, 'req-prev-page')!.props.onPress();
      await flushPromises();
    });
    expect(mockListRequestUsage.mock.calls[3]![1]).toEqual({
      offset: 40,
      limit: 10,
    });
  });

  it('首拉失败不无限重试：清脏标记后等待用户切页签/改筛选再触发（MF-1）', async () => {
    mockListRequestUsage.mockRejectedValue(new Error('x'));
    const renderer = await renderScreen();
    await act(async () => {
      findByTestId(renderer.root, 'stats-tab-requests')!.props.onPress();
      await flushPromises();
    });
    expect(mockListRequestUsage).toHaveBeenCalledTimes(1);
    // 再等两轮 flush：若失败后仍标脏，reqLoading 复位会再触发 effect，
    // 这里应保持 1 次，证明无重试循环。
    await act(async () => {
      await flushPromises();
      await flushPromises();
    });
    expect(mockListRequestUsage).toHaveBeenCalledTimes(1);
  });

  it('多页时页码窗口收窄：首尾页 + 当前页 ±1，间隙省略号，尾页可直达', async () => {
    mockListRequestUsage.mockResolvedValue({
      rows: SAMPLE_REQUEST_ROWS,
      total: 400,
    });
    const renderer = await renderScreen();
    await act(async () => {
      findByTestId(renderer.root, 'stats-tab-requests')!.props.onPress();
      await flushPromises();
    });
    // 40 页（400/10）：当前第 1 页 → [1][2]…[40]
    expect(findByTestId(renderer.root, 'req-page-2')).toBeTruthy();
    expect(findByTestId(renderer.root, 'req-page-40')).toBeTruthy();
    expect(
      nodeText(findByTestId(renderer.root, 'req-page-40')!.parent!),
    ).toContain('…');

    await act(async () => {
      findByTestId(renderer.root, 'req-page-40')!.props.onPress();
      await flushPromises();
    });
    expect(mockListRequestUsage.mock.calls.at(-1)![1]).toEqual({
      offset: 390,
      limit: 10,
    });
  });
});

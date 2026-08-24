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
 * - MonthRangePickerSheet 组件级选值回调 + 自定义区间正常路径与 366 天上限。
 *
 * 照 session-detail-screen.test.tsx 范式：mock useRuntime 返回固定引用 runtime
 * （新对象字面量会导致 effect 无限重跑）；AppModal 只在 visible 时渲染 children。
 */
import React from 'react';
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import TestRenderer, { act } from 'react-test-renderer';

const mockGetSummary = jest.fn();
const mockGetDailyBuckets = jest.fn();
const mockGetHourlyBuckets = jest.fn();
const mockGetModelBreakdown = jest.fn();
const mockListModels = jest.fn();

const mockRuntime = {
  usageStats: {
    getSummary: mockGetSummary,
    getDailyBuckets: mockGetDailyBuckets,
    getHourlyBuckets: mockGetHourlyBuckets,
    getModelBreakdown: mockGetModelBreakdown,
    listModels: mockListModels,
  },
  state: {
    getCurrentModelId: jest.fn(async () => null),
    getCurrentAgentId: jest.fn(async () => null),
  },
};

jest.mock('../src/hooks/useRuntime', () => ({
  // 固定引用：runtime 每次渲染都是新对象的话 reload 的 useCallback 会重建，
  // effect 就会无限重跑（session-detail-screen 范式）。
  useRuntime: () => mockRuntime,
}));

jest.mock('../src/theme/ThemeProvider', () => ({
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

jest.mock('../src/components/chrome/ToastHost', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

jest.mock('../src/errors/toast-message', () => ({
  toastMessage: (_title: string, err: unknown) => String(err),
}));

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
        ? mockReact.createElement('View', { testID: 'app-modal' }, children)
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
      getParent: () => ({ navigate: mockNavigate }),
    }),
    // 近似真实 focus 行为：挂载时执行一次（每次渲染直调会让 async effect
    // 无限重渲染）；筛选变化的重查由页面自身的 useEffect([reload]) 驱动。
    useFocusEffect: (cb: () => void | (() => void)) => {
      mockReact.useEffect(cb, []);
    },
    useIsFocused: () => true,
  };
});

jest.mock('../src/components/chrome/AppHeader', () => {
  const mockReact = require('react');
  return {
    AppHeader: () => mockReact.createElement('View', { testID: 'app-header' }),
  };
});

jest.mock('../src/components/agent/AgentPickerModal', () => {
  const mockReact = require('react');
  return {
    AgentPickerModal: () =>
      mockReact.createElement('View', { testID: 'agent-picker' }),
  };
});

jest.mock('../src/components/provider/ModelPickerModal', () => {
  const mockReact = require('react');
  return {
    ModelPickerModal: () =>
      mockReact.createElement('View', { testID: 'model-picker' }),
  };
});

jest.mock('../src/services/agent-display-label', () => ({
  resolveCurrentAgentDisplayLabel: jest.fn(async () => 'Agent'),
}));

import {
  TokenUsageStatsScreen,
  isCustomRangeValid,
} from '../src/screens/stack/TokenUsageStatsScreen';
import { MonthRangePickerSheet } from '../src/components/ui/MonthRangePickerSheet';
import { ProfileTabScreen } from '../src/screens/tabs/ProfileTabScreen';

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
  today: { totalTokens: 500, calls: 2 },
};

// 三天样例：总用量递减（900+100 / 400+100 / 50+0），柱高随之递减。
const SAMPLE_BUCKETS = [
  {
    bucketStartMs: dayMs(2026, 7, 21),
    calls: 2,
    promptTokens: 900,
    completionTokens: 100,
    cacheReadTokens: 500,
    cacheCreationTokens: 0,
    billedInputTokens: 600,
  },
  {
    bucketStartMs: dayMs(2026, 7, 22),
    calls: 2,
    promptTokens: 400,
    completionTokens: 100,
    cacheReadTokens: 300,
    cacheCreationTokens: 0,
    billedInputTokens: 500,
  },
  {
    bucketStartMs: dayMs(2026, 7, 23),
    calls: 2,
    promptTokens: 50,
    completionTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    billedInputTokens: 0,
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

function flushPromises(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
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
    Array.from({ length: 24 }, (_, hour) => ({
      bucketStartMs: dayMs(2026, 7, 22) + hour * 3_600_000,
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      billedInputTokens: 0,
    })),
  );
  mockGetModelBreakdown.mockReset().mockResolvedValue(SAMPLE_MODEL_ROWS);
  mockListModels.mockReset().mockResolvedValue(['gpt-4o']);
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
      range: { kind: 'last7' },
      model: undefined,
    });
    await act(async () => {
      findByTestId(renderer.root, 'range-last30')!.props.onPress();
      await flushPromises();
    });
    expect(mockGetDailyBuckets).toHaveBeenLastCalledWith({
      range: { kind: 'last30' },
      model: undefined,
    });
  });

  it('模型筛选：「未记录」选项由 UI 补上，选中具体模型后 filter.model 生效', async () => {
    const renderer = await renderScreen();
    await act(async () => {
      findByTestId(renderer.root, 'model-filter-entry')!.props.onPress();
    });
    // DEV-1：listModels 只返回非 NULL 模型名，「未记录」必须由 UI 侧补上。
    expect(findByTestId(renderer.root, 'model-option-gpt-4o')).toBeTruthy();
    expect(
      findByTestId(renderer.root, 'model-option-__unlogged__'),
    ).toBeTruthy();
    await act(async () => {
      findByTestId(renderer.root, 'model-option-gpt-4o')!.props.onPress();
      await flushPromises();
    });
    expect(mockGetSummary).toHaveBeenLastCalledWith({
      range: { kind: 'last7' },
      model: 'gpt-4o',
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
      range: { kind: 'last30' },
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
    expect(nodeText(findByTestId(renderer.root, 'summary-metric-calls')!)).toContain(
      '6',
    );
    // 命中率 = 800/1000 = 80%。
    expect(
      nodeText(findByTestId(renderer.root, 'summary-metric-hitRate')!),
    ).toContain('80%');
    // 今日卡独立于筛选：today 子对象数值。
    const today = nodeText(findByTestId(renderer.root, 'today-card')!);
    expect(today).toContain('500');
    expect(today).toContain('2');
  });

  it('汇总页签：命中率无 cache 数据时显示「暂无数据」而非 0%', async () => {
    mockGetSummary.mockResolvedValue({
      ...SAMPLE_SUMMARY,
      cacheReadTokens: 0,
      billedInputTokens: 0,
    });
    const renderer = await renderScreen();
    const hitTile = nodeText(
      findByTestId(renderer.root, 'summary-metric-hitRate')!,
    );
    expect(hitTile).toContain('暂无数据');
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
      range: { kind: 'last7' },
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

  it('汇总页签分模型列表：未记录行按用量降序在前，不提供命中率列', async () => {
    const renderer = await renderScreen(); // 默认汇总页签，无需切页签
    const json = JSON.stringify(renderer.toJSON());
    // 降序：gpt-4o（950）在未记录（600）前。
    const gptIndex = json.indexOf('gpt-4o');
    const unloggedIndex = json.indexOf('未记录');
    expect(gptIndex).toBeGreaterThanOrEqual(0);
    expect(gptIndex).toBeLessThan(unloggedIndex);
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

  it('空数据时展示引导文案而非空白', async () => {
    mockGetSummary.mockResolvedValue({
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      billedInputTokens: 0,
      today: { totalTokens: 0, calls: 0 },
    });
    mockGetDailyBuckets.mockResolvedValue([]);
    mockGetModelBreakdown.mockResolvedValue([]);
    const renderer = await renderScreen();
    const json = JSON.stringify(renderer.toJSON());
    expect(json).toContain('暂无用量数据');
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
    return { renderer: renderer!, onClose, onConfirm };
  }

  it('两次点选确定区间，确认回调给起止日本地 0 点（倒序点选自动排序）', async () => {
    const { renderer, onConfirm } = await renderSheet();
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
    const { renderer, onConfirm } = await renderSheet();
    await act(async () => {
      findByTestId(renderer.root, 'month-range-day-3')!.props.onPress();
      findByTestId(renderer.root, 'month-range-confirm')!.props.onPress();
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('月份翻页可跨月，1 月翻到上一年 12 月', async () => {
    const { renderer, onConfirm } = await renderSheet();
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

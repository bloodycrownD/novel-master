/**
 * 数据统计页（TokenUsageStatsScreen）mobile UI 测试（T-S7）。
 *
 * - 入口：ProfileTabScreen CONFIG_MENU「数据统计」项 navigate TokenUsageStats；
 * - 「汇总 / 图表 / 流水」三页签：筛选栏置顶共享（切页签不重查、筛选状态
 *   跨页签保留）；汇总页签五指标卡 + 服务商×模型饼图（今日卡已删）；
 *   图表页签柱状图 / 小时钻取（今天模式直出小时图）；流水随时间窗口
 *   （需求①勘误后，模型/服务商叠加）；
 * - 筛选切换重查：时间范围 / 模型筛选切换后 stub 的 usageStats 方法收到新
 *   filter 参数；CR-2 方案 A：两类归并选项传参与选项覆盖 parity（每个
 *   (providerId, modelName) 组合至少被一个筛选项命中）；
 * - 柱状图数据映射：样例桶数据 → 柱高顺序 / 标签文本；
 * - 空态文案；
 * - 刷新单通道（mobile/B-2）：挂载与筛选切换各只触发一轮三连查询；
 * - 主查询竞态（cross/B-1）：旧响应后到不覆盖新数据；
 * - 空态区分（mobile/A-1）：库全空冷启动引导（拦全部页签）vs 范围内
 *   无数据（拦全部页签，流水随时间窗口，需求①勘误后）；
 *   饼图占比分母用窗口 summary.totalTokens 且人为错开行总和（P1-3 锁口径）；
 * - 加载失败（mobile/C-orch-2）：常驻错误条 + 不渲染 0 兜底卡片；
 * - MonthRangePickerSheet 组件级选值回调 + 自定义区间正常路径（无上限）。
 * - T-M1..T-M7：今天映射/近 7·30 天恰 7·30 桶/今日卡全删/饼图渲染与点选/
 *   流水跟随时间/自定义无上限/PieChart 组件级交互。
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
const mockProvidersList = jest.fn();
const mockListByProvider = jest.fn();
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
  providers: {
    list: mockProvidersList,
  },
  savedModelRepo: {
    listByProvider: mockListByProvider,
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

// react-native-svg 在 Jest 环境下依赖原生视图管理器，渲染会抛错；
// mock 成转发 props（testID/onPress）的普通 View，保饼图扇区可查可点。
jest.mock('react-native-svg', () => {
  const mockReact = require('react');
  const passthrough = (props: Record<string, unknown>) =>
    mockReact.createElement('View', props);
  return {
    __esModule: true,
    default: passthrough,
    Path: passthrough,
    Circle: passthrough,
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
import {
  isCustomRangeValid,
  localDayKeyOffset,
  toLocalDayKey,
} from '@/screens/stack/token-usage/format';
import {MonthRangePickerSheet} from '@/components/ui/MonthRangePickerSheet';
import {PieChart} from '@/components/charts/PieChart';
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
    providerId: null,
    modelName: null,
    calls: 2,
    promptTokens: 500,
    completionTokens: 100,
    totalTokens: 600,
    cacheReadTokens: 0,
    billedInputTokens: 500,
  },
  {
    providerId: 'p1',
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

/** 当天（运行时）与 N 天前偏移的本地日 key：与实现同用日历加法。 */
function todayKey(): string {
  return toLocalDayKey(Date.now());
}
function dayKeyOffset(offsetDays: number): string {
  return localDayKeyOffset(new Date(), offsetDays);
}

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
  mockProvidersList
    .mockReset()
    .mockResolvedValue([{id: 'p1', displayName: '智谱'}]);
  mockListByProvider
    .mockReset()
    .mockResolvedValue([{providerId: 'p1', vendorModelId: 'gpt-4o'}]);
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
  it('初始加载以 last7 查询，切近 30 天后以 last30 重查（T-M2：近 7/30 天恰 7/30 桶）', async () => {
    const renderer = await renderScreen();
    // last7 = {D-6, D}（含今天共 7 桶，修正旧版 8 桶偏差）。
    expect(mockGetDailyBuckets).toHaveBeenCalledWith({
      range: {fromDay: dayKeyOffset(-6), toDay: todayKey()},
      model: undefined,
      providerId: undefined,
    });
    await act(async () => {
      findByTestId(renderer.root, 'range-last30')!.props.onPress();
      await flushPromises();
    });
    // last30 = {D-29, D}（含今天共 30 桶）。
    expect(mockGetDailyBuckets).toHaveBeenLastCalledWith({
      range: {fromDay: dayKeyOffset(-29), toDay: todayKey()},
      model: undefined,
      providerId: undefined,
    });
  });

  it('模型筛选：三类选项生成与选中后 filter 传参（CR-2 方案 A）', async () => {
    const renderer = await renderScreen();
    await act(async () => {
      findByTestId(renderer.root, 'model-filter-entry')!.props.onPress();
    });
    // 选项生成：配置组合「智谱 · gpt-4o」+ 服务商归并「智谱 · 其他模型」+
    // 全局归并「未记录服务商（历史）」（provider_id IS NULL，模型在不在
    // 配置集均归此）。
    expect(findByTestId(renderer.root, 'model-option-p1::gpt-4o')).toBeTruthy();
    expect(
      findByTestId(renderer.root, 'model-option-p1::__other__'),
    ).toBeTruthy();
    expect(
      findByTestId(renderer.root, 'model-option-__unlogged__'),
    ).toBeTruthy();
    // 配置组合：model/providerId 传具体值。
    await act(async () => {
      findByTestId(renderer.root, 'model-option-p1::gpt-4o')!.props.onPress();
      await flushPromises();
    });
    expect(mockGetSummary).toHaveBeenLastCalledWith({
      range: {fromDay: dayKeyOffset(-6), toDay: todayKey()},
      model: 'gpt-4o',
      providerId: 'p1',
    });
    // 未记录服务商（历史）：model: undefined（不筛模型）+ providerId: null
    // （provider_id IS NULL）——覆盖「未记录 × 已配置模型」存量行。
    await act(async () => {
      findByTestId(renderer.root, 'model-filter-entry')!.props.onPress();
    });
    await act(async () => {
      findByTestId(renderer.root, 'model-option-__unlogged__')!.props.onPress();
      await flushPromises();
    });
    expect(mockGetSummary).toHaveBeenLastCalledWith({
      range: {fromDay: dayKeyOffset(-6), toDay: todayKey()},
      model: undefined,
      providerId: null,
    });
    expect(
      nodeText(findByTestId(renderer.root, 'model-filter-entry')!),
    ).toContain('未记录服务商（历史）');
    // {服务商} · 其他模型：model: null + providerId: P——覆盖「P × 未配置模型」存量行。
    await act(async () => {
      findByTestId(renderer.root, 'model-filter-entry')!.props.onPress();
    });
    await act(async () => {
      findByTestId(
        renderer.root,
        'model-option-p1::__other__',
      )!.props.onPress();
      await flushPromises();
    });
    expect(mockGetSummary).toHaveBeenLastCalledWith({
      range: {fromDay: dayKeyOffset(-6), toDay: todayKey()},
      model: null,
      providerId: 'p1',
    });
    expect(
      nodeText(findByTestId(renderer.root, 'model-filter-entry')!),
    ).toContain('智谱 · 其他模型');
  });

  it('筛选 parity：无筛选返回的每个 (providerId, modelName) 组合至少被一个筛选项命中', async () => {
    // p2 为无任何已配置模型的服务商：其「其他模型」选项仍须生成。
    mockProvidersList.mockImplementation(async () => [
      {id: 'p1', displayName: '智谱'},
      {id: 'p2', displayName: 'OpenAI'},
    ]);
    mockListByProvider.mockImplementation(async (providerId: unknown) =>
      providerId === 'p1' ? [{providerId: 'p1', vendorModelId: 'gpt-4o'}] : [],
    );
    // 样例行覆盖五类组合：配置组合 / (P, 未配置模型) / (零配置服务商, 未配置
    // 模型) / (未记录, NULL) / (未记录, 已配置模型)——后四类含 CR-2 修复的
    // 存量行形态。
    const parityRows = [
      {
        providerId: 'p1',
        modelName: 'gpt-4o',
        calls: 4,
        promptTokens: 850,
        completionTokens: 100,
        totalTokens: 950,
        cacheReadTokens: 800,
        billedInputTokens: 600,
      },
      {
        providerId: 'p1',
        modelName: 'legacy-relay-model',
        calls: 1,
        promptTokens: 50,
        completionTokens: 0,
        totalTokens: 50,
        cacheReadTokens: 0,
        billedInputTokens: 50,
      },
      {
        providerId: 'p2',
        modelName: 'p2-only-model',
        calls: 1,
        promptTokens: 30,
        completionTokens: 0,
        totalTokens: 30,
        cacheReadTokens: 0,
        billedInputTokens: 30,
      },
      {
        providerId: null,
        modelName: null,
        calls: 2,
        promptTokens: 500,
        completionTokens: 100,
        totalTokens: 600,
        cacheReadTokens: 0,
        billedInputTokens: 500,
      },
      {
        providerId: null,
        modelName: 'gpt-4o',
        calls: 1,
        promptTokens: 40,
        completionTokens: 0,
        totalTokens: 40,
        cacheReadTokens: 0,
        billedInputTokens: 40,
      },
    ];
    mockGetModelBreakdown.mockImplementation(async () => parityRows);
    const renderer = await renderScreen();
    await act(async () => {
      findByTestId(renderer.root, 'model-filter-entry')!.props.onPress();
    });
    // 渲染出的选项 id 集合锁死生成规则：全部 / 配置组合 / 每服务商其他模型
    // （含 p2 这种零配置服务商）/ 未记录服务商。
    const optionIds = [
      ...new Set(
        renderer.root
          .findAll(
            node =>
              typeof node.props.testID === 'string' &&
              node.props.testID.startsWith('model-option-'),
          )
          .map(node =>
            (node.props.testID as string).slice('model-option-'.length),
          ),
      ),
    ].sort();
    expect(optionIds).toEqual(
      [
        '__all__',
        '__unlogged__',
        'p1::gpt-4o',
        'p1::__other__',
        'p2::__other__',
      ].sort(),
    );
    // 由渲染出的选项 id 还原筛选语义（与 StatsFilterBar 传参、core SQL
    // 口径一致），逐行断言覆盖：providerId 匹配 + model 三态（undefined 不筛 /
    // null 篚 NULL 或不在配置集 / 字串精确匹配）。
    const configuredModels = new Set(['gpt-4o']);
    const semantics = optionIds
      .filter(id => id !== '__all__')
      .map(id => {
        if (id === '__unlogged__') {
          return {providerId: null, model: undefined};
        }
        const sep = id.indexOf('::');
        const model = id.slice(sep + 2);
        return {
          providerId: id.slice(0, sep),
          model: model === '__other__' ? null : model,
        };
      });
    const uncovered = parityRows.filter(
      row =>
        !semantics.some(
          s =>
            (s.providerId === null
              ? row.providerId === null
              : row.providerId === s.providerId) &&
            (s.model === undefined
              ? true
              : s.model === null
              ? row.modelName == null || !configuredModels.has(row.modelName)
              : row.modelName === s.model),
        ),
    );
    expect(uncovered).toEqual([]);
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
      range: {fromDay: dayKeyOffset(-29), toDay: todayKey()},
      model: undefined,
      providerId: undefined,
    });
    await act(async () => {
      findByTestId(renderer.root, 'stats-tab-summary')!.props.onPress();
      await flushPromises();
    });
    // 回汇总页签：筛选状态保留（总览标题仍为近 30 天，未重置回近 7 天）。
    expect(JSON.stringify(renderer.toJSON())).toContain('近 30 天');
  });

  it('汇总页签：五指标卡，命中率 80%（T-M3：今日卡已删）', async () => {
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
    // 今日卡全删（summary 无 today 子对象，页签不再渲染）。
    expect(findByTestId(renderer.root, 'today-card')).toBeUndefined();
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
      range: {fromDay: dayKeyOffset(-6), toDay: todayKey()},
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

  it('汇总页签饼图：扇区数=行数不折叠，点选出详情行，占比分母=窗口 totalTokens（T-M4）', async () => {
    // 分母鉴别（P1-3 锁口径）：窗口 summary.totalTokens 人为错开饼图行总和
    // （2500 vs 600+950=1550）——占比必须按窗口总分母算（950/2500=38%、
    // 600/2500=24%）；若实现回退为行总和作分母（61%/39%），断言即失败。
    mockGetSummary.mockResolvedValue({
      ...SAMPLE_SUMMARY,
      totalTokens: 2500,
    });
    const renderer = await renderScreen(); // 默认汇总页签
    // SAMPLE_MODEL_ROWS 两行（未记录 600 / gpt-4o 950）→ 恰两扇区，
    // 按用量降序 gpt-4o 在前，不折叠不归并。
    expect(findByTestId(renderer.root, 'pie-sector-p1::gpt-4o')).toBeTruthy();
    expect(
      findByTestId(renderer.root, 'pie-sector-__np__::__unlogged__'),
    ).toBeTruthy();
    const legendText = nodeText(
      findByTestId(renderer.root, 'pie-legend-p1::gpt-4o')!,
    );
    expect(legendText).toContain('智谱 · gpt-4o');
    expect(
      nodeText(findByTestId(renderer.root, 'pie-legend-__np__::__unlogged__')!),
    ).toContain('未记录服务商（历史）');
    // 未选时无详情行。
    expect(findByTestId(renderer.root, 'pie-detail')).toBeUndefined();
    // 点选扇区：详情行 = 服务商·模型 / 用量 / 次数 / 占比（950/2500=38%，
    // 分母为窗口 summary.totalTokens 而非行总和）。
    await act(async () => {
      findByTestId(renderer.root, 'pie-sector-p1::gpt-4o')!.props.onPress();
      await flushPromises();
    });
    const detail = nodeText(findByTestId(renderer.root, 'pie-detail')!);
    expect(detail).toContain('智谱 · gpt-4o');
    expect(detail).toContain('950');
    expect(detail).toContain('调用 4 次');
    expect(detail).toContain('38%');
    // 点图例切换选中：600/2500=24%。
    await act(async () => {
      findByTestId(
        renderer.root,
        'pie-legend-__np__::__unlogged__',
      )!.props.onPress();
      await flushPromises();
    });
    const detail2 = nodeText(findByTestId(renderer.root, 'pie-detail')!);
    expect(detail2).toContain('未记录服务商（历史）');
    expect(detail2).toContain('600');
    expect(detail2).toContain('24%');
  });

  it('图表页签不含饼图，未选天时无命中率出口', async () => {
    const renderer = await renderScreen();
    await switchToDetailTab(renderer);
    const json = JSON.stringify(renderer.toJSON());
    expect(json).not.toContain('分服务商×模型汇总');
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
    // 配置侧无任何服务商×模型 → 库全空信号：冷启动引导而非「该区间无数据」。
    mockProvidersList.mockResolvedValue([]);
    mockListByProvider.mockResolvedValue([]);
    mockGetSummary.mockResolvedValue({
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      billedInputTokens: 0,
    });
    mockGetDailyBuckets.mockResolvedValue([]);
    mockGetModelBreakdown.mockResolvedValue([]);
    const renderer = await renderScreen();
    expect(findByTestId(renderer.root, 'empty-cold-start')).toBeTruthy();
    const json = JSON.stringify(renderer.toJSON());
    expect(json).toContain('自记录功能上线起开始积累');
    expect(json).not.toContain('该区间无数据');
    // 今日卡全删：库全空空态也不渲染（T-M3）。
    expect(findByTestId(renderer.root, 'today-card')).toBeUndefined();
    // 库全空优先级不变（回归锁）：冷启动引导拦全部页签，切流水页签
    // 也不放行——流水同样无数据可翻。
    await act(async () => {
      findByTestId(renderer.root, 'stats-tab-requests')!.props.onPress();
      await flushPromises();
    });
    expect(findByTestId(renderer.root, 'empty-cold-start')).toBeTruthy();
  });

  it('空态区分：范围内无数据提示该区间，不再保留今日卡（mobile/A-1 / T-M3）', async () => {
    // 库非空（配置侧有服务商×模型）但当前范围空：区间提示；今日卡已删。
    mockGetSummary.mockResolvedValue({
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      billedInputTokens: 0,
    });
    mockGetDailyBuckets.mockResolvedValue([]);
    mockGetModelBreakdown.mockResolvedValue([]);
    const renderer = await renderScreen();
    // 汇总页签（默认）：空态文案在场、无指标卡（不渲染 0 兑底卡片）。
    expect(findByTestId(renderer.root, 'empty-range')).toBeTruthy();
    expect(findByTestId(renderer.root, 'summary-metric-total')).toBeUndefined();
    const json = JSON.stringify(renderer.toJSON());
    expect(json).toContain('该区间无数据');
    expect(json).not.toContain('自记录功能上线起开始积累');
    expect(findByTestId(renderer.root, 'today-card')).toBeUndefined();
    // 图表页签同样被范围空态拦：空态文案在场、无柱状图。
    await switchToDetailTab(renderer);
    expect(findByTestId(renderer.root, 'empty-range')).toBeTruthy();
    expect(findByTestId(renderer.root, 'daily-chart')).toBeUndefined();
  });

  it('窗口空 + 流水页签：与其他页签统一显示区间空态，不渲染流水行（需求①勘误）', async () => {
    // 窗口空（今天还没用量）但库有历史：流水随时间窗口（勘误后不再解绑），
    // 切到流水页签与其他页签统一被「该区间无数据」拦住——不渲染流水行
    // 与页码条（拉取照发但 filter 含 range，数据层与展示层口径一致）。
    mockGetSummary.mockResolvedValue({
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      billedInputTokens: 0,
    });
    mockGetDailyBuckets.mockResolvedValue([]);
    mockGetModelBreakdown.mockResolvedValue([]);
    const renderer = await renderScreen();
    // 默认汇总页签被范围空态拦住作为前置。
    expect(findByTestId(renderer.root, 'empty-range')).toBeTruthy();
    await act(async () => {
      findByTestId(renderer.root, 'stats-tab-requests')!.props.onPress();
      await flushPromises();
    });
    // 空态仍在场拦住流水：无流水行、无页码条。
    expect(findByTestId(renderer.root, 'empty-range')).toBeTruthy();
    expect(findByTestId(renderer.root, 'empty-cold-start')).toBeUndefined();
    expect(findByTestId(renderer.root, 'req-page-1')).toBeUndefined();
    expect(nodeText(renderer.root)).not.toContain('首字延迟 900 ms');
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

  it('自定义区间：sheet 选起止日后以 custom range 重查（跨度不设上限）', async () => {
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
    // 自定义区间由 sheet 结果产日期字符串（本地日 key），不再有毫秒换算。
    expect(mockGetDailyBuckets).toHaveBeenLastCalledWith({
      range: {
        fromDay: toLocalDayKey(dayMs(year, month, 3)),
        toDay: toLocalDayKey(dayMs(year, month, 10)),
      },
      model: undefined,
    });
  });

  it('自定义区间结束日跨 DST 边界：日期字符串按挂钟日产出（cross/B-2 / T-M6）', async () => {
    // 照 desktop test 的做法：运行时切纽约时区再断言；TZ 不可控则跳过
    // （toLocalDayKey 直接读本地年月日，跨 DST 天然正确；用例锢定
    // 日期字符串口径不回退到毫秒换算）。jest 没有 node:test 的
    // t.skip，这里以探测失败即返回兼底，避免假失败。
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
          // 结束日 03-08 为 23 小时日：日期字符串仍按挂钟日 03-07/03-08
          // 产出（回退到毫秒换算的回归在这里会被抓到）。
          fromDay: '2026-03-07',
          toDay: '2026-03-08',
        },
        model: undefined,
      });
    } finally {
      process.env.TZ = prevTz;
    }
  });

  it('「今天」筛选：range 传当天闭区间，自动选今天，图表页签直出小时图（T-M1）', async () => {
    const today = todayKey();
    const [y, m, d] = today.split('-').map(Number);
    // today 的日桶：core 稠密补零保证唯一桶（此处给非零形态供汇总行）。
    mockGetDailyBuckets.mockResolvedValue([
      {
        bucketStartMs: dayMs(y, m - 1, d),
        calls: 3,
        promptTokens: 300,
        completionTokens: 60,
        cacheReadTokens: 100,
        cacheCreationTokens: 0,
        billedInputTokens: 200,
        avgFirstTokenMs: 800,
        avgTokensPerSecond: 30,
      },
    ]);
    const renderer = await renderScreen();
    await act(async () => {
      findByTestId(renderer.root, 'range-today')!.props.onPress();
      await flushPromises();
    });
    expect(mockGetDailyBuckets).toHaveBeenLastCalledWith({
      range: {fromDay: today, toDay: today},
      model: undefined,
      providerId: undefined,
    });
    // 自动补选今天（P1-1：写进 reload 成功回调而非独立 effect）→ 小时桶加载。
    expect(mockGetHourlyBuckets).toHaveBeenCalledWith(today, {
      range: {fromDay: today, toDay: today},
      model: undefined,
    });
    // 图表页签：隐藏按天图，直出当天汇总行 + 24 小时图。
    await switchToDetailTab(renderer);
    expect(findByTestId(renderer.root, 'daily-chart')).toBeUndefined();
    expect(findByTestId(renderer.root, 'hourly-chart')).toBeTruthy();
    const json = JSON.stringify(renderer.toJSON());
    expect(json).not.toContain('按天用量');
    expect(json).toContain('按小时分布');
    expect(json).toContain(today);
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

describe('T-M7 PieChart 组件级', () => {
  const CHART_TOKENS = {
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
  };

  const PIE_ROWS = [
    {key: 'a', label: 'A · m1', totalTokens: 700, calls: 7},
    {key: 'b', label: 'B · m2', totalTokens: 250, calls: 2},
    {key: 'c', label: '未记录服务商（历史）', totalTokens: 50, calls: 1},
  ];

  async function renderPie() {
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        // 分母错开行总和（2500 vs 700+250+50=1000）：占比按传入的窗口
        // 总分母算，锁死调用方分母口径（与 T-M4 同理，P1-3）。
        <PieChart data={PIE_ROWS} totalTokens={2500} tokens={CHART_TOKENS} />,
      );
      await flushPromises();
    });
    return renderer!;
  }

  it('三行渲染三扇区；点扇区出详情行，点图例切换选中，再点同项取消', async () => {
    const renderer = await renderPie();
    expect(findByTestId(renderer.root, 'pie-sector-a')).toBeTruthy();
    expect(findByTestId(renderer.root, 'pie-sector-b')).toBeTruthy();
    expect(findByTestId(renderer.root, 'pie-sector-c')).toBeTruthy();
    // 小扇区（50/1000）也能从图例命中（c 行）。
    expect(findByTestId(renderer.root, 'pie-legend-c')).toBeTruthy();
    // 未选中：无详情行。
    expect(findByTestId(renderer.root, 'pie-detail')).toBeUndefined();
    // 点扇区 a：700/2500 = 28%（分母为传入的 totalTokens，非行总和 1000）。
    await act(async () => {
      findByTestId(renderer.root, 'pie-sector-a')!.props.onPress();
      await flushPromises();
    });
    let detail = nodeText(findByTestId(renderer.root, 'pie-detail')!);
    expect(detail).toContain('A · m1');
    expect(detail).toContain('700');
    expect(detail).toContain('调用 7 次');
    expect(detail).toContain('28%');
    // 点图例 c 切换选中：50/2500 = 2%。
    await act(async () => {
      findByTestId(renderer.root, 'pie-legend-c')!.props.onPress();
      await flushPromises();
    });
    detail = nodeText(findByTestId(renderer.root, 'pie-detail')!);
    expect(detail).toContain('未记录服务商（历史）');
    expect(detail).toContain('2%');
    // 再点同一图例：取消选中，详情行消失。
    await act(async () => {
      findByTestId(renderer.root, 'pie-legend-c')!.props.onPress();
      await flushPromises();
    });
    expect(findByTestId(renderer.root, 'pie-detail')).toBeUndefined();
  });

  it('唯一非零行满圆扇区与零值行：不渲染退化扇区，图例仍在（T-M7 兜底形态）', async () => {
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <PieChart
          data={[
            {key: 'only', label: 'X · m', totalTokens: 400, calls: 4},
            {key: 'zero', label: 'Y · m', totalTokens: 0, calls: 0},
          ]}
          totalTokens={400}
          tokens={CHART_TOKENS}
        />,
      );
      await flushPromises();
    });
    // 满圆行渲染扇区（Circle 满圆路径），零值行角度退化不渲染扇区。
    expect(findByTestId(renderer!.root, 'pie-sector-only')).toBeTruthy();
    expect(findByTestId(renderer!.root, 'pie-sector-zero')).toBeUndefined();
    expect(findByTestId(renderer!.root, 'pie-legend-zero')).toBeTruthy();
  });
});

describe('T-M6 自定义区间校验（无上限）', () => {
  it('366 天、十年均合法，仅倒序非法', () => {
    const from = new Date(2026, 0, 1);
    expect(isCustomRangeValid(from, new Date(2027, 0, 1))).toBe(true); // 366 天
    expect(isCustomRangeValid(from, new Date(2036, 0, 1))).toBe(true); // 十年
    expect(
      isCustomRangeValid(new Date(2026, 0, 10), new Date(2026, 0, 1)),
    ).toBe(false); // from > to
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
    expect(nodeText(rateTile!)).toContain('45.5 t/s');
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
    expect(json).toContain('25.0 t/s');
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

  it('流水跟随时间：改时间重拉且 filter 含 range；改组合筛选重拉且叠加 model/providerId（T-M5）', async () => {
    const renderer = await renderScreen();
    await act(async () => {
      findByTestId(renderer.root, 'stats-tab-requests')!.props.onPress();
      await flushPromises();
    });
    expect(mockListRequestUsage).toHaveBeenCalledTimes(1);
    // 首拉 filter 含 range（last7 窗口，与汇总/图表同窗口）。
    expect(mockListRequestUsage.mock.calls[0]![0]).toEqual({
      range: {fromDay: dayKeyOffset(-6), toDay: todayKey()},
      model: undefined,
      providerId: undefined,
    });
    // 切时间（last30）：脏标记不豁免时间维度（P1-2 勘误后），停在流水页
    // 立即重拉，filter 换成 last30 窗口。
    await act(async () => {
      findByTestId(renderer.root, 'range-last30')!.props.onPress();
      await flushPromises();
    });
    expect(mockGetDailyBuckets).toHaveBeenCalledTimes(2);
    expect(mockListRequestUsage).toHaveBeenCalledTimes(2);
    expect(mockListRequestUsage.mock.calls[1]![0]).toEqual({
      range: {fromDay: dayKeyOffset(-29), toDay: todayKey()},
      model: undefined,
      providerId: undefined,
    });
    // 切组合筛选（未记录服务商，CR-2 三态之一）：重拉且叠加 model/providerId。
    await act(async () => {
      findByTestId(renderer.root, 'model-filter-entry')!.props.onPress();
    });
    await act(async () => {
      findByTestId(renderer.root, 'model-option-__unlogged__')!.props.onPress();
      await flushPromises();
    });
    expect(mockListRequestUsage).toHaveBeenCalledTimes(3);
    expect(mockListRequestUsage.mock.calls[2]![0]).toEqual({
      range: {fromDay: dayKeyOffset(-29), toDay: todayKey()},
      model: undefined,
      providerId: null,
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

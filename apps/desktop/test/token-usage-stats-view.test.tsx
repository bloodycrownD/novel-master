/**
 * TokenUsageStatsView 渲染与交互（spec T-S6 的 view 部分 / Step 7）：
 * - 「汇总 / 明细」双页签：默认汇总（五指标卡 + 今日卡 + 分模型表）；切页签不重查、筛选共享；
 * - 汇总页签：分模型表（无命中率列，含「未记录」行、按用量降序）；明细页签：按天柱状图（data-day 序列）；
 * - 空态区分（库全空冷启动 vs 范围内无数据保留今日卡）；自定义区间 ≤366 天校验（超限行内提示且不再发查询）；
 * - kind / filter 参数随筛选（时间范围 × 模型三态）切换正确；点选某天 → hourly 钻取；
 * - 主查询竞态守卫（旧响应后到不覆盖新数据）；错误路径（{ok:false} 保留旧数据 / 格式异常）；
 * - custom toMs 跨 DST 边界（日历推进而非固定毫秒加法）。
 *
 * 范式与 fetch-models-modal.test.tsx 一致：注册 react-alias-hook.mjs 统一 react 副本，
 * react-test-renderer 真渲组件，mock 拦在 window.novelMasterDesktop.invoke 按 channel + kind 路由。
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import { describe, it } from "node:test";
import TestRenderer, {
  type ReactTestRenderer,
  type ReactTestRendererRoot,
} from "react-test-renderer";

// 先注册钩子，再动态导入 act 与组件（统一根 react 副本）。
register(new URL("./react-alias-hook.mjs", import.meta.url));
const { act } = await import("react");
const { TokenUsageStatsView } = await import(
  "@/features/settings/TokenUsageStatsView"
);

/** 与视图同口径的本地 0 点构造（相对今天偏移 N 天），避免用例受时区影响。 */
function localMidnight(offsetDays: number): number {
  const now = new Date();
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + offsetDays,
  ).getTime();
}

function toDayKey(ms: number): string {
  const d = new Date(ms);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/** 桶工厂（字段与 UsageStatsBucketDto 一致；timing 缺省为存量 null 形态）。 */
function bucket(
  bucketStartMs: number,
  calls: number,
  promptTokens: number,
  completionTokens: number,
  cacheReadTokens: number,
  billedInputTokens: number,
  timing?: { avgFirstTokenMs?: number | null; avgTokensPerSecond?: number | null },
) {
  return {
    bucketStartMs,
    calls,
    promptTokens,
    completionTokens,
    cacheReadTokens,
    cacheCreationTokens: 0,
    billedInputTokens,
    avgFirstTokenMs: timing?.avgFirstTokenMs ?? null,
    avgTokensPerSecond: timing?.avgTokensPerSecond ?? null,
  };
}

const SUMMARY = {
  calls: 12,
  promptTokens: 1000,
  completionTokens: 2000,
  totalTokens: 3000,
  cacheReadTokens: 400,
  cacheCreationTokens: 600,
  billedInputTokens: 2000,
  avgFirstTokenMs: 1200,
  avgTokensPerSecond: 45.5,
  today: { totalTokens: 550, calls: 3 },
};

/** 3 个有量的天（today-6 / -5 / -2），中间夹杂无 cache 数据（billed=0）的桶。 */
const DAILY = [
  bucket(localMidnight(-6), 3, 1200, 800, 400, 1000, {
    avgFirstTokenMs: 900,
    avgTokensPerSecond: 25,
  }),
  bucket(localMidnight(-5), 1, 300, 200, 0, 0),
  bucket(localMidnight(-2), 2, 900_000, 100_000, 750_000, 900_000),
];

/** 24 小时桶（仅 5 时有量，其余 0）。 */
const HOURLY: ReturnType<typeof bucket>[] = Array.from({ length: 24 }, (_, h) =>
  h === 5
    ? bucket(localMidnight(-6) + 5 * 3_600_000, 2, 500, 300, 100, 500)
    : bucket(localMidnight(-6) + h * 3_600_000, 0, 0, 0, 0, 0),
);

/** 故意乱序 + 含「未记录」（null）行——视图应按用量降序重排。 */
const MODEL_ROWS = [
  {
    modelName: null,
    calls: 2,
    promptTokens: 500,
    completionTokens: 300,
    totalTokens: 800,
    cacheReadTokens: 0,
    billedInputTokens: 0,
  },
  {
    modelName: "gpt-4o",
    calls: 10,
    promptTokens: 600,
    completionTokens: 600,
    totalTokens: 1200,
    cacheReadTokens: 300,
    billedInputTokens: 600,
  },
];

const MODELS = ["claude-3-5-sonnet", "gpt-4o"];

interface UsageQueryPayload {
  kind: string;
  filter: { range: { kind: string }; model?: string | null };
  dayLocalDate?: string;
  offset?: number;
  limit?: number;
}

interface MockData {
  /** 静态样例，或按请求路由的函数（库全空探底查询与用户查询需区分返回时用）。 */
  summary?: unknown | ((req: UsageQueryPayload) => unknown);
  daily?: unknown;
  hourly?: unknown;
  modelRows?: unknown;
  models?: unknown;
  requests?: unknown;
}

/** 流水样例：两行（有 timing / 存量 null），total=260 → 50/页 共 6 页。 */
const REQUEST_PAGE = {
  rows: [
    {
      createdAtMs: Date.UTC(2026, 7, 23, 3, 0),
      modelName: "gpt-4o",
      promptTokens: 900,
      completionTokens: 100,
      totalTokens: 1000,
      cacheReadTokens: 500,
      cacheCreationTokens: 0,
      firstTokenMs: 900,
      durationMs: 8_000,
    },
    {
      createdAtMs: Date.UTC(2026, 7, 22, 7, 0),
      modelName: null,
      promptTokens: 400,
      completionTokens: 100,
      totalTokens: 500,
      cacheReadTokens: null,
      cacheCreationTokens: null,
      firstTokenMs: null,
      durationMs: null,
    },
  ],
  total: 260,
};

/** 拦在 ipc client 底层出口：按 nm:usageStats/query 的 payload.kind 路由回样例数据。 */
function makeInvoke(
  data: MockData,
  requests: UsageQueryPayload[] = [],
): (channel: string, payload: unknown) => Promise<unknown> {
  return (channel, payload) => {
    if (channel !== "nm:usageStats/query") {
      return Promise.reject(new Error(`测试未预期的 IPC channel: ${channel}`));
    }
    const req = payload as UsageQueryPayload;
    requests.push(req);
    switch (req.kind) {
      case "summary": {
        const sum =
          typeof data.summary === "function" ? data.summary(req) : data.summary;
        return Promise.resolve({ ok: true, data: sum ?? SUMMARY });
      }
      case "daily":
        return Promise.resolve({ ok: true, data: data.daily ?? DAILY });
      case "hourly":
        return Promise.resolve({ ok: true, data: data.hourly ?? HOURLY });
      case "modelBreakdown":
        return Promise.resolve({ ok: true, data: data.modelRows ?? MODEL_ROWS });
      case "models":
        return Promise.resolve({ ok: true, data: data.models ?? MODELS });
      case "requests":
        return Promise.resolve({
          ok: true,
          data: data.requests ?? REQUEST_PAGE,
        });
      default:
        return Promise.reject(new Error(`测试未预期的 kind: ${req.kind}`));
    }
  };
}

/** 挂全局 window.novelMasterDesktop，返回还原函数。 */
function mockWindow(
  invoke: (channel: string, payload: unknown) => Promise<unknown>,
): () => void {
  const g = globalThis as unknown as {
    window?: unknown;
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const prevWindow = g.window;
  const prevActEnv = g.IS_REACT_ACT_ENVIRONMENT;
  g.window = { novelMasterDesktop: { invoke } };
  g.IS_REACT_ACT_ENVIRONMENT = true;
  return () => {
    g.window = prevWindow;
    g.IS_REACT_ACT_ENVIRONMENT = prevActEnv;
  };
}

/** 挂载并等待首个 filter effect 的三连查询落地。 */
async function mountView(): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = TestRenderer.create(<TokenUsageStatsView />);
  });
  if (renderer == null) {
    throw new Error("渲染失败");
  }
  return renderer;
}

function metricText(root: ReactTestRendererRoot, metric: string): string {
  const node = root.findByProps({ "data-metric": metric });
  const value = node.findAll(
    (child) =>
      typeof child.props.className === "string" &&
      child.props.className.startsWith("token-stats-card__value"),
  )[0];
  return (value.children as unknown[]).map((c) => String(c)).join("");
}

function chartCols(root: ReactTestRendererRoot, chart: string): string[] {
  const container = root.findAll((node) => node.props["data-chart"] === chart);
  if (container.length === 0) {
    return [];
  }
  return container[0]!
    .findAll(
      (node) =>
        typeof node.props.className === "string" &&
        /^token-stats-chart__col( |$)/.test(node.props.className),
    )
    .map((node) => node.props["data-day"] as string);
}

function modelRowKeys(root: ReactTestRendererRoot): string[] {
  return root
    .findAll(
      (node) =>
        typeof node.props.className === "string" &&
        /^token-stats-models__row( |$)/.test(node.props.className),
    )
    .filter((node) => !node.props.className.includes("--head"))
    .map((node) => node.props["data-model"] as string);
}

/** 点击 SegmentedControl 按钮（按按钮文本定位）。 */
async function clickSegmented(
  root: ReactTestRendererRoot,
  label: string,
): Promise<void> {
  await act(async () => {
    const btn = root
      .findAll(
        (node) =>
          typeof node.props.className === "string" &&
          /^segmented-control__btn( |$)/.test(node.props.className),
      )
      .find(
        (node) => (node.children as unknown[]).some((c) => c === label),
      );
    assert.ok(btn != null, `未找到分段按钮：${label}`);
    btn.props.onClick();
  });
}

/** 模型下拉选值（受控 select：onChange 只读 e.target.value）。 */
async function selectModel(
  root: ReactTestRendererRoot,
  value: string,
): Promise<void> {
  await act(async () => {
    root.findByProps({ className: "token-stats-view__model-select" }).props.onChange({
      target: { value },
    });
  });
}

/** 日期输入（按 aria-label 定位）。 */
async function setDate(
  root: ReactTestRendererRoot,
  ariaLabel: string,
  value: string,
): Promise<void> {
  await act(async () => {
    root.findByProps({ className: "token-stats-view__date", "aria-label": ariaLabel }).props.onChange(
      { target: { value } },
    );
  });
}

/** 点击某根按天柱。 */
async function clickDayCol(root: ReactTestRendererRoot, day: string): Promise<void> {
  await act(async () => {
    const btn = root.findAll(
      (node) =>
        typeof node.props.className === "string" &&
        /^token-stats-chart__col( |$)/.test(node.props.className),
    );
    const col = btn.find((node) => node.props["data-day"] === day);
    assert.ok(col != null, `未找到按天柱：${day}`);
    col.props.onClick();
  });
}

describe("TokenUsageStatsView（T-S6 view 部分）", () => {
  it("汇总页签：五指标卡 + 今日卡 + 分模型表（无命中率列）；明细页签：按天柱；页签共享筛选不重查", async () => {
    const requests: UsageQueryPayload[] = [];
    const restore = mockWindow(makeInvoke({}, requests));
    let renderer: ReactTestRenderer | undefined;
    try {
      renderer = await mountView();
      const root = renderer.root;

      // 默认落在「汇总」页签：五指标卡（总 3K / 输入 1K / 输出 2K / 调用 12 / 命中率 400÷2000=20%）
      assert.equal(metricText(root, "totalTokens"), "3K");
      assert.equal(metricText(root, "promptTokens"), "1K");
      assert.equal(metricText(root, "completionTokens"), "2K");
      assert.equal(metricText(root, "calls"), "12");
      assert.equal(metricText(root, "hitRate"), "20%");

      // 今日卡（独立于筛选）
      assert.equal(metricText(root, "todayTotalTokens"), "550");
      assert.equal(metricText(root, "todayCalls"), "3");

      // 汇总页签不渲染明细图表
      assert.deepEqual(chartCols(root, "daily"), []);

      // 分模型汇总（挂在汇总页签）：按用量降序（gpt-4o 1200 → 其他 800），null 行显示「其他」
      assert.deepEqual(modelRowKeys(root), ["gpt-4o", "__unlogged__"]);
      const unloggedRow = root.findAll(
        (node) => node.props["data-model"] === "__unlogged__",
      )[0]!;
      assert.ok(
        unloggedRow
          .findAll((n) => n.props.className === "token-stats-models__name")
          .some((n) => (n.children as unknown[]).includes("其他")),
        "其他模型行（null）应展示「其他」名称",
      );

      // 表头无命中率列：模型 / 用量 / 占比 / 调用次数
      const headRow = root.findAll(
        (node) =>
          typeof node.props.className === "string" &&
          node.props.className.includes("token-stats-models__row--head"),
      )[0]!;
      const headTexts = (headRow.children as unknown[]).map((c) =>
        String((c as { props: { children: unknown } }).props.children),
      );
      assert.deepEqual(headTexts, ["模型", "用量", "占比", "调用次数"]);

      // 数据行单元格：名称 / 用量 / 占比 / 调用次数（不再有命中率出口）
      const gptRow = root.findAll((node) => node.props["data-model"] === "gpt-4o")[0]!;
      const cellTexts = (gptRow.children as unknown[]).map((c) =>
        String((c as { props: { children: unknown } }).props.children),
      );
      assert.deepEqual(cellTexts, ["gpt-4o", "1.2K", "40%", "10"]);

      // 模型下拉（共享筛选栏，两页签都在）：全部 / 库内模型 / 其他模型（DEV-1：UI 侧补「其他模型」选项，语义为 NULL + 非当前配置历史模型）
      const select = root.findByProps({ className: "token-stats-view__model-select" });
      const optionValues = select.children.map(
        (c: { props: { value: string } }) => c.props.value,
      );
      assert.deepEqual(optionValues, [
        "__all__",
        "claude-3-5-sonnet",
        "gpt-4o",
        "__unlogged__",
      ]);
      // 下拉文案：哨兵选项展示「其他模型」（value 名保留 __unlogged__ 历史命名）
      assert.ok(
        select.children.some(
          (c: { props: { value: string; children: unknown } }) =>
            c.props.value === "__unlogged__" &&
            (c.props.children as unknown[]).includes("其他模型"),
        ),
        "哨兵选项文案应为「其他模型」",
      );

      // 切到「明细」：页签共享筛选与数据，不触发任何新查询；只剩按天柱，不含分模型表
      requests.length = 0;
      await clickSegmented(root, "明细");
      assert.equal(requests.length, 0, "切换页签不应重新查询");
      assert.deepEqual(chartCols(root, "daily"), DAILY.map((b) => toDayKey(b.bucketStartMs)));
      assert.equal(modelRowKeys(root).length, 0, "明细页签不应渲染分模型表");

      // 切回「汇总」：卡片与分模型表仍在，明细图表隐藏（筛选与数据保持）
      await clickSegmented(root, "汇总");
      assert.equal(metricText(root, "totalTokens"), "3K");
      assert.deepEqual(chartCols(root, "daily"), []);
      assert.deepEqual(modelRowKeys(root), ["gpt-4o", "__unlogged__"]);
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      restore();
    }
  });

  it("空态区分（库全空）：冷启动引导文案，不渲染图表与今日卡", async () => {
    const requests: UsageQueryPayload[] = [];
    const restore = mockWindow(
      makeInvoke(
        {
          // 范围内空、今日空，探底（custom 宽范围 summary）也空 → 库全空
          summary: { ...SUMMARY, calls: 0, totalTokens: 0, today: { totalTokens: 0, calls: 0 } },
          daily: [],
          modelRows: [],
        },
        requests,
      ),
    );
    let renderer: ReactTestRenderer | undefined;
    try {
      renderer = await mountView();
      const root = renderer.root;

      const empty = root.findByProps({ className: "settings-list__empty" });
      const emptyText = (empty.children as unknown[]).map((c) => String(c)).join("");
      assert.ok(
        emptyText.includes("上线起开始积累"),
        "库全空应展示冷启动引导文案",
      );
      assert.deepEqual(chartCols(root, "daily"), []);
      assert.equal(modelRowKeys(root).length, 0);
      // 库全空时今日卡必为 0，不随冷启动文案渲染
      assert.equal(
        root.findAll((node) => node.props["data-metric"] === "todayTotalTokens").length,
        0,
        "库全空不应渲染今日卡",
      );

      // 空态对两个页签一致：切到「明细」仍展示空态，不渲染图表与分模型表
      await clickSegmented(root, "明细");
      assert.deepEqual(chartCols(root, "daily"), []);
      assert.equal(modelRowKeys(root).length, 0);
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      restore();
    }
  });

  it("空态区分（范围内无数据）：「该区间无数据」文案 + 保留今日卡", async () => {
    const requests: UsageQueryPayload[] = [];
    const restore = mockWindow(
      makeInvoke(
        {
          // 用户查询（last7）范围内空但今日有量；探底（custom 宽范围）非空 → 库有数据
          summary: (req) =>
            req.filter.range.kind === "custom"
              ? SUMMARY
              : { ...SUMMARY, calls: 0, totalTokens: 0, today: { totalTokens: 120, calls: 2 } },
          daily: [],
          modelRows: [],
        },
        requests,
      ),
    );
    let renderer: ReactTestRenderer | undefined;
    try {
      renderer = await mountView();
      const root = renderer.root;

      const empty = root.findByProps({ className: "settings-list__empty" });
      const emptyText = (empty.children as unknown[]).map((c) => String(c)).join("");
      assert.ok(
        emptyText.includes("当前筛选范围内暂无用量数据"),
        "范围内无数据应提示该区间无数据",
      );
      assert.deepEqual(chartCols(root, "daily"), []);
      assert.equal(modelRowKeys(root).length, 0);
      // 今日卡独立于筛选，不随范围空态消失
      assert.equal(metricText(root, "todayTotalTokens"), "120");
      assert.equal(metricText(root, "todayCalls"), "2");
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      restore();
    }
  });

  it("kind / filter 参数随筛选切换正确（时间范围 × 模型三态）", async () => {
    const requests: UsageQueryPayload[] = [];
    const restore = mockWindow(makeInvoke({}, requests));
    let renderer: ReactTestRenderer | undefined;
    try {
      renderer = await mountView();
      const root = renderer.root;

      // 初始挂载：models + summary/daily/modelBreakdown（last7、model 全部）
      const kinds = requests.map((r) => r.kind).sort();
      assert.deepEqual(kinds, ["daily", "modelBreakdown", "models", "summary"]);
      assert.ok(
        requests.every((r) => r.filter.range.kind === "last7" && r.filter.model === undefined),
      );

      // 切到近 30 天：三连查询 range.kind=last30
      requests.length = 0;
      await clickSegmented(root, "近 30 天");
      assert.deepEqual(
        requests.map((r) => r.kind).sort(),
        ["daily", "modelBreakdown", "summary"],
      );
      assert.ok(requests.every((r) => r.filter.range.kind === "last30"));

      // 模型三态：指定模型 → 字符串；未记录 → null；全部 → undefined
      requests.length = 0;
      await selectModel(root, "gpt-4o");
      assert.ok(
        requests.length > 0 &&
          requests.every((r) => r.filter.model === "gpt-4o"),
      );

      requests.length = 0;
      await selectModel(root, "__unlogged__");
      assert.ok(requests.length > 0 && requests.every((r) => r.filter.model === null));

      requests.length = 0;
      await selectModel(root, "__all__");
      assert.ok(requests.length > 0 && requests.every((r) => r.filter.model === undefined));

      // 页签共享筛选：切「明细」不重查；在明细页签下改时间范围仍触发三连查询
      // （当前已是近 30 天，切回近 7 天验证）
      requests.length = 0;
      await clickSegmented(root, "明细");
      assert.equal(requests.length, 0, "切换页签不应重新查询");
      await clickSegmented(root, "近 7 天");
      assert.deepEqual(
        requests.map((r) => r.kind).sort(),
        ["daily", "modelBreakdown", "summary"],
      );
      assert.ok(requests.every((r) => r.filter.range.kind === "last7"));
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      restore();
    }
  });

  it("自定义区间：预填最近 7 天发起 custom 查询；超 366 天行内提示且不再查询", async () => {
    const requests: UsageQueryPayload[] = [];
    const restore = mockWindow(makeInvoke({}, requests));
    let renderer: ReactTestRenderer | undefined;
    try {
      renderer = await mountView();
      const root = renderer.root;

      // 切到自定义：预填 today-6 ~ today，from=起始日 0 点、to=结束日次日 0 点
      requests.length = 0;
      await clickSegmented(root, "自定义");
      const custom = requests.filter((r) => r.filter.range.kind === "custom");
      assert.equal(custom.length, 3);
      const first = custom[0]!.filter.range as { fromMs?: number; toMs?: number };
      assert.equal(first.fromMs, localMidnight(-6));
      assert.equal(first.toMs, localMidnight(1));

      // 起始日拉到 2020-01-01：超 366 天 → 行内提示、无新查询
      requests.length = 0;
      await setDate(root, "开始日期", "2020-01-01");
      const err = root.findByProps({ className: "token-stats-view__range-error" });
      const errText = (err.children as unknown[]).map((c) => String(c)).join("");
      assert.equal(errText, "自定义区间最长 366 天");
      assert.equal(requests.length, 0, "区间非法时不应发起查询");
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      restore();
    }
  });

  it("点选某天 → hourly 钻取（dayLocalDate + 24 小时柱 + 当天汇总行含命中率）；再点取消", async () => {
    const requests: UsageQueryPayload[] = [];
    const restore = mockWindow(makeInvoke({}, requests));
    let renderer: ReactTestRenderer | undefined;
    try {
      renderer = await mountView();
      const root = renderer.root;

      // 按天图在「明细」页签：先切过去再点选
      await clickSegmented(root, "明细");
      const dayKey = toDayKey(DAILY[0]!.bucketStartMs);
      requests.length = 0;
      await clickDayCol(root, dayKey);

      // hourly 请求：kind=hourly、dayLocalDate=选中天、filter 保留当前模型维度
      const hourly = requests.filter((r) => r.kind === "hourly");
      assert.equal(hourly.length, 1);
      assert.equal(hourly[0]!.dayLocalDate, dayKey);
      assert.equal(hourly[0]!.filter.range.kind, "last7");

      // 24 小时柱 + 当天汇总行（标题含选中日期；汇总行保留命中率出口：400÷1000=40%）
      assert.equal(chartCols(root, "hourly").length, 24);
      // hourly 柱为纯展示（role="img" 的 div）：不可聚焦 button；按天柱仍可交互（desktop/J-1）
      const hourlyContainer = root.findAll((node) => node.props["data-chart"] === "hourly")[0]!;
      assert.equal(
        hourlyContainer.findAll((node) => node.type === "button").length,
        0,
        "hourly 柱不应渲染为可聚焦 button",
      );
      assert.equal(
        hourlyContainer.findAll((node) => node.props.role === "img").length,
        24,
        "hourly 柱应为 role=img 的纯展示节点",
      );
      const dailyContainer = root.findAll((node) => node.props["data-chart"] === "daily")[0]!;
      assert.equal(
        dailyContainer.findAll((node) => node.type === "button").length,
        DAILY.length,
        "按天柱应保持可交互 button",
      );
      const detail = root.findByProps({ "data-day-detail": dayKey });
      const detailSummary = detail.children
        .filter((c: { props?: { className?: string } }) => c.props?.className === "token-stats-view__day-detail-summary")
        .map((c: { props: { children: unknown[] } }) =>
          (c.props.children as unknown[]).map((x) => String(x)).join(""),
        )
        .join("");
      assert.ok(detailSummary.includes("40%"), "当天汇总行应保留命中率");

      // 再点同一根柱 → 取消选中
      await clickDayCol(root, dayKey);
      assert.equal(
        root.findAll((node) => node.props["data-day-detail"] === dayKey).length,
        0,
      );
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      restore();
    }
  });

  it("主查询竞态：旧响应后 resolve 不覆盖新数据（cross/B-1）", async () => {
    const requests: UsageQueryPayload[] = [];
    // 第二轮（last30）数据与第一轮（last7）可区分：总 token 9K vs 3K
    const SUMMARY_B = {
      ...SUMMARY,
      promptTokens: 5000,
      completionTokens: 4000,
      totalTokens: 9000,
    };
    const DAILY_B = [bucket(localMidnight(-2), 1, 10, 5, 0, 10)];
    const ROWS_B = [
      {
        modelName: "claude-3-5-sonnet",
        calls: 9,
        promptTokens: 5000,
        completionTokens: 4000,
        totalTokens: 9000,
        cacheReadTokens: 0,
        billedInputTokens: 0,
      },
    ];
    const dataOf = (kind: string): unknown =>
      kind === "summary" ? SUMMARY_B : kind === "daily" ? DAILY_B : ROWS_B;
    // 第一轮（last7）三连挂起，手动释放；其余（models / last30）立即返回
    const pending: Array<(v: { ok: true; data: unknown }) => void> = [];
    const restore = mockWindow((channel, payload) => {
      if (channel !== "nm:usageStats/query") {
        return Promise.reject(new Error(`测试未预期的 IPC channel: ${channel}`));
      }
      const req = payload as UsageQueryPayload;
      requests.push(req);
      if (req.kind === "models" || req.kind === "hourly") {
        return Promise.resolve({ ok: true, data: req.kind === "models" ? MODELS : HOURLY });
      }
      if (req.filter.range.kind === "last30") {
        return Promise.resolve({ ok: true, data: dataOf(req.kind) });
      }
      return new Promise((resolve) => {
        pending.push(resolve as (v: { ok: true; data: unknown }) => void);
      });
    });
    let renderer: ReactTestRenderer | undefined;
    try {
      renderer = await mountView();
      const root = renderer.root;

      // 快速切筛选：第一轮（last7）仍挂起，第二轮（last30）先落地
      await clickSegmented(root, "近 30 天");
      assert.equal(metricText(root, "totalTokens"), "9K", "第二轮数据应先落地");
      assert.deepEqual(modelRowKeys(root), ["claude-3-5-sonnet"]);

      // 旧响应后到：第一轮（last7，3K / gpt-4o）随后 resolve，应被整体丢弃。
      // 按请求顺序回填正确旧数据（summary / daily / modelBreakdown），
      // 保证断言失败时能归因到竞态守卫而非 shape 校验兜底。
      const staleData: unknown[] = [SUMMARY, DAILY, MODEL_ROWS];
      await act(async () => {
        pending.forEach((resolve, i) => {
          resolve({ ok: true, data: staleData[i] });
        });
      });
      assert.equal(metricText(root, "totalTokens"), "9K", "旧响应不应覆盖新数据");
      assert.equal(metricText(root, "promptTokens"), "5K");
      assert.deepEqual(modelRowKeys(root), ["claude-3-5-sonnet"], "分模型表不应被旧响应覆盖");
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      restore();
    }
  });

  it("错误路径：查询失败展示错误文案且保留旧数据（desktop/G-1①）", async () => {
    const requests: UsageQueryPayload[] = [];
    const base = makeInvoke({}, requests);
    let failAll = false;
    const restore = mockWindow((channel, payload) => {
      const req = payload as UsageQueryPayload;
      if (failAll && req.kind !== "models") {
        return Promise.resolve({
          ok: false,
          error: { code: "ERROR", message: "数据库暂时不可用" },
        });
      }
      return base(channel, payload);
    });
    let renderer: ReactTestRenderer | undefined;
    try {
      renderer = await mountView();
      const root = renderer.root;
      assert.equal(metricText(root, "totalTokens"), "3K");

      // 切筛选后三连全部失败：错误文案展示，旧数据不丢
      failAll = true;
      requests.length = 0;
      await clickSegmented(root, "近 30 天");
      const err = root.findByProps({ className: "token-stats-view__error" });
      const errText = (err.children as unknown[]).map((c) => String(c)).join("");
      assert.equal(errText, "数据库暂时不可用");
      assert.equal(metricText(root, "totalTokens"), "3K", "旧 summary 应保留");
      assert.equal(metricText(root, "calls"), "12");
      assert.deepEqual(modelRowKeys(root), ["gpt-4o", "__unlogged__"], "旧分模型表应保留");
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      restore();
    }
  });

  it("格式异常：summary 返回非对象 → 格式异常文案（desktop/G-1②）", async () => {
    const requests: UsageQueryPayload[] = [];
    const restore = mockWindow(
      makeInvoke({ summary: "not-an-object" }, requests),
    );
    let renderer: ReactTestRenderer | undefined;
    try {
      renderer = await mountView();
      const root = renderer.root;

      const err = root.findByProps({ className: "token-stats-view__error" });
      const errText = (err.children as unknown[]).map((c) => String(c)).join("");
      assert.equal(errText, "统计数据返回格式异常");
      assert.deepEqual(chartCols(root, "daily"), []);
      assert.equal(modelRowKeys(root).length, 0);
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      restore();
    }
  });

  it("custom toMs 跨 DST 切换日：toMs 恰为次日本地 0 点（cross/B-2）", async (t) => {
    // 环境时区不可控时切到纽约时区再断言；若 TZ 环境变量不生效则跳过（纯逻辑上
    // new Date(y, m, d+1) 的日历推进天然正确，固定毫秒加法在 23 小时日会晚 1 小时）。
    const prevTz = process.env.TZ;
    process.env.TZ = "America/New_York";
    const dstActive =
      new Date(2024, 2, 11).getTime() - new Date(2024, 2, 10).getTime() !== 86_400_000;
    if (!dstActive) {
      process.env.TZ = prevTz;
      t.skip("当前环境 TZ 不可控，跳过 DST 边界断言");
      return;
    }
    const requests: UsageQueryPayload[] = [];
    const restore = mockWindow(makeInvoke({}, requests));
    let renderer: ReactTestRenderer | undefined;
    try {
      renderer = await mountView();
      const root = renderer.root;

      // 自定义区间跨 2024-03-10（纽约春季拨快，当天只有 23 小时）：
      // 结束日次日 0 点应为 2024-03-11 00:00 EDT（固定 +86400000 会晚 1 小时）
      await clickSegmented(root, "自定义");
      await setDate(root, "开始日期", "2024-03-08");
      await setDate(root, "结束日期", "2024-03-10");
      const custom = requests.filter((r) => r.filter.range.kind === "custom");
      const last = custom[custom.length - 1]!;
      const range = last.filter.range as { fromMs?: number; toMs?: number };
      assert.equal(range.fromMs, new Date(2024, 2, 8).getTime());
      assert.equal(range.toMs, new Date(2024, 2, 11).getTime());
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      restore();
      process.env.TZ = prevTz;
    }
  });
});

describe("TokenUsageStatsView 图表样式与新指标（T-DT1~4）", () => {
  it("图表渲染图例行与 3 条网格刻度（含 max 标注）；柱节点不再有 title 属性（T-DT1）", async () => {
    const restore = mockWindow(makeInvoke({}));
    let renderer: ReactTestRenderer | undefined;
    try {
      renderer = await mountView();
      const root = renderer.root;
      await clickSegmented(root, "明细");

      const container = root.findAll(
        (node) => node.props["data-chart"] === "daily",
      )[0]!;

      // 图例行：输入 / 输出两项与色块类名
      const legend = container.findAll(
        (node) =>
          typeof node.props.className === "string" &&
          node.props.className === "token-stats-chart__legend",
      )[0]!;
      const legendText = legend.children
        .map((c: { props: { children: unknown[] } }) =>
          (c.props.children as unknown[]).map(String).join(""),
        )
        .join("");
      assert.ok(legendText.includes("输入"));
      assert.ok(legendText.includes("输出"));
      assert.ok(
        legend.findAll(
          (node) =>
            typeof node.props.className === "string" &&
            node.props.className.includes("token-stats-chart__legend-dot--input"),
        ).length === 1,
      );
      assert.ok(
        legend.findAll(
          (node) =>
            typeof node.props.className === "string" &&
            node.props.className.includes("token-stats-chart__legend-dot--output"),
        ).length === 1,
      );

      // 3 条网格刻度线（max / mid / zero）与 max 数值标注（1_000_000 → 1M）
      for (const mod of ["--max", "--mid", "--zero"]) {
        assert.ok(
          container.findAll(
            (node) =>
              typeof node.props.className === "string" &&
              node.props.className.includes(
                `token-stats-chart__grid-line${mod}`,
              ),
          ).length === 1,
          `应有 ${mod} 网格线`,
        );
      }
      const maxLabel = container.findAll(
        (node) =>
          typeof node.props.className === "string" &&
          node.props.className.includes("token-stats-chart__grid-label--max"),
      )[0]!;
      assert.equal((maxLabel.children as unknown[]).map(String).join(""), "1M");

      // 柱节点不再有原生 title 属性（hover 详情改受控卡片）
      const cols = container.findAll(
        (node) =>
          typeof node.props.className === "string" &&
          /^token-stats-chart__col( |$)/.test(node.props.className),
      );
      assert.equal(cols.length, DAILY.length);
      for (const col of cols) {
        assert.equal(col.props.title, undefined, "柱节点不应再带原生 title");
      }
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      restore();
    }
  });

  it("hover 柱子出现 data-tooltip 卡片且文案为 bucketTooltip 口径；离开后消失；aria-label 保留（T-DT2）", async () => {
    const restore = mockWindow(makeInvoke({}));
    let renderer: ReactTestRenderer | undefined;
    try {
      renderer = await mountView();
      const root = renderer.root;
      await clickSegmented(root, "明细");

      const dayKey = toDayKey(DAILY[0]!.bucketStartMs);
      const col = root
        .findAll(
          (node) =>
            typeof node.props.className === "string" &&
            /^token-stats-chart__col( |$)/.test(node.props.className),
        )
        .find((node) => node.props["data-day"] === dayKey)!;

      // 初始无卡片
      assert.equal(
        root.findAll((node) => node.props["data-tooltip"] != null).length,
        0,
      );

      await act(async () => {
        col.props.onMouseEnter();
      });
      const tooltip = root.findAll(
        (node) => node.props["data-tooltip"] != null,
      )[0]!;
      assert.equal(tooltip.props["data-tooltip"], dayKey);
      const text = (tooltip.children as unknown[]).map(String).join("");
      assert.ok(text.includes(`输入 ${"1.2K"}`), "卡片文案应为 bucketTooltip 口径");
      assert.ok(text.includes("输出 800"));
      assert.ok(text.includes("调用 3 次"));

      // aria-label 保留（读屏不回退）
      assert.equal(col.props["aria-label"], text);

      await act(async () => {
        col.props.onMouseLeave();
      });
      assert.equal(
        root.findAll((node) => node.props["data-tooltip"] != null).length,
        0,
        "离开柱子后卡片应消失",
      );
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      restore();
    }
  });

  it("汇总页新增平均速率 / 平均首字延迟两张指标卡；null 时显示横杠而非 0（T-DT3）", async () => {
    const restore = mockWindow(makeInvoke({}));
    let renderer: ReactTestRenderer | undefined;
    try {
      renderer = await mountView();
      const root = renderer.root;
      assert.equal(metricText(root, "avgTokensPerSecond"), "45.5 tok/s");
      assert.equal(metricText(root, "avgFirstTokenMs"), "1.2 s");
      // 口径注记随卡展示
      const ttftCard = root.findByProps({ "data-metric": "avgFirstTokenMs" });
      assert.ok(
        ttftCard
          .findAll(
            (node) => node.props.className === "token-stats-card__hint",
          )
          .some((n) =>
            (n.children as unknown[]).map(String).join("").includes("非流式"),
          ),
      );
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      restore();
    }
  });

  it("新指标空态：summary 两字段 null → 卡片显示横杠而非 0（T-DT3）", async () => {
    const restore = mockWindow(
      makeInvoke({
        summary: {
          ...SUMMARY,
          avgFirstTokenMs: null,
          avgTokensPerSecond: null,
        },
      }),
    );
    let renderer: ReactTestRenderer | undefined;
    try {
      renderer = await mountView();
      const root = renderer.root;
      assert.equal(metricText(root, "avgTokensPerSecond"), "—");
      assert.equal(metricText(root, "avgFirstTokenMs"), "—");
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      restore();
    }
  });

  it("点选某天后汇总行含当日平均速率 / 首字延迟（有值与 null 两种形态）（T-DT4）", async () => {
    const restore = mockWindow(makeInvoke({}));
    let renderer: ReactTestRenderer | undefined;
    try {
      renderer = await mountView();
      const root = renderer.root;
      await clickSegmented(root, "明细");

      // 有值形态：DAILY[0] avgTokensPerSecond=25、avgFirstTokenMs=900
      const dayWithValues = toDayKey(DAILY[0]!.bucketStartMs);
      await clickDayCol(root, dayWithValues);
      let detail = root.findByProps({ "data-day-detail": dayWithValues });
      let summaryText = detail.children
        .filter(
          (c: { props?: { className?: string } }) =>
            c.props?.className === "token-stats-view__day-detail-summary",
        )
        .map((c: { props: { children: unknown[] } }) =>
          (c.props.children as unknown[]).map(String).join(""),
        )
        .join("");
      assert.ok(summaryText.includes("25.0 tok/s"), "当日平均速率");
      assert.ok(summaryText.includes("900 ms"), "当日平均首字延迟");

      // null 形态：DAILY[1] 无 timing → 横杠
      const dayNull = toDayKey(DAILY[1]!.bucketStartMs);
      await clickDayCol(root, dayNull);
      detail = root.findByProps({ "data-day-detail": dayNull });
      summaryText = detail.children
        .filter(
          (c: { props?: { className?: string } }) =>
            c.props?.className === "token-stats-view__day-detail-summary",
        )
        .map((c: { props: { children: unknown[] } }) =>
          (c.props.children as unknown[]).map(String).join(""),
        )
        .join("");
      assert.ok(summaryText.includes("平均速率 —"));
      assert.ok(summaryText.includes("平均首字延迟 —"));
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      restore();
    }
  });

  it("流水页签：页码条常驻，点页码按页号取整页（首字延迟/总时间列渲染）", async () => {
    const requests: UsageQueryPayload[] = [];
    const restore = mockWindow(makeInvoke({}, requests));
    let renderer: ReactTestRenderer | undefined;
    try {
      renderer = await mountView();
      const root = renderer.root;
      await clickSegmented(root, "流水");
      assert.equal(requests.at(-1)?.kind, "requests");
      assert.equal(requests.at(-1)?.offset, 0);
      assert.equal(requests.at(-1)?.limit, 50);

      // 6 页全展示（≤7 不收窄）：页码 1-6 按钮可见，当前页 1 高亮
      const pageBtn = (label: string) =>
        root.findAll(
          (node) =>
            typeof node.props.className === "string" &&
            node.props.className.split(" ").includes(
              "token-stats-requests__page-num",
            ) &&
            (node.children as unknown[]).some((c) => c === label),
        )[0];
      for (const n of ["1", "2", "3", "4", "5", "6"]) {
        assert.ok(pageBtn(n) != null, `页码按钮 ${n} 应存在`);
      }
      // 空值列显示横杠（存量 null 行的缓存读/首字/总时间）。
      // react-test-renderer 节点带循环引用，不能 JSON 序列化，递归收集文本。
      const collectText = (node: { children?: unknown }): string => {
        let out = "";
        for (const child of (node.children as unknown[]) ?? []) {
          if (typeof child === "string") {
            out += child;
          } else if (
            child != null &&
            typeof child === "object" &&
            "children" in child
          ) {
            out += collectText(child as { children?: unknown });
          }
        }
        return out;
      };
      const rowsText = root
        .findAll(
          (node) =>
            typeof node.props.className === "string" &&
            node.props.className === "token-stats-requests__row",
        )
        .map((node) => collectText(node))
        .join("|");
      assert.ok(rowsText.includes("—"));

      // 点页码 5 跳页：offset 200
      await act(async () => {
        pageBtn("5")!.props.onClick();
      });
      assert.equal(requests.at(-1)?.offset, 200);
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      restore();
    }
  });
});

/**
 * TokenUsageStatsView 渲染与交互（token-usage-stats-ui-refresh / Step 3，T-D1~T-D6）：
 * - 「汇总 / 图表 / 流水」三页签：默认汇总（指标卡 + 服务商×模型饼图）；切页签不重查、筛选共享；
 * - 汇总页签：饼图（扇区数 = 行数、provider 三态 label、点选扇区/图例出固定详情行、
 *   占比分母 = summary.totalTokens）；图表页签：按天柱状图（data-day 序列），
 *   「今天」模式直出按小时图（无按天图节点）；
 * - 时间模型：自然日闭区间 {fromDay, toDay}（today/last7/last30/custom 映射 + 自定义
 *   from > to 校验、无 366 上限——超长区间照常查询）；
 * - 流水与时间筛选解绑（T-D3）：切时间不重拉流水；模型变化重拉且 filter 无 range；
 * - 空态区分（库全空冷启动 vs 范围内无数据，探底走 {fromDay,toDay} 表达 365 天）；
 *   窗口空（库非空）时空态只拦汇总/图表两页签，流水页签照常渲染全历史流水；
 *   库全空探底命中时三个页签统一整屏空态；
 * - 今日卡全删（T-D5：非空与空态两分支均无 today 卡节点）；
 * - 主查询竞态守卫（旧响应后到不覆盖新数据）；错误路径（{ok:false} 保留旧数据 / 格式异常）。
 *
 * 范式与 fetch-models-modal.test.tsx 一致：注册 react-alias-hook.mjs 统一 react 副本，
 * react-test-renderer 真渲组件，mock 拦在 window.novelMasterDesktop.invoke 按 channel + kind 路由
 * （nm:usageStats/query 按 kind、nm:providers/list 返回 provider 列表）。
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

/** 递归收集节点文本（react-test-renderer 节点带循环引用，不能 JSON 序列化）。 */
function collectText(node: { children?: unknown }): string {
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

/**
 * 故意乱序 + 含 provider 三态（未记录 null / 已知 p1 / ——）——视图应按用量降序重排。
 * 默认两行覆盖「服务商·模型」与「未记录服务商（历史）·其他模型」；未知服务商形态由
 * T-D2 用例覆写注入。
 */
const MODEL_ROWS = [
  {
    providerId: null,
    modelName: null,
    calls: 2,
    promptTokens: 500,
    completionTokens: 300,
    totalTokens: 800,
    cacheReadTokens: 0,
    billedInputTokens: 0,
  },
  {
    providerId: "p1",
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

/** provider 列表（nm:providers/list 同源样例；p1 可解析、p-gone 不在其中）。 */
const PROVIDERS = [
  {
    id: "p1",
    displayName: "OpenAI 官方",
    protocol: "openai",
    baseUrl: "",
    isBuiltin: false,
    apiKeyStatus: "set",
    savedCount: 1,
  },
];

interface UsageQueryPayload {
  kind: string;
  filter: { range?: { fromDay?: string; toDay?: string }; model?: string | null };
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
  providers?: unknown;
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

/**
 * 拦在 ipc client 底层出口：nm:usageStats/query 按 payload.kind 路由回样例数据，
 * nm:providers/list 返回 provider 列表（服务商名解析数据源）。
 */
function makeInvoke(
  data: MockData,
  requests: UsageQueryPayload[] = [],
): (channel: string, payload: unknown) => Promise<unknown> {
  return (channel, payload) => {
    if (channel === "nm:providers/list") {
      return Promise.resolve({ ok: true, data: data.providers ?? PROVIDERS });
    }
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

/** 饼图扇区 key 序列（data-slice 节点，按渲染顺序）。 */
function sliceKeys(root: ReactTestRendererRoot): string[] {
  return root
    .findAll((node) => typeof node.props["data-slice"] === "string")
    .map((node) => node.props["data-slice"] as string);
}

/** 饼图图例 key 序列（data-slice-key 节点）。 */
function legendKeys(root: ReactTestRendererRoot): string[] {
  return root
    .findAll((node) => typeof node.props["data-slice-key"] === "string")
    .map((node) => node.props["data-slice-key"] as string);
}

/** 图例文案（按 key 定位图例按钮）。 */
function legendText(root: ReactTestRendererRoot, key: string): string {
  return collectText(root.findByProps({ "data-slice-key": key }));
}

/** 详情行文案（点选扇区/图例后出现；无选中返回 null）。 */
function sliceDetailText(root: ReactTestRendererRoot): string | null {
  const node = root.findAll(
    (n) => typeof n.props["data-slice-detail"] === "string",
  )[0];
  return node == null ? null : collectText(node);
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

/** 点击饼图扇区（data-slice 按钮）。 */
async function clickSlice(root: ReactTestRendererRoot, key: string): Promise<void> {
  await act(async () => {
    const node = root.findByProps({ "data-slice": key });
    node.props.onClick();
  });
}

/** 点击饼图图例（data-slice-key 按钮）。 */
async function clickLegend(root: ReactTestRendererRoot, key: string): Promise<void> {
  await act(async () => {
    const node = root.findByProps({ "data-slice-key": key });
    node.props.onClick();
  });
}

describe("TokenUsageStatsView（Step 3 适配）", () => {
  it("汇总页签：指标卡 + 饼图（点图例出详情行）；图表页签：按天柱；页签共享筛选不重查", async () => {
    const requests: UsageQueryPayload[] = [];
    const restore = mockWindow(makeInvoke({}, requests));
    let renderer: ReactTestRenderer | undefined;
    try {
      renderer = await mountView();
      const root = renderer.root;

      // 默认落在「汇总」页签：指标卡（总 3K / 输入 1K / 输出 2K / 调用 12 / 命中率 400÷2000=20%）
      assert.equal(metricText(root, "totalTokens"), "3K");
      assert.equal(metricText(root, "promptTokens"), "1K");
      assert.equal(metricText(root, "completionTokens"), "2K");
      assert.equal(metricText(root, "calls"), "12");
      assert.equal(metricText(root, "hitRate"), "20%");

      // 汇总页签不渲染明细图表
      assert.deepEqual(chartCols(root, "daily"), []);

      // 饼图（挂在汇总页签）：按用量降序（p1/gpt-4o 1200 → 未记录 800）；
      // 扇区与图例同源同序，key = providerId::modelName 组合
      assert.deepEqual(sliceKeys(root), ["p1::gpt-4o", "__no_provider__::__other_model__"]);
      assert.deepEqual(legendKeys(root), ["p1::gpt-4o", "__no_provider__::__other_model__"]);
      assert.equal(legendText(root, "p1::gpt-4o"), "OpenAI 官方 · gpt-4o");
      assert.equal(
        legendText(root, "__no_provider__::__other_model__"),
        "未记录服务商（历史） · 其他模型",
      );

      // 点图例 → 图下固定详情行（服务商·模型 / 用量 / 次数 / 占比；分母 = summary.totalTokens）
      await clickLegend(root, "p1::gpt-4o");
      const detail = sliceDetailText(root);
      assert.ok(detail != null, "点图例后应出现详情行");
      assert.ok(detail.includes("OpenAI 官方 · gpt-4o"));
      assert.ok(detail.includes("1.2K"), `详情行应含用量 1.2K：${detail}`);
      assert.ok(detail.includes("10 次"));
      assert.ok(detail.includes("40%"), `占比应为 1200/3000=40%：${detail}`);
      // 再点同一图例取消选中
      await clickLegend(root, "p1::gpt-4o");
      assert.equal(sliceDetailText(root), null, "再点图例应取消详情行");

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

      // 切到「图表」：页签共享筛选与数据，不触发任何新查询；只剩按天柱，不含饼图
      requests.length = 0;
      await clickSegmented(root, "图表");
      assert.equal(requests.length, 0, "切换页签不应重新查询");
      assert.deepEqual(chartCols(root, "daily"), DAILY.map((b) => toDayKey(b.bucketStartMs)));
      assert.equal(sliceKeys(root).length, 0, "图表页签不应渲染饼图");

      // 切回「汇总」：卡片与饼图仍在，明细图表隐藏（筛选与数据保持）
      await clickSegmented(root, "汇总");
      assert.equal(metricText(root, "totalTokens"), "3K");
      assert.deepEqual(chartCols(root, "daily"), []);
      assert.deepEqual(sliceKeys(root), ["p1::gpt-4o", "__no_provider__::__other_model__"]);
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      restore();
    }
  });

  it("空态区分（库全空）：冷启动引导文案，不渲染图表；无今日卡（T-D5 空态分支）", async () => {
    const requests: UsageQueryPayload[] = [];
    const restore = mockWindow(
      makeInvoke(
        {
          // 范围内空、探底（365 天宽区间 summary）也空 → 库全空
          summary: { ...SUMMARY, calls: 0, totalTokens: 0 },
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
      assert.equal(sliceKeys(root).length, 0);
      // 今日卡已删（T-D5）：空态分支不渲染任何 today 卡节点
      assert.equal(
        root.findAll((node) => node.props["data-metric"] === "todayTotalTokens").length,
        0,
        "空态不应渲染今日卡",
      );
      assert.equal(
        root.findAll((node) => node.props["data-metric"] === "todayCalls").length,
        0,
        "空态不应渲染今日卡（调用次数）",
      );

      // 空态对两个页签一致：切到「图表」仍展示空态，不渲染图表与饼图
      await clickSegmented(root, "图表");
      assert.deepEqual(chartCols(root, "daily"), []);
      assert.equal(sliceKeys(root).length, 0);
      // 库全空行为不变：流水页签同样整屏空态（流水本身也无数据），不渲染流水行
      await clickSegmented(root, "流水");
      assert.ok(
        collectText(root.findByProps({ className: "settings-list__empty" })).includes(
          "上线起开始积累",
        ),
        "库全空时流水页签仍应整屏冷启动空态",
      );
      assert.equal(
        root.findAll(
          (node) => node.props.className === "token-stats-requests__row",
        ).length,
        0,
        "库全空时不应渲染流水行",
      );
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      restore();
    }
  });

  it("空态区分（范围内无数据）：「该区间无数据」文案；探底走 {fromDay,toDay} 表达 365 天（T-D6）；无今日卡", async () => {
    const requests: UsageQueryPayload[] = [];
    const probeFromDay = toDayKey(localMidnight(-365));
    const restore = mockWindow(
      makeInvoke(
        {
          // 用户查询（last7）范围内空；探底（fromDay = 365 天前的宽区间）非空 → 库有数据
          summary: (req) =>
            req.filter.range?.fromDay === probeFromDay
              ? SUMMARY
              : { ...SUMMARY, calls: 0, totalTokens: 0 },
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
      assert.equal(sliceKeys(root).length, 0);
      // 今日卡已删：范围内无数据分支同样不渲染
      assert.equal(
        root.findAll((node) => node.props["data-metric"] === "todayTotalTokens").length,
        0,
        "范围内无数据分支不应渲染今日卡",
      );

      // T-D6：探底查询的 range 为 {fromDay: 365 天前, toDay: 今天} 的自然日闭区间
      const probe = requests.find(
        (r) => r.kind === "summary" && r.filter.range?.fromDay === probeFromDay,
      );
      assert.ok(probe != null, "空态应懒发一次 365 天宽区间探底查询");
      assert.equal(probe.filter.range?.toDay, toDayKey(localMidnight(0)));
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      restore();
    }
  });

  it("窗口空（库非空）：汇总/图表页签显示区间空态且无指标卡；流水页签照常渲染全历史流水（filter 无 range）", async () => {
    const requests: UsageQueryPayload[] = [];
    const probeFromDay = toDayKey(localMidnight(-365));
    const restore = mockWindow(
      makeInvoke(
        {
          // 用户查询（last7）窗口空；探底（365 天宽区间）非空 → 库有数据
          summary: (req) =>
            req.filter.range?.fromDay === probeFromDay
              ? SUMMARY
              : { ...SUMMARY, calls: 0, totalTokens: 0 },
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

      // 默认汇总页签：区间空态文案，不渲染任何指标卡
      assert.ok(
        collectText(root.findByProps({ className: "settings-list__empty" })).includes(
          "当前筛选范围内暂无用量数据",
        ),
      );
      assert.equal(
        root.findAll((node) => node.props["data-metric"] != null).length,
        0,
        "窗口空时汇总页签不应渲染指标卡",
      );

      // 图表页签：同样区间空态，不渲染按天图与饼图
      await clickSegmented(root, "图表");
      assert.ok(
        collectText(root.findByProps({ className: "settings-list__empty" })).includes(
          "当前筛选范围内暂无用量数据",
        ),
      );
      assert.deepEqual(chartCols(root, "daily"), []);
      assert.equal(sliceKeys(root).length, 0);

      // 流水页签：照常渲染全历史流水——不再被整屏空态拦截（PRD 验收第一条）
      requests.length = 0;
      await clickSegmented(root, "流水");
      assert.equal(
        root.findAll((node) => node.props.className === "settings-list__empty").length,
        0,
        "窗口空不应拦截流水页签",
      );
      const reqQueries = requests.filter((r) => r.kind === "requests");
      assert.equal(reqQueries.length, 1, "切流水页签应拉首页");
      assert.equal(reqQueries[0]!.filter.range, undefined, "流水查询不应携带 range");
      assert.equal(reqQueries[0]!.offset, 0);
      assert.equal(reqQueries[0]!.limit, 50);
      // 流水行渲染（REQUEST_PAGE 样例：gpt-4o 行可见）
      const rowsText = root
        .findAll(
          (node) => node.props.className === "token-stats-requests__row",
        )
        .map((node) => collectText(node))
        .join("|");
      assert.ok(rowsText.includes("gpt-4o"), `流水行应渲染：${rowsText}`);
      // 分页器常驻（total=260 → 6 页）
      assert.ok(
        root
          .findAll(
            (node) =>
              typeof node.props.className === "string" &&
              node.props.className.split(" ").includes(
                "token-stats-requests__page-num",
              ),
          )
          .some((node) => (node.children as unknown[]).some((c) => c === "6")),
        "流水分页器应渲染",
      );
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      restore();
    }
  });

  it("kind / filter 参数随筛选切换正确（自然日区间 × 模型三态；T-D1 映射）", async () => {
    const requests: UsageQueryPayload[] = [];
    const restore = mockWindow(makeInvoke({}, requests));
    let renderer: ReactTestRenderer | undefined;
    try {
      renderer = await mountView();
      const root = renderer.root;

      // 初始挂载：models + summary/daily/modelBreakdown（last7 = {D-6, D}、model 全部）
      const kinds = requests.map((r) => r.kind).sort();
      assert.deepEqual(kinds, ["daily", "modelBreakdown", "models", "summary"]);
      const last7From = toDayKey(localMidnight(-6));
      const todayKey = toDayKey(localMidnight(0));
      assert.ok(
        requests
          .filter((r) => r.kind !== "models")
          .every(
            (r) =>
              r.filter.range?.fromDay === last7From &&
              r.filter.range?.toDay === todayKey &&
              r.filter.model === undefined,
          ),
        "last7 应映射 {fromDay: D-6, toDay: D}",
      );
      // models 查询不传 dummy range（P2-4）
      assert.equal(
        requests.find((r) => r.kind === "models")?.filter.range,
        undefined,
        "models 查询不应携带 range",
      );

      // 切到「今天」：三连查询 range = {D, D}（T-D1）；同时 reload 成功回调自动补选
      // 今天（P1-1）→ hourly 钻取立即自动拉取（不依赖页签激活）
      requests.length = 0;
      await clickSegmented(root, "今天");
      assert.deepEqual(
        requests.map((r) => r.kind).sort(),
        ["daily", "hourly", "modelBreakdown", "summary"],
      );
      assert.ok(
        requests.every(
          (r) => r.filter.range?.fromDay === todayKey && r.filter.range?.toDay === todayKey,
        ),
        "today 应映射 {fromDay: D, toDay: D}",
      );

      // 切到近 30 天：三连查询 range = {D-29, D}（T-D1，30 桶口径）。
      // 注：从「今天」切走时，hourly effect 在 reload 清空 selectedDay 前会以旧
      // 选中天补发一次 hourly（过渡请求，随后被清空），断言时过滤掉。
      requests.length = 0;
      await clickSegmented(root, "近 30 天");
      assert.deepEqual(
        requests.map((r) => r.kind).filter((k) => k !== "hourly").sort(),
        ["daily", "modelBreakdown", "summary"],
      );
      assert.ok(
        requests.every(
          (r) =>
            r.filter.range?.fromDay === toDayKey(localMidnight(-29)) &&
            r.filter.range?.toDay === todayKey,
        ),
        "last30 应映射 {fromDay: D-29, toDay: D}",
      );

      // 模型三态：指定模型 → 字符串；其他 → null；全部 → undefined
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

      // 页签共享筛选：切「图表」不重查；在图表页签下改时间范围仍触发三连查询
      requests.length = 0;
      await clickSegmented(root, "图表");
      assert.equal(requests.length, 0, "切换页签不应重新查询");
      await clickSegmented(root, "近 7 天");
      assert.deepEqual(
        requests.map((r) => r.kind).sort(),
        ["daily", "modelBreakdown", "summary"],
      );
      assert.ok(
        requests.every((r) => r.filter.range?.fromDay === last7From),
        "切回近 7 天应重新按 {D-6, D} 查询",
      );
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      restore();
    }
  });

  it("自定义区间：预填最近 7 天直传日期串；超长区间不再报错；from > to 行内提示且不再查询（T-D1）", async () => {
    const requests: UsageQueryPayload[] = [];
    const restore = mockWindow(makeInvoke({}, requests));
    let renderer: ReactTestRenderer | undefined;
    try {
      renderer = await mountView();
      const root = renderer.root;

      // 切到自定义：预填 today-6 ~ today，range 为日期字符串直传（无毫秒换算）
      requests.length = 0;
      await clickSegmented(root, "自定义");
      const custom = requests.filter((r) => r.filter.range?.fromDay != null);
      assert.equal(custom.length, 3);
      assert.deepEqual(custom[0]!.filter.range, {
        fromDay: toDayKey(localMidnight(-6)),
        toDay: toDayKey(localMidnight(0)),
      });

      // 起始日拉到 2020-01-01：超长区间（数年）不再报错、照常发查询（366 上限已删）
      requests.length = 0;
      await setDate(root, "开始日期", "2020-01-01");
      assert.equal(
        root.findAll((node) => node.props.className === "token-stats-view__range-error").length,
        0,
        "超长区间不应再报 366 天错误",
      );
      assert.ok(
        requests.some((r) => r.filter.range?.fromDay === "2020-01-01"),
        "超长区间应照常发起查询",
      );

      // from > to：行内提示且不再发查询
      requests.length = 0;
      await setDate(root, "结束日期", "2019-12-31");
      const err = root.findByProps({ className: "token-stats-view__range-error" });
      const errText = (err.children as unknown[]).map((c) => String(c)).join("");
      assert.equal(errText, "开始日期不能晚于结束日期");
      assert.equal(requests.length, 0, "区间非法时不应发起查询");
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      restore();
    }
  });

  it("custom 日期字符串原样透传（含跨 DST 边界日期）", async () => {
    // 自然日区间模型下 fromDay/toDay 为字符串直传，不再有 toMs 次日 0 点换算
    // （原 DST 用例考的日历推进在时间模型重构后不再存在于桌面端）。
    const requests: UsageQueryPayload[] = [];
    const restore = mockWindow(makeInvoke({}, requests));
    let renderer: ReactTestRenderer | undefined;
    try {
      renderer = await mountView();
      const root = renderer.root;

      await clickSegmented(root, "自定义");
      await setDate(root, "开始日期", "2024-03-08");
      await setDate(root, "结束日期", "2024-03-10");
      // 改起止日各触发一轮查询（结束日落下后区间定型），取最后一轮断言字符串直传
      const custom = requests.filter(
        (r) => r.filter.range?.fromDay === "2024-03-08" && r.filter.range?.toDay === "2024-03-10",
      );
      assert.ok(custom.length >= 1, "区间定型后应发起查询");
      assert.deepEqual(custom.at(-1)!.filter.range, {
        fromDay: "2024-03-08",
        toDay: "2024-03-10",
      });
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

      // 按天图在「图表」页签：先切过去再点选
      await clickSegmented(root, "图表");
      const dayKey = toDayKey(DAILY[0]!.bucketStartMs);
      requests.length = 0;
      await clickDayCol(root, dayKey);

      // hourly 请求：kind=hourly、dayLocalDate=选中天、filter 保留当前模型维度
      const hourly = requests.filter((r) => r.kind === "hourly");
      assert.equal(hourly.length, 1);
      assert.equal(hourly[0]!.dayLocalDate, dayKey);
      assert.equal(hourly[0]!.filter.range?.fromDay, toDayKey(localMidnight(-6)));

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
        providerId: "p2",
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
      if (channel === "nm:providers/list") {
        return Promise.resolve({ ok: true, data: PROVIDERS });
      }
      if (channel !== "nm:usageStats/query") {
        return Promise.reject(new Error(`测试未预期的 IPC channel: ${channel}`));
      }
      const req = payload as UsageQueryPayload;
      requests.push(req);
      if (req.kind === "models" || req.kind === "hourly") {
        return Promise.resolve({ ok: true, data: req.kind === "models" ? MODELS : HOURLY });
      }
      if (req.filter.range?.fromDay === toDayKey(localMidnight(-29))) {
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
      assert.deepEqual(sliceKeys(root), ["p2::claude-3-5-sonnet"]);

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
      assert.deepEqual(sliceKeys(root), ["p2::claude-3-5-sonnet"], "饼图不应被旧响应覆盖");
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
      if (channel === "nm:providers/list") {
        return Promise.resolve({ ok: true, data: PROVIDERS });
      }
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
      assert.deepEqual(
        sliceKeys(root),
        ["p1::gpt-4o", "__no_provider__::__other_model__"],
        "旧饼图数据应保留",
      );
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
      assert.equal(sliceKeys(root).length, 0);
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      restore();
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
      await clickSegmented(root, "图表");

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
      await clickSegmented(root, "图表");

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
      await clickSegmented(root, "图表");

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

  it("流水页签：页码条常驻，点页码按页号取整页（首字延迟/总时间列渲染；filter 无 range）", async () => {
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
      // 流水与时间解绑：requests 查询不携带 range
      assert.equal(requests.at(-1)?.filter.range, undefined, "流水查询不应携带 range");

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

describe("TokenUsageStatsView 新增行为（T-D1~T-D6）", () => {
  it("T-D1：RangeKind 映射 today/last7/last30/custom → {fromDay,toDay} 正确传参；custom 超长区间不报错", async () => {
    const requests: UsageQueryPayload[] = [];
    const restore = mockWindow(makeInvoke({}, requests));
    let renderer: ReactTestRenderer | undefined;
    try {
      renderer = await mountView();
      const root = renderer.root;
      const todayKey = toDayKey(localMidnight(0));

      const summaryRange = (): { fromDay?: string; toDay?: string } | undefined =>
        requests.find((r) => r.kind === "summary")?.filter.range;

      // 初始 last7（mount 即查）：{D-6, D}
      assert.deepEqual(summaryRange(), {
        fromDay: toDayKey(localMidnight(-6)),
        toDay: todayKey,
      });

      // 今天：{D, D}
      requests.length = 0;
      await clickSegmented(root, "今天");
      assert.deepEqual(summaryRange(), { fromDay: todayKey, toDay: todayKey });

      // 近 30 天：{D-29, D}
      requests.length = 0;
      await clickSegmented(root, "近 30 天");
      assert.deepEqual(summaryRange(), {
        fromDay: toDayKey(localMidnight(-29)),
        toDay: todayKey,
      });

      // 自定义预填：{D-6, D}（日期字符串直传）
      requests.length = 0;
      await clickSegmented(root, "自定义");
      assert.deepEqual(summaryRange(), {
        fromDay: toDayKey(localMidnight(-6)),
        toDay: todayKey,
      });

      // 超长区间（数年）：不报错、照常查询
      requests.length = 0;
      await setDate(root, "开始日期", "2018-01-01");
      assert.equal(
        root.findAll((node) => node.props.className === "token-stats-view__range-error").length,
        0,
        "超长区间不应报错（366 上限已删）",
      );
      assert.equal(summaryRange()?.fromDay, "2018-01-01");
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      restore();
    }
  });

  it("T-D2：饼图切片数 = 行数、label 三态 + 未知服务商兜底、点扇区/图例出详情行、占比分母 = summary.totalTokens", async () => {
    const requests: UsageQueryPayload[] = [];
    // 四行覆盖四种形态：已知服务商·模型 / 未记录（历史）·其他模型 / 未知服务商·模型 / 已知服务商·其他模型
    const rows = [
      {
        providerId: "p1",
        modelName: "gpt-4o",
        calls: 10,
        promptTokens: 600,
        completionTokens: 600,
        totalTokens: 1200,
        cacheReadTokens: 300,
        billedInputTokens: 600,
      },
      {
        providerId: null,
        modelName: null,
        calls: 2,
        promptTokens: 500,
        completionTokens: 300,
        totalTokens: 800,
        cacheReadTokens: 0,
        billedInputTokens: 0,
      },
      {
        providerId: "p-gone",
        modelName: "glm-4.6",
        calls: 3,
        promptTokens: 300,
        completionTokens: 200,
        totalTokens: 500,
        cacheReadTokens: 0,
        billedInputTokens: 0,
      },
      {
        providerId: "p2",
        modelName: null,
        calls: 4,
        promptTokens: 200,
        completionTokens: 200,
        totalTokens: 400,
        cacheReadTokens: 0,
        billedInputTokens: 0,
      },
    ];
    const providers = [
      ...PROVIDERS,
      {
        id: "p2",
        displayName: "智谱中转",
        protocol: "openai",
        baseUrl: "",
        isBuiltin: false,
        apiKeyStatus: "set",
        savedCount: 1,
      },
    ];
    const restore = mockWindow(
      makeInvoke({ modelRows: rows, providers }, requests),
    );
    let renderer: ReactTestRenderer | undefined;
    try {
      renderer = await mountView();
      const root = renderer.root;

      // 切片数 = 行数（不折叠；按用量降序）
      assert.deepEqual(sliceKeys(root), [
        "p1::gpt-4o",
        "__no_provider__::__other_model__",
        "p-gone::glm-4.6",
        "p2::__other_model__",
      ]);
      // label 三态 + 未知服务商兜底
      assert.equal(legendText(root, "p1::gpt-4o"), "OpenAI 官方 · gpt-4o");
      assert.equal(
        legendText(root, "__no_provider__::__other_model__"),
        "未记录服务商（历史） · 其他模型",
      );
      assert.equal(legendText(root, "p-gone::glm-4.6"), "未知服务商 · glm-4.6");
      assert.equal(legendText(root, "p2::__other_model__"), "智谱中转 · 其他模型");

      // 扇区为 button 包装（P2-6 键盘可达）且带 aria-label
      const slice = root.findByProps({ "data-slice": "p1::gpt-4o" });
      assert.equal(slice.type, "button");
      assert.ok(String(slice.props["aria-label"]).includes("OpenAI 官方 · gpt-4o"));

      // 点扇区 → 详情行（用量 / 次数 / 占比，分母 = summary.totalTokens = 3000）
      await clickSlice(root, "p1::gpt-4o");
      let detail = sliceDetailText(root);
      assert.ok(detail != null && detail.includes("1.2K"), `详情行应含用量：${detail}`);
      assert.ok(detail != null && detail.includes("10 次"));
      assert.ok(detail != null && detail.includes("40%"), `占比 1200/3000=40%：${detail}`);

      // 点图例 → 切换到另一行（未知服务商形态）
      await clickLegend(root, "p-gone::glm-4.6");
      detail = sliceDetailText(root);
      assert.ok(detail != null && detail.includes("未知服务商 · glm-4.6"));
      assert.ok(detail != null && detail.includes("17%"), `占比 500/3000≈17%：${detail}`);

      // 再点同一图例 → 取消选中
      await clickLegend(root, "p-gone::glm-4.6");
      assert.equal(sliceDetailText(root), null);
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      restore();
    }
  });

  it("T-D3：流水解绑——时间筛选变化不触发 requests 重查；模型筛选变化触发且 filter 无 range", async () => {
    const requests: UsageQueryPayload[] = [];
    const restore = mockWindow(makeInvoke({}, requests));
    let renderer: ReactTestRenderer | undefined;
    try {
      renderer = await mountView();
      const root = renderer.root;

      // 先激活流水页签拉首页（filter 无 range）
      await clickSegmented(root, "流水");
      assert.equal(requests.filter((r) => r.kind === "requests").length, 1);

      // 时间筛选变化（近 7 天 → 近 30 天 → 今天）：主链路三连查询发出，
      // 但不触发 requests 重查（P1-2：脏标记只挂模型筛选）
      for (const label of ["近 30 天", "今天", "近 7 天"]) {
        requests.length = 0;
        await clickSegmented(root, label);
        assert.ok(
          requests.some((r) => r.kind === "summary"),
          `${label} 切换应触发主链路查询`,
        );
        assert.equal(
          requests.filter((r) => r.kind === "requests").length,
          0,
          `${label} 切换不应重拉流水`,
        );
      }

      // 模型筛选变化：触发流水重查，且 filter 只含 model、无 range
      requests.length = 0;
      await selectModel(root, "gpt-4o");
      const reqs = requests.filter((r) => r.kind === "requests");
      assert.equal(reqs.length, 1, "模型变化应重拉流水首页");
      assert.equal(reqs[0]!.filter.range, undefined, "流水 filter 不应携带 range");
      assert.equal(reqs[0]!.filter.model, "gpt-4o");

      // 切回「全部模型」同样重拉
      requests.length = 0;
      await selectModel(root, "__all__");
      assert.equal(requests.filter((r) => r.kind === "requests").length, 1);
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      restore();
    }
  });

  it("T-D4：今天 tab——图表页仅渲染按小时图（无 daily 图节点）；当天汇总行反映今日数据；hourly 自动拉取", async () => {
    const requests: UsageQueryPayload[] = [];
    const todayKey = toDayKey(localMidnight(0));
    const restore = mockWindow(
      makeInvoke(
        {
          // 今天单桶：输入 700 / 输出 300 / 调用 4 / 命中率 200÷800=25%
          daily: [bucket(localMidnight(0), 4, 700, 300, 200, 800)],
        },
        requests,
      ),
    );
    let renderer: ReactTestRenderer | undefined;
    try {
      renderer = await mountView();
      const root = renderer.root;

      // 切「今天」：三连 {D, D} + selectedDay 自动补选今天（P1-1）→ hourly 自动拉取
      requests.length = 0;
      await clickSegmented(root, "今天");
      assert.ok(
        requests
          .filter((r) => r.kind === "daily")
          .every(
            (r) => r.filter.range?.fromDay === todayKey && r.filter.range?.toDay === todayKey,
          ),
      );
      const hourly = requests.filter((r) => r.kind === "hourly");
      assert.equal(hourly.length, 1, "切今天应自动拉取当天 hourly");
      assert.equal(hourly[0]!.dayLocalDate, todayKey);

      // 切「图表」页签：today 模式直出按小时图——不出现按天图节点
      await clickSegmented(root, "图表");
      assert.equal(
        root.findAll((node) => node.props["data-chart"] === "daily").length,
        0,
        "today 模式不应渲染按天图",
      );
      assert.equal(chartCols(root, "hourly").length, 24, "today 模式应直出 24 小时图");

      // 当天汇总行：取 dailyBuckets 唯一桶，反映今日数据（含命中率出口）
      const detail = root.findByProps({ "data-day-detail": todayKey });
      const detailText = collectText(detail);
      assert.ok(detailText.includes("700"), "当天汇总行应含今日输入");
      assert.ok(detailText.includes("300"), "当天汇总行应含今日输出");
      assert.ok(detailText.includes("4 次"), "当天汇总行应含今日调用");
      assert.ok(detailText.includes("25%"), "当天汇总行应含今日命中率");
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      restore();
    }
  });

  it("T-D5：今日卡全删——非空与空态两分支均无今日卡节点；页签文案「图表」", async () => {
    // 非空分支（默认汇总页签）
    const restore = mockWindow(makeInvoke({}));
    let renderer: ReactTestRenderer | undefined;
    try {
      renderer = await mountView();
      const root = renderer.root;
      assert.equal(metricText(root, "totalTokens"), "3K");
      assert.equal(
        root.findAll((node) => node.props["data-metric"] === "todayTotalTokens").length,
        0,
        "非空分支不应渲染今日卡",
      );
      assert.equal(
        root.findAll((node) => node.props["data-metric"] === "todayCalls").length,
        0,
        "非空分支不应渲染今日卡（调用次数）",
      );

      // 页签文案：汇总 / 图表 / 流水（「明细」已更名）
      const allLabels = root
        .findAll(
          (node) =>
            typeof node.props.className === "string" &&
            /^segmented-control__btn( |$)/.test(node.props.className),
        )
        .map((node) => (node.children as unknown[]).map(String).join(""));
      assert.ok(allLabels.includes("图表"), "页签应含「图表」");
      assert.ok(!allLabels.includes("明细"), "「明细」页签应已更名");
      assert.ok(allLabels.includes("汇总") && allLabels.includes("流水"));
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      restore();
    }
  });
});

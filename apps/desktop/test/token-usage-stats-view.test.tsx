/**
 * TokenUsageStatsView 渲染与交互（spec T-S6 的 view 部分 / Step 7）：
 * - 「汇总 / 明细」双页签：默认汇总（五指标卡 + 今日卡）；切页签不重查、筛选共享；
 * - 明细页签：按天柱状图（data-day 序列）、分模型表（无命中率列，含「未记录」行、按用量降序）；
 * - 空态（SettingsListEmpty）；自定义区间 ≤366 天校验（超限行内提示且不再发查询）；
 * - kind / filter 参数随筛选（时间范围 × 模型三态）切换正确；点选某天 → hourly 钻取。
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

/** 桶工厂（字段与 UsageStatsBucketDto 一致）。 */
function bucket(
  bucketStartMs: number,
  calls: number,
  promptTokens: number,
  completionTokens: number,
  cacheReadTokens: number,
  billedInputTokens: number,
) {
  return {
    bucketStartMs,
    calls,
    promptTokens,
    completionTokens,
    cacheReadTokens,
    cacheCreationTokens: 0,
    billedInputTokens,
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
  today: { totalTokens: 550, calls: 3 },
};

/** 3 个有量的天（today-6 / -5 / -2），中间夹杂无 cache 数据（billed=0）的桶。 */
const DAILY = [
  bucket(localMidnight(-6), 3, 1200, 800, 400, 1000),
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
}

interface MockData {
  summary?: unknown;
  daily?: unknown;
  hourly?: unknown;
  modelRows?: unknown;
  models?: unknown;
}

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
      case "summary":
        return Promise.resolve({ ok: true, data: data.summary ?? SUMMARY });
      case "daily":
        return Promise.resolve({ ok: true, data: data.daily ?? DAILY });
      case "hourly":
        return Promise.resolve({ ok: true, data: data.hourly ?? HOURLY });
      case "modelBreakdown":
        return Promise.resolve({ ok: true, data: data.modelRows ?? MODEL_ROWS });
      case "models":
        return Promise.resolve({ ok: true, data: data.models ?? MODELS });
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
  it("汇总页签：五指标卡 + 今日卡；明细页签：按天柱 + 分模型表（无命中率列）；页签共享筛选不重查", async () => {
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

      // 汇总页签不渲染明细图表与分模型表
      assert.deepEqual(chartCols(root, "daily"), []);
      assert.equal(modelRowKeys(root).length, 0);

      // 切到「明细」：页签共享筛选与数据，不触发任何新查询
      requests.length = 0;
      await clickSegmented(root, "明细");
      assert.equal(requests.length, 0, "切换页签不应重新查询");

      // 按天柱：3 根、顺序与 daily 桶一致（data-day 为本地日期键）
      assert.deepEqual(chartCols(root, "daily"), DAILY.map((b) => toDayKey(b.bucketStartMs)));

      // 分模型汇总：按用量降序（gpt-4o 1200 → 未记录 800），null 行显示「未记录」
      assert.deepEqual(modelRowKeys(root), ["gpt-4o", "__unlogged__"]);
      const unloggedRow = root.findAll(
        (node) => node.props["data-model"] === "__unlogged__",
      )[0]!;
      assert.ok(
        unloggedRow
          .findAll((n) => n.props.className === "token-stats-models__name")
          .some((n) => (n.children as unknown[]).includes("未记录")),
        "未记录行应展示「未记录」名称",
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

      // 模型下拉（共享筛选栏，两页签都在）：全部 / 库内模型 / 未记录（DEV-1：UI 侧补「未记录」选项）
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

      // 切回「汇总」：卡片仍在，明细内容隐藏（筛选与数据保持）
      await clickSegmented(root, "汇总");
      assert.equal(metricText(root, "totalTokens"), "3K");
      assert.deepEqual(chartCols(root, "daily"), []);
      assert.equal(modelRowKeys(root).length, 0);
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      restore();
    }
  });

  it("空态：范围内无用量数据时展示 SettingsListEmpty，不渲染图表", async () => {
    const requests: UsageQueryPayload[] = [];
    const restore = mockWindow(
      makeInvoke(
        {
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
      assert.ok(emptyText.includes("暂无用量数据"), "空态文案应说明暂无用量数据");
      assert.deepEqual(chartCols(root, "daily"), []);
      assert.equal(modelRowKeys(root).length, 0);

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
});

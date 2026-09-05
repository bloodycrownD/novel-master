/**
 * 设置页「数据统计」视图（token-usage-stats-ui-refresh / Step 3）：
 * 「汇总 / 图表 / 流水」三页签，筛选栏（时间范围：今天 / 近 7 / 近 30 / 自定义区间 × 模型）
 * 置顶、汇总与图表两页签共享（切换页签保留筛选、不重查）。时间口径统一为本地自然日
 * 闭区间 {fromDay, toDay}：今天 = {D, D}、近 7 天 = {D-6, D}、近 30 天 = {D-29, D}、
 * 自定义直传日期串（无跨度上限，仅校验 from ≤ to）。汇总页签：范围内指标卡片 +
 * 服务商×模型饼图（行原样不折叠，点选扇区/图例出固定详情行）；图表页签：按天图 +
 * 24 小时钻取 + 当天汇总行，「今天」模式跳过按天图直出当天汇总行 + 按小时图；
 * 流水页签：请求级分页列表（按时间倒序、按需加载，跟随时间窗口与模型筛选——
 * 需求①勘误后时间/模型变化均置脏重拉；窗口空时与其他页签统一区间空态，
 * 库全空探底命中时整屏冷启动空态）。
 * 数据统一经 ipcUsageStatsQuery（nm:usageStats/query 单 channel 按 kind 分发）获取；
 * 服务商展示名经 ipcProvidersList（AgentEditorView 同源通道）解析；
 * 功能口径对齐 mobile 侧 TokenUsageStatsScreen，交互按桌面惯例。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ipcProvidersList, ipcUsageStatsQuery } from "@/ipc/client";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type {
  IpcResult,
  ProviderListItemDto,
  UsageStatsBucketDto,
  UsageStatsFilterDto,
  UsageStatsModelRowDto,
  UsageStatsRequestPageDto,
  UsageStatsRequestRowDto,
  UsageStatsSummaryDto,
} from "@shared/ipc-types";
import { SettingsListEmpty, SettingsPanel, SettingsSection } from "./settings-ui";
import { formatTokenCount } from "@shared/logic/format-token-count";
import {
  formatDurationMs,
  formatRequestTime,
  pageWindowItems,
} from "@shared/logic/usage-stats-format";

type RangeKind = "today" | "last7" | "last30" | "custom";
type PageTab = "summary" | "detail" | "requests";

/**
 * 模型下拉的三态哨兵：全部 / 其他模型（对应 filter.model 的 undefined / null）。
 * 「其他模型」= NULL 记录 + 非当前配置的历史模型归并。
 * 口径注记：modelBreakdown 行为 provider×model 复合维度原样透传（IPC 层不归并），
 * 饼图按复合维度展示；下拉按模型名单值筛选不受影响。
 */
const MODEL_OPTION_ALL = "__all__";
const MODEL_OPTION_UNLOGGED = "__unlogged__";

/** ms → 本地日期键 `YYYY-MM-DD`（天/小时桶都用它定位天边界）。 */
function toLocalDayKey(ms: number): string {
  const d = new Date(ms);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/** 今天偏移 N 天的本地日期键（命名窗口由应用层换算：「近 7 天」= {D-6, D} 共 7 桶）。 */
function dayKeyOffset(offsetDays: number): string {
  const now = new Date();
  return toLocalDayKey(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays).getTime(),
  );
}

/** `YYYY-MM-DD` → 本地 0 点 Date（非法输入返回 null）。 */
function parseLocalDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m == null) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Date → `<input type="date">` 接受的本地 `YYYY-MM-DD` 值。 */
function toDateInputValue(d: Date): string {
  return toLocalDayKey(d.getTime());
}

/** 命中率（0-1）；计费口径分母无数据时返回 null（展示「暂无数据」而非 0%）。 */
function hitRate(cacheRead: number, billed: number): number | null {
  if (billed <= 0) {
    return null;
  }
  return cacheRead / billed;
}

function formatHitRate(rate: number | null): string {
  return rate == null ? "—" : `${Math.round(rate * 100)}%`;
}

/** 平均 token 速率展示：`x.x tok/s`（≥100 取整避免小数位过长）；无数据显示空态。 */
function formatTokensPerSecond(v: number | null): string {
  if (v == null) {
    return "—";
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} tok/s`;
}

/**
 * 桶 tooltip 文案（当天/该小时 输入输出与调用数）。
 * 图表不展示命中率——命中率出口仅保留在汇总卡片与当天汇总行。
 */
function bucketTooltip(key: string, b: UsageStatsBucketDto): string {
  return `${key} · 输入 ${formatTokenCount(b.promptTokens)} · 输出 ${formatTokenCount(
    b.completionTokens,
  )} · 调用 ${b.calls} 次`;
}

/** 零值桶（「今天」无数据时当天汇总行的兜底形态）。 */
const ZERO_BUCKET: UsageStatsBucketDto = {
  bucketStartMs: 0,
  calls: 0,
  promptTokens: 0,
  completionTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  billedInputTokens: 0,
  avgFirstTokenMs: null,
  avgTokensPerSecond: null,
};

/**
 * CSS div 柱状图：输入（--primary）下 + 输出（--text-secondary）上堆叠（仅用量模式）。
 * 图例行 + max/max÷2/0 三条网格刻度线 + 受控 hover 卡片（替代原生 title）。
 */
function TokenStatsChart({
  buckets,
  chart,
  keyOf,
  labelOf,
  selectedKey,
  onSelect,
}: {
  buckets: UsageStatsBucketDto[];
  /** 图表标识（daily / hourly），供测试与样式区分。 */
  chart: string;
  /** 桶 → 键（按天用日期键，按小时用小时序号）。 */
  keyOf: (bucket: UsageStatsBucketDto, index: number) => string;
  labelOf: (key: string) => string;
  selectedKey?: string;
  onSelect?: (key: string) => void;
}) {
  const maxValue = Math.max(1, ...buckets.map((b) => b.promptTokens + b.completionTokens));
  // 受控 hover 卡片：activeKey 记当前柱，null 不渲染；容器级 onMouseLeave 统一清除。
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const activeBucketIndex =
    activeKey == null
      ? -1
      : buckets.findIndex((b, index) => keyOf(b, index) === activeKey);
  const activeText =
    activeKey != null && activeBucketIndex >= 0
      ? bucketTooltip(activeKey, buckets[activeBucketIndex]!)
      : null;
  return (
    <div
      className={`token-stats-chart${chart === "hourly" ? " token-stats-chart--hourly" : ""}`}
      data-chart={chart}
      onMouseLeave={() => setActiveKey(null)}
    >
      {/* 图例行：输入 primary / 输出 text-secondary，与 mobile legendRow 同口径 */}
      <div className="token-stats-chart__legend">
        <span className="token-stats-chart__legend-item">
          <span className="token-stats-chart__legend-dot token-stats-chart__legend-dot--input" />
          输入
        </span>
        <span className="token-stats-chart__legend-item">
          <span className="token-stats-chart__legend-dot token-stats-chart__legend-dot--output" />
          输出
        </span>
      </div>
      <div className="token-stats-chart__plot">
        {/* 网格刻度线：max / max÷2 / 0 三条，右侧数值标注（maxValue 派生） */}
        <div className="token-stats-chart__grid" aria-hidden="true">
          <span className="token-stats-chart__grid-line token-stats-chart__grid-line--max" />
          <span className="token-stats-chart__grid-line token-stats-chart__grid-line--mid" />
          <span className="token-stats-chart__grid-line token-stats-chart__grid-line--zero" />
          <span className="token-stats-chart__grid-label token-stats-chart__grid-label--max">
            {formatTokenCount(maxValue)}
          </span>
          <span className="token-stats-chart__grid-label token-stats-chart__grid-label--mid">
            {formatTokenCount(Math.round(maxValue / 2))}
          </span>
        </div>
        {buckets.map((b, index) => {
          const key = keyOf(b, index);
          const usagePct = (value: number) => `${Math.min(100, (value / maxValue) * 100)}%`;
          const tooltip = bucketTooltip(key, b);
          const className = `token-stats-chart__col${selectedKey === key ? " is-selected" : ""}`;
          const hoverProps = {
            onMouseEnter: () => setActiveKey(key),
            onMouseLeave: () => setActiveKey(null),
          };
          const content = (
            <>
              <span className="token-stats-chart__bars">
                <span
                  className="token-stats-chart__bar token-stats-chart__bar--output"
                  style={{ height: usagePct(b.completionTokens) }}
                />
                <span
                  className="token-stats-chart__bar token-stats-chart__bar--input"
                  style={{ height: usagePct(b.promptTokens) }}
                />
              </span>
              <span className="token-stats-chart__label">{labelOf(key)}</span>
            </>
          );
          // 仅可交互（有 onSelect，如按天柱）时才用 button；纯展示柱（如 hourly）用
          // role="img" 的 div，避免无 onClick 的 button 被键盘聚焦、回车无响应。
          // hover 详情改受控卡片，aria-label 保留 tooltip 供读屏。
          return onSelect != null ? (
            <button
              key={key}
              type="button"
              className={className}
              data-day={key}
              aria-label={tooltip}
              onClick={() => onSelect(key)}
              {...hoverProps}
            >
              {content}
            </button>
          ) : (
            <div
              key={key}
              role="img"
              className={className}
              data-day={key}
              aria-label={tooltip}
              {...hoverProps}
            >
              {content}
            </div>
          );
        })}
        {/* hover 详情卡片：随绘图区相对定位，横向不出容器 */}
        {activeText != null ? (
          <div className="token-stats-chart__tooltip" data-tooltip={activeKey}>
            {activeText}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * 饼图色板（P2-5）：固定循环色板常量，色相序列双端一致
 * （蓝→青→绿→黄→橙→红→紫→灰蓝，按用量降序分配）；色值经 CSS 变量适配亮暗主题
 * （shell.css 中 light/dark 各定义同名变量）。
 */
const PIE_PALETTE = [
  "var(--token-stats-pie-c1)",
  "var(--token-stats-pie-c2)",
  "var(--token-stats-pie-c3)",
  "var(--token-stats-pie-c4)",
  "var(--token-stats-pie-c5)",
  "var(--token-stats-pie-c6)",
  "var(--token-stats-pie-c7)",
  "var(--token-stats-pie-c8)",
] as const;

/**
 * 饼图扇区 path（单位圆，中心 0,0）：12 点方向起顺时针扫 [startAngle, endAngle]。
 * SVG y 轴向下，故 x = sinθ、y = -cosθ；扇区角 ≥ 2π（单扇区独占整圆）时单条 A 弧
 * 退化（起点终点重合画不出），拆成两个半圆弧绘制。
 */
function pieSlicePath(startAngle: number, endAngle: number): string {
  const r = 1;
  const px = (angle: number) => (r * Math.sin(angle)).toFixed(4);
  const py = (angle: number) => (-r * Math.cos(angle)).toFixed(4);
  if (endAngle - startAngle >= 2 * Math.PI - 1e-9) {
    const half = startAngle + Math.PI;
    return `M 0 0 L ${px(startAngle)} ${py(startAngle)} A ${r} ${r} 0 0 1 ${px(half)} ${py(half)} A ${r} ${r} 0 0 1 ${px(startAngle)} ${py(startAngle)} Z`;
  }
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M 0 0 L ${px(startAngle)} ${py(startAngle)} A ${r} ${r} 0 ${largeArc} 1 ${px(endAngle)} ${py(endAngle)} Z`;
}

/** 饼图扇区数据（label 为「服务商 · 模型」组合，share 分母 = 窗口 summary.totalTokens，P1-3）。 */
interface PieSlice {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly calls: number;
  readonly color: string;
  readonly share: number | null;
  readonly row: UsageStatsModelRowDto;
}

/**
 * 服务商×模型饼图：SVG path 扇区 + 可点图例（与 TokenStatsChart 同文件内嵌惯例）。
 * 键盘可达（P2-6）：每个扇区一个 HTML button——多个 button 经绝对定位叠满饼图容器，
 * button 自身 pointer-events:none、扇区 path pointer-events:auto（点击命中落在扇形
 * 区域内、事件冒泡经 button 触发 onClick），兼得精确命中与 Tab/回车可达。
 * 点击扇区或图例 → onSelect（选中/再点取消由调用方控制）；图下详情行由调用方渲染
 * （沿用 bar-inspect 惯例，规避浮层手势冲突）。
 */
function PieChart({
  slices,
  selectedKey,
  onSelect,
}: {
  slices: PieSlice[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  let acc = 0;
  const arcs = slices.map((s) => {
    const startAngle = total > 0 ? (acc / total) * 2 * Math.PI : 0;
    acc += s.value;
    const endAngle = total > 0 ? (acc / total) * 2 * Math.PI : 0;
    return { ...s, startAngle, endAngle };
  });
  return (
    <div className="token-stats-pie-view">
      <div className="token-stats-pie">
        {arcs.map((a) => {
          const shareText = a.share == null ? "—" : `${Math.round(a.share * 100)}%`;
          return (
            <button
              key={a.key}
              type="button"
              className={`token-stats-pie__slice${selectedKey === a.key ? " is-selected" : ""}`}
              data-slice={a.key}
              aria-label={`${a.label} · 用量 ${formatTokenCount(a.value)} · ${a.calls} 次 · 占比 ${shareText}`}
              onClick={() => onSelect(a.key)}
            >
              <svg viewBox="-1.08 -1.08 2.16 2.16" aria-hidden="true">
                {a.value > 0 ? (
                  <path d={pieSlicePath(a.startAngle, a.endAngle)} style={{ fill: a.color }} />
                ) : null}
              </svg>
            </button>
          );
        })}
      </div>
      <div className="token-stats-pie-view__legend">
        {slices.map((s) => (
          <button
            key={s.key}
            type="button"
            className={`token-stats-pie-view__legend-item${selectedKey === s.key ? " is-selected" : ""}`}
            data-slice-key={s.key}
            aria-pressed={selectedKey === s.key}
            onClick={() => onSelect(s.key)}
          >
            <span
              className="token-stats-pie-view__legend-dot"
              style={{ background: s.color }}
            />
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 流水分页页大小（core 限制 1–200，desktop 取 50）。 */
const REQUESTS_PAGE_SIZE = 50;

export function TokenUsageStatsView() {
  const [rangeKind, setRangeKind] = useState<RangeKind>("last7");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [pageTab, setPageTab] = useState<PageTab>("summary");
  const [modelFilter, setModelFilter] = useState<string | null | undefined>(undefined);
  const [models, setModels] = useState<string[]>([]);
  const [summary, setSummary] = useState<UsageStatsSummaryDto | null>(null);
  const [dailyBuckets, setDailyBuckets] = useState<UsageStatsBucketDto[]>([]);
  const [modelRows, setModelRows] = useState<UsageStatsModelRowDto[]>([]);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [hourlyBuckets, setHourlyBuckets] = useState<UsageStatsBucketDto[] | null>(null);
  const [reqRows, setReqRows] = useState<UsageStatsRequestRowDto[]>([]);
  const [reqTotal, setReqTotal] = useState<number>(0);
  const [reqPage, setReqPage] = useState(0);
  const [reqLoading, setReqLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedSliceKey, setSelectedSliceKey] = useState<string | null>(null);
  const [providerNames, setProviderNames] = useState<Map<string, string>>(new Map());

  // 自定义区间校验（from ≤ to，无跨度上限）；非法时行内提示且暂停重查。
  const customRangeError = useMemo(() => {
    if (rangeKind !== "custom") return null;
    if (customFrom.length === 0 || customTo.length === 0) return "请选择起止日期";
    const from = parseLocalDate(customFrom);
    const to = parseLocalDate(customTo);
    if (from == null || to == null) return "请选择起止日期";
    if (from.getTime() > to.getTime()) return "开始日期不能晚于结束日期";
    return null;
  }, [rangeKind, customFrom, customTo]);

  // 有效筛选（null = 自定义区间非法，暂停查询、保留旧数据，与 mobile「阻止确认」语义一致）。
  // 命名窗口在此换算为自然日闭区间：今天 = {D, D}，近 7 天 = {D-6, D}（含今天共 7 桶），
  // 近 30 天 = {D-29, D}；自定义直传日期串（from ≤ to 已由 customRangeError 把关）。
  const filter = useMemo<UsageStatsFilterDto | null>(() => {
    if (rangeKind === "custom") {
      if (customRangeError != null) return null;
      return { range: { fromDay: customFrom, toDay: customTo }, model: modelFilter };
    }
    const todayKey = dayKeyOffset(0);
    if (rangeKind === "today") {
      return { range: { fromDay: todayKey, toDay: todayKey }, model: modelFilter };
    }
    const spanDays = rangeKind === "last7" ? 6 : 29;
    return { range: { fromDay: dayKeyOffset(-spanDays), toDay: todayKey }, model: modelFilter };
  }, [rangeKind, customFrom, customTo, customRangeError, modelFilter]);

  // 主链路竞态守卫：请求序号自增，旧一轮响应落地前发现序号已过期即整体丢弃
  // （与 hourly/models 副链路的 cancelled 标志同款语义；错误路径同样受守卫约束，
  // 过期请求的报错不覆盖新一轮的 loading/数据状态）。
  const reloadSeqRef = useRef(0);

  // 流水页按需加载：筛选变化（时间/模型）置脏，页签激活且数据脏时才拉首页；
  // 不在流水页时改筛选仅置脏不重查，切回流水页补拉。
  const reqSeqRef = useRef(0);
  const reqDirtyRef = useRef(true);

  const reload = useCallback(async (f: UsageStatsFilterDto, autoSelectToday: boolean) => {
    const seq = ++reloadSeqRef.current;
    const [sumRes, dailyRes, rowsRes] = await Promise.all([
      ipcUsageStatsQuery({ kind: "summary", filter: f }),
      ipcUsageStatsQuery({ kind: "daily", filter: f }),
      ipcUsageStatsQuery({ kind: "modelBreakdown", filter: f }),
    ]);
    if (seq !== reloadSeqRef.current) {
      return;
    }
    if (!sumRes.ok) {
      setLoadError(sumRes.error.message);
      return;
    }
    if (!dailyRes.ok) {
      setLoadError(dailyRes.error.message);
      return;
    }
    if (!rowsRes.ok) {
      setLoadError(rowsRes.error.message);
      return;
    }
    const sum = sumRes.data;
    if (
      typeof sum !== "object" ||
      sum == null ||
      !("totalTokens" in sum) ||
      !Array.isArray(dailyRes.data) ||
      !Array.isArray(rowsRes.data)
    ) {
      setLoadError("统计数据返回格式异常");
      return;
    }
    setLoadError(null);
    setSummary(sum);
    setDailyBuckets(dailyRes.data as UsageStatsBucketDto[]);
    setModelRows(rowsRes.data as UsageStatsModelRowDto[]);
    // P1-1：「今天」的自动补选必须写在这个成功分支里——独立 effect 的补选会被
    // 此处对 selectedDay 的重置抹掉（后到的回调覆盖先行的 effect）。
    setSelectedDay(autoSelectToday ? toLocalDayKey(Date.now()) : null);
    setHourlyBuckets(null);
    // 数据已换，饼图选中行失效；流水脏标记由监听完整 filter 的独立 effect
    // 置位（需求①勘误后时间/模型变化均覆盖，见 requestsFilter 定义处）。
    setSelectedSliceKey(null);
  }, []);

  useEffect(() => {
    if (filter == null) return;
    void reload(filter, rangeKind === "today");
  }, [filter, rangeKind, reload]);

  // 流水筛选（需求①勘误后）：与汇总/图表共享完整 filter（range + model）——
  // 时间或模型筛选变化都会改变 requestsFilter，经下方独立 effect 置脏；
  // custom 区间非法（filter 为 null）时不发查询、保留旧列表。
  const requestsFilter = filter;

  useEffect(() => {
    reqDirtyRef.current = true;
  }, [requestsFilter]);

  // 流水页分页加载：按页号取整页替换（不再追加）；序号守卫防止旧响应覆盖新数据。
  // f 为 null（custom 区间非法）时静默跳过，不发查询。
  const loadRequests = useCallback(async (f: UsageStatsFilterDto | null, page: number) => {
    if (f == null) {
      return;
    }
    const seq = ++reqSeqRef.current;
    setReqLoading(true);
    const res = await ipcUsageStatsQuery({
      kind: "requests",
      filter: f,
      offset: page * REQUESTS_PAGE_SIZE,
      limit: REQUESTS_PAGE_SIZE,
    });
    if (seq !== reqSeqRef.current) {
      return;
    }
    setReqLoading(false);
    if (!res.ok) {
      setLoadError(res.error.message);
      return;
    }
    const body = res.data;
    if (
      typeof body !== "object" ||
      body == null ||
      !Array.isArray((body as UsageStatsRequestPageDto).rows)
    ) {
      setLoadError("统计数据返回格式异常");
      return;
    }
    setLoadError(null);
    const data = body as UsageStatsRequestPageDto;
    setReqRows([...data.rows]);
    setReqTotal(data.total);
    setReqPage(page);
  }, []);

  // 页签激活且数据脏时拉首页；仅切页签不重拉（保留已加载的分页）。
  // requestsFilter 含 range（需求①勘误后）：时间或模型变化置脏，停在流水页时
  // 依赖变化即时触发本 effect 重拉首页。
  useEffect(() => {
    if (pageTab !== "requests" || requestsFilter == null || !reqDirtyRef.current) {
      return;
    }
    reqDirtyRef.current = false;
    void loadRequests(requestsFilter, 0);
  }, [pageTab, requestsFilter, loadRequests]);

  // 模型选项：listModels 只回非 NULL 模型名，「其他模型」桶由 UI 侧补上（DEV-1）。
  // P2-4：models 查询不再传 dummy range（filter 留空，listModels 本就不按时间过滤）。
  useEffect(() => {
    let cancelled = false;
    void ipcUsageStatsQuery({ kind: "models", filter: {} }).then((res) => {
      if (!cancelled && res.ok && Array.isArray(res.data)) {
        setModels(res.data as string[]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 服务商展示名解析：AgentEditorView 同源通道拉 provider 列表；失败静默降级
  // （providerId 解析不到时饼图 label 显示「未知服务商」），不阻塞统计页。
  useEffect(() => {
    let cancelled = false;
    ipcProvidersList()
      .then((res) => {
        if (cancelled) return;
        const result = res as IpcResult<ProviderListItemDto[]>;
        if (result.ok && Array.isArray(result.data)) {
          setProviderNames(new Map(result.data.map((p) => [p.id, p.displayName])));
        }
      })
      .catch(() => {
        /* 拉取失败：名称解析走「未知服务商」兜底 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 选中天后加载 24 小时桶：透传完整 filter（其中仅模型维度参与此链路，
  // range 不生效），时间边界由 dayLocalDate 单独界定（core 侧按该天构造
  // 24 个本地钟点桶）。
  useEffect(() => {
    if (selectedDay == null || filter == null) {
      setHourlyBuckets(null);
      return;
    }
    let cancelled = false;
    void ipcUsageStatsQuery({ kind: "hourly", filter, dayLocalDate: selectedDay }).then(
      (res) => {
        if (!cancelled && res.ok && Array.isArray(res.data)) {
          setHourlyBuckets(res.data as UsageStatsBucketDto[]);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [selectedDay, filter]);

  const handleRangeKindChange = useCallback(
    (next: RangeKind) => {
      // 切到自定义时预填最近 7 天，避免空日期空转。
      if (next === "custom" && customFrom.length === 0 && customTo.length === 0) {
        const today = new Date();
        const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
        setCustomFrom(toDateInputValue(from));
        setCustomTo(toDateInputValue(today));
      }
      setRangeKind(next);
    },
    [customFrom, customTo],
  );

  const handleSliceSelect = useCallback((key: string) => {
    setSelectedSliceKey((prev) => (prev === key ? null : key));
  }, []);

  const selectedDayBucket =
    selectedDay != null
      ? dailyBuckets.find((b) => toLocalDayKey(b.bucketStartMs) === selectedDay)
      : undefined;

  const sortedModelRows = useMemo(
    () => [...modelRows].sort((a, b) => b.totalTokens - a.totalTokens),
    [modelRows],
  );

  // 饼图扇区：modelRows 原样不折叠（provider×model 复合维度），按用量降序分配
  // 循环色板；label 组合「服务商 · 模型」——服务商三态（解析名 / 未知服务商 /
  // 未记录服务商（历史））× 模型两态（名 / 其他模型）；占比分母 = 窗口
  // summary.totalTokens（P1-3，与原列表口径一致）。
  const pieSlices = useMemo<PieSlice[]>(
    () =>
      sortedModelRows.map((row, index) => {
        const providerPart =
          row.providerId == null
            ? "未记录服务商（历史）"
            : (providerNames.get(row.providerId) ?? "未知服务商");
        const modelPart = row.modelName ?? "其他模型";
        return {
          key: `${row.providerId ?? "__no_provider__"}::${row.modelName ?? "__other_model__"}`,
          label: `${providerPart} · ${modelPart}`,
          value: row.totalTokens,
          calls: row.calls,
          color: PIE_PALETTE[index % PIE_PALETTE.length]!,
          share:
            summary != null && summary.totalTokens > 0
              ? row.totalTokens / summary.totalTokens
              : null,
          row,
        };
      }),
    [sortedModelRows, providerNames, summary],
  );

  const selectedSlice =
    selectedSliceKey != null
      ? (pieSlices.find((s) => s.key === selectedSliceKey) ?? null)
      : null;

  const modelSelectValue =
    modelFilter === undefined
      ? MODEL_OPTION_ALL
      : modelFilter === null
        ? MODEL_OPTION_UNLOGGED
        : modelFilter;

  const rangeLabel =
    rangeKind === "custom" && customFrom.length > 0 && customTo.length > 0
      ? `${customFrom} — ${customTo}`
      : rangeKind === "today"
        ? "今天"
        : rangeKind === "last30"
          ? "近 30 天"
          : "近 7 天";

  const empty = summary != null && summary.calls === 0 && summary.totalTokens === 0;

  // 空态区分（库全空 vs 范围内无数据）：仅在出现空态时懒发一次探底查询——
  // 近一年宽度的 {fromDay, toDay} 自然日区间 summary（365 天跨度）。功能上线
  // 不足一年，一年内无任何记录 ⇔ 库全空；非空场景零额外查询。探底失败保持 null，
  // 按范围内无数据展示（不阻塞用户）。
  const [libraryEmpty, setLibraryEmpty] = useState<boolean | null>(null);
  const libraryProbedRef = useRef(false);
  useEffect(() => {
    if (!empty || libraryProbedRef.current) {
      return;
    }
    libraryProbedRef.current = true;
    let cancelled = false;
    void ipcUsageStatsQuery({
      kind: "summary",
      filter: { range: { fromDay: dayKeyOffset(-365), toDay: dayKeyOffset(0) } },
    }).then((res) => {
      const sum = res.ok ? res.data : null;
      if (
        !cancelled &&
        typeof sum === "object" &&
        sum != null &&
        "totalTokens" in sum
      ) {
        setLibraryEmpty(
          (sum as UsageStatsSummaryDto).calls === 0 &&
            (sum as UsageStatsSummaryDto).totalTokens === 0,
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [empty]);

  return (
    <SettingsPanel>
      <SettingsSection title="筛选">
        <div className="token-stats-view__controls">
          <SegmentedControl
            aria-label="时间范围"
            value={rangeKind}
            options={[
              { value: "today" as RangeKind, label: "今天" },
              { value: "last7" as RangeKind, label: "近 7 天" },
              { value: "last30" as RangeKind, label: "近 30 天" },
              { value: "custom" as RangeKind, label: "自定义" },
            ]}
            onChange={handleRangeKindChange}
          />
        </div>
        {rangeKind === "custom" ? (
          <div className="token-stats-view__custom-range">
            <input
              type="date"
              className="token-stats-view__date"
              aria-label="开始日期"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
            <span className="token-stats-view__range-sep">—</span>
            <input
              type="date"
              className="token-stats-view__date"
              aria-label="结束日期"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
            />
            {customRangeError != null ? (
              <p className="token-stats-view__range-error">{customRangeError}</p>
            ) : null}
          </div>
        ) : null}
        <label className="token-stats-view__model-filter">
          <span className="token-stats-view__model-filter-label">模型</span>
          <select
            className="token-stats-view__model-select"
            aria-label="模型筛选"
            value={modelSelectValue}
            onChange={(e) =>
              setModelFilter(
                e.target.value === MODEL_OPTION_ALL
                  ? undefined
                  : e.target.value === MODEL_OPTION_UNLOGGED
                    ? null
                    : e.target.value,
              )
            }
          >
            <option value={MODEL_OPTION_ALL}>全部模型</option>
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            {/* 常量与 value 名保留 __unlogged__（历史命名），语义已升级为「其他模型」：NULL + 非当前配置历史模型。modelBreakdown 行为 provider×model 复合维度原样透传，本选项仍按模型名单值筛选 */}
            <option value={MODEL_OPTION_UNLOGGED}>其他模型</option>
          </select>
        </label>
        {loadError != null ? <p className="token-stats-view__error">{loadError}</p> : null}
      </SettingsSection>

      <div className="token-stats-view__tabs">
        <SegmentedControl
          aria-label="视图页签"
          value={pageTab}
          options={[
            { value: "summary" as PageTab, label: "汇总" },
            { value: "detail" as PageTab, label: "图表" },
            { value: "requests" as PageTab, label: "流水" },
          ]}
          onChange={setPageTab}
        />
      </div>

      {/* 空态三页签统一（需求①勘误后）：窗口空（库非空）时流水页签同样显示区间 */}
      {/* 空态——流水跟随时间窗口，窗口外无数据可展示；库全空探底命中时为 */}
      {/* 冷启动引导文案。 */}
      {empty ? (
        <SettingsSection title="数据统计">
          {libraryEmpty ? (
            <SettingsListEmpty>
              库里还没有任何用量数据。Token 用量自记录功能上线起开始积累，发起对话后这里会展示统计；缓存命中率数据自本版本起开始记录；速率与首字延迟数据自本版本起开始积累。
            </SettingsListEmpty>
          ) : (
            <SettingsListEmpty>
              当前筛选范围内暂无用量数据，可调整时间范围或模型筛选后再试。
            </SettingsListEmpty>
          )}
        </SettingsSection>
      ) : pageTab === "summary" ? (
        <>
          <SettingsSection title={`总览 · ${rangeLabel}`} desc="跟随当前时间范围与模型筛选">
            <div className="token-stats-cards token-stats-cards--metrics">
              <div className="token-stats-card" data-metric="totalTokens">
                <span className="token-stats-card__label">总 token</span>
                <span className="token-stats-card__value">
                  {formatTokenCount(summary?.totalTokens ?? 0)}
                </span>
              </div>
              <div className="token-stats-card" data-metric="promptTokens">
                <span className="token-stats-card__label">输入</span>
                <span className="token-stats-card__value">
                  {formatTokenCount(summary?.promptTokens ?? 0)}
                </span>
              </div>
              <div className="token-stats-card" data-metric="completionTokens">
                <span className="token-stats-card__label">输出</span>
                <span className="token-stats-card__value">
                  {formatTokenCount(summary?.completionTokens ?? 0)}
                </span>
              </div>
              <div className="token-stats-card" data-metric="calls">
                <span className="token-stats-card__label">调用次数</span>
                <span className="token-stats-card__value">{String(summary?.calls ?? 0)}</span>
              </div>
              <div className="token-stats-card" data-metric="hitRate">
                <span className="token-stats-card__label">命中率</span>
                <span className="token-stats-card__value token-stats-card__value--success">
                  {formatHitRate(
                    hitRate(summary?.cacheReadTokens ?? 0, summary?.billedInputTokens ?? 0),
                  )}
                </span>
              </div>
              {/* 新指标卡：无有效行为 null → 空态文案而非 0 */}
              <div className="token-stats-card" data-metric="avgTokensPerSecond">
                <span className="token-stats-card__label">平均速率</span>
                <span className="token-stats-card__value">
                  {formatTokensPerSecond(summary?.avgTokensPerSecond ?? null)}
                </span>
              </div>
              <div className="token-stats-card" data-metric="avgFirstTokenMs">
                <span className="token-stats-card__label">平均首字延迟</span>
                <span className="token-stats-card__value">
                  {formatDurationMs(summary?.avgFirstTokenMs ?? null)}
                </span>
                {/* 口径注记：非流式请求的 TTFT 取完成时刻，避免误导 */}
                <span className="token-stats-card__hint">非流式请求按完成时刻计</span>
              </div>
            </div>
          </SettingsSection>

          <SettingsSection
            title="服务商 × 模型"
            desc="点选扇区或图例查看用量、调用次数与占比"
          >
            <div className="token-stats-pie-block">
              <PieChart
                slices={pieSlices}
                selectedKey={selectedSliceKey}
                onSelect={handleSliceSelect}
              />
              {selectedSlice != null ? (
                <p
                  className="token-stats-pie-block__detail"
                  data-slice-detail={selectedSlice.key}
                >
                  {selectedSlice.label} · 用量{" "}
                  {formatTokenCount(selectedSlice.row.totalTokens)} · 调用{" "}
                  {selectedSlice.row.calls} 次 · 占比{" "}
                  {selectedSlice.share == null ? "—" : `${Math.round(selectedSlice.share * 100)}%`}
                </p>
              ) : null}
            </div>
          </SettingsSection>
        </>
      ) : pageTab === "requests" ? (
        <SettingsSection
          title={`请求流水 · 共 ${reqTotal} 条`}
          desc="按时间倒序列出当前筛选范围内的请求"
        >
          <div className="token-stats-requests">
            <div className="token-stats-requests__row token-stats-requests__row--head">
              <span>时间</span>
              <span>模型</span>
              <span>输入</span>
              <span>输出</span>
              <span>缓存读</span>
              <span>首字延迟</span>
              <span>总时间</span>
            </div>
            {reqRows.map((row, index) => (
              <div
                key={`${row.createdAtMs}-${index}`}
                className="token-stats-requests__row"
              >
                <span>{formatRequestTime(row.createdAtMs)}</span>
                <span className="token-stats-requests__name">
                  {row.modelName ?? "—"}
                </span>
                <span>{formatTokenCount(row.promptTokens)}</span>
                <span>{formatTokenCount(row.completionTokens)}</span>
                <span>
                  {row.cacheReadTokens == null
                    ? "—"
                    : formatTokenCount(row.cacheReadTokens)}
                </span>
                <span>{formatDurationMs(row.firstTokenMs)}</span>
                <span>{formatDurationMs(row.durationMs)}</span>
              </div>
            ))}
            {reqRows.length === 0 && !reqLoading ? (
              <div className="token-stats-requests__row">—</div>
            ) : null}
          </div>
          {reqTotal > 0 ? (
            <div className="token-stats-requests__pager">
              <button
                type="button"
                className="token-stats-requests__page-btn"
                disabled={reqLoading || reqPage === 0}
                onClick={() => void loadRequests(requestsFilter, reqPage - 1)}
              >
                上一页
              </button>
              {pageWindowItems(
                reqPage + 1,
                Math.max(1, Math.ceil(reqTotal / REQUESTS_PAGE_SIZE)),
              ).map((item, index) =>
                item === "…" ? (
                  <span key={`gap-${index}`} className="token-stats-requests__pager-gap">
                    …
                  </span>
                ) : (
                  <button
                    key={`page-${item}`}
                    type="button"
                    className={`token-stats-requests__page-num${
                      item === reqPage + 1 ? " token-stats-requests__page-num--active" : ""
                    }`}
                    disabled={reqLoading}
                    onClick={() => void loadRequests(requestsFilter, item - 1)}
                  >
                    {String(item)}
                  </button>
                ),
              )}
              <button
                type="button"
                className="token-stats-requests__page-btn"
                disabled={
                  reqLoading || (reqPage + 1) * REQUESTS_PAGE_SIZE >= reqTotal
                }
                onClick={() => void loadRequests(requestsFilter, reqPage + 1)}
              >
                下一页
              </button>
            </div>
          ) : null}
        </SettingsSection>
      ) : rangeKind === "today" ? (
        // 「今天」模式（T-D4）：跳过按天图（单日柱无信息量），直出当天汇总行 +
        // 按小时图；当天汇总行取 dailyBuckets 的选中天桶（即唯一桶），无数据日
        // 显示零值文案。hourly 数据由 selectedDay 自动补选（P1-1）触发拉取。
        <SettingsSection title="今天 · 按小时分布" desc="当天 0-24 点的输入输出与调用量">
          <div
            className="token-stats-view__day-detail"
            data-day-detail={selectedDay ?? undefined}
          >
            <p className="token-stats-view__day-detail-summary">
              输入 {formatTokenCount((selectedDayBucket ?? ZERO_BUCKET).promptTokens)} · 输出{" "}
              {formatTokenCount((selectedDayBucket ?? ZERO_BUCKET).completionTokens)} · 命中率{" "}
              {formatHitRate(
                hitRate(
                  (selectedDayBucket ?? ZERO_BUCKET).cacheReadTokens,
                  (selectedDayBucket ?? ZERO_BUCKET).billedInputTokens,
                ),
              )}{" "}
              · 调用 {(selectedDayBucket ?? ZERO_BUCKET).calls} 次 · 平均速率{" "}
              {formatTokensPerSecond((selectedDayBucket ?? ZERO_BUCKET).avgTokensPerSecond)} · 平均首字延迟{" "}
              {formatDurationMs((selectedDayBucket ?? ZERO_BUCKET).avgFirstTokenMs)}
            </p>
            <TokenStatsChart
              buckets={hourlyBuckets ?? []}
              chart="hourly"
              keyOf={(_b, index) => String(index)}
              labelOf={(key) => `${Number(key)}时`}
            />
          </div>
        </SettingsSection>
      ) : (
        <SettingsSection title="按天用量">
          <TokenStatsChart
            buckets={dailyBuckets}
            chart="daily"
            keyOf={(b) => toLocalDayKey(b.bucketStartMs)}
            labelOf={(key) => key.slice(8)}
            selectedKey={selectedDay ?? undefined}
            onSelect={(key) => setSelectedDay((prev) => (prev === key ? null : key))}
          />
          {selectedDay != null && selectedDayBucket != null ? (
            <div className="token-stats-view__day-detail" data-day-detail={selectedDay}>
              <p className="token-stats-view__day-detail-title">{selectedDay} · 按小时分布</p>
              <p className="token-stats-view__day-detail-summary">
                输入 {formatTokenCount(selectedDayBucket.promptTokens)} · 输出{" "}
                {formatTokenCount(selectedDayBucket.completionTokens)} · 命中率{" "}
                {formatHitRate(
                  hitRate(
                    selectedDayBucket.cacheReadTokens,
                    selectedDayBucket.billedInputTokens,
                  ),
                )}{" "}
                · 调用 {selectedDayBucket.calls} 次 · 平均速率{" "}
                {formatTokensPerSecond(selectedDayBucket.avgTokensPerSecond)} · 平均首字延迟{" "}
                {formatDurationMs(selectedDayBucket.avgFirstTokenMs)}
              </p>
              <TokenStatsChart
                buckets={hourlyBuckets ?? []}
                chart="hourly"
                keyOf={(_b, index) => String(index)}
                labelOf={(key) => `${Number(key)}时`}
              />
            </div>
          ) : null}
        </SettingsSection>
      )}
    </SettingsPanel>
  );
}

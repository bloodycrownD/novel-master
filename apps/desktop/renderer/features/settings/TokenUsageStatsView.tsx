/**
 * 设置页「数据统计」视图（spec 变更点 6 / Step 7）：
 * 「汇总 / 明细 / 流水」三页签，筛选栏（时间范围：近 7 / 近 30 / 自定义区间 × 模型）置顶、
 * 三页签共享（切换页签保留筛选、不重查）。汇总页签：范围内五指标卡片 + 独立于筛选的
 * 今日卡；明细页签：按天图 + 24 小时钻取 + 当天汇总行；分模型表在汇总页签
 * （不含命中率列，命中率出口在汇总卡片与选中天汇总行）；流水页签：请求级分页列表
 * （时间倒序，按需加载）。
 * 数据统一经 ipcUsageStatsQuery（nm:usageStats/query 单 channel 按 kind 分发）获取；
 * 功能口径对齐 mobile 侧 TokenUsageStatsScreen，交互按桌面惯例。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ipcUsageStatsQuery } from "@/ipc/client";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type {
  UsageStatsBucketDto,
  UsageStatsFilterDto,
  UsageStatsModelRowDto,
  UsageStatsRequestPageDto,
  UsageStatsRequestRowDto,
  UsageStatsSummaryDto,
} from "@shared/ipc-types";
import { SettingsListEmpty, SettingsPanel, SettingsSection } from "./settings-ui";
import { formatTokenCount } from "@shared/logic/format-token-count";

type RangeKind = "last7" | "last30" | "custom";
type PageTab = "summary" | "detail" | "requests";

const MS_PER_DAY = 86_400_000;
/** 自定义区间上限（天，含首尾；与 mobile 侧同口径，避免超长区间查询变慢）。 */
const CUSTOM_RANGE_MAX_DAYS = 366;

/** 模型下拉的三态哨兵：全部 / 其他模型（对应 filter.model 的 undefined / null）。「其他模型」= NULL 记录 + 非当前配置的历史模型归并。 */
const MODEL_OPTION_ALL = "__all__";
const MODEL_OPTION_UNLOGGED = "__unlogged__";

/** ms → 本地日期键 `YYYY-MM-DD`（天/小时桶都用它定位天边界）。 */
function toLocalDayKey(ms: number): string {
  const d = new Date(ms);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
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

/** 平均首字延迟展示：秒级 `x.x s` / 毫秒级 `xxx ms`；无数据显示空态。 */
function formatFirstTokenMs(ms: number | null): string {
  if (ms == null) {
    return "—";
  }
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

/** 请求耗时展示：秒级 `x.x s` / 毫秒级 `xxx ms`；无数据显示横杠。 */
function formatDurationMs(ms: number | null): string {
  if (ms == null) {
    return "—";
  }
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

/** 请求流水时间展示：本地时区 `MM-DD HH:mm`。 */
function formatRequestTime(ms: number): string {
  const d = new Date(ms);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hh}:${mm}`;
}

/**
 * 桶 tooltip 文案（当天/该小时 输入输出与调用数）。
 * 明细图表不再展示命中率——命中率出口仅保留在汇总卡片与选中天汇总行。
 */
function bucketTooltip(key: string, b: UsageStatsBucketDto): string {
  return `${key} · 输入 ${formatTokenCount(b.promptTokens)} · 输出 ${formatTokenCount(
    b.completionTokens,
  )} · 调用 ${b.calls} 次`;
}

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

/** 流水分页页大小（与 mobile 侧同口径；core 限制 1–200）。 */
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

  // 自定义区间校验（≤366 天，含首尾）；非法时行内提示且暂停重查。
  const customRangeError = useMemo(() => {
    if (rangeKind !== "custom") return null;
    if (customFrom.length === 0 || customTo.length === 0) return "请选择起止日期";
    const from = parseLocalDate(customFrom);
    const to = parseLocalDate(customTo);
    if (from == null || to == null) return "请选择起止日期";
    if (from.getTime() > to.getTime()) return "开始日期不能晚于结束日期";
    const dayCount = Math.round((to.getTime() - from.getTime()) / MS_PER_DAY) + 1;
    if (dayCount > CUSTOM_RANGE_MAX_DAYS) {
      return `自定义区间最长 ${CUSTOM_RANGE_MAX_DAYS} 天`;
    }
    return null;
  }, [rangeKind, customFrom, customTo]);

  // 有效筛选（null = 自定义区间非法，暂停查询、保留旧数据，与 mobile「阻止确认」语义一致）。
  const filter = useMemo<UsageStatsFilterDto | null>(() => {
    if (rangeKind === "custom") {
      if (customRangeError != null) return null;
      const from = parseLocalDate(customFrom);
      const to = parseLocalDate(customTo);
      if (from == null || to == null) return null;
      // to 取结束日次日 0 点（含结束日全天，与 last7/last30 覆盖到本地明日 0 点一致）。
      // 用 Date 日历推进而非固定毫秒加法：DST 切换日实际只有 23/25 小时，
      // 固定 +MS_PER_DAY 会让边界偏移 1 小时（与预填逻辑同款构造）。
      return {
        range: {
          kind: "custom",
          fromMs: from.getTime(),
          toMs: new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1).getTime(),
        },
        model: modelFilter,
      };
    }
    return { range: { kind: rangeKind }, model: modelFilter };
  }, [rangeKind, customFrom, customTo, customRangeError, modelFilter]);

  // 主链路竞态守卫：请求序号自增，旧一轮响应落地前发现序号已过期即整体丢弃
  // （与 hourly/models 副链路的 cancelled 标志同款语义；错误路径同样受守卫约束，
  // 过期请求的报错不覆盖新一轮的 loading/数据状态）。
  const reloadSeqRef = useRef(0);

  // 流水页按需加载：筛选变化置脏，页签激活且数据脏时才拉首页（与汇总/明细共享筛选不即时重查）。
  const reqSeqRef = useRef(0);
  const reqDirtyRef = useRef(true);

  const reload = useCallback(async (f: UsageStatsFilterDto) => {
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
      !("today" in sum) ||
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
    setSelectedDay(null);
    setHourlyBuckets(null);
    // 筛选已变，流水页数据失效（等切回页签时重拉首页）。
    reqDirtyRef.current = true;
  }, []);

  useEffect(() => {
    if (filter == null) return;
    void reload(filter);
  }, [filter, reload]);

  // 流水页分页加载：按页号取整页替换（不再追加）；序号守卫防止旧响应覆盖新数据。
  const loadRequests = useCallback(
    async (f: UsageStatsFilterDto, page: number) => {
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
    },
    [],
  );

  // 页签激活且数据脏时拉首页；仅切页签不重拉（保留已加载的分页）。
  useEffect(() => {
    if (pageTab !== "requests" || filter == null || !reqDirtyRef.current) {
      return;
    }
    reqDirtyRef.current = false;
    void loadRequests(filter, 0);
  }, [pageTab, filter, loadRequests]);

  // 模型选项：listModels 只回非 NULL 模型名，「未记录」桶由 UI 侧补上（DEV-1）。
  useEffect(() => {
    let cancelled = false;
    void ipcUsageStatsQuery({ kind: "models", filter: { range: { kind: "last7" } } }).then(
      (res) => {
        if (!cancelled && res.ok && Array.isArray(res.data)) {
          setModels(res.data as string[]);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // 选中天后加载 24 小时桶（时间由天本身界定，filter 只取模型维度）。
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

  const selectedDayBucket =
    selectedDay != null
      ? dailyBuckets.find((b) => toLocalDayKey(b.bucketStartMs) === selectedDay)
      : undefined;

  const sortedModelRows = useMemo(
    () => [...modelRows].sort((a, b) => b.totalTokens - a.totalTokens),
    [modelRows],
  );

  const modelSelectValue =
    modelFilter === undefined
      ? MODEL_OPTION_ALL
      : modelFilter === null
        ? MODEL_OPTION_UNLOGGED
        : modelFilter;

  const rangeLabel =
    rangeKind === "custom" && customFrom.length > 0 && customTo.length > 0
      ? `${customFrom} — ${customTo}`
      : rangeKind === "last30"
        ? "近 30 天"
        : "近 7 天";

  const empty = summary != null && summary.calls === 0 && summary.totalTokens === 0;

  // 空态区分（库全空 vs 范围内无数据）：仅在出现空态时懒发一次探底查询——
  // 近一年宽度的 custom 范围 summary（core custom 上限 366 天，故取 365 天）。功能上线
  // 不足一年，一年内无任何记录 ⇔ 库全空；非空场景零额外查询。探底失败保持 null，
  // 按范围内无数据展示（保留今日卡，不阻塞用户）。
  const [libraryEmpty, setLibraryEmpty] = useState<boolean | null>(null);
  const libraryProbedRef = useRef(false);
  useEffect(() => {
    if (!empty || libraryProbedRef.current) {
      return;
    }
    libraryProbedRef.current = true;
    let cancelled = false;
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 365);
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    void ipcUsageStatsQuery({
      kind: "summary",
      filter: { range: { kind: "custom", fromMs: from.getTime(), toMs: to.getTime() } },
    }).then((res) => {
      const sum = res.ok ? res.data : null;
      if (
        !cancelled &&
        typeof sum === "object" &&
        sum != null &&
        "today" in sum
      ) {
        setLibraryEmpty((sum as UsageStatsSummaryDto).calls === 0 && (sum as UsageStatsSummaryDto).totalTokens === 0);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [empty]);

  // 今日卡独立于筛选，非空与「范围内无数据」空态两个分支共用。
  const todayCard = (
    <div className="token-stats-view__today">
      <span className="token-stats-view__today-title">今日</span>
      <span className="token-stats-view__today-hint">不受时间范围与模型筛选影响</span>
      <div className="token-stats-cards token-stats-cards--today">
        <div className="token-stats-card" data-metric="todayTotalTokens">
          <span className="token-stats-card__label">总 token</span>
          <span className="token-stats-card__value">
            {formatTokenCount(summary?.today.totalTokens ?? 0)}
          </span>
        </div>
        <div className="token-stats-card" data-metric="todayCalls">
          <span className="token-stats-card__label">调用次数</span>
          <span className="token-stats-card__value">
            {String(summary?.today.calls ?? 0)}
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <SettingsPanel>
      <SettingsSection title="筛选">
        <div className="token-stats-view__controls">
          <SegmentedControl
            aria-label="时间范围"
            value={rangeKind}
            options={[
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
            {/* 常量与 value 名保留 __unlogged__（历史命名），语义已升级为「其他模型」：NULL + 非当前配置历史模型 */}
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
            { value: "detail" as PageTab, label: "明细" },
            { value: "requests" as PageTab, label: "流水" },
          ]}
          onChange={setPageTab}
        />
      </div>

      {empty ? (
        <SettingsSection title="数据统计">
          {libraryEmpty ? (
            <SettingsListEmpty>
              库里还没有任何用量数据。Token 用量自记录功能上线起开始积累，发起对话后这里会展示统计；缓存命中率数据自本版本起开始记录；速率与首字延迟数据自本版本起开始积累。
            </SettingsListEmpty>
          ) : (
            <>
              <SettingsListEmpty>当前筛选范围内暂无用量数据，可调整时间范围或模型筛选后再试。</SettingsListEmpty>
              {/* 今日卡独立于筛选，不随范围空态消失（mobile/A-1 并档双端） */}
              {todayCard}
            </>
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
                  {formatFirstTokenMs(summary?.avgFirstTokenMs ?? null)}
                </span>
                {/* 口径注记：非流式请求的 TTFT 取完成时刻，避免误导 */}
                <span className="token-stats-card__hint">非流式请求按完成时刻计</span>
              </div>
            </div>
            {/* 今日卡见 todayCard（非空分支同样独立于筛选） */}
            {todayCard}
          </SettingsSection>

          <SettingsSection title="分模型汇总" desc="不含命中率列——命中率出口在汇总卡片与选中天汇总行">
            <div className="token-stats-models">
              <div className="token-stats-models__row token-stats-models__row--head">
                <span>模型</span>
                <span>用量</span>
                <span>占比</span>
                <span>调用次数</span>
              </div>
              {sortedModelRows.map((row) => {
                const share =
                  summary != null && summary.totalTokens > 0
                    ? row.totalTokens / summary.totalTokens
                    : null;
                return (
                  <div
                    key={row.modelName ?? MODEL_OPTION_UNLOGGED}
                    className="token-stats-models__row"
                    data-model={row.modelName ?? MODEL_OPTION_UNLOGGED}
                  >
                    <span className="token-stats-models__name">
                      {row.modelName ?? "其他"}
                    </span>
                    <span>{formatTokenCount(row.totalTokens)}</span>
                    <span>{share == null ? "—" : `${Math.round(share * 100)}%`}</span>
                    <span>{String(row.calls)}</span>
                  </div>
                );
              })}
            </div>
          </SettingsSection>
        </>
      ) : pageTab === "requests" ? (
        <SettingsSection
          title={`请求流水 · 共 ${reqTotal} 条`}
          desc="按时间倒序列出范围内的每次 LLM 请求"
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
                <span>{formatFirstTokenMs(row.firstTokenMs)}</span>
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
                onClick={() =>
                  filter != null
                    ? void loadRequests(filter, reqPage - 1)
                    : undefined
                }
              >
                上一页
              </button>
              <span className="token-stats-requests__pager-label">
                {reqLoading
                  ? "加载中…"
                  : `第 ${reqPage + 1}/${Math.max(1, Math.ceil(reqTotal / REQUESTS_PAGE_SIZE))} 页`}
              </span>
              <button
                type="button"
                className="token-stats-requests__page-btn"
                disabled={
                  reqLoading || (reqPage + 1) * REQUESTS_PAGE_SIZE >= reqTotal
                }
                onClick={() =>
                  filter != null
                    ? void loadRequests(filter, reqPage + 1)
                    : undefined
                }
              >
                下一页
              </button>
            </div>
          ) : null}
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
                {formatFirstTokenMs(selectedDayBucket.avgFirstTokenMs)}
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

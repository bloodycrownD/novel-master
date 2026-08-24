/**
 * 设置页「数据统计」视图（spec 变更点 6 / Step 7）：
 * 「汇总 / 明细」双页签，筛选栏（时间范围：近 7 / 近 30 / 自定义区间 × 模型）置顶、
 * 两页签共享（切换页签保留筛选、不重查）。汇总页签：范围内五指标卡片 + 独立于筛选的
 * 今日卡；明细页签：按天 CSS 柱状图（点选某天钻取 24 小时分布 + 当天汇总行）+ 分模型表
 * （不含命中率列，命中率出口在汇总卡片与选中天汇总行）。
 * 数据统一经 ipcUsageStatsQuery（nm:usageStats/query 单 channel 按 kind 分发）获取；
 * 功能口径对齐 mobile 侧 TokenUsageStatsScreen，交互按桌面惯例。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ipcUsageStatsQuery } from "@/ipc/client";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type {
  UsageStatsBucketDto,
  UsageStatsFilterDto,
  UsageStatsModelRowDto,
  UsageStatsSummaryDto,
} from "@shared/ipc-types";
import { SettingsListEmpty, SettingsPanel, SettingsSection } from "./settings-ui";

type RangeKind = "last7" | "last30" | "custom";
type PageTab = "summary" | "detail";

const MS_PER_DAY = 86_400_000;
/** 自定义区间上限（天，含首尾；与 mobile 侧同口径，避免超长区间查询变慢）。 */
const CUSTOM_RANGE_MAX_DAYS = 366;

/** 模型下拉的三态哨兵：全部 / 未记录（对应 filter.model 的 undefined / null）。 */
const MODEL_OPTION_ALL = "__all__";
const MODEL_OPTION_UNLOGGED = "__unlogged__";

/**
 * token 数量紧凑格式化（999 以下原样 / K / M 一位小数压缩）。
 * 结构等价复制自 packages/core/src/common/format-token-count.ts 的 formatTokenCount
 * ——renderer 禁止 import core（eslint X1 门禁），故在此自备同口径实现。
 */
function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) {
    return "—";
  }
  const rounded = Math.round(n);
  if (rounded < 1000) {
    return String(rounded);
  }
  if (rounded < 1_000_000) {
    const k = rounded / 1000;
    return k >= 100 ? `${Math.round(k)}K` : `${k.toFixed(1).replace(/\.0$/, "")}K`;
  }
  const m = rounded / 1_000_000;
  return m >= 100 ? `${Math.round(m)}M` : `${m.toFixed(1).replace(/\.0$/, "")}M`;
}

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
  return rate == null ? "暂无数据" : `${Math.round(rate * 100)}%`;
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

/** CSS div 柱状图：输入（--primary）下 + 输出（--text-secondary）上堆叠（仅用量模式）。 */
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
  return (
    <div
      className={`token-stats-chart${chart === "hourly" ? " token-stats-chart--hourly" : ""}`}
      data-chart={chart}
    >
      {buckets.map((b, index) => {
        const key = keyOf(b, index);
        const usagePct = (value: number) => `${Math.min(100, (value / maxValue) * 100)}%`;
        return (
          <button
            key={key}
            type="button"
            className={`token-stats-chart__col${selectedKey === key ? " is-selected" : ""}`}
            data-day={key}
            title={bucketTooltip(key, b)}
            aria-label={bucketTooltip(key, b)}
            onClick={onSelect ? () => onSelect(key) : undefined}
          >
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
          </button>
        );
      })}
    </div>
  );
}

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
      return {
        range: { kind: "custom", fromMs: from.getTime(), toMs: to.getTime() + MS_PER_DAY },
        model: modelFilter,
      };
    }
    return { range: { kind: rangeKind }, model: modelFilter };
  }, [rangeKind, customFrom, customTo, customRangeError, modelFilter]);

  const reload = useCallback(async (f: UsageStatsFilterDto) => {
    const [sumRes, dailyRes, rowsRes] = await Promise.all([
      ipcUsageStatsQuery({ kind: "summary", filter: f }),
      ipcUsageStatsQuery({ kind: "daily", filter: f }),
      ipcUsageStatsQuery({ kind: "modelBreakdown", filter: f }),
    ]);
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
  }, []);

  useEffect(() => {
    if (filter == null) return;
    void reload(filter);
  }, [filter, reload]);

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
            <option value={MODEL_OPTION_UNLOGGED}>未记录</option>
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
          ]}
          onChange={setPageTab}
        />
      </div>

      {empty ? (
        <SettingsSection title="数据统计">
          <SettingsListEmpty>
            当前筛选范围内暂无用量数据。Token 用量自记录功能上线起开始积累，发起对话后这里会展示统计；缓存命中率数据自本版本起开始记录。
          </SettingsListEmpty>
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
            </div>
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
                      {row.modelName ?? "未记录"}
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
                · 调用 {selectedDayBucket.calls} 次
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

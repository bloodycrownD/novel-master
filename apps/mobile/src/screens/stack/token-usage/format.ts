/**
 * 数据统计页纯函数与共享常量（screens/C-4 拆分自主文件）。
 *
 * - 命中率 = cacheReadTokens / billedInputTokens，展示层计算；
 *   分母为 0（无 cache 数据）返回 null，展示「—」而非 0%；
 * - 时间范围为自然日闭区间 {fromDay, toDay}（本地日期字符串），「今天 /
 *   近 7 天 / 近 30 天」由应用层算出具体日期后传 core，跨度不设上限；
 * - 模型筛选选项哨兵沿用 unlogged 命名，语义为「未记录服务商（历史）」——
 *   provider_id IS NULL 的存量行（模型在不在配置集均归此，筛选只传
 *   providerId: null、不筛 model）；每个服务商另有「{服务商} · 其他模型」
 *   归并项，筛该服务商下不在配置集的模型行（filter.model = null 由 core 侧解释）。
 */
import type {UsageStatsRange} from '@novel-master/core/chat';

/** 时间范围筛选种类；custom 需经 MonthRangePickerSheet 选定区间。 */
export type RangeKind = 'today' | 'last7' | 'last30' | 'custom';

/** 页面主结构页签：汇总（指标卡 + 服务商×模型饼图）/ 图表（按天图表钻取）/ 流水（请求分页）。 */
export type PageTab = 'summary' | 'detail' | 'requests';

export const MS_PER_DAY = 86_400_000;

export const MODEL_OPTION_ALL = '__all__';
export const MODEL_OPTION_UNLOGGED = '__unlogged__';

/** 服务商「其他模型」选项的组合键后缀（与 providerModelKey 拼成选项 id）。 */
export const MODEL_OTHER_KEY = '__other__';

/** 汇总卡空态文案：统计自本版本才开始积累，统一显示横杠（简洁，不占版面）。 */
export const SUMMARY_EMPTY_TEXT = '—';

export function toLocalDayKey(ms: number): string {
  const d = new Date(ms);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/** 日历日偏移的本地日 key：`new Date(y, m, d + offset)` 日历推进（DST 安全），
 * 不用固定毫秒加法（23/25 小时日会偏 1 小时）。 */
export function localDayKeyOffset(base: Date, offsetDays: number): string {
  return toLocalDayKey(
    new Date(
      base.getFullYear(),
      base.getMonth(),
      base.getDate() + offsetDays,
    ).getTime(),
  );
}

/** 命中率（0-1），分母无 cache 数据时返回 null（展示「—」）。 */
export function hitRate(cacheRead: number, billed: number): number | null {
  if (billed <= 0) {
    return null;
  }
  return cacheRead / billed;
}

/** 校验自定义区间日期顺序（from ≤ to；跨度不设上限）。MonthRangePickerSheet
 * 点选自动排序，正常路径恒满足；此校验仅作确认回调的兑底护栏。 */
export function isCustomRangeValid(from: Date, to: Date): boolean {
  return from.getTime() <= to.getTime();
}

/**
 * RangeKind → 自然日闭区间 {fromDay, toDay}（应用层时间语义，core 只认日期）：
 * - today = {D, D}；last7 = {D-6, D}（含今天共 7 桶）；last30 = {D-29, D}；
 * - custom 由 MonthRangePickerSheet 结果产日期字符串；
 * - custom 未选定日期时兑底回退近 7 天（切换到 custom 必经 sheet 确认，
 *   此分支仅为类型完备，正常不可达）。日偏移均走日历加法（DST 安全）。
 */
export function resolveRangeDays(
  kind: RangeKind,
  customFrom: Date | null,
  customTo: Date | null,
): UsageStatsRange {
  const now = new Date();
  const today = toLocalDayKey(now.getTime());
  if (kind === 'today') {
    return {fromDay: today, toDay: today};
  }
  if (kind === 'last30') {
    return {fromDay: localDayKeyOffset(now, -29), toDay: today};
  }
  if (kind === 'custom' && customFrom != null && customTo != null) {
    return {
      fromDay: toLocalDayKey(customFrom.getTime()),
      toDay: toLocalDayKey(customTo.getTime()),
    };
  }
  return {fromDay: localDayKeyOffset(now, -6), toDay: today};
}

export function formatHitRate(rate: number | null): string {
  return rate == null ? '—' : `${Math.round(rate * 100)}%`;
}

/** 平均 token 速率展示：`x.x t/s`；无数据时返回调用方传入的空态文案。 */
export function formatTokensPerSecond(
  v: number | null,
  emptyText: string,
): string {
  if (v == null) {
    return emptyText;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} t/s`;
}

/** 平均首字延迟展示：秒级 `x.x s` / 毫秒级 `xxx ms`；无数据时返回调用方传入的空态文案。 */
export function formatFirstTokenMs(
  ms: number | null,
  emptyText: string,
): string {
  if (ms == null) {
    return emptyText;
  }
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

/** 服务商×模型筛选项（数据统计维度，配置侧生成）。 */
export interface ProviderModelOption {
  readonly providerId: string;
  readonly providerLabel: string;
  readonly model: string;
}

/**
 * 服务商×模型筛选值：`undefined` = 全部；对象 = 具体筛选目标（三形态）：
 * - `{providerId: P, model: M}`：具体 provider×model 组合；
 * - `{providerId: null, model: undefined}`：未记录服务商（历史）——
 *   `provider_id IS NULL` 的存量行，模型在不在配置集均归此
 *   （model 不筛，SQL 只留 provider_id IS NULL）；
 * - `{providerId: P, model: null}`：{P} · 其他模型——该服务商下
 *   `model_name IS NULL` 或不在已保存模型集合内的历史行。
 */
export type ProviderModelFilterValue =
  | {providerId: string; model: string}
  | {providerId: string; model: null}
  | {providerId: null; model: undefined}
  | undefined;

/** 组合的稳定展示键（testID/行 key 共用）。 */
export function providerModelKey(providerId: string, model: string): string {
  return `${providerId}::${model}`;
}

/**
 * 筛选值（非 undefined 形态）对应的选项 id，与 StatsFilterBar 的选项
 * 生成规则一致：未记录服务商 → unlogged 哨兵；服务商其他模型 →
 * `{providerId}::__other__`；具体组合 → providerModelKey。
 */
export function providerModelFilterOptionKey(
  value: Exclude<ProviderModelFilterValue, undefined>,
): string {
  if (value.providerId === null) {
    return MODEL_OPTION_UNLOGGED;
  }
  return providerModelKey(value.providerId, value.model ?? MODEL_OTHER_KEY);
}

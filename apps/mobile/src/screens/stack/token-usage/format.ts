/**
 * 数据统计页纯函数与共享常量（screens/C-4 拆分自主文件）。
 *
 * - 命中率 = cacheReadTokens / billedInputTokens，展示层计算；
 *   分母为 0（无 cache 数据）返回 null，展示「—」而非 0%；
 * - 自定义区间上限 366 天（含首尾），避免超长区间查询变慢；
 * - 模型筛选选项哨兵沿用 unlogged 命名，语义为「未记录服务商（历史）」——
 *   provider_id IS NULL 的存量行（模型在不在配置集均归此，筛选只传
 *   providerId: null、不筛 model）；每个服务商另有「{服务商} · 其他模型」
 *   归并项，筛该服务商下不在配置集的模型行（filter.model = null 由 core 侧解释）。
 */

/** 时间范围筛选种类；custom 需经 MonthRangePickerSheet 选定区间。 */
export type RangeKind = 'last7' | 'last30' | 'custom';

/** 页面主结构页签：汇总（指标卡 + 分模型列表）/ 明细（按天图表钻取）/ 流水（请求分页）。 */
export type PageTab = 'summary' | 'detail' | 'requests';

export const MS_PER_DAY = 86_400_000;

export const MODEL_OPTION_ALL = '__all__';
export const MODEL_OPTION_UNLOGGED = '__unlogged__';

/** 服务商「其他模型」选项的组合键后缀（与 providerModelKey 拼成选项 id）。 */
export const MODEL_OTHER_KEY = '__other__';

/** 自定义区间上限（天，含首尾；避免超长区间查询变慢）。 */
export const CUSTOM_RANGE_MAX_DAYS = 366;

/** 汇总卡空态文案：统计自本版本才开始积累，统一显示横杠（简洁，不占版面）。 */
export const SUMMARY_EMPTY_TEXT = '—';

export function toLocalDayKey(ms: number): string {
  const d = new Date(ms);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/** 命中率（0-1），分母无 cache 数据时返回 null（展示「—」）。 */
export function hitRate(cacheRead: number, billed: number): number | null {
  if (billed <= 0) {
    return null;
  }
  return cacheRead / billed;
}

/** 校验自定义区间是否在上限内（from/to 均为本地 0 点的日粒度）。 */
export function isCustomRangeValid(from: Date, to: Date): boolean {
  const dayCount = Math.round((to.getTime() - from.getTime()) / MS_PER_DAY) + 1;
  return dayCount >= 1 && dayCount <= CUSTOM_RANGE_MAX_DAYS;
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

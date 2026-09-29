/**
 * 缓存命中率计算与展示格式（desktop 侧单源）：自 TokenUsageStatsView 与
 * MetricsDetailPopover 两份同文私有实现抽并（cr-ui-4，纯搬运不改行为）。
 * 分母为计费口径（anthropic 的 input_tokens 不含 cache，需在调用方加回
 * cache 双列后再传入）；分母无数据时返回 null，展示「—」而非 0%。
 */

/**
 * 命中率（0-1）；计费口径分母无数据（≤0）或 cacheRead 缺失（null，
 * 单行请求可能无 cache 列）时返回 null。
 */
export function hitRate(
  cacheRead: number | null,
  billed: number,
): number | null {
  if (cacheRead == null || billed <= 0) {
    return null;
  }
  return cacheRead / billed;
}

/** 命中率展示：null →「—」，否则四舍五入到整百分比（如 `67%`）。 */
export function formatHitRate(rate: number | null): string {
  return rate == null ? "—" : `${Math.round(rate * 100)}%`;
}

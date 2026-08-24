/**
 * Usage stats application service port.
 *
 * @module service/chat/usage-stats.port
 */

/**
 * 统计时间范围。
 *
 * - `last7` / `last30`：本地时区今日 0 点往回 7/30 天，覆盖到本地明日 0 点（含今日全天）；
 * - `custom`：调用方给定的毫秒区间，`fromMs`/`toMs` 必填，服务层校验
 *   `from <= to` 且跨度不超过 366 天。
 */
export interface UsageStatsRange {
  readonly kind: "last7" | "last30" | "custom";
  readonly fromMs?: number;
  readonly toMs?: number;
}

/**
 * 统计筛选条件。
 *
 * `model` 三态：
 * - `undefined`：全部模型；
 * - `null`：只统计「其他」桶——`model_name IS NULL`，或 `model_name`
 *   不在当前已保存模型集合（`llm_saved_model.vendor_model_id`）内的历史行
 *   （如中转站标注名、已下线模型）；
 * - 具体字符串：只统计 `model_name` 相等的行。
 */
export interface UsageStatsFilter {
  readonly range: UsageStatsRange;
  readonly model?: string | null;
}

/** 今日卡片子对象（本地时区当日 0 点起算，独立于 filter）。 */
export interface UsageStatsToday {
  readonly totalTokens: number;
  readonly calls: number;
}

/** 范围内汇总（命中率由展示层用 cacheReadTokens / billedInputTokens 计算）。 */
export interface UsageStatsSummary {
  readonly calls: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
  /**
   * 计费口径全部输入：anthropic 行为 prompt + cache_read + cache_creation，
   * 其余协议为 prompt；仅对 cache 列非 NULL 的行求和（缺失行不入分母）。
   */
  readonly billedInputTokens: number;
  readonly today: UsageStatsToday;
}

/** 天或小时桶（`bucketStartMs` 为桶起点，本地时区边界）。 */
export interface UsageStatsBucket {
  readonly bucketStartMs: number;
  readonly calls: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
  readonly billedInputTokens: number;
}

/**
 * 分模型汇总行（`modelName` 为 null 表示「其他」桶：未记录行与不在
 * 当前已保存模型集合内的行归并成一行）。
 */
export interface UsageStatsModelRow {
  readonly modelName: string | null;
  readonly calls: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly cacheReadTokens: number;
  readonly billedInputTokens: number;
}

/** Token 用量统计聚合服务。 */
export interface UsageStatsService {
  /** 范围内汇总 + 独立于 filter 的今日子对象。 */
  getSummary(filter: UsageStatsFilter): Promise<UsageStatsSummary>;

  /** 按本地时区天边界切桶（custom 首尾为部分天时取与区间的交集）。 */
  getDailyBuckets(filter: UsageStatsFilter): Promise<UsageStatsBucket[]>;

  /**
   * 指定本地日期（`YYYY-MM-DD`）的 24 个小时桶（只应用 `filter.model`，
   * 时间范围由 `dayLocalDate` 本身界定；DST 日按实际构造出的桶边界为准）。
   */
  getHourlyBuckets(
    dayLocalDate: string,
    filter: UsageStatsFilter,
  ): Promise<UsageStatsBucket[]>;

  /** 分模型汇总（非配置模型与未记录行归并为 `modelName` 为 null 的「其他」桶）。 */
  getModelBreakdown(filter: UsageStatsFilter): Promise<UsageStatsModelRow[]>;

  /**
   * 可选模型列表：来自当前服务商配置的已保存模型（vendor_model_id 去重，
   * 与全局模型选择器同源），不从历史消息 distinct——历史已下线模型不出现；
   * 「其他」桶由 UI 侧补齐。
   */
  listModels(): Promise<string[]>;
}

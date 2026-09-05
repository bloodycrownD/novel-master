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
  /**
   * 服务商筛选（与 model 复合）：
   * - `undefined`：全部服务商；
   * - `null`：只统计「其他」桶——`provider_id IS NULL` 的历史行
   *   （provider_id 写入时快照，新版本起每条 assistant 行均携带）；
   * - 具体字符串：只统计 `provider_id` 相等的行（服务商已删除仍按
   *   原 id 匹配，展示名由 UI 层解析兑底）。
   */
  readonly providerId?: string | null;
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
  /**
   * 平均首字延迟（ms）：AVG(first_token_ms)，仅对非 NULL 行求均值；
   * 非流式请求的 first_token_ms = duration_ms（按完成时刻计），
   * 会进入均值。存量数据全 NULL 时返回 null（UI 空态依据）。
   */
  readonly avgFirstTokenMs: number | null;
  /**
   * 平均 token 速率（tokens/s）：SUM(completion_tokens) ÷
   * SUM(duration_ms − first_token_ms) / 1000 的加权口径，仅统计两列
   * 非 NULL 且 duration_ms > first_token_ms 的行（排除等待首字的纯生成
   * 速率；非流式行 first=duration 不入分母）。无有效行为 null。
   */
  readonly avgTokensPerSecond: number | null;
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
  /** 桶内平均首字延迟（ms）；无有效行为 null（口径同 UsageStatsSummary）。 */
  readonly avgFirstTokenMs: number | null;
  /** 桶内平均 token 速率（tokens/s）；无有效行为 null（口径同 UsageStatsSummary）。 */
  readonly avgTokensPerSecond: number | null;
}

/**
 * 分服务商×模型汇总行（`providerId` 为写入时快照的服务商配置 id，
 * null 表示未记录的历史行；`modelName` 为 null 表示该服务商下的
 * 「其他模型」桶：未记录行与不在当前已保存模型集合内的行归并成一行）。
 */
export interface UsageStatsModelRow {
  readonly providerId: string | null;
  readonly modelName: string | null;
  readonly calls: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly cacheReadTokens: number;
  readonly billedInputTokens: number;
}

/** 请求流水行（一条 assistant 消息 = 一次 LLM 请求）。 */
export interface UsageStatsRequestRow {
  /** 请求完成落库时刻（本地时区展示）。 */
  readonly createdAtMs: number;
  readonly modelName: string | null;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly cacheReadTokens: number | null;
  readonly cacheCreationTokens: number | null;
  readonly firstTokenMs: number | null;
  readonly durationMs: number | null;
}

/** 请求流水分页查询入参。 */
export interface UsageStatsRequestPageQuery {
  readonly offset: number;
  /** 每页条数（服务层限制 1–200）。 */
  readonly limit: number;
}

/** 请求流水分页结果。 */
export interface UsageStatsRequestPage {
  readonly rows: readonly UsageStatsRequestRow[];
  /** 符合筛选的总条数（供 UI 判断是否还有下一页）。 */
  readonly total: number;
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
    filter: UsageStatsFilter
  ): Promise<UsageStatsBucket[]>;

  /** 分模型汇总（非配置模型与未记录行归并为 `modelName` 为 null 的「其他」桶）。 */
  getModelBreakdown(filter: UsageStatsFilter): Promise<UsageStatsModelRow[]>;

  /**
   * 请求流水分页：按时间倒序逐条列出范围（与模型筛选同口径）内的
   * LLM 请求记录，供「流水」页签展示。
   */
  listRequestUsage(
    filter: UsageStatsFilter,
    page: UsageStatsRequestPageQuery
  ): Promise<UsageStatsRequestPage>;

  /**
   * 可选模型列表：来自当前服务商配置的已保存模型（vendor_model_id 去重，
   * 与全局模型选择器同源），不从历史消息 distinct——历史已下线模型不出现；
   * 「其他」桶由 UI 侧补齐。
   */
  listModels(): Promise<string[]>;
}

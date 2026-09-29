/**
 * Usage stats application service port.
 *
 * @module service/chat/usage-stats.port
 */

/**
 * 统计时间范围：本地自然日闭区间。
 *
 * `fromDay` / `toDay` 均为本地时区日期 `YYYY-MM-DD`，双端含（闭区间）。
 * 服务层内部换算为 `[fromDay 本地 0 点, toDay+1 本地 0 点)` 毫秒半开区间
 * 参与查询，毫秒值不出现在对外契约。校验仅两项：日期格式/合法性
 * （拒绝 02-30 等溢出日期）与 `fromDay ≤ toDay`；「近 7/30 天」「今天」
 * 等命名窗口由应用层算出具体日期后传入。
 */
export interface UsageStatsRange {
  readonly fromDay: string;
  readonly toDay: string;
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
  /**
   * 时间范围：缺省语义按查询分级——`getSummary` / `getModelBreakdown` /
   * `listRequestUsage` 不限时间（全历史）；`getDailyBuckets` 必填，
   * 否则抛 `chatInvalidArgument`（日桶序列需要界）。
   */
  readonly range?: UsageStatsRange;
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

/**
 * 会话详情 · 最近一次请求：会话内 `seq` 最大且 usage 非空的 assistant 行
 * （OpenAI/Gemini 等无 cache_creation 概念的协议 cache 列为 null，展示层
 * 出「—」；`atMs` 为该行落库时刻，本地时区展示）。
 */
export interface SessionUsageLastRequest {
  readonly seq: number;
  readonly modelName: string | null;
  readonly provider: string | null;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly cacheReadTokens: number | null;
  readonly cacheCreationTokens: number | null;
  readonly atMs: number;
}

/**
 * 会话详情 · 会话累计（**已移除**，2026-09-29 用户拍板）：曾为
 * `SessionUsageTotals`（assistant usage 行全量求和，含 hidden），随弹窗
 * 「累计输入/输出」两行一并删除——含隐藏消息的累计对用户无意义。最近
 * 请求段（`SessionUsageLastRequest`）不受影响。
 */

/**
 * 会话维度用量详情（metric-detail-sheet 弹窗数据）。**不含 contextUsage**
 * ——`resolveCurrentPromptTokens` 的 params 组装链只存在于双端 app 层，core
 * 装配注入不了；弹窗的「当前上下文占用」由端侧直接复用 chip 现有读数
 * （spec-check 第 1 轮 P0-2 拍板）。**不含会话累计输入/输出**（2026-09-29
 * 用户拍板移除：含 hidden 的累计求和对用户无意义）。空会话返回
 * `{last: null, visibleMessageCount: 0, toolUseCount: 0}`。
 */
export interface SessionUsageDetail {
  readonly last: SessionUsageLastRequest | null;
  /** 可见口径消息数（`listVisibleSorted` 同源：hidden 剔除，不筛角色）。 */
  readonly visibleMessageCount: number;
  /**
   * 会话内 assistant 消息 `tool_use` 块总数（含 hidden 行——累计口径）。
   * 会话 KKV `usage_stats.toolUseCount` 缓存优先（跟随会话生命周期）；
   * miss 时解压 assistant 行现算并回填缓存。失效挂点见
   * `session-kkv-domains` 的 usage_stats 域注释。
   */
  readonly toolUseCount: number;
}

/** Token 用量统计聚合服务。 */
export interface UsageStatsService {
  /** 范围内汇总（`filter.range` 缺省时为全历史）。 */
  getSummary(filter: UsageStatsFilter): Promise<UsageStatsSummary>;

  /**
   * 按本地时区天边界切桶，`fromDay` 到 `toDay` 逐日稠密产出（无数据日
   * 为零值桶）；`filter.range` 必填，否则抛 `chatInvalidArgument`。
   */
  getDailyBuckets(filter: UsageStatsFilter): Promise<UsageStatsBucket[]>;

  /**
   * 指定本地日期（`YYYY-MM-DD`）的 24 个小时桶（只应用 `filter.model` 与 `filter.providerId`，
   * 时间范围由 `dayLocalDate` 本身界定；DST 日按实际构造出的桶边界为准）。
   */
  getHourlyBuckets(
    dayLocalDate: string,
    filter: UsageStatsFilter
  ): Promise<UsageStatsBucket[]>;

  /**
   * 分模型汇总（非配置模型与未记录行归并为 `modelName` 为 null 的「其他」桶；
   * `filter.range` 缺省时为全历史）。
   */
  getModelBreakdown(filter: UsageStatsFilter): Promise<UsageStatsModelRow[]>;

  /**
   * 请求流水分页：按时间倒序逐条列出范围（与模型筛选同口径）内的
   * LLM 请求记录，供「流水」页签展示；`filter.range` 缺省时为全历史。
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

  /**
   * 会话维度用量详情（metric-detail-sheet 弹窗）：最近一条 usage 行 +
   * 会话累计（含 hidden，统计页同口径谓词 + `session_id` 界定）+ 可见
   * 消息数 + 工具调用数。不进 `UsageStatsFilter`——filter 服务统计页
   * 时间轴语义，会话详情是独立读型（spec 拍板）。
   */
  getSessionUsageDetail(sessionId: string): Promise<SessionUsageDetail>;
}

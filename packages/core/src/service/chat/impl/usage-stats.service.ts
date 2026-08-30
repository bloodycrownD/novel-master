/**
 * Default usage stats service.
 *
 * @module service/chat/impl/usage-stats.service
 */

import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import { queryTemplate } from "@/infra/tdbc/logic/template-helper.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { Row } from "@/infra/tdbc/types.js";
import { chatInvalidArgument } from "@/errors/chat-errors.js";
import type {
  UsageStatsBucket,
  UsageStatsFilter,
  UsageStatsModelRow,
  UsageStatsRange,
  UsageStatsRequestPage,
  UsageStatsRequestPageQuery,
  UsageStatsRequestRow,
  UsageStatsService,
  UsageStatsSummary,
  UsageStatsToday,
} from "../usage-stats.port.js";

/**
 * 命中率分母（计费口径全部输入）的 SUM 表达式：
 * anthropic 行 `input_tokens` 不含 cache，须加回 cache_read 与 cache_creation；
 * 其余协议 prompt 已含 cached。FILTER 只对 cache 列非 NULL 的行求和——
 * 缺失行不入分母（PRD 口径，避免拉低命中率）。
 */
const BILLED_INPUT_SUM_SQL =
  `SUM(CASE WHEN provider = 'anthropic' ` +
  `THEN prompt_tokens + COALESCE(cache_read_tokens, 0) + COALESCE(cache_creation_tokens, 0) ` +
  `ELSE prompt_tokens END) ` +
  `FILTER (WHERE cache_read_tokens IS NOT NULL OR cache_creation_tokens IS NOT NULL)`;

/**
 * 速率聚合的有效行 FILTER（summary 与桶查询共用）：token 三列与耗时两列
 * 均非 NULL，且 duration_ms > first_token_ms（非流式行 first=duration
 * 与时钟毛刺行不入分母，避免除零与负速率）。
 */
const RATE_FILTER_SQL =
  `WHERE completion_tokens IS NOT NULL ` +
  `AND first_token_ms IS NOT NULL ` +
  `AND duration_ms IS NOT NULL AND duration_ms > first_token_ms`;

/** 聚合 SELECT 列表（bucket 复用后丢弃 total_tokens）。 */
const AGG_SELECT_SQL =
  `COUNT(*) AS calls, ` +
  `COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens, ` +
  `COALESCE(SUM(completion_tokens), 0) AS completion_tokens, ` +
  `COALESCE(SUM(total_tokens), 0) AS total_tokens, ` +
  `COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens, ` +
  `COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens, ` +
  `COALESCE(${BILLED_INPUT_SUM_SQL}, 0) AS billed_input_tokens, ` +
  `AVG(first_token_ms) AS avg_first_token_ms, ` +
  `CAST(SUM(completion_tokens) FILTER (${RATE_FILTER_SQL}) AS REAL) ` +
  `/ (SUM(duration_ms - first_token_ms) FILTER (${RATE_FILTER_SQL}) / 1000.0) AS avg_tokens_per_second`;

/** usage 非空判定的公共片断（NULL usage 行不计任何求和与次数）。 */
const USAGE_NOT_NULL_SQL = `role = 'assistant' AND (prompt_tokens IS NOT NULL OR completion_tokens IS NOT NULL)`;

/**
 * 模型筛选片断：undefined = 全部；null = 「其他」桶（未记录 + 不在
 * 已保存模型集合内）；字符串 = 指定模型。子查询免动态参数。
 */
function modelFilterSql(model: string | null | undefined): string {
  if (model === undefined) {
    return "";
  }
  if (model === null) {
    return (
      "AND (model_name IS NULL OR model_name NOT IN " +
      "(SELECT DISTINCT vendor_model_id FROM llm_saved_model))"
    );
  }
  return "AND model_name = #{modelName}";
}

/** 取 ms 所属本地日的 0 点（DST/月界由 Date 构造器保证正确）。 */
function startOfLocalDay(ms: number): Date {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** 以本地日为基点加天数（`days` 可为负）。 */
function addLocalDays(base: Date, days: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
}

/** 解析 `YYYY-MM-DD` 为本地日期分量（拒绝溢出日期如 02-30）。 */
function parseDayLocalDate(dayLocalDate: string): {
  year: number;
  month: number;
  day: number;
} {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayLocalDate);
  if (match == null) {
    throw chatInvalidArgument(
      `dayLocalDate 须为 YYYY-MM-DD 格式，收到：${dayLocalDate}`
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const probe = new Date(year, month, day);
  if (
    probe.getFullYear() !== year ||
    probe.getMonth() !== month ||
    probe.getDate() !== day
  ) {
    throw chatInvalidArgument(`dayLocalDate 不是有效日期：${dayLocalDate}`);
  }
  return { year, month, day };
}

/** 空桶的零值聚合行（DST 空钟点桶直接复用，省一次查询）。 */
const ZERO_AGG_ROW: Row = {
  calls: 0,
  prompt_tokens: 0,
  completion_tokens: 0,
  total_tokens: 0,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
  billed_input_tokens: 0,
  avg_first_token_ms: null,
  avg_tokens_per_second: null,
};

/**
 * custom 区间跨度（天）：本地日 0 点差 ÷ 24h。
 * Math.round 补偿 DST 的 23/25 小时天（春季拨快日差 23h、秋季拨慢日差 25h），
 * 避免 366 天上限在 DST 日被误判为 366.04 之类而拒收合法区间。
 */
export function daySpanBetweenLocalDays(
  fromDayStartMs: number,
  toDayStartMs: number
): number {
  return Math.round((toDayStartMs - fromDayStartMs) / 86_400_000);
}

/** TDBC-backed 默认统计服务。 */
export class DefaultUsageStatsService implements UsageStatsService {
  private readonly parser = new SqlTemplateParser();

  constructor(private readonly conn: TdbcConnection) {}

  async getSummary(filter: UsageStatsFilter): Promise<UsageStatsSummary> {
    const { fromMs, toMs } = this.resolveRangeMs(filter.range);
    const row = await this.queryAggregateRow(fromMs, toMs, filter.model);
    const today = await this.queryToday();
    return {
      calls: Number(row.calls),
      promptTokens: Number(row.prompt_tokens),
      completionTokens: Number(row.completion_tokens),
      totalTokens: Number(row.total_tokens),
      cacheReadTokens: Number(row.cache_read_tokens),
      cacheCreationTokens: Number(row.cache_creation_tokens),
      billedInputTokens: Number(row.billed_input_tokens),
      avgFirstTokenMs:
        row.avg_first_token_ms == null ? null : Number(row.avg_first_token_ms),
      avgTokensPerSecond:
        row.avg_tokens_per_second == null
          ? null
          : Number(row.avg_tokens_per_second),
      today,
    };
  }

  async getDailyBuckets(filter: UsageStatsFilter): Promise<UsageStatsBucket[]> {
    const { fromMs, toMs } = this.resolveRangeMs(filter.range);
    const buckets: UsageStatsBucket[] = [];
    let cursor = startOfLocalDay(fromMs).getTime();
    while (cursor < toMs) {
      const dayStart = new Date(cursor);
      const nextDayMs = addLocalDays(dayStart, 1).getTime();
      // custom 首尾为部分天时取交集，保证桶数据不越出筛选区间；
      // bucketStartMs 统一用本地日 0 点，图表按天对齐。
      const bucketFrom = Math.max(cursor, fromMs);
      const bucketTo = Math.min(nextDayMs, toMs);
      if (bucketFrom < bucketTo) {
        const row = await this.queryAggregateRow(
          bucketFrom,
          bucketTo,
          filter.model
        );
        buckets.push(this.toBucket(cursor, row));
      }
      cursor = nextDayMs;
    }
    return buckets;
  }

  async getHourlyBuckets(
    dayLocalDate: string,
    filter: UsageStatsFilter
  ): Promise<UsageStatsBucket[]> {
    const { year, month, day } = parseDayLocalDate(dayLocalDate);
    const buckets: UsageStatsBucket[] = [];
    for (let hour = 0; hour < 24; hour++) {
      // 按本地钟点构造桶边界：常规日 24 桶；DST 缺失钟点退化为空桶（零值），
      // 重复钟点自然加宽，均以实际构造结果为准。
      const startMs = new Date(year, month, day, hour).getTime();
      const endMs = new Date(year, month, day, hour + 1).getTime();
      const row =
        startMs < endMs
          ? await this.queryAggregateRow(startMs, endMs, filter.model)
          : ZERO_AGG_ROW;
      buckets.push(this.toBucket(startMs, row));
    }
    return buckets;
  }

  async getModelBreakdown(
    filter: UsageStatsFilter
  ): Promise<UsageStatsModelRow[]> {
    const { fromMs, toMs } = this.resolveRangeMs(filter.range);
    const rows = await queryTemplate<Row>(
      this.conn,
      this.parser,
      `SELECT model_name, ${AGG_SELECT_SQL}
       FROM chat_message
       WHERE ${USAGE_NOT_NULL_SQL}
         AND created_at_ms >= #{fromMs}
         AND created_at_ms < #{toMs}
         ${modelFilterSql(filter.model)}
       GROUP BY model_name
       ORDER BY total_tokens DESC, model_name ASC`,
      { fromMs, toMs, modelName: filter.model ?? null }
    );
    const mapped = rows.map((row) => ({
      modelName: row.model_name == null ? null : String(row.model_name),
      calls: Number(row.calls),
      promptTokens: Number(row.prompt_tokens),
      completionTokens: Number(row.completion_tokens),
      totalTokens: Number(row.total_tokens),
      cacheReadTokens: Number(row.cache_read_tokens),
      billedInputTokens: Number(row.billed_input_tokens),
    }));
    // 「其他」桶归并：modelName 不在当前配置集合（listModels 同源查询）的行
    // 与 null 行合并成一行（各用量字段相加），配置模型各成一行；
    // 归并后重排保持按用量降序。
    const configured = new Set(await this.listModels());
    const merged = new Map<string | null, UsageStatsModelRow>();
    for (const row of mapped) {
      const key =
        row.modelName != null && configured.has(row.modelName)
          ? row.modelName
          : null;
      const prev = merged.get(key);
      merged.set(key, {
        modelName: key,
        calls: (prev?.calls ?? 0) + row.calls,
        promptTokens: (prev?.promptTokens ?? 0) + row.promptTokens,
        completionTokens: (prev?.completionTokens ?? 0) + row.completionTokens,
        totalTokens: (prev?.totalTokens ?? 0) + row.totalTokens,
        cacheReadTokens: (prev?.cacheReadTokens ?? 0) + row.cacheReadTokens,
        billedInputTokens:
          (prev?.billedInputTokens ?? 0) + row.billedInputTokens,
      });
    }
    return [...merged.values()].sort(
      (a, b) =>
        b.totalTokens - a.totalTokens ||
        (a.modelName ?? "").localeCompare(b.modelName ?? "")
    );
  }

  async listRequestUsage(
    filter: UsageStatsFilter,
    page: UsageStatsRequestPageQuery
  ): Promise<UsageStatsRequestPage> {
    const limit = Math.floor(page.limit);
    if (!Number.isFinite(limit) || limit < 1 || limit > 200) {
      throw chatInvalidArgument(
        `流水分页 limit 须为 1–200，收到：${page.limit}`
      );
    }
    // NaN/Infinity 会穿透 Math.floor/Math.max 进 SQL 绑定（better-sqlite3
    // 直接抛错），与 limit 同构提前拒收。
    if (!Number.isFinite(page.offset)) {
      throw chatInvalidArgument(
        `流水分页 offset 须为有限数值，收到：${page.offset}`
      );
    }
    const offset = Math.max(0, Math.floor(page.offset));
    const { fromMs, toMs } = this.resolveRangeMs(filter.range);
    const whereSql =
      `WHERE ${USAGE_NOT_NULL_SQL}` +
      ` AND created_at_ms >= #{fromMs} AND created_at_ms < #{toMs}` +
      ` ${modelFilterSql(filter.model)}`;
    const params = {
      fromMs,
      toMs,
      modelName: filter.model ?? null,
      offset,
      limit,
    };
    const totalRows = await queryTemplate<{ n: number }>(
      this.conn,
      this.parser,
      `SELECT COUNT(*) AS n FROM chat_message ${whereSql}`,
      params
    );
    const rows = await queryTemplate<Row>(
      this.conn,
      this.parser,
      `SELECT created_at_ms, model_name, prompt_tokens, completion_tokens,
              total_tokens, cache_read_tokens, cache_creation_tokens,
              first_token_ms, duration_ms
       FROM chat_message
       ${whereSql}
       ORDER BY created_at_ms DESC, id ASC
       LIMIT #{limit} OFFSET #{offset}`,
      params
    );
    return {
      rows: rows.map(
        (row): UsageStatsRequestRow => ({
          createdAtMs: Number(row.created_at_ms),
          modelName: row.model_name == null ? null : String(row.model_name),
          promptTokens: Number(row.prompt_tokens ?? 0),
          completionTokens: Number(row.completion_tokens ?? 0),
          totalTokens: Number(row.total_tokens ?? 0),
          cacheReadTokens:
            row.cache_read_tokens == null
              ? null
              : Number(row.cache_read_tokens),
          cacheCreationTokens:
            row.cache_creation_tokens == null
              ? null
              : Number(row.cache_creation_tokens),
          firstTokenMs:
            row.first_token_ms == null ? null : Number(row.first_token_ms),
          durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
        })
      ),
      total: Number(totalRows[0]?.n ?? 0),
    };
  }

  async listModels(): Promise<string[]> {
    // 选项与服务商配置的模型列表同源（vendor_model_id 去重），
    // 不从 chat_message 历史记录 distinct——历史模型会随模型更替不断堆积。
    const rows = await queryTemplate<{ vendor_model_id: string }>(
      this.conn,
      this.parser,
      `SELECT DISTINCT vendor_model_id FROM llm_saved_model
       ORDER BY vendor_model_id ASC`,
      {}
    );
    return rows.map((row) => String(row.vendor_model_id));
  }

  /**
   * 把 range 归一为毫秒区间：last7/last30 = 本地今日 0 点往回 N 天到本地明日 0 点
   * （含今日全天）；custom 校验必填、from <= to、跨度 <= 366 天。
   */
  private resolveRangeMs(range: UsageStatsRange): {
    fromMs: number;
    toMs: number;
  } {
    if (range.kind === "last7" || range.kind === "last30") {
      const today0 = startOfLocalDay(Date.now());
      const back = range.kind === "last7" ? 7 : 30;
      return {
        fromMs: addLocalDays(today0, -back).getTime(),
        toMs: addLocalDays(today0, 1).getTime(),
      };
    }
    const fromMs = Number(range.fromMs);
    const toMs = Number(range.toMs);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
      throw chatInvalidArgument("custom 区间必须提供 fromMs 与 toMs");
    }
    if (fromMs > toMs) {
      throw chatInvalidArgument("custom 区间 fromMs 不能晚于 toMs");
    }
    const daySpan = daySpanBetweenLocalDays(
      startOfLocalDay(fromMs).getTime(),
      startOfLocalDay(toMs).getTime()
    );
    if (daySpan > 366) {
      throw chatInvalidArgument("custom 区间跨度不能超过 366 天");
    }
    return { fromMs, toMs };
  }

  /** 单区间聚合查询（无 GROUP BY，聚合恒返回一行）。 */
  private async queryAggregateRow(
    fromMs: number,
    toMs: number,
    model: string | null | undefined
  ): Promise<Row> {
    const rows = await queryTemplate<Row>(
      this.conn,
      this.parser,
      `SELECT ${AGG_SELECT_SQL}
       FROM chat_message
       WHERE ${USAGE_NOT_NULL_SQL}
         AND created_at_ms >= #{fromMs}
         AND created_at_ms < #{toMs}
         ${modelFilterSql(model)}`,
      { fromMs, toMs, modelName: model ?? null }
    );
    return rows[0] ?? ZERO_AGG_ROW;
  }

  /** 今日卡片（本地今日 0 点起算，不受 filter 的 range/model 影响）。 */
  private async queryToday(): Promise<UsageStatsToday> {
    const today0 = startOfLocalDay(Date.now());
    const rows = await queryTemplate<Row>(
      this.conn,
      this.parser,
      `SELECT COUNT(*) AS calls, COALESCE(SUM(total_tokens), 0) AS total_tokens
       FROM chat_message
       WHERE ${USAGE_NOT_NULL_SQL}
         AND created_at_ms >= #{fromMs}
         AND created_at_ms < #{toMs}`,
      {
        fromMs: today0.getTime(),
        toMs: addLocalDays(today0, 1).getTime(),
      }
    );
    const row = rows[0] ?? ZERO_AGG_ROW;
    return { totalTokens: Number(row.total_tokens), calls: Number(row.calls) };
  }

  private toBucket(bucketStartMs: number, row: Row): UsageStatsBucket {
    return {
      bucketStartMs,
      calls: Number(row.calls),
      promptTokens: Number(row.prompt_tokens),
      completionTokens: Number(row.completion_tokens),
      cacheReadTokens: Number(row.cache_read_tokens),
      cacheCreationTokens: Number(row.cache_creation_tokens),
      billedInputTokens: Number(row.billed_input_tokens),
      avgFirstTokenMs:
        row.avg_first_token_ms == null ? null : Number(row.avg_first_token_ms),
      avgTokensPerSecond:
        row.avg_tokens_per_second == null
          ? null
          : Number(row.avg_tokens_per_second),
    };
  }
}

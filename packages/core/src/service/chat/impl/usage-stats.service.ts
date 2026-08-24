/**
 * Default usage stats service.
 *
 * @module service/chat/impl/usage-stats.service
 */

import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import {
  queryTemplate,
} from "@/infra/tdbc/logic/template-helper.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { Row } from "@/infra/tdbc/types.js";
import { chatInvalidArgument } from "@/errors/chat-errors.js";
import type {
  UsageStatsBucket,
  UsageStatsFilter,
  UsageStatsModelRow,
  UsageStatsRange,
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

/** 聚合 SELECT 列表（bucket 复用后丢弃 total_tokens）。 */
const AGG_SELECT_SQL =
  `COUNT(*) AS calls, ` +
  `COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens, ` +
  `COALESCE(SUM(completion_tokens), 0) AS completion_tokens, ` +
  `COALESCE(SUM(total_tokens), 0) AS total_tokens, ` +
  `COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens, ` +
  `COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens, ` +
  `COALESCE(${BILLED_INPUT_SUM_SQL}, 0) AS billed_input_tokens`;

/** usage 非空判定的公共片断（NULL usage 行不计任何求和与次数）。 */
const USAGE_NOT_NULL_SQL =
  `role = 'assistant' AND (prompt_tokens IS NOT NULL OR completion_tokens IS NOT NULL)`;

/** 模型筛选片断：undefined = 全部；null = 未记录桶；字符串 = 指定模型。 */
function modelFilterSql(model: string | null | undefined): string {
  if (model === undefined) {
    return "";
  }
  if (model === null) {
    return "AND model_name IS NULL";
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
      `dayLocalDate 须为 YYYY-MM-DD 格式，收到：${dayLocalDate}`,
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
};

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
      today,
    };
  }

  async getDailyBuckets(
    filter: UsageStatsFilter,
  ): Promise<UsageStatsBucket[]> {
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
          filter.model,
        );
        buckets.push(this.toBucket(cursor, row));
      }
      cursor = nextDayMs;
    }
    return buckets;
  }

  async getHourlyBuckets(
    dayLocalDate: string,
    filter: UsageStatsFilter,
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
    filter: UsageStatsFilter,
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
      { fromMs, toMs, modelName: filter.model ?? null },
    );
    return rows.map((row) => ({
      modelName: row.model_name == null ? null : String(row.model_name),
      calls: Number(row.calls),
      promptTokens: Number(row.prompt_tokens),
      completionTokens: Number(row.completion_tokens),
      totalTokens: Number(row.total_tokens),
      cacheReadTokens: Number(row.cache_read_tokens),
      billedInputTokens: Number(row.billed_input_tokens),
    }));
  }

  async listModels(): Promise<string[]> {
    const rows = await queryTemplate<{ model_name: string }>(
      this.conn,
      this.parser,
      `SELECT DISTINCT model_name FROM chat_message
       WHERE model_name IS NOT NULL
       ORDER BY model_name ASC`,
      {},
    );
    return rows.map((row) => String(row.model_name));
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
    const daySpan = Math.round(
      (startOfLocalDay(toMs).getTime() - startOfLocalDay(fromMs).getTime()) /
        86_400_000,
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
    model: string | null | undefined,
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
      { fromMs, toMs, modelName: model ?? null },
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
      },
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
    };
  }
}

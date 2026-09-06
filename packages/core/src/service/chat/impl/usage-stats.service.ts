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

/**
 * 服务商筛选片断（与 modelFilterSql 同构）：undefined = 全部；null =
 * 「其他」桶（provider_id IS NULL 的历史行）；字符串 = 指定服务商配置 id
 * （写入时快照，服务商已删除也照常按 id 匹配——解析不到展示名是 UI 层的事）。
 */
function providerFilterSql(providerId: string | null | undefined): string {
  if (providerId === undefined) {
    return "";
  }
  if (providerId === null) {
    return "AND provider_id IS NULL";
  }
  return "AND provider_id = #{providerId}";
}

/**
 * 时间谓词片断：fromMs/toMs 任一为 null 时不限时间（全历史），
 * 非空时拼 [fromMs, toMs) 半开区间条件（与 range 可选语义配套）。
 */
function timeRangeSql(fromMs: number | null, toMs: number | null): string {
  if (fromMs == null || toMs == null) {
    return "";
  }
  return "AND created_at_ms >= #{fromMs} AND created_at_ms < #{toMs}";
}

/** 以本地日为基点加天数（`days` 可为负）。 */
function addLocalDays(base: Date, days: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
}

/** 解析 `YYYY-MM-DD` 为本地日期分量（拒绝溢出日期如 02-30；`label` 用于报错指认字段）。 */
function parseDayLocalDate(
  dayLocalDate: string,
  label = "dayLocalDate"
): {
  year: number;
  month: number;
  day: number;
} {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayLocalDate);
  if (match == null) {
    throw chatInvalidArgument(
      `${label} 须为 YYYY-MM-DD 格式，收到：${dayLocalDate}`
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
    throw chatInvalidArgument(`${label} 不是有效日期：${dayLocalDate}`);
  }
  return { year, month, day };
}

/** 本地日期格式化为 `YYYY-MM-DD`（与 strftime 的 day_key 同构，年份补零 4 位防 <1000 年错位死循环）。 */
function fmtLocalDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(d.getFullYear()).padStart(4, "0")}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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

/** TDBC-backed 默认统计服务。 */
export class DefaultUsageStatsService implements UsageStatsService {
  private readonly parser = new SqlTemplateParser();

  constructor(private readonly conn: TdbcConnection) {}

  async getSummary(filter: UsageStatsFilter): Promise<UsageStatsSummary> {
    const { fromMs, toMs } = this.resolveOptionalRange(filter.range);
    const row = await this.queryAggregateRow(
      fromMs,
      toMs,
      filter.model,
      filter.providerId
    );
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
    };
  }

  async getDailyBuckets(filter: UsageStatsFilter): Promise<UsageStatsBucket[]> {
    // 日桶序列需要界（桶数随天数线性膨胀），护栏挂在这条查询上而非区间类型。
    if (filter.range == null) {
      throw chatInvalidArgument("getDailyBuckets 必须提供 range（日桶序列需要界）");
    }
    const { fromMs, toMs } = this.resolveDayRangeMs(filter.range);
    // 单条 GROUP BY 查询替代旧实现的逐日 N+1：strftime 的 localtime 与
    // JS Date 同用进程本地时区，DST 日按挂钟日归桶；整数除法截到秒不影响
    // 日归属（日界切换发生在整秒的 0 点，毫秒截断不可能跨日）。
    const rows = await queryTemplate<Row>(
      this.conn,
      this.parser,
      `SELECT strftime('%Y-%m-%d', created_at_ms / 1000, 'unixepoch', 'localtime') AS day_key,
              ${AGG_SELECT_SQL}
       FROM chat_message
       WHERE ${USAGE_NOT_NULL_SQL}
         AND created_at_ms >= #{fromMs}
         AND created_at_ms < #{toMs}
         ${modelFilterSql(filter.model)}
         ${providerFilterSql(filter.providerId)}
       GROUP BY day_key`,
      {
        fromMs,
        toMs,
        modelName: filter.model ?? null,
        providerId: filter.providerId ?? null,
      }
    );
    const rowByDay = new Map<string, Row>();
    for (const row of rows) {
      rowByDay.set(String(row.day_key), row);
    }
    // JS 侧从 fromDay 起按日历逐日推进（Date 构造器对 DST 安全），
    // 无数据日复用零值行，保证桶序列稠密且首尾闭区间含两端。
    const buckets: UsageStatsBucket[] = [];
    const from = parseDayLocalDate(filter.range.fromDay, "range.fromDay");
    for (
      let cursor = new Date(from.year, from.month, from.day);
      ;
      cursor = addLocalDays(cursor, 1)
    ) {
      const dayKey = fmtLocalDay(cursor);
      buckets.push(
        this.toBucket(cursor.getTime(), rowByDay.get(dayKey) ?? ZERO_AGG_ROW)
      );
      if (dayKey === filter.range.toDay) {
        return buckets;
      }
    }
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
          ? await this.queryAggregateRow(
              startMs,
              endMs,
              filter.model,
              filter.providerId
            )
          : ZERO_AGG_ROW;
      buckets.push(this.toBucket(startMs, row));
    }
    return buckets;
  }

  async getModelBreakdown(
    filter: UsageStatsFilter
  ): Promise<UsageStatsModelRow[]> {
    const { fromMs, toMs } = this.resolveOptionalRange(filter.range);
    const rows = await queryTemplate<Row>(
      this.conn,
      this.parser,
      `SELECT provider_id, model_name, ${AGG_SELECT_SQL}
       FROM chat_message
       WHERE ${USAGE_NOT_NULL_SQL}
         ${timeRangeSql(fromMs, toMs)}
         ${modelFilterSql(filter.model)}
         ${providerFilterSql(filter.providerId)}
       GROUP BY provider_id, model_name
       -- 不排序：输出顺序由 JS 归并后的 sort 保证（SQL 序会被归并架空）`,
      {
        fromMs,
        toMs,
        modelName: filter.model ?? null,
        providerId: filter.providerId ?? null,
      }
    );
    const mapped = rows.map((row) => ({
      providerId: row.provider_id == null ? null : String(row.provider_id),
      modelName: row.model_name == null ? null : String(row.model_name),
      calls: Number(row.calls),
      promptTokens: Number(row.prompt_tokens),
      completionTokens: Number(row.completion_tokens),
      totalTokens: Number(row.total_tokens),
      cacheReadTokens: Number(row.cache_read_tokens),
      billedInputTokens: Number(row.billed_input_tokens),
    }));
    // provider×model 归并：modelName 不在当前配置集合（listModels 同源查询）
    // 的行与 null 行在该 provider 下归并成一行（各用量字段相加）；
    // providerId 为 null 的历史行不按模型分桶——「未记录服务商 · 各模型」
    // 切片无从辨认也无意义，全部归并为单行（modelName 同置 null，
    // 即使模型名在配置集合内也不独立成行）；providerId 为写入时快照，
    // 不做存在性回查（服务商已删除仍按原 id 归组，展示名解析不到
    // 由 UI 层兜底）。归并后重排保持按用量降序。
    const configured = new Set(await this.listModels());
    const compositeKey = (
      providerId: string | null,
      modelName: string | null
    ) => `${providerId ?? ""}\u0000${modelName ?? ""}`;
    const merged = new Map<string, UsageStatsModelRow>();
    for (const row of mapped) {
      const modelKey =
        row.providerId == null
          ? null // 未记录服务商历史行：不参与模型分桶，全部并入单一合并行
          : row.modelName != null && configured.has(row.modelName)
            ? row.modelName
            : null;
      const key = compositeKey(row.providerId, modelKey);
      const prev = merged.get(key);
      merged.set(key, {
        providerId: row.providerId,
        modelName: modelKey,
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
        `${a.providerId ?? ""}/${a.modelName ?? ""}`.localeCompare(
          `${b.providerId ?? ""}/${b.modelName ?? ""}`
        )
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
    const { fromMs, toMs } = this.resolveOptionalRange(filter.range);
    // total 与行集同用 whereSql：range 缺省时两者都不含时间谓词（全历史）。
    const whereSql =
      `WHERE ${USAGE_NOT_NULL_SQL}` +
      ` ${timeRangeSql(fromMs, toMs)}` +
      ` ${modelFilterSql(filter.model)}` +
      ` ${providerFilterSql(filter.providerId)}`;
    const params = {
      fromMs,
      toMs,
      modelName: filter.model ?? null,
      providerId: filter.providerId ?? null,
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
   * 把 `{fromDay, toDay}` 闭区间换算为毫秒半开区间：
   * `[fromDay 本地 0 点, toDay+1 本地 0 点)`。日期格式与合法性由
   * parseDayLocalDate 校验（拒绝 02-30 等溢出日期），fromDay 晚于
   * toDay 抛错；闭区间的双端含由 toMs 取 toDay 次日 0 点保证。
   */
  private resolveDayRangeMs(range: UsageStatsRange): {
    fromMs: number;
    toMs: number;
  } {
    const from = parseDayLocalDate(range.fromDay, "range.fromDay");
    const to = parseDayLocalDate(range.toDay, "range.toDay");
    const fromStart = new Date(from.year, from.month, from.day);
    const toStart = new Date(to.year, to.month, to.day);
    if (fromStart.getTime() > toStart.getTime()) {
      throw chatInvalidArgument(
        `fromDay 不能晚于 toDay：${range.fromDay} > ${range.toDay}`
      );
    }
    return {
      fromMs: fromStart.getTime(),
      toMs: addLocalDays(toStart, 1).getTime(),
    };
  }

  /** range 缺省 → (null, null)，聚合/流水查询不限时间（全历史）。 */
  private resolveOptionalRange(range: UsageStatsRange | undefined): {
    fromMs: number | null;
    toMs: number | null;
  } {
    if (range == null) {
      return { fromMs: null, toMs: null };
    }
    return this.resolveDayRangeMs(range);
  }

  /**
   * 单区间聚合查询（无 GROUP BY，聚合恒返回一行；fromMs/toMs 为
   * null 时不加时间谓词 = 全历史）。
   */
  private async queryAggregateRow(
    fromMs: number | null,
    toMs: number | null,
    model: string | null | undefined,
    providerId: string | null | undefined
  ): Promise<Row> {
    const rows = await queryTemplate<Row>(
      this.conn,
      this.parser,
      `SELECT ${AGG_SELECT_SQL}
       FROM chat_message
       WHERE ${USAGE_NOT_NULL_SQL}
         ${timeRangeSql(fromMs, toMs)}
         ${modelFilterSql(model)}
         ${providerFilterSql(providerId)}`,
      { fromMs, toMs, modelName: model ?? null, providerId: providerId ?? null }
    );
    return rows[0] ?? ZERO_AGG_ROW;
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

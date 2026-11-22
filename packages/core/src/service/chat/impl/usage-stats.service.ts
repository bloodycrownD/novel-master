/**
 * Default usage stats service.
 *
 * @module service/chat/impl/usage-stats.service
 */

import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import { UsageStatsSql } from "@/infra/sql-template/generated/usage_stats.mapper.generated.js";
import { TdbcTemplate } from "@/infra/tdbc/logic/template-helper.js";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { Row } from "@/infra/tdbc/types.js";
import { DateTime } from "@/common/datetime.js";
import { MessageContentParse } from "@/domain/chat/content/parse-message-content.js";
import { SESSION_KKV_DOMAIN_USAGE_STATS, USAGE_STATS_TOOL_USE_COUNT_KEY } from "@/domain/session-kkv/model/session-kkv-domains.js";
import { SessionKkvServiceFactory } from "@/service/session-kkv/create-session-kkv-service.js";
import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import { LogFactory } from "@/infra/log/logger.js";
import type {
  SessionUsageDetail,
  SessionUsageLastRequest,
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

const log = LogFactory.create("chat.usage-stats");

/** 解析 `YYYY-MM-DD` 为本地日期分量（拒绝溢出日期如 02-30；`label` 用于报错指认字段）。 */
function parseDayLocalDate(dayLocalDate: string, label = "dayLocalDate"): Result<{ year: number; month: number; day: number }, AppError> {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayLocalDate);
  if (match == null) {
    return Result.err(new AppError("CHAT_INVALID_ARGUMENT", { descriptor: { key: "error.usage.invalid_day_format", params: { field: label, value: dayLocalDate } } }));
  }
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const probe = new Date(year, month, day);
  if (probe.getFullYear() !== year || probe.getMonth() !== month || probe.getDate() !== day) {
    return Result.err(new AppError("CHAT_INVALID_ARGUMENT", { descriptor: { key: "error.usage.invalid_day", params: { field: label, value: dayLocalDate } } }));
  }
  return Result.ok({ year, month, day });
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

  async getSummary(filter: UsageStatsFilter): Promise<Result<UsageStatsSummary, AppError>> {
    const range = this.resolveOptionalRange(filter.range);
    if (!range.ok) return Result.err(range.error);
    const { fromMs, toMs } = range.value;
    const row = await this.queryAggregateRow(fromMs, toMs, filter.model, filter.providerId);
    return Result.ok({
      calls: Number(row.calls),
      promptTokens: Number(row.prompt_tokens),
      completionTokens: Number(row.completion_tokens),
      totalTokens: Number(row.total_tokens),
      cacheReadTokens: Number(row.cache_read_tokens),
      cacheCreationTokens: Number(row.cache_creation_tokens),
      billedInputTokens: Number(row.billed_input_tokens),
      avgFirstTokenMs: row.avg_first_token_ms == null ? null : Number(row.avg_first_token_ms),
      avgTokensPerSecond: row.avg_tokens_per_second == null ? null : Number(row.avg_tokens_per_second),
    });
  }

  async getDailyBuckets(filter: UsageStatsFilter): Promise<Result<UsageStatsBucket[], AppError>> {
    // 日桶序列需要界（桶数随天数线性膨胀），护栏挂在这条查询上而非区间类型。
    if (filter.range == null) {
      return Result.err(new AppError("CHAT_INVALID_ARGUMENT", { descriptor: { key: "error.usage.daily_buckets_range_required" } }));
    }
    const ms = this.resolveDayRangeMs(filter.range);
    if (!ms.ok) return Result.err(ms.error);
    const { fromMs, toMs } = ms.value;
    // 单条 GROUP BY 查询替代旧实现的逐日 N+1：strftime 的 localtime 与
    // JS Date 同用进程本地时区，DST 日按挂钟日归桶；整数除法截到秒不影响
    // 日归属（日界切换发生在整秒的 0 点，毫秒截断不可能跨日）。
    const rows = await TdbcTemplate.query<Row>(this.conn, this.parser, UsageStatsSql.dailyBuckets, { fromMs, toMs, model: filter.model, providerId: filter.providerId });
    const rowByDay = new Map<string, Row>();
    for (const row of rows) {
      rowByDay.set(String(row.day_key), row);
    }
    // JS 侧从 fromDay 起按日历逐日推进（Date 构造器对 DST 安全），
    // 无数据日复用零值行，保证桶序列稠密且首尾闭区间含两端。
    const buckets: UsageStatsBucket[] = [];
    const from = parseDayLocalDate(filter.range.fromDay, "range.fromDay");
    if (!from.ok) return Result.err(from.error);
    for (let cursor = new Date(from.value.year, from.value.month, from.value.day); ; cursor = DateTime.addLocalDays(cursor, 1)) {
      // 本地日期键与 strftime 的 day_key 同构（年份补零 4 位防 <1000 年错位死循环）。
      const dayKey = DateTime.localDayKey(cursor);
      buckets.push(this.toBucket(cursor.getTime(), rowByDay.get(dayKey) ?? ZERO_AGG_ROW));
      if (dayKey === filter.range.toDay) {
        return Result.ok(buckets);
      }
    }
  }

  async getHourlyBuckets(dayLocalDate: string, filter: UsageStatsFilter): Promise<Result<UsageStatsBucket[], AppError>> {
    const parsedDay = parseDayLocalDate(dayLocalDate);
    if (!parsedDay.ok) return Result.err(parsedDay.error);
    const { year, month, day } = parsedDay.value;
    const buckets: UsageStatsBucket[] = [];
    for (let hour = 0; hour < 24; hour++) {
      // 按本地钟点构造桶边界：常规日 24 桶；DST 缺失钟点退化为空桶（零值），
      // 重复钟点自然加宽，均以实际构造结果为准。
      const startMs = new Date(year, month, day, hour).getTime();
      const endMs = new Date(year, month, day, hour + 1).getTime();
      const row = startMs < endMs ? await this.queryAggregateRow(startMs, endMs, filter.model, filter.providerId) : ZERO_AGG_ROW;
      buckets.push(this.toBucket(startMs, row));
    }
    return Result.ok(buckets);
  }

  async getModelBreakdown(filter: UsageStatsFilter): Promise<Result<UsageStatsModelRow[], AppError>> {
    const range = this.resolveOptionalRange(filter.range);
    if (!range.ok) return Result.err(range.error);
    const { fromMs, toMs } = range.value;
    const rows = await TdbcTemplate.query<Row>(this.conn, this.parser, UsageStatsSql.modelBreakdown, { fromMs, toMs, model: filter.model, providerId: filter.providerId });
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
    const merged = new Map<string, UsageStatsModelRow>();
    for (const row of mapped) {
      const modelKey = row.providerId == null ? null : row.modelName != null && configured.has(row.modelName) ? row.modelName : null;
      const key = `${row.providerId ?? ""}\u0000${modelKey ?? ""}`;
      const prev = merged.get(key);
      merged.set(key, {
        providerId: row.providerId,
        modelName: modelKey,
        calls: (prev?.calls ?? 0) + row.calls,
        promptTokens: (prev?.promptTokens ?? 0) + row.promptTokens,
        completionTokens: (prev?.completionTokens ?? 0) + row.completionTokens,
        totalTokens: (prev?.totalTokens ?? 0) + row.totalTokens,
        cacheReadTokens: (prev?.cacheReadTokens ?? 0) + row.cacheReadTokens,
        billedInputTokens: (prev?.billedInputTokens ?? 0) + row.billedInputTokens,
      });
    }
    return Result.ok([...merged.values()].sort((a, b) => b.totalTokens - a.totalTokens || `${a.providerId ?? ""}/${a.modelName ?? ""}`.localeCompare(`${b.providerId ?? ""}/${b.modelName ?? ""}`)));
  }

  async listRequestUsage(filter: UsageStatsFilter, page: UsageStatsRequestPageQuery): Promise<Result<UsageStatsRequestPage, AppError>> {
    const limit = Math.floor(page.limit);
    if (!Number.isFinite(limit) || limit < 1 || limit > 200) {
      return Result.err(new AppError("CHAT_INVALID_ARGUMENT", { descriptor: { key: "error.usage.invalid_page_limit", params: { value: page.limit } } }));
    }
    // NaN/Infinity 会穿透 Math.floor/Math.max 进 SQL 绑定（better-sqlite3
    // 直接抛错），与 limit 同构提前拒收。
    if (!Number.isFinite(page.offset)) {
      return Result.err(new AppError("CHAT_INVALID_ARGUMENT", { descriptor: { key: "error.usage.invalid_page_offset", params: { value: page.offset } } }));
    }
    const offset = Math.max(0, Math.floor(page.offset));
    const range = this.resolveOptionalRange(filter.range);
    if (!range.ok) return Result.err(range.error);
    const { fromMs, toMs } = range.value;
    // total 与行集同用一组筛选谓词：range 缺省时两者都不含时间谓词（全历史）。
    const params = {
      fromMs,
      toMs,
      model: filter.model,
      providerId: filter.providerId,
      offset,
      limit,
    };
    const totalRows = await TdbcTemplate.query<{ n: number }>(this.conn, this.parser, UsageStatsSql.countRequestUsage, params);
    const rows = await TdbcTemplate.query<Row>(this.conn, this.parser, UsageStatsSql.listRequestUsage, params);
    return Result.ok({
      rows: rows.map(
        (row): UsageStatsRequestRow => ({
          createdAtMs: Number(row.created_at_ms),
          modelName: row.model_name == null ? null : String(row.model_name),
          promptTokens: Number(row.prompt_tokens ?? 0),
          completionTokens: Number(row.completion_tokens ?? 0),
          totalTokens: Number(row.total_tokens ?? 0),
          cacheReadTokens: row.cache_read_tokens == null ? null : Number(row.cache_read_tokens),
          cacheCreationTokens: row.cache_creation_tokens == null ? null : Number(row.cache_creation_tokens),
          firstTokenMs: row.first_token_ms == null ? null : Number(row.first_token_ms),
          durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
        })
      ),
      total: Number(totalRows[0]?.n ?? 0),
    });
  }

  async listModels(): Promise<string[]> {
    // 选项与服务商配置的模型列表同源（vendor_model_id 去重），
    // 不从 chat_message 历史记录 distinct——历史模型会随模型更替不断堆积。
    const rows = await TdbcTemplate.query<{ vendor_model_id: string }>(this.conn, this.parser, UsageStatsSql.listModels, {});
    return rows.map((row) => String(row.vendor_model_id));
  }

  async getSessionUsageDetail(sessionId: string): Promise<Result<SessionUsageDetail, AppError>> {
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      return Result.err(new AppError("CHAT_INVALID_ARGUMENT", { descriptor: { key: "error.usage.session_id_required", params: { value: String(sessionId) } } }));
    }
    // 最近行 + 可见计数两条 SQL 与会话 KKV 缓存读并行。最近行改打账本
    // （usage_record，按 created_at_ms 倒序取首行）——消息被删除/回滚后
    // 账本行仍在，「最近一次请求」不再随内容消失；可见数 SQL 数行
    // （hidden 列判定，只剔 hidden 不筛角色），
    // 它属内容侧读数（随会话删），仍打 chat_message。
    // 工具调用数走会话 KKV `usage_stats.toolUseCount` 缓存（2026-09-29 用户
    // 拍板「实时算 + 缓存，失效挂 run/编辑/删除」；缓存跟随会话生命周期，
    // fork 新会话天然 miss 重算）；miss 时解压 assistant 行现算并回填——
    // 大会话这笔现算数百毫秒量级，由失效挂点保证只在「真的变了之后」付
    // 一次。会话累计输入/输出已移除（含 hidden 的累计对用户无意义）。
    const sessionUsageQueries = Promise.all([
      TdbcTemplate.query<Row>(this.conn, this.parser, UsageStatsSql.lastRequest, { sessionId }),
      TdbcTemplate.query<{ n: number }>(this.conn, this.parser, UsageStatsSql.visibleMessageCount, { sessionId }),
      SessionKkvServiceFactory.create(this.conn).get(sessionId, SESSION_KKV_DOMAIN_USAGE_STATS, USAGE_STATS_TOOL_USE_COUNT_KEY),
    ]);
    const [lastRows, visibleRows, cachedToolUseCount] = await sessionUsageQueries;
    const lastRow = lastRows[0];
    let last: SessionUsageLastRequest | null = null;
    if (lastRow != null) {
      last = {
        // 账本行自带消息 seq 快照；异常缺省按 0（展示层不消费 seq）。
        seq: Number(lastRow.message_seq ?? 0),
        modelName: lastRow.model_name == null ? null : String(lastRow.model_name),
        provider: lastRow.provider == null ? null : String(lastRow.provider),
        promptTokens: Number(lastRow.prompt_tokens ?? 0),
        completionTokens: Number(lastRow.completion_tokens ?? 0),
        cacheReadTokens: lastRow.cache_read_tokens == null ? null : Number(lastRow.cache_read_tokens),
        cacheCreationTokens: lastRow.cache_creation_tokens == null ? null : Number(lastRow.cache_creation_tokens),
        atMs: Number(lastRow.created_at_ms),
      };
    }
    const visibleMessageCount = Number(visibleRows[0]?.n ?? 0);
    const cached = cachedToolUseCount != null ? Number.parseInt(cachedToolUseCount, 10) : NaN;
    if (Number.isFinite(cached)) {
      return Result.ok({ last, visibleMessageCount, toolUseCount: cached });
    }
    // 缓存 miss：现算 assistant 行（含 hidden 行——累计口径；user 侧
    // tool_result 不计）。只投影 content 列，不选 raw_json/attachments。
    // 坏行（parse 失败）按 0 计并 warn：计数是统计读数，单条历史坏行
    // 不该让整个弹窗报错。
    const assistantRows = await TdbcTemplate.query<Row>(this.conn, this.parser, UsageStatsSql.listAssistantMessageContents, { sessionId });
    let toolUseCount = 0;
    // 无 keyword 语义，无粗筛面：全量 parse 为固有成本
    for (const row of assistantRows) {
      const parsed = MessageContentParse.parse(String(row.content_json));
      if (!parsed.ok) {
        log.warn(`工具调用现算遇坏行（按 0 计）：${parsed.error.message}`);
        continue;
      }
      for (const block of parsed.value.blocks) {
        if (block.type === "tool_use") toolUseCount += 1;
      }
    }
    // 回填前复核（cr-fix-spec-r2 s3/B-1）：现算的数百毫秒里若发生失效
    // （写哨兵空串），miss 时所见原值已变——放弃回填（本次返回值已出，
    // 下次读重算），防止陈旧值覆盖失效结果。已知残余（接受，见 fix-spec）：
    // miss 时原值本就是哨兵、现算期间再失效（哨兵幂等不可分辨）→ 复核
    // 通过回填陈旧值，窗口延续到下次失效自愈——两次失效夹一次现算的低
    // 概率场景，不引入版本化哨兵。回填 best-effort，失败只影响下次读数。
    try {
      const sessionKkv = SessionKkvServiceFactory.create(this.conn);
      const current = await sessionKkv.get(sessionId, SESSION_KKV_DOMAIN_USAGE_STATS, USAGE_STATS_TOOL_USE_COUNT_KEY);
      if (current === cachedToolUseCount) {
        await sessionKkv.set(sessionId, SESSION_KKV_DOMAIN_USAGE_STATS, USAGE_STATS_TOOL_USE_COUNT_KEY, String(toolUseCount));
      }
    } catch (error) {
      log.warn(`工具调用缓存回填失败（不影响本次读数）：${error instanceof Error ? error.message : String(error)}`);
    }
    return Result.ok({ last, visibleMessageCount, toolUseCount });
  }

  /**
   * 把 `{fromDay, toDay}` 闭区间换算为毫秒半开区间：
   * `[fromDay 本地 0 点, toDay+1 本地 0 点)`。日期格式与合法性由
   * parseDayLocalDate 校验（拒绝 02-30 等溢出日期），fromDay 晚于
   * toDay 抛错；闭区间的双端含由 toMs 取 toDay 次日 0 点保证。
   */
  private resolveDayRangeMs(range: UsageStatsRange): Result<{ fromMs: number; toMs: number }, AppError> {
    const from = parseDayLocalDate(range.fromDay, "range.fromDay");
    if (!from.ok) return Result.err(from.error);
    const to = parseDayLocalDate(range.toDay, "range.toDay");
    if (!to.ok) return Result.err(to.error);
    const fromStart = new Date(from.value.year, from.value.month, from.value.day);
    const toStart = new Date(to.value.year, to.value.month, to.value.day);
    if (fromStart.getTime() > toStart.getTime()) {
      return Result.err(new AppError("CHAT_INVALID_ARGUMENT", { descriptor: { key: "error.usage.from_after_to", params: { from_day: range.fromDay, to_day: range.toDay } } }));
    }
    return Result.ok({
      fromMs: fromStart.getTime(),
      toMs: DateTime.addLocalDays(toStart, 1).getTime(),
    });
  }

  /** range 缺省 → (null, null)，聚合/流水查询不限时间（全历史）。 */
  private resolveOptionalRange(range: UsageStatsRange | undefined): Result<{ fromMs: number | null; toMs: number | null }, AppError> {
    if (range == null) {
      return Result.ok({ fromMs: null, toMs: null });
    }
    const ms = this.resolveDayRangeMs(range);
    if (!ms.ok) return Result.err(ms.error);
    return Result.ok(ms.value);
  }

  /**
   * 单区间聚合查询（无 GROUP BY，聚合恒返回一行；fromMs/toMs 为
   * null 时不加时间谓词 = 全历史）。
   */
  private async queryAggregateRow(fromMs: number | null, toMs: number | null, model: string | null | undefined, providerId: string | null | undefined): Promise<Row> {
    const rows = await TdbcTemplate.query<Row>(this.conn, this.parser, UsageStatsSql.aggregate, { fromMs, toMs, model, providerId });
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
      avgFirstTokenMs: row.avg_first_token_ms == null ? null : Number(row.avg_first_token_ms),
      avgTokensPerSecond: row.avg_tokens_per_second == null ? null : Number(row.avg_tokens_per_second),
    };
  }
}

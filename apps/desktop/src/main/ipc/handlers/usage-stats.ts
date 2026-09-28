/**
 * Usage stats IPC handler — 单 channel 按 kind 分发转发 core 统计服务，
 * core 返回体在此显式映射为 shared DTO（renderer 侧不 import core）；
 * modelBreakdown 的 provider×model 复合行原样透传（不按 modelName 归并——饼图以复合维度展示）。
 */
import type {
  SessionUsageDetail,
  UsageStatsBucket,
  UsageStatsFilter,
  UsageStatsModelRow,
  UsageStatsRequestRow,
  UsageStatsService,
  UsageStatsSummary,
} from "@novel-master/core/chat";

import type {
  IpcResult,
  SessionUsageDetailDto,
  UsageStatsBucketDto,
  UsageStatsFilterDto,
  UsageStatsModelRowDto,
  UsageStatsQueryRequest,
  UsageStatsQueryResponse,
  UsageStatsRangeDto,
  UsageStatsRequestRowDto,
  UsageStatsSummaryDto,
} from "../../../../shared/ipc-types.js";
import { formatIpcError } from "../format-ipc-error.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";

/**
 * 校验自然日区间 DTO：YYYY-MM-DD 格式、合法日历日（拒绝 02-30 等溢出）与
 * fromDay ≤ toDay（字典序比较，定宽日期串等价日期序）。IPC 边界先行拒绝，
 * 不依赖 core 侧抛错路径。
 */
function validateRangeDto(range: UsageStatsRangeDto): string | null {
  const re = /^(\d{4})-(\d{2})-(\d{2})$/;
  for (const [name, day] of [
    ["fromDay", range.fromDay],
    ["toDay", range.toDay],
  ] as const) {
    const m = re.exec(day);
    if (m == null) {
      return `${name} 须为 YYYY-MM-DD 格式：${day}`;
    }
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const parsed = new Date(y, mo - 1, d);
    if (
      parsed.getFullYear() !== y ||
      parsed.getMonth() !== mo - 1 ||
      parsed.getDate() !== d
    ) {
      return `${name} 不是合法日期：${day}`;
    }
  }
  if (range.fromDay > range.toDay) {
    return `fromDay 不能晚于 toDay：${range.fromDay} > ${range.toDay}`;
  }
  return null;
}

/** DTO 与 core 类型结构等效，此处显式转换以守住类型边界（model 三态原样保留；range 可选透传）。 */
function toCoreFilter(filter: UsageStatsFilterDto): UsageStatsFilter {
  return {
    ...(filter.range != null
      ? { range: { fromDay: filter.range.fromDay, toDay: filter.range.toDay } }
      : {}),
    ...(filter.model !== undefined ? { model: filter.model } : {}),
  };
}

function toSummaryDto(summary: UsageStatsSummary): UsageStatsSummaryDto {
  return {
    calls: summary.calls,
    promptTokens: summary.promptTokens,
    completionTokens: summary.completionTokens,
    totalTokens: summary.totalTokens,
    cacheReadTokens: summary.cacheReadTokens,
    cacheCreationTokens: summary.cacheCreationTokens,
    billedInputTokens: summary.billedInputTokens,
    avgFirstTokenMs: summary.avgFirstTokenMs,
    avgTokensPerSecond: summary.avgTokensPerSecond,
  };
}

function toBucketDto(bucket: UsageStatsBucket): UsageStatsBucketDto {
  return {
    bucketStartMs: bucket.bucketStartMs,
    calls: bucket.calls,
    promptTokens: bucket.promptTokens,
    completionTokens: bucket.completionTokens,
    cacheReadTokens: bucket.cacheReadTokens,
    cacheCreationTokens: bucket.cacheCreationTokens,
    billedInputTokens: bucket.billedInputTokens,
    avgFirstTokenMs: bucket.avgFirstTokenMs,
    avgTokensPerSecond: bucket.avgTokensPerSecond,
  };
}

/**
 * provider×model 复合行原样透传（行结构与 DTO 同构，显式逐字段映射守住类型边界）。
 * 不按 modelName 归并：饼图需要 provider×model 复合维度，同名模型多服务商保持多行，
 * 保持 core 返回的首现顺序（renderer 侧自行按 totalTokens 重排）。
 */
function toModelRowDtos(rows: UsageStatsModelRow[]): UsageStatsModelRowDto[] {
  return rows.map((row) => ({
    providerId: row.providerId,
    modelName: row.modelName,
    calls: row.calls,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    totalTokens: row.totalTokens,
    cacheReadTokens: row.cacheReadTokens,
    billedInputTokens: row.billedInputTokens,
  }));
}

function toRequestRowDto(row: UsageStatsRequestRow): UsageStatsRequestRowDto {
  return {
    createdAtMs: row.createdAtMs,
    modelName: row.modelName,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    totalTokens: row.totalTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheCreationTokens: row.cacheCreationTokens,
    firstTokenMs: row.firstTokenMs,
    durationMs: row.durationMs,
  };
}

/**
 * 会话详情 DTO 映射（逐字段守住类型边界；last/totals 空态 null 透传，
 * cache 列 nullable 语义与 core 一致——缺失协议列 null 保真到展示层「—」）。
 */
function toSessionDetailDto(detail: SessionUsageDetail): SessionUsageDetailDto {
  return {
    last:
      detail.last == null
        ? null
        : {
            seq: detail.last.seq,
            modelName: detail.last.modelName,
            provider: detail.last.provider,
            promptTokens: detail.last.promptTokens,
            completionTokens: detail.last.completionTokens,
            cacheReadTokens: detail.last.cacheReadTokens,
            cacheCreationTokens: detail.last.cacheCreationTokens,
            atMs: detail.last.atMs,
          },
    totals:
      detail.totals == null
        ? null
        : {
            promptTokens: detail.totals.promptTokens,
            completionTokens: detail.totals.completionTokens,
            cacheReadTokens: detail.totals.cacheReadTokens,
            cacheCreationTokens: detail.totals.cacheCreationTokens,
            billedInputTokens: detail.totals.billedInputTokens,
            assistantRows: detail.totals.assistantRows,
          },
    visibleMessageCount: detail.visibleMessageCount,
    toolUseCount: detail.toolUseCount,
  };
}

export async function handleUsageStatsQuery(
  req: UsageStatsQueryRequest
): Promise<IpcResult<UsageStatsQueryResponse>> {
  try {
    if (req.filter.range != null) {
      const rangeError = validateRangeDto(req.filter.range);
      if (rangeError != null) {
        return {
          ok: false,
          error: { code: "ERROR", message: rangeError },
        };
      }
    }
    const rt = await getDesktopRuntime();
    const svc: UsageStatsService = rt.usageStats;
    const filter = toCoreFilter(req.filter);
    switch (req.kind) {
      case "summary":
        return {
          ok: true,
          data: toSummaryDto(await svc.getSummary(filter)),
        };
      case "daily":
        return {
          ok: true,
          data: (await svc.getDailyBuckets(filter)).map(toBucketDto),
        };
      case "hourly":
        // dayLocalDate 缺失时传空串，由服务层日期校验拒绝并落入 IpcResult error
        return {
          ok: true,
          data: (
            await svc.getHourlyBuckets(req.dayLocalDate ?? "", filter)
          ).map(toBucketDto),
        };
      case "modelBreakdown":
        return {
          ok: true,
          data: toModelRowDtos(await svc.getModelBreakdown(filter)),
        };
      case "models":
        return { ok: true, data: await svc.listModels() };
      case "requests": {
        // offset/limit 仅 requests 使用；缺省 0/50 与 renderer 侧默认页大小一致。
        const page = await svc.listRequestUsage(filter, {
          offset: req.offset ?? 0,
          limit: req.limit ?? 50,
        });
        return {
          ok: true,
          data: { rows: page.rows.map(toRequestRowDto), total: page.total },
        };
      }
      case "sessionDetail":
        // 会话详情不走 filter（req.filter 为必填占位 `filter:{}`，此处不读）；
        // sessionId 缺失传空串，由服务层 chatInvalidArgument 拒绝并落入 error。
        return {
          ok: true,
          data: toSessionDetailDto(
            await svc.getSessionUsageDetail(req.sessionId ?? "")
          ),
        };
      default: {
        const exhaustive: never = req.kind;
        return {
          ok: false,
          error: {
            code: "ERROR",
            message: `未知的 usageStats 查询 kind: ${String(exhaustive)}`,
          },
        };
      }
    }
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

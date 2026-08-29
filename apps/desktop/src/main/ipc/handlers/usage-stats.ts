/**
 * Usage stats IPC handler — 单 channel 按 kind 分发转发 core 统计服务，
 * core 返回体在此显式映射为 shared DTO（renderer 侧不 import core）。
 */
import type {
  UsageStatsBucket,
  UsageStatsFilter,
  UsageStatsModelRow,
  UsageStatsRequestRow,
  UsageStatsService,
  UsageStatsSummary,
} from '@novel-master/core/chat';

import type {
  IpcResult,
  UsageStatsBucketDto,
  UsageStatsFilterDto,
  UsageStatsModelRowDto,
  UsageStatsQueryRequest,
  UsageStatsQueryResponse,
  UsageStatsRequestRowDto,
  UsageStatsSummaryDto,
} from '../../../../shared/ipc-types.js';
import { formatIpcError } from '../format-ipc-error.js';
import { getDesktopRuntime } from '../../runtime/desktop-runtime-singleton.js';

/** DTO 与 core 类型结构等效，此处显式转换以守住类型边界（model 三态原样保留）。 */
function toCoreFilter(filter: UsageStatsFilterDto): UsageStatsFilter {
  return {
    range: {
      kind: filter.range.kind,
      ...(filter.range.kind === 'custom'
        ? { fromMs: filter.range.fromMs, toMs: filter.range.toMs }
        : {}),
    },
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
    today: {
      totalTokens: summary.today.totalTokens,
      calls: summary.today.calls,
    },
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

function toModelRowDto(row: UsageStatsModelRow): UsageStatsModelRowDto {
  return {
    modelName: row.modelName,
    calls: row.calls,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    totalTokens: row.totalTokens,
    cacheReadTokens: row.cacheReadTokens,
    billedInputTokens: row.billedInputTokens,
  };
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

export async function handleUsageStatsQuery(
  req: UsageStatsQueryRequest,
): Promise<IpcResult<UsageStatsQueryResponse>> {
  try {
    const rt = await getDesktopRuntime();
    const svc: UsageStatsService = rt.usageStats;
    const filter = toCoreFilter(req.filter);
    switch (req.kind) {
      case 'summary':
        return {
          ok: true,
          data: toSummaryDto(await svc.getSummary(filter)),
        };
      case 'daily':
        return {
          ok: true,
          data: (await svc.getDailyBuckets(filter)).map(toBucketDto),
        };
      case 'hourly':
        // dayLocalDate 缺失时传空串，由服务层日期校验拒绝并落入 IpcResult error
        return {
          ok: true,
          data: (
            await svc.getHourlyBuckets(req.dayLocalDate ?? '', filter)
          ).map(toBucketDto),
        };
      case 'modelBreakdown':
        return {
          ok: true,
          data: (await svc.getModelBreakdown(filter)).map(toModelRowDto),
        };
      case 'models':
        return { ok: true, data: await svc.listModels() };
      case 'requests': {
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
      default: {
        const exhaustive: never = req.kind;
        return {
          ok: false,
          error: {
            code: 'ERROR',
            message: `未知的 usageStats 查询 kind: ${String(exhaustive)}`,
          },
        };
      }
    }
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

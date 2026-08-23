/**
 * Usage stats IPC handler — 单 channel 按 kind 分发转发 core 统计服务，
 * core 返回体在此显式映射为 shared DTO（renderer 侧不 import core）。
 */
import type {
  UsageStatsBucket,
  UsageStatsFilter,
  UsageStatsModelRow,
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

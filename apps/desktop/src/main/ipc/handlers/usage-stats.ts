/**
 * Usage stats IPC handler — 单 channel 按 kind 分发转发 core 统计服务，
 * core 返回体在此显式映射为 shared DTO（renderer 侧不 import core）；
 * modelBreakdown 的 provider×model 复合行原样透传（不按 modelName 归并——饼图以复合维度展示）。
 */
import type { UsageStatsBucket, UsageStatsFilter, UsageStatsService } from "@novel-master/core/chat";

import type { IpcResult, UsageStatsBucketDto, UsageStatsQueryRequest, UsageStatsQueryResponse } from "../../../../shared/ipc-types.js";
import { AppError } from "@novel-master/core/agent";
import { Result } from "@novel-master/core/errors";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import { toIpcResult } from "../ipc-result.js";

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

/** 已知失败沿 Result 返回（range 校验拒绝 + core 服务 Err）；未知异常由 toIpcResult 兜底转码。 */
export function handleUsageStatsQuery(req: UsageStatsQueryRequest): Promise<IpcResult<UsageStatsQueryResponse>> {
  return toIpcResult(async (): Promise<Result<UsageStatsQueryResponse, AppError>> => {
    if (req.filter.range != null) {
      const range = req.filter.range;
      const re = /^(\d{4})-(\d{2})-(\d{2})$/;
      for (const [name, day] of [
        ["fromDay", range.fromDay],
        ["toDay", range.toDay],
      ] as const) {
        const m = re.exec(day);
        if (m == null) return Result.err(new AppError("INFRA_UNEXPECTED_ERROR", { detail: `${name} 须为 YYYY-MM-DD 格式：${day}` }));
        const y = Number(m[1]);
        const mo = Number(m[2]);
        const d = Number(m[3]);
        const parsed = new Date(y, mo - 1, d);
        if (parsed.getFullYear() !== y || parsed.getMonth() !== mo - 1 || parsed.getDate() !== d) {
          return Result.err(new AppError("INFRA_UNEXPECTED_ERROR", { detail: `${name} 不是合法日期：${day}` }));
        }
      }
      if (range.fromDay > range.toDay) {
        return Result.err(new AppError("INFRA_UNEXPECTED_ERROR", { detail: `fromDay 不能晚于 toDay：${range.fromDay} > ${range.toDay}` }));
      }
    }
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return Result.err(built.error);
    const rt = built.value;
    const svc: UsageStatsService = rt.usageStats;
    // DTO 与 core 类型结构等效，此处显式转换以守住类型边界（model 三态原样保留；range 可选透传）。
    const filter: UsageStatsFilter = {
      ...(req.filter.range != null ? { range: { fromDay: req.filter.range.fromDay, toDay: req.filter.range.toDay } } : {}),
      ...(req.filter.model !== undefined ? { model: req.filter.model } : {}),
    };
    switch (req.kind) {
      case "summary": {
        const summary = await svc.getSummary(filter);
        return summary.map((s) => ({
          calls: s.calls,
          promptTokens: s.promptTokens,
          completionTokens: s.completionTokens,
          totalTokens: s.totalTokens,
          cacheReadTokens: s.cacheReadTokens,
          cacheCreationTokens: s.cacheCreationTokens,
          billedInputTokens: s.billedInputTokens,
          avgFirstTokenMs: s.avgFirstTokenMs,
          avgTokensPerSecond: s.avgTokensPerSecond,
        }));
      }
      case "daily": {
        const buckets = await svc.getDailyBuckets(filter);
        return buckets.map((list) => list.map(toBucketDto));
      }
      case "hourly": {
        // dayLocalDate 缺失时传空串，由服务层日期校验拒绝并落入 IpcResult error
        const buckets = await svc.getHourlyBuckets(req.dayLocalDate ?? "", filter);
        return buckets.map((list) => list.map(toBucketDto));
      }
      case "modelBreakdown": {
        // provider×model 复合行原样透传（行结构与 DTO 同构，显式逐字段映射守住类型边界）。
        // 不按 modelName 归并：饼图需要 provider×model 复合维度，同名模型多服务商保持多行，
        // 保持 core 返回的首现顺序（renderer 侧自行按 totalTokens 重排）。
        const rows = await svc.getModelBreakdown(filter);
        return rows.map((list) =>
          list.map((row) => ({
            providerId: row.providerId,
            modelName: row.modelName,
            calls: row.calls,
            promptTokens: row.promptTokens,
            completionTokens: row.completionTokens,
            totalTokens: row.totalTokens,
            cacheReadTokens: row.cacheReadTokens,
            billedInputTokens: row.billedInputTokens,
          }))
        );
      }
      case "models":
        return Result.ok(await svc.listModels());
      case "requests": {
        // offset/limit 仅 requests 使用；缺省 0/50 与 renderer 侧默认页大小一致。
        const page = await svc.listRequestUsage(filter, { offset: req.offset ?? 0, limit: req.limit ?? 50 });
        return page.map((p) => ({
          rows: p.rows.map((row) => ({
            createdAtMs: row.createdAtMs,
            modelName: row.modelName,
            promptTokens: row.promptTokens,
            completionTokens: row.completionTokens,
            totalTokens: row.totalTokens,
            cacheReadTokens: row.cacheReadTokens,
            cacheCreationTokens: row.cacheCreationTokens,
            firstTokenMs: row.firstTokenMs,
            durationMs: row.durationMs,
          })),
          total: p.total,
        }));
      }
      case "sessionDetail": {
        // 会话详情不走 filter（req.filter 为必填占位 `filter:{}`，此处不读）；
        // sessionId 缺失传空串，由服务层 CHAT_INVALID_ARGUMENT 拒绝并落入 error。
        // last 空态 null 透传，cache 列 nullable 语义与 core 一致——缺失协议列 null
        // 保真到展示层「—」。会话累计输入/输出已随 totals 字段移除（2026-09-29 用户拍板）。
        const detail = await svc.getSessionUsageDetail(req.sessionId ?? "");
        return detail.map((d) => ({
          last:
            d.last == null
              ? null
              : {
                  seq: d.last.seq,
                  modelName: d.last.modelName,
                  provider: d.last.provider,
                  promptTokens: d.last.promptTokens,
                  completionTokens: d.last.completionTokens,
                  cacheReadTokens: d.last.cacheReadTokens,
                  cacheCreationTokens: d.last.cacheCreationTokens,
                  atMs: d.last.atMs,
                },
          visibleMessageCount: d.visibleMessageCount,
          toolUseCount: d.toolUseCount,
        }));
      }
      default: {
        const exhaustive: never = req.kind;
        return Result.err(new AppError("INFRA_UNEXPECTED_ERROR", { detail: `未知的 usageStats 查询 kind: ${String(exhaustive)}` }));
      }
    }
  });
}

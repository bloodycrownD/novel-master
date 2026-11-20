/**
 * Usage stats IPC handler — 单 channel 按 kind 分发转发 core 统计服务，
 * core 返回体在此显式映射为 shared DTO（renderer 侧不 import core）；
 * modelBreakdown 的 provider×model 复合行原样透传（不按 modelName 归并——饼图以复合维度展示）。
 *
 * 取消（signal-abort-scope §五）：timeout 120s；每个 kind 分支边界一组检查点
 * （进入分支前 + 单条 SQL 完成后），单条 SQL 本身标为不可中断窗口。`doWork`
 * 返回 `Outcome`，边界由 `RunScope.abortable` 三分派。
 */
import type { UsageStatsBucket, UsageStatsFilter, UsageStatsService } from "@novel-master/core/chat";
import { ABORT_KEY, type AbortScope } from "@novel-master/core/abort";
import type { Outcome } from "@novel-master/core/errors";

import type { IpcResult, UsageStatsBucketDto, UsageStatsQueryRequest, UsageStatsQueryResponse } from "../../../../shared/ipc-types.js";
import { AppError } from "@novel-master/core/errors";
import { DesktopRuntimeSingleton } from "../../runtime/desktop-runtime-singleton.js";
import type { DesktopNovelMasterRuntime } from "../../runtime/types.js";
import { FormatIpcError } from "../format-ipc-error.js";
import { IpcResults } from "../ipc-result.js";
import { RunScope } from "../run-scope.js";

export const UsageStats = {
  toBucketDto(bucket: UsageStatsBucket): UsageStatsBucketDto {
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
  },

  /** range 校验在 IPC 边界先行拒绝；runId 缺省时只建 scope + deadline、不注册。 */
  async handleQuery(req: UsageStatsQueryRequest): Promise<IpcResult<UsageStatsQueryResponse>> {
    const range = req.filter.range;
    if (range != null) {
      // 区间校验：格式 / 日历日溢出（02-30 等）/ fromDay ≤ toDay。校验失败不触达服务层。
      const re = /^(\d{4})-(\d{2})-(\d{2})$/;
      for (const [name, day] of [
        ["fromDay", range.fromDay],
        ["toDay", range.toDay],
      ] as const) {
        const m = re.exec(day);
        if (m == null) return IpcResults.err(FormatIpcError.format(new AppError("INFRA_UNEXPECTED_ERROR", { detail: `${name} 须为 YYYY-MM-DD 格式：${day}` })));
        const y = Number(m[1]);
        const mo = Number(m[2]);
        const d = Number(m[3]);
        const parsed = new Date(y, mo - 1, d);
        if (parsed.getFullYear() !== y || parsed.getMonth() !== mo - 1 || parsed.getDate() !== d) {
          return IpcResults.err(FormatIpcError.format(new AppError("INFRA_UNEXPECTED_ERROR", { detail: `${name} 不是合法日期：${day}` })));
        }
      }
      if (range.fromDay > range.toDay) {
        return IpcResults.err(FormatIpcError.format(new AppError("INFRA_UNEXPECTED_ERROR", { detail: `fromDay 不能晚于 toDay：${range.fromDay} > ${range.toDay}` })));
      }
    }
    const built = await DesktopRuntimeSingleton.get();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return IpcResults.err(FormatIpcError.format(built.error));
    const rt = built.value;
    return RunScope.abortable({ registry: rt.abortRegistry, key: RunScope.key(ABORT_KEY.usageStats, req.runId), timeoutMs: 120_000 }, (scope) => UsageStats.query(rt, req, scope));
  },

  /** 可中断的统计查询段：各 kind 分支边界检查点，单条 SQL 完成后再次判停。 */
  async query(rt: DesktopNovelMasterRuntime, req: UsageStatsQueryRequest, scope: AbortScope): Promise<Outcome<UsageStatsQueryResponse>> {
    const svc: UsageStatsService = rt.usageStats;
    // DTO 与 core 类型结构等效，此处显式转换以守住类型边界（model 三态原样保留；range 可选透传）。
    const filter: UsageStatsFilter = {
      ...(req.filter.range != null ? { range: { fromDay: req.filter.range.fromDay, toDay: req.filter.range.toDay } } : {}),
      ...(req.filter.model !== undefined ? { model: req.filter.model } : {}),
    };
    const stopped = RunScope.outcomeIfAborted(scope);
    if (stopped != null) return stopped;
    switch (req.kind) {
      case "summary": {
        const summary = await svc.getSummary(filter);
        const interrupted = RunScope.outcomeIfAborted(scope);
        if (interrupted != null) return interrupted;
        if (!summary.ok) return { kind: "failed", error: summary.error };
        const s = summary.value;
        return {
          kind: "completed",
          value: {
            calls: s.calls,
            promptTokens: s.promptTokens,
            completionTokens: s.completionTokens,
            totalTokens: s.totalTokens,
            cacheReadTokens: s.cacheReadTokens,
            cacheCreationTokens: s.cacheCreationTokens,
            billedInputTokens: s.billedInputTokens,
            avgFirstTokenMs: s.avgFirstTokenMs,
            avgTokensPerSecond: s.avgTokensPerSecond,
          },
        };
      }
      case "daily": {
        const buckets = await svc.getDailyBuckets(filter);
        const interrupted = RunScope.outcomeIfAborted(scope);
        if (interrupted != null) return interrupted;
        return buckets.ok ? { kind: "completed", value: buckets.value.map(UsageStats.toBucketDto) } : { kind: "failed", error: buckets.error };
      }
      case "hourly": {
        // dayLocalDate 缺失时传空串，由服务层日期校验拒绝并落入 IPC error。
        const buckets = await svc.getHourlyBuckets(req.dayLocalDate ?? "", filter);
        const interrupted = RunScope.outcomeIfAborted(scope);
        if (interrupted != null) return interrupted;
        return buckets.ok ? { kind: "completed", value: buckets.value.map(UsageStats.toBucketDto) } : { kind: "failed", error: buckets.error };
      }
      case "modelBreakdown": {
        // provider×model 复合行原样透传（行结构与 DTO 同构，显式逐字段映射守住类型边界）。
        // 不按 modelName 归并：饼图需要 provider×model 复合维度，同名模型多服务商保持多行，
        // 保持 core 返回的首现顺序（renderer 侧自行按 totalTokens 重排）。
        const rows = await svc.getModelBreakdown(filter);
        const interrupted = RunScope.outcomeIfAborted(scope);
        if (interrupted != null) return interrupted;
        if (!rows.ok) return { kind: "failed", error: rows.error };
        return {
          kind: "completed",
          value: rows.value.map((row) => ({
            providerId: row.providerId,
            modelName: row.modelName,
            calls: row.calls,
            promptTokens: row.promptTokens,
            completionTokens: row.completionTokens,
            totalTokens: row.totalTokens,
            cacheReadTokens: row.cacheReadTokens,
            billedInputTokens: row.billedInputTokens,
          })),
        };
      }
      case "models": {
        const models = await svc.listModels();
        const interrupted = RunScope.outcomeIfAborted(scope);
        if (interrupted != null) return interrupted;
        return { kind: "completed", value: models };
      }
      case "requests": {
        // offset/limit 仅 requests 使用；缺省 0/50 与 renderer 侧默认页大小一致。
        const page = await svc.listRequestUsage(filter, { offset: req.offset ?? 0, limit: req.limit ?? 50 });
        const interrupted = RunScope.outcomeIfAborted(scope);
        if (interrupted != null) return interrupted;
        if (!page.ok) return { kind: "failed", error: page.error };
        return {
          kind: "completed",
          value: {
            rows: page.value.rows.map((row) => ({
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
            total: page.value.total,
          },
        };
      }
      case "sessionDetail": {
        // 会话详情不走 filter（req.filter 为必填占位 `filter:{}`，此处不读）；
        // sessionId 缺失传空串，由服务层 CHAT_INVALID_ARGUMENT 拒绝并落入 error。
        // last 空态 null 透传，cache 列 nullable 语义与 core 一致——缺失协议列 null
        // 保真到展示层「—」。会话累计输入/输出已随 totals 字段移除（2026-09-29 用户拍板）。
        const detail = await svc.getSessionUsageDetail(req.sessionId ?? "");
        const interrupted = RunScope.outcomeIfAborted(scope);
        if (interrupted != null) return interrupted;
        if (!detail.ok) return { kind: "failed", error: detail.error };
        return {
          kind: "completed",
          value: {
            last:
              detail.value.last == null
                ? null
                : {
                    seq: detail.value.last.seq,
                    modelName: detail.value.last.modelName,
                    provider: detail.value.last.provider,
                    promptTokens: detail.value.last.promptTokens,
                    completionTokens: detail.value.last.completionTokens,
                    cacheReadTokens: detail.value.last.cacheReadTokens,
                    cacheCreationTokens: detail.value.last.cacheCreationTokens,
                    atMs: detail.value.last.atMs,
                  },
            visibleMessageCount: detail.value.visibleMessageCount,
            toolUseCount: detail.value.toolUseCount,
          },
        };
      }
      default: {
        const exhaustive: never = req.kind;
        return { kind: "failed", error: new AppError("INFRA_UNEXPECTED_ERROR", { detail: `未知的 usageStats 查询 kind: ${String(exhaustive)}` }) };
      }
    }
  },
} as const;

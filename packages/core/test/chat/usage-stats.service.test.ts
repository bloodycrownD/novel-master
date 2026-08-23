/**
 * T-S5（→ Step 5）：UsageStatsService 聚合服务。
 *
 * - 本地时区天边界：本地 00:30 消息入当日桶、昨日 23:30 入前一日桶（AC-3）；
 * - hourly 24 桶且桶边界按本地时区（AC-4 小时粒度）；
 * - hidden 行与子会话（parent_session_id 非空）行计入总和（AC-2 口径）；
 * - NULL usage 行、无 cache 行不入命中率分母；
 * - model_name IS NULL 归「未记录」桶；模型 × 时间组合过滤；
 * - getSummary 附带的 today 子对象独立于 filter；
 * - listModels 含已记录模型；
 * - billedInputTokens 含 anthropic 加法项（命中率原料）。
 *
 * 时区相关断言不依赖运行机器时区：统一以「本地今日 0 点 ± 固定偏移」构造时间戳。
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import type { ChatMessage } from "../../src/domain/chat/model/message.js";
import { SqliteMessageRepository } from "../../src/domain/chat/repositories/impl/sqlite-message.repository.js";
import { ChatError } from "../../src/errors/chat-errors.js";
import { createUsageStatsService } from "../../src/service/chat/create-chat-services.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

// 统计查询扫全表，而 fixture 是整文件共享一条库：每个用例前清空消息表隔离数据。
beforeEach(async () => {
  const ctx = getNovelMasterTestContext();
  await ctx.conn.execute("DELETE FROM chat_message");
});

/** 本地今日 0 点（ms）。 */
function localDayStart(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** 以本地日为基点加天数（DST 日差由 Date 构造器保证正确）。 */
function localAddDays(ms: number, days: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days).getTime();
}

/** 本地日期格式化为 `YYYY-MM-DD`。 */
function fmtLocalDay(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

interface MsgSeed {
  createdAtMs: number;
  role?: string;
  provider?: string | null;
  modelName?: string | null;
  hidden?: boolean;
  usage?: {
    prompt?: number;
    completion?: number;
    total?: number;
    cacheRead?: number;
    cacheCreation?: number;
  };
}

async function seedSession() {
  const ctx = getNovelMasterTestContext();
  const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
  const session = await ctx.sessions.create(project.id, "usage-stats");
  return { ctx, project, session };
}

/** 直接走 repo.insert 落一条时间戳/模型/usage 完全受控的消息。 */
async function seedMsg(
  ctx: ReturnType<typeof getNovelMasterTestContext>,
  sessionId: string,
  seq: number,
  seed: MsgSeed,
): Promise<void> {
  const u = seed.usage;
  const usage =
    u == null
      ? undefined
      : {
          ...(u.prompt != null ? { promptTokens: u.prompt } : {}),
          ...(u.completion != null ? { completionTokens: u.completion } : {}),
          ...(u.total != null ? { totalTokens: u.total } : {}),
          ...(u.cacheRead != null ? { cacheReadTokens: u.cacheRead } : {}),
          ...(u.cacheCreation != null
            ? { cacheCreationTokens: u.cacheCreation }
            : {}),
        };
  const message: ChatMessage = {
    id: randomUUID(),
    sessionId,
    seq,
    role: seed.role ?? "assistant",
    content: textBlocks("usage-stats-seed"),
    provider: seed.provider ?? null,
    modelName: seed.modelName ?? null,
    raw: null,
    createdAtMs: seed.createdAtMs,
    hidden: seed.hidden ?? false,
    ...(usage != null ? { usage } : {}),
  };
  await new SqliteMessageRepository(ctx.conn).insert(message);
}

describe("usage stats service (T-S5)", () => {
  it("本地时区天边界：本地 00:30 入当日桶、昨日 23:30 入前一日桶", async () => {
    const { ctx, session } = await seedSession();
    const today0 = localDayStart(Date.now());
    const yesterday0 = localAddDays(today0, -1);
    // 昨日 23:30 与今日 00:30（本地钟点），任何时区下都分别落在昨天/今天的桶。
    await seedMsg(ctx, session.id, 1, {
      createdAtMs: today0 - 30 * MIN,
      usage: { prompt: 10, total: 10 },
    });
    await seedMsg(ctx, session.id, 2, {
      createdAtMs: today0 + 30 * MIN,
      usage: { prompt: 20, total: 20 },
    });

    const svc = createUsageStatsService(ctx.conn);
    const buckets = await svc.getDailyBuckets({
      range: {
        kind: "custom",
        fromMs: yesterday0,
        toMs: localAddDays(today0, 1),
      },
    });
    const todayBucket = buckets.find((b) => b.bucketStartMs === today0);
    const yesterdayBucket = buckets.find((b) => b.bucketStartMs === yesterday0);
    assert.ok(todayBucket, "应存在本地今日 0 点起算的桶");
    assert.ok(yesterdayBucket, "应存在本地昨日 0 点起算的桶");
    assert.equal(todayBucket!.calls, 1);
    assert.equal(todayBucket!.promptTokens, 20);
    assert.equal(yesterdayBucket!.calls, 1);
    assert.equal(yesterdayBucket!.promptTokens, 10);
  });

  it("hourly 24 桶且桶边界按本地时区（整点入本桶不入前桶）", async () => {
    const { ctx, session } = await seedSession();
    const today0 = localDayStart(Date.now());
    // 本地 00:00 整点 → 0 点桶；本地 01:30 → 1 点桶。
    await seedMsg(ctx, session.id, 1, {
      createdAtMs: today0,
      usage: { prompt: 7, total: 7 },
    });
    await seedMsg(ctx, session.id, 2, {
      createdAtMs: today0 + 90 * MIN,
      usage: { prompt: 11, total: 11 },
    });

    const svc = createUsageStatsService(ctx.conn);
    const hourly = await svc.getHourlyBuckets(fmtLocalDay(today0), {
      range: { kind: "last7" },
    });
    assert.equal(hourly.length, 24);
    assert.equal(hourly[0]!.bucketStartMs, today0);
    assert.equal(hourly[0]!.calls, 1);
    assert.equal(hourly[0]!.promptTokens, 7);
    assert.equal(hourly[1]!.calls, 1);
    assert.equal(hourly[1]!.promptTokens, 11);
    assert.equal(hourly[2]!.calls, 0);
  });

  it("hidden 行与子会话行计入总和，NULL usage 行与 user 行不计（AC-2）", async () => {
    const { ctx, project, session } = await seedSession();
    const today0 = localDayStart(Date.now());
    // 子会话：造一个 parent_session_id 非空的 session。
    const childSession = await ctx.sessions.create(
      project.id,
      "usage-stats-child",
    );
    await ctx.conn.execute(
      `UPDATE chat_session SET parent_session_id = ? WHERE id = ?`,
      [session.id, childSession.id],
    );

    await seedMsg(ctx, session.id, 1, {
      createdAtMs: today0 + 10 * MIN,
      hidden: true,
      usage: { prompt: 100, completion: 50, total: 150 },
    });
    await seedMsg(ctx, childSession.id, 1, {
      createdAtMs: today0 + 20 * MIN,
      usage: { prompt: 30, completion: 20, total: 50 },
    });
    // NULL usage 行（abort）与 user 行都不应计入。
    await seedMsg(ctx, session.id, 2, { createdAtMs: today0 + 30 * MIN });
    await seedMsg(ctx, session.id, 3, {
      createdAtMs: today0 + 40 * MIN,
      role: "user",
      usage: { prompt: 999, total: 999 },
    });

    const svc = createUsageStatsService(ctx.conn);
    const summary = await svc.getSummary({
      range: {
        kind: "custom",
        fromMs: today0,
        toMs: localAddDays(today0, 1),
      },
    });
    assert.equal(summary.calls, 2);
    assert.equal(summary.promptTokens, 130);
    assert.equal(summary.completionTokens, 70);
    assert.equal(summary.totalTokens, 200);
  });

  it("命中率分母口径：anthropic 加法项、openai 纯 prompt、无 cache 行不入分母", async () => {
    const { ctx, session } = await seedSession();
    const today0 = localDayStart(Date.now());
    await seedMsg(ctx, session.id, 1, {
      createdAtMs: today0 + 10 * MIN,
      provider: "anthropic",
      usage: { prompt: 100, cacheRead: 2048, cacheCreation: 512 },
    });
    await seedMsg(ctx, session.id, 2, {
      createdAtMs: today0 + 20 * MIN,
      provider: "openai",
      usage: { prompt: 200, cacheRead: 50 },
    });
    // cache 两列全 NULL：不入分母（缺失行不拉低命中率）。
    await seedMsg(ctx, session.id, 3, {
      createdAtMs: today0 + 30 * MIN,
      provider: "openai",
      usage: { prompt: 999 },
    });

    const svc = createUsageStatsService(ctx.conn);
    const filter = {
      range: {
        kind: "custom" as const,
        fromMs: today0,
        toMs: localAddDays(today0, 1),
      },
    };
    const summary = await svc.getSummary(filter);
    // anthropic: 100 + 2048 + 512 = 2660；openai: 200（cached 已含 prompt 内）。
    assert.equal(summary.billedInputTokens, 2660 + 200);
    assert.equal(summary.cacheReadTokens, 2048 + 50);
    assert.equal(summary.cacheCreationTokens, 512);

    // 桶同样携带命中率原料（展示层算比率）。
    const buckets = await svc.getDailyBuckets(filter);
    const todayBucket = buckets.find((b) => b.bucketStartMs === today0);
    assert.ok(todayBucket);
    assert.equal(todayBucket!.billedInputTokens, 2660 + 200);
    assert.equal(todayBucket!.cacheReadTokens, 2048 + 50);
  });

  it("model_name IS NULL 归「未记录」，getModelBreakdown 含 null 行", async () => {
    const { ctx, session } = await seedSession();
    const today0 = localDayStart(Date.now());
    await seedMsg(ctx, session.id, 1, {
      createdAtMs: today0 + 10 * MIN,
      modelName: null,
      usage: { prompt: 10, total: 10 },
    });
    await seedMsg(ctx, session.id, 2, {
      createdAtMs: today0 + 20 * MIN,
      modelName: "model-a",
      usage: { prompt: 20, total: 20 },
    });

    const svc = createUsageStatsService(ctx.conn);
    const filter = {
      range: {
        kind: "custom" as const,
        fromMs: today0,
        toMs: localAddDays(today0, 1),
      },
    };
    const breakdown = await svc.getModelBreakdown(filter);
    const unrecorded = breakdown.find((r) => r.modelName === null);
    const modelA = breakdown.find((r) => r.modelName === "model-a");
    assert.ok(unrecorded, "breakdown 应含「未记录」行");
    assert.ok(modelA);
    assert.equal(unrecorded!.calls, 1);
    assert.equal(unrecorded!.totalTokens, 10);
    assert.equal(modelA!.calls, 1);

    // model: null → 只查未记录桶。
    const summaryNull = await svc.getSummary({ ...filter, model: null });
    assert.equal(summaryNull.calls, 1);
    assert.equal(summaryNull.promptTokens, 10);
  });

  it("模型 × 时间组合过滤", async () => {
    const { ctx, session } = await seedSession();
    const today0 = localDayStart(Date.now());
    const yesterday0 = localAddDays(today0, -1);
    await seedMsg(ctx, session.id, 1, {
      createdAtMs: today0 + 10 * MIN,
      modelName: "model-a",
      usage: { prompt: 10, total: 10 },
    });
    await seedMsg(ctx, session.id, 2, {
      createdAtMs: yesterday0 + 10 * MIN,
      modelName: "model-b",
      usage: { prompt: 20, total: 20 },
    });

    const svc = createUsageStatsService(ctx.conn);
    const todayOnly = {
      kind: "custom" as const,
      fromMs: today0,
      toMs: localAddDays(today0, 1),
    };
    const yesterdayOnly = {
      kind: "custom" as const,
      fromMs: yesterday0,
      toMs: today0,
    };

    const aToday = await svc.getSummary({ range: todayOnly, model: "model-a" });
    assert.equal(aToday.calls, 1);
    assert.equal(aToday.promptTokens, 10);

    const aYesterday = await svc.getSummary({
      range: yesterdayOnly,
      model: "model-a",
    });
    assert.equal(aYesterday.calls, 0);

    const bYesterday = await svc.getSummary({
      range: yesterdayOnly,
      model: "model-b",
    });
    assert.equal(bYesterday.calls, 1);
    assert.equal(bYesterday.promptTokens, 20);
  });

  it("today 子对象独立于 filter（切换 range/model 不变）", async () => {
    const { ctx, session } = await seedSession();
    const today0 = localDayStart(Date.now());
    const yesterday0 = localAddDays(today0, -1);
    await seedMsg(ctx, session.id, 1, {
      createdAtMs: today0 + 10 * MIN,
      modelName: "model-a",
      usage: { prompt: 10, completion: 5, total: 15 },
    });
    await seedMsg(ctx, session.id, 2, {
      createdAtMs: yesterday0 + 10 * MIN,
      modelName: "model-a",
      usage: { prompt: 20, completion: 10, total: 30 },
    });

    const svc = createUsageStatsService(ctx.conn);
    const s1 = await svc.getSummary({
      range: {
        kind: "custom",
        fromMs: yesterday0,
        toMs: localAddDays(today0, 1),
      },
      model: "model-a",
    });
    const s2 = await svc.getSummary({
      range: { kind: "custom", fromMs: yesterday0, toMs: today0 },
      model: null,
    });
    const expectedToday = { totalTokens: 15, calls: 1 };
    assert.deepEqual(s1.today, expectedToday);
    assert.deepEqual(s2.today, expectedToday);
  });

  it("listModels 含已记录模型、不含 null", async () => {
    const { ctx, session } = await seedSession();
    const now = Date.now();
    await seedMsg(ctx, session.id, 1, {
      createdAtMs: now,
      modelName: "model-b",
      usage: { prompt: 1 },
    });
    await seedMsg(ctx, session.id, 2, {
      createdAtMs: now,
      modelName: "model-a",
      usage: { prompt: 2 },
    });
    await seedMsg(ctx, session.id, 3, {
      createdAtMs: now,
      modelName: null,
      usage: { prompt: 3 },
    });

    const svc = createUsageStatsService(ctx.conn);
    assert.deepEqual(await svc.listModels(), ["model-a", "model-b"]);
  });

  it("last7 覆盖近 7 天（含今日），8 天前不计入；桶按本地日对齐", async () => {
    const { ctx, session } = await seedSession();
    const today0 = localDayStart(Date.now());
    await seedMsg(ctx, session.id, 1, {
      createdAtMs: today0 - 30 * MIN,
      usage: { prompt: 10, total: 10 },
    });
    await seedMsg(ctx, session.id, 2, {
      createdAtMs: localAddDays(today0, -8) + 10 * MIN,
      usage: { prompt: 99, total: 99 },
    });

    const svc = createUsageStatsService(ctx.conn);
    const summary = await svc.getSummary({ range: { kind: "last7" } });
    assert.equal(summary.calls, 1);
    assert.equal(summary.promptTokens, 10);

    const buckets = await svc.getDailyBuckets({ range: { kind: "last7" } });
    assert.equal(buckets.length, 8);
    assert.equal(buckets[0]!.bucketStartMs, localAddDays(today0, -7));
    assert.equal(buckets[7]!.bucketStartMs, today0);
  });

  it("custom 区间校验：缺参 / from > to / 跨度超 366 天均抛错", async () => {
    const { ctx } = await seedSession();
    const svc = createUsageStatsService(ctx.conn);
    const today0 = localDayStart(Date.now());
    await assert.rejects(
      svc.getSummary({ range: { kind: "custom" } }),
      ChatError,
    );
    await assert.rejects(
      svc.getSummary({
        range: { kind: "custom", fromMs: today0 + HOUR, toMs: today0 },
      }),
      ChatError,
    );
    await assert.rejects(
      svc.getSummary({
        range: {
          kind: "custom",
          fromMs: localAddDays(today0, -400),
          toMs: today0,
        },
      }),
      ChatError,
    );
  });

  it("hourly 对非法日期字符串抛错", async () => {
    const { ctx } = await seedSession();
    const svc = createUsageStatsService(ctx.conn);
    await assert.rejects(
      svc.getHourlyBuckets("2026-02-30", { range: { kind: "last7" } }),
      ChatError,
    );
    await assert.rejects(
      svc.getHourlyBuckets("not-a-date", { range: { kind: "last7" } }),
      ChatError,
    );
  });
});

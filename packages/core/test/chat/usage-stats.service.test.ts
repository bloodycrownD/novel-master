/**
 * T-S5（→ Step 5）：UsageStatsService 聚合服务。
 *
 * - 本地时区天边界：本地 00:30 消息入当日桶、昨日 23:30 入前一日桶（AC-3）；
 * - hourly 24 桶且桶边界按本地时区（AC-4 小时粒度）；
 * - hidden 行与子会话（parent_session_id 非空）行计入总和（AC-2 口径）；
 * - NULL usage 行、无 cache 行不入命中率分母；
 * - model_name 为 NULL 或不在已保存模型集合的行归「其他」桶；模型 × 时间组合过滤；
 * - getSummary 附带的 today 子对象独立于 filter；
 * - listModels 来自服务商配置的已保存模型（不 distinct 历史消息）；
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
import { daySpanBetweenLocalDays } from "../../src/service/chat/impl/usage-stats.service.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

// G-2 DST：固定日期断言需要可控时区。node:test 每个文件独立进程，在 fixture
// 初始化前把本地时区固定为带 DST 切换的 America/New_York；既有用例全部以
// 「本地今日 0 点 ± 偏移」相对构造，与具体时区取值无关，换时区后依然自洽。
process.env.TZ = "America/New_York";

novelMasterTestFixture();

// 统计查询扫全表，而 fixture 是整文件共享一条库：每个用例前清空消息表
// 与模型配置表隔离数据（llm_saved_model 外键引用 llm_provider，先删子表）。
beforeEach(async () => {
  const ctx = getNovelMasterTestContext();
  await ctx.conn.execute("DELETE FROM chat_message");
  await ctx.conn.execute("DELETE FROM llm_saved_model");
  await ctx.conn.execute("DELETE FROM llm_provider");
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
  providerId?: string | null;
  modelName?: string | null;
  hidden?: boolean;
  usage?: {
    prompt?: number;
    completion?: number;
    total?: number;
    cacheRead?: number;
    cacheCreation?: number;
    firstTokenMs?: number;
    durationMs?: number;
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
  seed: MsgSeed
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
          ...(u.firstTokenMs != null ? { firstTokenMs: u.firstTokenMs } : {}),
          ...(u.durationMs != null ? { durationMs: u.durationMs } : {}),
        };
  const message: ChatMessage = {
    id: randomUUID(),
    sessionId,
    seq,
    role: seed.role ?? "assistant",
    content: textBlocks("usage-stats-seed"),
    provider: seed.provider ?? null,
    providerId: seed.providerId ?? null,
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
      "usage-stats-child"
    );
    await ctx.conn.execute(
      `UPDATE chat_session SET parent_session_id = ? WHERE id = ?`,
      [session.id, childSession.id]
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

  it("「其他」桶：NULL 与非配置模型归并，配置模型独立", async () => {
    const { ctx, session } = await seedSession();
    const today0 = localDayStart(Date.now());
    // 历史行：未记录（null）、非配置模型（中转站标注名/已下线）、配置模型各一条。
    await seedMsg(ctx, session.id, 1, {
      createdAtMs: today0 + 10 * MIN,
      modelName: null,
      usage: { prompt: 10, total: 10 },
    });
    await seedMsg(ctx, session.id, 2, {
      createdAtMs: today0 + 20 * MIN,
      modelName: "[3]gemini-legacy",
      usage: { prompt: 20, total: 20 },
    });
    await seedMsg(ctx, session.id, 3, {
      createdAtMs: today0 + 30 * MIN,
      modelName: "model-a",
      usage: { prompt: 30, total: 5 },
    });
    // 服务商配置：仅 model-a 在已保存模型集合内。
    const ts = String(Date.now());
    await ctx.conn.execute(
      `INSERT INTO llm_provider (id, protocol, base_url, display_name, headers_json, is_builtin, created_at_ms, updated_at_ms)
       VALUES ('stats-other-provider', 'openai', 'https://example.com', 'Stats Other Provider', '{}', 0, ${ts}, ${ts})`
    );
    await ctx.conn.execute(
      `INSERT INTO llm_saved_model (id, provider_id, vendor_model_id, model_name, settings_json, created_at_ms, updated_at_ms)
       VALUES ('som-1', 'stats-other-provider', 'model-a', 'model-a', '{}', ${ts}, ${ts})`
    );

    const svc = createUsageStatsService(ctx.conn);
    const filter = {
      range: {
        kind: "custom" as const,
        fromMs: today0,
        toMs: localAddDays(today0, 1),
      },
    };
    // 非配置行与 null 行归并成一个「其他」行（用量相加），配置模型独立成行。
    const breakdown = await svc.getModelBreakdown(filter);
    assert.equal(breakdown.length, 2);
    const other = breakdown.find((r) => r.modelName === null);
    const modelA = breakdown.find((r) => r.modelName === "model-a");
    assert.ok(other, "breakdown 应含归并后的「其他」行");
    assert.ok(!breakdown.some((r) => r.modelName === "[3]gemini-legacy"));
    assert.ok(modelA);
    assert.equal(other!.calls, 2);
    assert.equal(other!.promptTokens, 30);
    assert.equal(other!.totalTokens, 30);
    assert.equal(modelA!.calls, 1);
    // 归并后仍按用量降序：「其他」30 在 model-a 5 之前。
    assert.equal(breakdown[0]!.modelName, null);

    // model: null → 只查「其他」桶（NULL + 非配置），不含配置模型行。
    const summaryNull = await svc.getSummary({ ...filter, model: null });
    assert.equal(summaryNull.calls, 2);
    assert.equal(summaryNull.promptTokens, 30);
  });

  it("无任何 saved model 时「其他」桶 = 全部行", async () => {
    const { ctx, session } = await seedSession();
    const today0 = localDayStart(Date.now());
    // beforeEach 已清空 llm_saved_model：所有非 NULL 模型均不在配置集合内。
    await seedMsg(ctx, session.id, 1, {
      createdAtMs: today0 + 10 * MIN,
      modelName: "model-a",
      usage: { prompt: 10, total: 10 },
    });
    await seedMsg(ctx, session.id, 2, {
      createdAtMs: today0 + 20 * MIN,
      modelName: "model-b",
      usage: { prompt: 20, total: 20 },
    });
    await seedMsg(ctx, session.id, 3, {
      createdAtMs: today0 + 30 * MIN,
      modelName: null,
      usage: { prompt: 5, total: 5 },
    });

    const svc = createUsageStatsService(ctx.conn);
    const filter = {
      range: {
        kind: "custom" as const,
        fromMs: today0,
        toMs: localAddDays(today0, 1),
      },
    };
    const summaryNull = await svc.getSummary({ ...filter, model: null });
    assert.equal(summaryNull.calls, 3);
    assert.equal(summaryNull.promptTokens, 35);

    const breakdown = await svc.getModelBreakdown(filter);
    assert.equal(breakdown.length, 1);
    assert.equal(breakdown[0]!.modelName, null);
    assert.equal(breakdown[0]!.calls, 3);
    assert.equal(breakdown[0]!.totalTokens, 35);
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

  it("listModels 来自服务商配置的已保存模型，不从历史消息 distinct", async () => {
    const { ctx, session } = await seedSession();
    const now = Date.now();
    // 历史消息里存在 model-legacy（已下线）与未记录行——不应出现在选项里。
    await seedMsg(ctx, session.id, 1, {
      createdAtMs: now,
      modelName: "model-legacy",
      usage: { prompt: 1 },
    });
    await seedMsg(ctx, session.id, 2, {
      createdAtMs: now,
      modelName: null,
      usage: { prompt: 3 },
    });
    // 服务商配置：model-b、model-a（同模型两个服务商，去重后一个）。
    const ts = String(now);
    await ctx.conn.execute(
      `INSERT INTO llm_provider (id, protocol, base_url, display_name, headers_json, is_builtin, created_at_ms, updated_at_ms)
       VALUES ('stats-provider', 'openai', 'https://example.com', 'Stats Provider', '{}', 0, ${ts}, ${ts})`
    );
    const insertModel = `INSERT INTO llm_saved_model (id, provider_id, vendor_model_id, model_name, settings_json, created_at_ms, updated_at_ms)
       VALUES (?, 'stats-provider', ?, ?, '{}', ${ts}, ${ts})`;
    await ctx.conn.execute(insertModel, ["sm-1", "model-b", "model-b"]);
    await ctx.conn.execute(insertModel, ["sm-2", "model-a", "model-a"]);
    await ctx.conn.execute(insertModel, ["sm-3", "model-b", "model-b"]);

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
      ChatError
    );
    await assert.rejects(
      svc.getSummary({
        range: { kind: "custom", fromMs: today0 + HOUR, toMs: today0 },
      }),
      ChatError
    );
    await assert.rejects(
      svc.getSummary({
        range: {
          kind: "custom",
          fromMs: localAddDays(today0, -400),
          toMs: today0,
        },
      }),
      ChatError
    );
  });

  it("hourly 对非法日期字符串抛错", async () => {
    const { ctx } = await seedSession();
    const svc = createUsageStatsService(ctx.conn);
    await assert.rejects(
      svc.getHourlyBuckets("2026-02-30", { range: { kind: "last7" } }),
      ChatError
    );
    await assert.rejects(
      svc.getHourlyBuckets("not-a-date", { range: { kind: "last7" } }),
      ChatError
    );
  });

  it("B-1: cache_read_tokens = 0 的行计入命中率分母（显式 0 ≠ 缺席）", async () => {
    const { ctx, session } = await seedSession();
    const today0 = localDayStart(Date.now());
    // OpenAI 渠道常态：cached_tokens 显式为 0（上报的「未命中」，非未上报）。
    await seedMsg(ctx, session.id, 1, {
      createdAtMs: today0 + 10 * MIN,
      provider: "openai",
      usage: { prompt: 100, total: 100, cacheRead: 0 },
    });
    // 对照：无 cache 字段的行不入分母（PRD 口径）。
    await seedMsg(ctx, session.id, 2, {
      createdAtMs: today0 + 20 * MIN,
      provider: "openai",
      usage: { prompt: 50, total: 50 },
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
    assert.equal(summary.cacheReadTokens, 0);
    // 0 值行入分母、无 cache 行不入：分母 = 100 而非 0，命中率不被抬高。
    assert.equal(summary.billedInputTokens, 100);
  });

  it("G-1: custom 区间 fromMs 落在日中（12 点）→ 首桶只含下午数据", async () => {
    const { ctx, session } = await seedSession();
    const today0 = localDayStart(Date.now());
    await seedMsg(ctx, session.id, 1, {
      createdAtMs: today0 + 11 * HOUR, // 上午 11 点：在筛选区间外。
      usage: { prompt: 11, total: 11 },
    });
    await seedMsg(ctx, session.id, 2, {
      createdAtMs: today0 + 13 * HOUR + 30 * MIN, // 下午 13:30：入首桶。
      usage: { prompt: 13, total: 13 },
    });

    const svc = createUsageStatsService(ctx.conn);
    const buckets = await svc.getDailyBuckets({
      range: {
        kind: "custom",
        fromMs: today0 + 12 * HOUR,
        toMs: localAddDays(today0, 1),
      },
    });
    // 首尾部分天取交集：只有今日一个桶，桶起点仍对齐本地日 0 点。
    assert.equal(buckets.length, 1);
    assert.equal(buckets[0]!.bucketStartMs, today0);
    assert.equal(buckets[0]!.calls, 1);
    assert.equal(buckets[0]!.promptTokens, 13);
  });

  it("G-1: custom 区间跨度恰好 366 天不抛错，桶数正确", async () => {
    const { ctx, session } = await seedSession();
    const today0 = localDayStart(Date.now());
    await seedMsg(ctx, session.id, 1, {
      createdAtMs: today0 + 10 * MIN,
      usage: { prompt: 5, total: 5 },
    });

    const svc = createUsageStatsService(ctx.conn);
    const range = {
      kind: "custom" as const,
      fromMs: localAddDays(today0, -365),
      toMs: localAddDays(today0, 1),
    };
    const summary = await svc.getSummary({ range });
    assert.equal(summary.calls, 1);
    // 跨度恰好 366 天（今日 0 点往回 365 天 + 今日全天）：不抛错；
    // 桶数 = 日历日数 366（D-365 … D 每天一桶）。
    const buckets = await svc.getDailyBuckets({ range });
    assert.equal(buckets.length, 366);
  });

  it("G-1: getModelBreakdown × model:null → 非 null 行全归并成一行", async () => {
    const { ctx, session } = await seedSession();
    const today0 = localDayStart(Date.now());
    await seedMsg(ctx, session.id, 1, {
      createdAtMs: today0 + 10 * MIN,
      modelName: null,
      usage: { prompt: 30, total: 30 },
    });
    await seedMsg(ctx, session.id, 2, {
      createdAtMs: today0 + 20 * MIN,
      modelName: "model-b",
      usage: { prompt: 20, total: 20 },
    });
    await seedMsg(ctx, session.id, 3, {
      createdAtMs: today0 + 30 * MIN,
      modelName: "model-a",
      usage: { prompt: 10, total: 10 },
    });
    // 服务商配置：仅 model-a 在已保存模型集合内。
    const ts = String(Date.now());
    await ctx.conn.execute(
      `INSERT INTO llm_provider (id, protocol, base_url, display_name, headers_json, is_builtin, created_at_ms, updated_at_ms)
       VALUES ('stats-null-model-provider', 'openai', 'https://example.com', 'Stats Null Model Provider', '{}', 0, ${ts}, ${ts})`
    );
    await ctx.conn.execute(
      `INSERT INTO llm_saved_model (id, provider_id, vendor_model_id, model_name, settings_json, created_at_ms, updated_at_ms)
       VALUES ('som-null-1', 'stats-null-model-provider', 'model-a', 'model-a', '{}', ${ts}, ${ts})`
    );

    const svc = createUsageStatsService(ctx.conn);
    // model: null = 「其他模型」筛选：NULL 行与非配置模型（model-b）行全部归并成一行。
    const breakdown = await svc.getModelBreakdown({
      range: {
        kind: "custom",
        fromMs: today0,
        toMs: localAddDays(today0, 1),
      },
      model: null,
    });
    assert.equal(breakdown.length, 1);
    const row = breakdown[0]!;
    assert.equal(row.modelName, null);
    assert.equal(row.calls, 2);
    assert.equal(row.promptTokens, 50);
    assert.equal(row.totalTokens, 50);
  });

  it("G-1b: provider×model 维度——同名模型跨服务商分列，providerId 筛选与 null 其他桶", async () => {
    const { ctx, session } = await seedSession();
    const today0 = localDayStart(Date.now());
    // 同名 model-a 分属两个服务商；另一条为未记录服务商（provider_id NULL）
    // 的历史行，模型名也不在配置集合 → 归「未记录×其他」。
    await seedMsg(ctx, session.id, 1, {
      createdAtMs: today0 + 10 * MIN,
      providerId: "stats-px",
      modelName: "model-a",
      usage: { prompt: 40, total: 40 },
    });
    await seedMsg(ctx, session.id, 2, {
      createdAtMs: today0 + 20 * MIN,
      providerId: "stats-py",
      modelName: "model-a",
      usage: { prompt: 25, total: 25 },
    });
    await seedMsg(ctx, session.id, 3, {
      createdAtMs: today0 + 30 * MIN,
      providerId: null,
      modelName: "model-legacy",
      usage: { prompt: 10, total: 10 },
    });
    const ts = String(Date.now());
    for (const pid of ["stats-px", "stats-py"]) {
      await ctx.conn.execute(
        `INSERT INTO llm_provider (id, protocol, base_url, display_name, headers_json, is_builtin, created_at_ms, updated_at_ms)
         VALUES ('${pid}', 'openai', 'https://example.com', '${pid}', '{}', 0, ${ts}, ${ts})`
      );
    }
    await ctx.conn.execute(
      `INSERT INTO llm_saved_model (id, provider_id, vendor_model_id, model_name, settings_json, created_at_ms, updated_at_ms)
       VALUES ('som-pm-1', 'stats-px', 'model-a', 'model-a', '{}', ${ts}, ${ts})`
    );

    const svc = createUsageStatsService(ctx.conn);
    const range = {
      kind: "custom" as const,
      fromMs: today0,
      toMs: localAddDays(today0, 1),
    };
    // 无筛选：三行分列（同名模型按服务商拆开；未记录行独立）。
    const breakdown = await svc.getModelBreakdown({ range });
    assert.equal(breakdown.length, 3);
    const px = breakdown.find(
      (r) => r.providerId === "stats-px" && r.modelName === "model-a"
    );
    const py = breakdown.find(
      (r) => r.providerId === "stats-py" && r.modelName === "model-a"
    );
    const unlogged = breakdown.find(
      (r) => r.providerId === null && r.modelName === null
    );
    assert.ok(
      px && py && unlogged,
      `breakdown 应三行分列，实际 ${JSON.stringify(breakdown)}`
    );
    assert.equal(px!.totalTokens, 40);
    assert.equal(py!.totalTokens, 25);
    assert.equal(unlogged!.totalTokens, 10);

    // providerId 筛选：只看 stats-py。
    const filtered = await svc.getModelBreakdown({
      range,
      providerId: "stats-py",
    });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]!.providerId, "stats-py");
    assert.equal(filtered[0]!.totalTokens, 25);

    // providerId:null → 只剩未记录的历史行。
    const nullFiltered = await svc.getModelBreakdown({
      range,
      providerId: null,
    });
    assert.equal(nullFiltered.length, 1);
    assert.equal(nullFiltered[0]!.providerId, null);
    assert.equal(nullFiltered[0]!.totalTokens, 10);
  });

  it("CR-2: providerId:null（model 不筛）可筛出「未记录服务商 × 已配置模型」存量行", async () => {
    const { ctx, session } = await seedSession();
    const today0 = localDayStart(Date.now());
    // 两行：已记录服务商 × 已配置模型，以及未记录服务商（provider_id NULL）
    // × 已配置模型——后者是旧「其他模型」口径（model:null）筛不中的存量行，
    // mobile 方案 A 的 provider 维度语义必须能筛出。
    await seedMsg(ctx, session.id, 1, {
      createdAtMs: today0 + 10 * MIN,
      providerId: "stats-cr2-p1",
      modelName: "model-a",
      usage: { prompt: 40, total: 40 },
    });
    await seedMsg(ctx, session.id, 2, {
      createdAtMs: today0 + 20 * MIN,
      providerId: null,
      modelName: "model-a",
      usage: { prompt: 10, total: 10 },
    });
    const ts = String(Date.now());
    await ctx.conn.execute(
      `INSERT INTO llm_provider (id, protocol, base_url, display_name, headers_json, is_builtin, created_at_ms, updated_at_ms)
       VALUES ('stats-cr2-p1', 'openai', 'https://example.com', 'CR2 P1', '{}', 0, ${ts}, ${ts})`
    );
    // model-a 进入已保存模型集合（全局 distinct，不分服务商）。
    await ctx.conn.execute(
      `INSERT INTO llm_saved_model (id, provider_id, vendor_model_id, model_name, settings_json, created_at_ms, updated_at_ms)
       VALUES ('som-cr2-1', 'stats-cr2-p1', 'model-a', 'model-a', '{}', ${ts}, ${ts})`
    );

    const svc = createUsageStatsService(ctx.conn);
    const range = {
      kind: "custom" as const,
      fromMs: today0,
      toMs: localAddDays(today0, 1),
    };
    // 旧口径佐证：model-a 在配置集内，model:null 的 NOT IN 子句筛不中未记录行。
    const legacyStyle = await svc.getModelBreakdown({
      range,
      model: null,
      providerId: null,
    });
    assert.equal(legacyStyle.length, 0);
    // 方案 A：model: undefined（不加模型子句）+ providerId: null
    // （provider_id IS NULL）→ 未记录 × 已配置模型的行可被筛出。
    const breakdown = await svc.getModelBreakdown({
      range,
      model: undefined,
      providerId: null,
    });
    assert.equal(breakdown.length, 1);
    assert.equal(breakdown[0]!.providerId, null);
    assert.equal(breakdown[0]!.modelName, "model-a");
    assert.equal(breakdown[0]!.totalTokens, 10);
  });

  it("CR-2: model:null + providerId:P 可筛出「P × 未配置模型」存量行", async () => {
    const { ctx, session } = await seedSession();
    const today0 = localDayStart(Date.now());
    // 三行：P 的未配置模型（目标行）、P 的已配置模型（被 NOT IN 子句排除）、
    // 未记录服务商的同名未配置模型（被 provider 子句排除）。
    await seedMsg(ctx, session.id, 1, {
      createdAtMs: today0 + 10 * MIN,
      providerId: "stats-cr2-p2",
      modelName: "model-legacy",
      usage: { prompt: 40, total: 40 },
    });
    await seedMsg(ctx, session.id, 2, {
      createdAtMs: today0 + 20 * MIN,
      providerId: "stats-cr2-p2",
      modelName: "model-cfg",
      usage: { prompt: 25, total: 25 },
    });
    await seedMsg(ctx, session.id, 3, {
      createdAtMs: today0 + 30 * MIN,
      providerId: null,
      modelName: "model-legacy",
      usage: { prompt: 10, total: 10 },
    });
    const ts = String(Date.now());
    await ctx.conn.execute(
      `INSERT INTO llm_provider (id, protocol, base_url, display_name, headers_json, is_builtin, created_at_ms, updated_at_ms)
       VALUES ('stats-cr2-p2', 'openai', 'https://example.com', 'CR2 P2', '{}', 0, ${ts}, ${ts})`
    );
    // 配置集内只放 model-cfg：model-legacy 成为「未配置模型」。
    await ctx.conn.execute(
      `INSERT INTO llm_saved_model (id, provider_id, vendor_model_id, model_name, settings_json, created_at_ms, updated_at_ms)
       VALUES ('som-cr2-2', 'stats-cr2-p2', 'model-cfg', 'model-cfg', '{}', ${ts}, ${ts})`
    );

    const svc = createUsageStatsService(ctx.conn);
    const breakdown = await svc.getModelBreakdown({
      range: {
        kind: "custom",
        fromMs: today0,
        toMs: localAddDays(today0, 1),
      },
      model: null,
      providerId: "stats-cr2-p2",
    });
    // 只剩「P × 未配置模型」一行：provider 子句挡掉未记录行，
    // NOT IN 子句挡掉 P 的已配置模型行；model-legacy 不在配置集，
    // 输出侧按展示口径归并为 modelName: null（用量仍在）。
    assert.equal(breakdown.length, 1);
    assert.equal(breakdown[0]!.providerId, "stats-cr2-p2");
    assert.equal(breakdown[0]!.modelName, null);
    assert.equal(breakdown[0]!.totalTokens, 40);
  });

  it("G-2: daySpanBetweenLocalDays 对 DST 23/25 小时天做 Math.round 补偿", () => {
    const DAY = 86_400_000;
    const H = 3_600_000;
    // 常规日 24h → 1 天。
    assert.equal(daySpanBetweenLocalDays(0, DAY), 1);
    // 春季拨快日（日 0 点差 23h）与秋季拨慢日（25h）：round 后均为 1 天。
    assert.equal(daySpanBetweenLocalDays(0, 23 * H), 1);
    assert.equal(daySpanBetweenLocalDays(0, 25 * H), 1);
    // 常规天 + 拨快天 = 47h → 2 天；常规 + 拨慢 + 常规 = 73h → 3 天。
    assert.equal(daySpanBetweenLocalDays(0, 47 * H), 2);
    assert.equal(daySpanBetweenLocalDays(0, 73 * H), 3);
    // 366 天上限：整 366 天合法；跨 DST 的 366 个日历日（毫秒差 ± 1h）仍为 366。
    assert.equal(daySpanBetweenLocalDays(0, 366 * DAY), 366);
    assert.equal(daySpanBetweenLocalDays(0, 366 * DAY + 2 * H), 366);
  });

  it("G-2 DST: 春季拨快日（2026-03-08 NYC）缺失钟点出空桶、桶数仍 24", async () => {
    const { ctx, session } = await seedSession();
    // 02:00 不存在（拨快到 03:00）；seed 一条 03:10 的消息。
    await seedMsg(ctx, session.id, 1, {
      createdAtMs: new Date(2026, 2, 8, 3, 10).getTime(),
      usage: { prompt: 7, total: 7 },
    });

    const svc = createUsageStatsService(ctx.conn);
    const buckets = await svc.getHourlyBuckets("2026-03-08", {
      range: { kind: "last7" },
    });
    assert.equal(buckets.length, 24);
    // 缺失钟点（本地 2 点）退化为零值空桶，bucketStartMs 与下一桶重合
    //（Date 构造器把不存在的 02:00 折叠到 03:00）。
    assert.equal(buckets[2]!.calls, 0);
    assert.equal(buckets[2]!.bucketStartMs, buckets[3]!.bucketStartMs);
    // 03 点桶含 seed 的 03:10 消息。
    assert.equal(buckets[3]!.calls, 1);
    assert.equal(buckets[3]!.promptTokens, 7);
  });

  it("G-2 DST: 秋季拨慢日（2026-11-01 NYC）重复钟点桶加宽（25 小时天）", async () => {
    const { ctx, session } = await seedSession();
    // 两次本地 01:10：EDT 一次（05:10 UTC，Date 构造器取第一次出现）与 EST 一次（06:10 UTC）。
    await seedMsg(ctx, session.id, 1, {
      createdAtMs: new Date(2026, 10, 1, 1, 10).getTime(),
      usage: { prompt: 1, total: 1 },
    });
    await seedMsg(ctx, session.id, 2, {
      createdAtMs: Date.UTC(2026, 10, 1, 6, 10),
      usage: { prompt: 2, total: 2 },
    });

    const svc = createUsageStatsService(ctx.conn);
    const buckets = await svc.getHourlyBuckets("2026-11-01", {
      range: { kind: "last7" },
    });
    assert.equal(buckets.length, 24);
    // 重复钟点（本地 1 点）桶加宽：1 点桶（01:00 EDT 起）到 2 点桶（02:00 EST 起）跨 2 小时。
    assert.equal(
      buckets[2]!.bucketStartMs - buckets[1]!.bucketStartMs,
      2 * HOUR
    );
    assert.equal(buckets[1]!.bucketStartMs - buckets[0]!.bucketStartMs, HOUR);
    // 两个 01:10 实例都落在加宽的 1 点桶里。
    assert.equal(buckets[1]!.calls, 2);
    assert.equal(buckets[1]!.promptTokens, 3);
  });
});

describe("usage stats service 速率/TTFT 聚合（T-US2/3/4）", () => {
  it("聚合速率口径：加权 SUM/SUM，NULL 与零分母行不入；avgFirstTokenMs 含非流式行（T-US2）", async () => {
    const { ctx, session } = await seedSession();
    const today0 = localDayStart(Date.now());
    // 行 1：有效行（流式）—— completion 900，生成时长 3500-500=3000ms → 900/3 = 300 tok/s
    await seedMsg(ctx, session.id, 1, {
      createdAtMs: today0 + 10 * MIN,
      usage: {
        prompt: 100,
        completion: 900,
        total: 1000,
        firstTokenMs: 500,
        durationMs: 3500,
      },
    });
    // 行 2：非流式行（first=duration）—— 入 TTFT 均值，不入速率分母
    await seedMsg(ctx, session.id, 2, {
      createdAtMs: today0 + 11 * MIN,
      usage: {
        prompt: 50,
        completion: 100,
        total: 150,
        firstTokenMs: 2000,
        durationMs: 2000,
      },
    });
    // 行 3：旧数据（耗时全 NULL）—— 不入任何新指标
    await seedMsg(ctx, session.id, 3, {
      createdAtMs: today0 + 12 * MIN,
      usage: { prompt: 30, completion: 60, total: 90 },
    });

    const svc = createUsageStatsService(ctx.conn);
    const summary = await svc.getSummary({
      range: {
        kind: "custom",
        fromMs: today0,
        toMs: localAddDays(today0, 1),
      },
    });
    // 速率 = 900 / (3500-500)/1000 = 300 tok/s（仅有效行）
    assert.equal(summary.avgTokensPerSecond, 300);
    // TTFT 均值 = AVG(500, 2000) = 1250（NULL 行忽略，非流式行计入）
    assert.equal(summary.avgFirstTokenMs, 1250);
    // token 各汇总值不受新指标影响（三行全计）
    assert.equal(summary.calls, 3);
    assert.equal(summary.promptTokens, 180);
    assert.equal(summary.completionTokens, 1060);
    assert.equal(summary.totalTokens, 1240);
  });

  it("全为存量 NULL 行时两新指标返回 null，token 汇总不变（T-US3）", async () => {
    const { ctx, session } = await seedSession();
    const today0 = localDayStart(Date.now());
    await seedMsg(ctx, session.id, 1, {
      createdAtMs: today0 + 10 * MIN,
      usage: { prompt: 100, completion: 200, total: 300 },
    });
    await seedMsg(ctx, session.id, 2, {
      createdAtMs: today0 + 11 * MIN,
      usage: { prompt: 10, completion: 20, total: 30 },
    });

    const svc = createUsageStatsService(ctx.conn);
    const summary = await svc.getSummary({
      range: {
        kind: "custom",
        fromMs: today0,
        toMs: localAddDays(today0, 1),
      },
    });
    assert.equal(summary.avgFirstTokenMs, null);
    assert.equal(summary.avgTokensPerSecond, null);
    assert.equal(summary.calls, 2);
    assert.equal(summary.totalTokens, 330);
  });

  it("daily/hourly 桶的新指标随桶正确切分，空桶为零值 + 双 null（T-US4）", async () => {
    const { ctx, session } = await seedSession();
    const today0 = localDayStart(Date.now());
    const yesterday0 = localAddDays(today0, -1);
    // 今天：有效行 → 600/(4000-1000)/1000*1000... 计算：completion 600，生成 3000ms → 200 tok/s
    await seedMsg(ctx, session.id, 1, {
      createdAtMs: today0 + 14 * HOUR,
      usage: {
        prompt: 80,
        completion: 600,
        total: 680,
        firstTokenMs: 1000,
        durationMs: 4000,
      },
    });
    // 昨天：另一条有效行 → completion 300，生成 1500ms → 200 tok/s；TTFT 300
    await seedMsg(ctx, session.id, 2, {
      createdAtMs: yesterday0 + 9 * HOUR,
      usage: {
        prompt: 40,
        completion: 300,
        total: 340,
        firstTokenMs: 300,
        durationMs: 1800,
      },
    });

    const svc = createUsageStatsService(ctx.conn);
    const daily = await svc.getDailyBuckets({
      range: {
        kind: "custom",
        fromMs: yesterday0,
        toMs: localAddDays(today0, 1),
      },
    });
    assert.equal(daily.length, 2);
    const todayBucket = daily.find((b) => b.bucketStartMs === today0);
    const yesterdayBucket = daily.find((b) => b.bucketStartMs === yesterday0);
    assert.ok(todayBucket);
    assert.ok(yesterdayBucket);
    assert.equal(todayBucket!.avgTokensPerSecond, 200);
    assert.equal(todayBucket!.avgFirstTokenMs, 1000);
    assert.equal(yesterdayBucket!.avgTokensPerSecond, 200);
    assert.equal(yesterdayBucket!.avgFirstTokenMs, 300);

    // hourly：今天 14 点桶有效，其余 23 个空桶 calls=0 + 双 null
    const hourly = await svc.getHourlyBuckets(fmtLocalDay(today0), {
      range: { kind: "last7" },
    });
    assert.equal(hourly.length, 24);
    const hour14 = hourly.find((b) => b.bucketStartMs === today0 + 14 * HOUR);
    assert.ok(hour14);
    assert.equal(hour14!.calls, 1);
    assert.equal(hour14!.avgTokensPerSecond, 200);
    assert.equal(hour14!.avgFirstTokenMs, 1000);
    for (const [i, b] of hourly.entries()) {
      if (b.bucketStartMs === today0 + 14 * HOUR) {
        continue;
      }
      assert.equal(b.calls, 0, `桶 ${i} 应为空`);
      assert.equal(b.avgFirstTokenMs, null, `桶 ${i} TTFT 应为 null`);
      assert.equal(b.avgTokensPerSecond, null, `桶 ${i} 速率应为 null`);
    }
  });

  it("listRequestUsage 流水分页：时间倒序、分页与总数、模型筛选同口径", async () => {
    const { ctx, session } = await seedSession();
    // seed 已保存模型 model-a：「其他」桶口径 = null 或不在配置集内
    const ts = String(Date.now());
    await ctx.conn.execute(
      `INSERT INTO llm_provider (id, protocol, base_url, display_name, headers_json, is_builtin, created_at_ms, updated_at_ms)
       VALUES ('reqlog-provider', 'openai', 'https://example.com', 'reqlog-p', '{}', 0, ${ts}, ${ts})`
    );
    await ctx.conn.execute(
      `INSERT INTO llm_saved_model (id, provider_id, vendor_model_id, model_name, settings_json, created_at_ms, updated_at_ms)
       VALUES ('som-reqlog-1', 'reqlog-provider', 'model-a', 'model-a', '{}', ${ts}, ${ts})`
    );
    const svc = createUsageStatsService(ctx.conn);
    const now = Date.now();
    // 5 条 usage 行（时间递增 seed）+ 1 条无 usage 行（不入流水）
    for (let i = 0; i < 5; i++) {
      await seedMsg(ctx, session.id, i + 1, {
        createdAtMs: now - (5 - i) * 60_000,
        modelName: i === 0 ? null : "model-a",
        usage: {
          prompt: 100 + i,
          completion: 10 + i,
          total: 110 + 2 * i,
          firstTokenMs: 200,
          durationMs: 2000,
        },
      });
    }
    await seedMsg(ctx, session.id, 9, {
      createdAtMs: now,
      modelName: "model-a",
      usage: null,
    });
    const page1 = await svc.listRequestUsage(
      { range: { kind: "last7" } },
      { offset: 0, limit: 3 }
    );
    assert.equal(page1.total, 5);
    assert.equal(page1.rows.length, 3);
    // 时间倒序：最新在前
    assert.ok(page1.rows[0]!.createdAtMs >= page1.rows[1]!.createdAtMs);
    assert.equal(page1.rows[0]!.completionTokens, 14);
    const page2 = await svc.listRequestUsage(
      { range: { kind: "last7" } },
      { offset: 3, limit: 3 }
    );
    assert.equal(page2.rows.length, 2);
    assert.ok(page2.rows[0]!.createdAtMs >= page2.rows[1]!.createdAtMs);
    // 越界页空
    const page3 = await svc.listRequestUsage(
      { range: { kind: "last7" } },
      { offset: 9, limit: 3 }
    );
    assert.equal(page3.rows.length, 0);
    // 模型筛选：只 model-a（排除 null 行）→ 4 条
    const filtered = await svc.listRequestUsage(
      { range: { kind: "last7" }, model: "model-a" },
      { offset: 0, limit: 50 }
    );
    assert.equal(filtered.total, 4);
    for (const row of filtered.rows) {
      assert.equal(row.modelName, "model-a");
    }
    // 「其他」桶（null model）→ 1 条
    const others = await svc.listRequestUsage(
      { range: { kind: "last7" }, model: null },
      { offset: 0, limit: 50 }
    );
    assert.equal(others.total, 1);
    assert.equal(others.rows[0]!.modelName, null);
    // 非法 limit 拒收
    await assert.rejects(
      () =>
        svc.listRequestUsage(
          { range: { kind: "last7" } },
          { offset: 0, limit: 0 }
        ),
      /limit/
    );
  });

  it("listRequestUsage 分页 offset 非有限数值（NaN/±Infinity）拒收，不触达 SQL（B-2）", async () => {
    const { ctx } = await seedSession();
    const svc = createUsageStatsService(ctx.conn);
    for (const offset of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      await assert.rejects(
        () =>
          svc.listRequestUsage(
            { range: { kind: "last7" } },
            { offset, limit: 10 }
          ),
        /offset/
      );
    }
  });
});

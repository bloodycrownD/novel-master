/**
 * Usage stats IPC handler（spec T-S6 的 handler 部分）：
 * - 五种 kind 各自转发到 rt.usageStats 对应方法（filter / dayLocalDate 参数透传）；
 * - core 返回体 → shared DTO 显式映射（含 today 子对象透传、modelName null 透传）；
 * - service 抛错时经 formatIpcError 包成 IpcResult error 形态。
 *
 * runtime mock 走 module hook：先把 desktop-runtime-singleton 重定向到
 * usage-stats-runtime-stub.mjs（从 globalThis 取 stub runtime），再动态导入 handler，
 * 与 fetch-models-modal.test.tsx 的 register-then-import 范式一致。
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import { describe, it } from "node:test";

import type { UsageStatsFilterDto } from "../shared/ipc-types.js";

register(new URL("./usage-stats-runtime-hook.mjs", import.meta.url));
const { handleUsageStatsQuery } = await import(
  "../src/main/ipc/handlers/usage-stats.js"
);

/** stub service 的 core 返回体样例（字段与 core UsageStats* 一致）。 */
const SUMMARY = {
  calls: 12,
  promptTokens: 1000,
  completionTokens: 2000,
  totalTokens: 3000,
  cacheReadTokens: 400,
  cacheCreationTokens: 600,
  billedInputTokens: 2000,
  avgFirstTokenMs: 850.5,
  avgTokensPerSecond: 42.25,
  today: { totalTokens: 550, calls: 3 },
};

const BUCKETS = [
  {
    bucketStartMs: 1_800_000_000_000,
    calls: 2,
    promptTokens: 100,
    completionTokens: 200,
    cacheReadTokens: 40,
    cacheCreationTokens: 60,
    billedInputTokens: 200,
    avgFirstTokenMs: 620,
    avgTokensPerSecond: 33.5,
  },
  {
    bucketStartMs: 1_800_086_400_000,
    calls: 1,
    promptTokens: 10,
    completionTokens: 20,
    cacheReadTokens: 4,
    cacheCreationTokens: 6,
    billedInputTokens: 20,
    // 存量 NULL 行：两新指标 null 保真透传
    avgFirstTokenMs: null,
    avgTokensPerSecond: null,
  },
];

const MODEL_ROWS = [
  {
    modelName: null,
    calls: 5,
    promptTokens: 500,
    completionTokens: 600,
    totalTokens: 1100,
    cacheReadTokens: 0,
    billedInputTokens: 500,
  },
  {
    modelName: "gpt-4o",
    calls: 7,
    promptTokens: 500,
    completionTokens: 1400,
    totalTokens: 1900,
    cacheReadTokens: 400,
    billedInputTokens: 500,
  },
];

interface RecordedCall {
  method: string;
  args: unknown[];
}

/** 记录调用并返回样例数据的 stub service；getSummary 抛错可注入。 */
function makeStubUsageStats(
  calls: RecordedCall[],
  summaryError?: Error,
): {
  usageStats: unknown;
} {
  const usageStats = {
    getSummary: async (filter: unknown) => {
      calls.push({ method: "getSummary", args: [filter] });
      if (summaryError) {
        throw summaryError;
      }
      return SUMMARY;
    },
    getDailyBuckets: async (filter: unknown) => {
      calls.push({ method: "getDailyBuckets", args: [filter] });
      return BUCKETS;
    },
    getHourlyBuckets: async (dayLocalDate: string, filter: unknown) => {
      calls.push({ method: "getHourlyBuckets", args: [dayLocalDate, filter] });
      return BUCKETS;
    },
    getModelBreakdown: async (filter: unknown) => {
      calls.push({ method: "getModelBreakdown", args: [filter] });
      return MODEL_ROWS;
    },
    listModels: async () => {
      calls.push({ method: "listModels", args: [] });
      return ["gpt-4o", "claude-3-5-sonnet"];
    },
  };
  return { usageStats };
}

/** 挂 stub runtime 到 globalThis（hook 替身从这里取），返回记录数组。 */
function installStubRuntime(summaryError?: Error): RecordedCall[] {
  const calls: RecordedCall[] = [];
  const g = globalThis as unknown as {
    __usageStatsTestRuntime?: unknown;
  };
  g.__usageStatsTestRuntime = makeStubUsageStats(calls, summaryError);
  return calls;
}

const LAST7_FILTER: UsageStatsFilterDto = { range: { kind: "last7" } };

describe("usage stats IPC handler（T-S6）", () => {
  it("kind=summary 转发 getSummary，DTO 含 today 子对象透传", async () => {
    const calls = installStubRuntime();
    const res = await handleUsageStatsQuery({
      kind: "summary",
      filter: LAST7_FILTER,
    });
    assert.equal(res.ok, true);
    if (!res.ok) {
      return;
    }
    assert.deepEqual(res.data, {
      calls: 12,
      promptTokens: 1000,
      completionTokens: 2000,
      totalTokens: 3000,
      cacheReadTokens: 400,
      cacheCreationTokens: 600,
      billedInputTokens: 2000,
      avgFirstTokenMs: 850.5,
      avgTokensPerSecond: 42.25,
      today: { totalTokens: 550, calls: 3 },
    });
    assert.deepEqual(calls, [
      { method: "getSummary", args: [{ range: { kind: "last7" } }] },
    ]);
  });

  it("kind=daily 转发 getDailyBuckets，bucket 数组逐字段映射（model:null 三态保留）", async () => {
    const calls = installStubRuntime();
    const res = await handleUsageStatsQuery({
      kind: "daily",
      filter: { range: { kind: "last30" }, model: null },
    });
    assert.equal(res.ok, true);
    if (!res.ok) {
      return;
    }
    assert.deepEqual(res.data, BUCKETS);
    assert.deepEqual(calls, [
      {
        method: "getDailyBuckets",
        args: [{ range: { kind: "last30" }, model: null }],
      },
    ]);
  });

  it("kind=hourly 转发 getHourlyBuckets，dayLocalDate 作为首参透传", async () => {
    const calls = installStubRuntime();
    const res = await handleUsageStatsQuery({
      kind: "hourly",
      filter: LAST7_FILTER,
      dayLocalDate: "2026-08-23",
    });
    assert.equal(res.ok, true);
    assert.deepEqual(calls, [
      {
        method: "getHourlyBuckets",
        args: ["2026-08-23", { range: { kind: "last7" } }],
      },
    ]);
  });

  it("kind=hourly 缺 dayLocalDate 时传空串（由服务层日期校验拒绝）", async () => {
    const calls = installStubRuntime();
    const res = await handleUsageStatsQuery({
      kind: "hourly",
      filter: LAST7_FILTER,
    });
    assert.equal(res.ok, true);
    assert.deepEqual(calls, [
      {
        method: "getHourlyBuckets",
        args: ["", { range: { kind: "last7" } }],
      },
    ]);
  });

  it("kind=modelBreakdown 转发 getModelBreakdown，modelName null 透传 + custom 区间参数", async () => {
    const calls = installStubRuntime();
    const res = await handleUsageStatsQuery({
      kind: "modelBreakdown",
      filter: {
        range: { kind: "custom", fromMs: 1, toMs: 2 },
        model: "gpt-4o",
      },
    });
    assert.equal(res.ok, true);
    if (!res.ok) {
      return;
    }
    assert.deepEqual(res.data, MODEL_ROWS);
    assert.deepEqual(calls, [
      {
        method: "getModelBreakdown",
        args: [
          {
            range: { kind: "custom", fromMs: 1, toMs: 2 },
            model: "gpt-4o",
          },
        ],
      },
    ]);
  });

  it("kind=models 转发 listModels，字符串数组原样返回", async () => {
    const calls = installStubRuntime();
    const res = await handleUsageStatsQuery({
      kind: "models",
      filter: LAST7_FILTER,
    });
    assert.equal(res.ok, true);
    if (!res.ok) {
      return;
    }
    assert.deepEqual(res.data, ["gpt-4o", "claude-3-5-sonnet"]);
    assert.deepEqual(calls, [{ method: "listModels", args: [] }]);
  });

  it("新指标字段显式透传且 null 保真：summary 有值 / bucket 存量 null（T-IP1）", async () => {
    const calls = installStubRuntime();
    const summaryRes = await handleUsageStatsQuery({
      kind: "summary",
      filter: LAST7_FILTER,
    });
    assert.equal(summaryRes.ok, true);
    if (!summaryRes.ok) {
      return;
    }
    const summary = summaryRes.data;
    assert.equal(
      typeof summary === "object" && summary != null && "today" in summary,
      true,
    );
    if (typeof summary === "object" && summary != null && "today" in summary) {
      assert.equal(summary.avgFirstTokenMs, 850.5);
      assert.equal(summary.avgTokensPerSecond, 42.25);
    }

    const dailyRes = await handleUsageStatsQuery({
      kind: "daily",
      filter: LAST7_FILTER,
    });
    assert.equal(dailyRes.ok, true);
    if (!dailyRes.ok) {
      return;
    }
    assert.ok(Array.isArray(dailyRes.data));
    if (Array.isArray(dailyRes.data)) {
      const [withValues, legacyNull] = dailyRes.data;
      assert.equal(withValues.avgFirstTokenMs, 620);
      assert.equal(withValues.avgTokensPerSecond, 33.5);
      assert.equal(legacyNull.avgFirstTokenMs, null);
      assert.equal(legacyNull.avgTokensPerSecond, null);
    }
    assert.equal(calls.length, 2);
  });

  it("service 抛 ChatError 时返回 IpcResult error 形态（code/message 透传）", async () => {
    // 构造带 domain code 的 ChatError 形状（core 主入口未导出该类，
    // formatIpcError 按 name ∈ TYPED_ERROR_NAMES + code 字段识别）
    const chatError = Object.assign(
      new Error("自定义区间缺少 fromMs/toMs"),
      { name: "ChatError", code: "INVALID_ARGUMENT" },
    );
    const calls = installStubRuntime(chatError);
    const res = await handleUsageStatsQuery({
      kind: "summary",
      filter: { range: { kind: "custom" } },
    });
    assert.deepEqual(res, {
      ok: false,
      error: {
        code: "INVALID_ARGUMENT",
        message: "自定义区间缺少 fromMs/toMs",
      },
    });
    assert.equal(calls.length, 1);
  });
});

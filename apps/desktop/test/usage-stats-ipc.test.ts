/**
 * Usage stats IPC handler（spec T-S6 的 handler 部分）：
 * - 五种 kind 各自转发到 rt.usageStats 对应方法（filter / dayLocalDate 参数透传）；
 * - core 返回体 → shared DTO 显式映射（新指标 null 保真透传、modelName null 透传）；
 * - modelBreakdown 的 provider×model 复合行原样透传（不按 modelName 归并——饼图以
 *   复合维度展示，同名模型多服务商保持多行）；
 * - range 区间校验（格式 / 02-30 溢出 / fromDay ≤ toDay）在 IPC 边界先行拒绝；
 * - filter 无 range 时透传为无 range 的 core filter（summary/requests 等全历史语义）；
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
    providerId: null,
    modelName: null,
    calls: 5,
    promptTokens: 500,
    completionTokens: 600,
    totalTokens: 1100,
    cacheReadTokens: 0,
    billedInputTokens: 500,
  },
  {
    providerId: "p1",
    modelName: "gpt-4o",
    calls: 7,
    promptTokens: 500,
    completionTokens: 1400,
    totalTokens: 1900,
    cacheReadTokens: 400,
    billedInputTokens: 500,
  },
];

const REQUEST_PAGE = {
  rows: [
    {
      createdAtMs: 1_800_000_000_000,
      modelName: "gpt-4o",
      promptTokens: 100,
      completionTokens: 200,
      totalTokens: 300,
      cacheReadTokens: 40,
      cacheCreationTokens: 60,
      firstTokenMs: 620,
      durationMs: 8_000,
    },
    {
      createdAtMs: 1_799_900_000_000,
      // 存量 NULL 行：timing/cache 字段 null 保真透传
      modelName: null,
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      cacheReadTokens: null,
      cacheCreationTokens: null,
      firstTokenMs: null,
      durationMs: null,
    },
  ],
  total: 12,
};

interface RecordedCall {
  method: string;
  args: unknown[];
}

/** 记录调用并返回样例数据的 stub service；getSummary 抛错可注入，modelBreakdown 返回体可注入。 */
function makeStubUsageStats(
  calls: RecordedCall[],
  summaryError?: Error,
  modelRows?: unknown[]
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
      return modelRows ?? MODEL_ROWS;
    },
    listModels: async () => {
      calls.push({ method: "listModels", args: [] });
      return ["gpt-4o", "claude-3-5-sonnet"];
    },
    listRequestUsage: async (filter: unknown, page: unknown) => {
      calls.push({ method: "listRequestUsage", args: [filter, page] });
      return REQUEST_PAGE;
    },
  };
  return { usageStats };
}

/** 挂 stub runtime 到 globalThis（hook 替身从这里取），返回记录数组。 */
function installStubRuntime(
  summaryError?: Error,
  modelRows?: unknown[]
): RecordedCall[] {
  const calls: RecordedCall[] = [];
  const g = globalThis as unknown as {
    __usageStatsTestRuntime?: unknown;
  };
  g.__usageStatsTestRuntime = makeStubUsageStats(
    calls,
    summaryError,
    modelRows
  );
  return calls;
}

const RANGE_FILTER: UsageStatsFilterDto = {
  range: { fromDay: "2026-08-24", toDay: "2026-08-30" },
};

describe("usage stats IPC handler（T-S6 + Step 2 适配）", () => {
  it("kind=summary 转发 getSummary，区间 DTO 逐字段映射（summary 无 today 子对象）", async () => {
    const calls = installStubRuntime();
    const res = await handleUsageStatsQuery({
      kind: "summary",
      filter: RANGE_FILTER,
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
    });
    assert.deepEqual(calls, [
      {
        method: "getSummary",
        args: [
          { range: { fromDay: "2026-08-24", toDay: "2026-08-30" } },
        ],
      },
    ]);
  });

  it("filter 无 range 时透传为无 range 的 core filter（model 三态保留）", async () => {
    const calls = installStubRuntime();
    const res = await handleUsageStatsQuery({
      kind: "requests",
      filter: { model: null },
    });
    assert.equal(res.ok, true);
    if (!res.ok) {
      return;
    }
    assert.deepEqual(res.data, REQUEST_PAGE);
    assert.deepEqual(calls, [
      {
        method: "listRequestUsage",
        args: [{ model: null }, { offset: 0, limit: 50 }],
      },
    ]);
  });

  it("kind=daily 转发 getDailyBuckets，bucket 数组逐字段映射（model:null 三态保留）", async () => {
    const calls = installStubRuntime();
    const res = await handleUsageStatsQuery({
      kind: "daily",
      filter: { range: { fromDay: "2026-08-01", toDay: "2026-08-30" }, model: null },
    });
    assert.equal(res.ok, true);
    if (!res.ok) {
      return;
    }
    assert.deepEqual(res.data, BUCKETS);
    assert.deepEqual(calls, [
      {
        method: "getDailyBuckets",
        args: [
          { range: { fromDay: "2026-08-01", toDay: "2026-08-30" }, model: null },
        ],
      },
    ]);
  });

  it("kind=hourly 转发 getHourlyBuckets，dayLocalDate 作为首参透传", async () => {
    const calls = installStubRuntime();
    const res = await handleUsageStatsQuery({
      kind: "hourly",
      filter: RANGE_FILTER,
      dayLocalDate: "2026-08-23",
    });
    assert.equal(res.ok, true);
    assert.deepEqual(calls, [
      {
        method: "getHourlyBuckets",
        args: [
          "2026-08-23",
          { range: { fromDay: "2026-08-24", toDay: "2026-08-30" } },
        ],
      },
    ]);
  });

  it("kind=hourly 缺 dayLocalDate 时传空串（由服务层日期校验拒绝）", async () => {
    const calls = installStubRuntime();
    const res = await handleUsageStatsQuery({
      kind: "hourly",
      filter: RANGE_FILTER,
    });
    assert.equal(res.ok, true);
    assert.deepEqual(calls, [
      {
        method: "getHourlyBuckets",
        args: ["", { range: { fromDay: "2026-08-24", toDay: "2026-08-30" } }],
      },
    ]);
  });

  it("kind=modelBreakdown 转发 getModelBreakdown，providerId/modelName null 透传", async () => {
    const calls = installStubRuntime();
    const res = await handleUsageStatsQuery({
      kind: "modelBreakdown",
      filter: {
        range: { fromDay: "2026-08-24", toDay: "2026-08-25" },
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
            range: { fromDay: "2026-08-24", toDay: "2026-08-25" },
            model: "gpt-4o",
          },
        ],
      },
    ]);
  });

  it("kind=modelBreakdown 同名模型多服务商保持多行原样透出（饼图复合维度）", async () => {
    // core 按 (providerId, modelName) 复合分组，同名模型多服务商各返回一行；
    // DTO 侧原样透传（不再按 modelName 归并），renderer 饼图按复合维度展示。
    const rows = [
      {
        providerId: "p1",
        modelName: "gpt-4o",
        calls: 3,
        promptTokens: 100,
        completionTokens: 200,
        totalTokens: 300,
        cacheReadTokens: 40,
        billedInputTokens: 120,
      },
      {
        providerId: "p2",
        modelName: "gpt-4o",
        calls: 4,
        promptTokens: 500,
        completionTokens: 900,
        totalTokens: 1400,
        cacheReadTokens: 60,
        billedInputTokens: 480,
      },
    ];
    const calls = installStubRuntime(undefined, rows);
    const res = await handleUsageStatsQuery({
      kind: "modelBreakdown",
      filter: RANGE_FILTER,
    });
    assert.equal(res.ok, true);
    if (!res.ok) {
      return;
    }
    assert.deepEqual(res.data, rows);
    assert.deepEqual(calls, [
      {
        method: "getModelBreakdown",
        args: [
          { range: { fromDay: "2026-08-24", toDay: "2026-08-30" } },
        ],
      },
    ]);
  });

  it("kind=models 转发 listModels，字符串数组原样返回", async () => {
    const calls = installStubRuntime();
    const res = await handleUsageStatsQuery({
      kind: "models",
      filter: RANGE_FILTER,
    });
    assert.equal(res.ok, true);
    assert.deepEqual(res.data, ["gpt-4o", "claude-3-5-sonnet"]);
    assert.deepEqual(calls, [{ method: "listModels", args: [] }]);
  });

  it("kind=requests 转发 listRequestUsage，offset/limit 透传且分页/NULL 字段保真", async () => {
    const calls = installStubRuntime();
    const res = await handleUsageStatsQuery({
      kind: "requests",
      filter: { range: { fromDay: "2026-08-24", toDay: "2026-08-30" }, model: "gpt-4o" },
      offset: 50,
      limit: 100,
    });
    assert.equal(res.ok, true);
    if (!res.ok) {
      return;
    }
    assert.deepEqual(res.data, REQUEST_PAGE);
    assert.deepEqual(calls, [
      {
        method: "listRequestUsage",
        args: [
          {
            range: { fromDay: "2026-08-24", toDay: "2026-08-30" },
            model: "gpt-4o",
          },
          { offset: 50, limit: 100 },
        ],
      },
    ]);
  });

  it("kind=requests 缺省 offset/limit 时回落 0/50", async () => {
    const calls = installStubRuntime();
    const res = await handleUsageStatsQuery({
      kind: "requests",
      filter: RANGE_FILTER,
    });
    assert.equal(res.ok, true);
    assert.deepEqual(calls, [
      {
        method: "listRequestUsage",
        args: [
          { range: { fromDay: "2026-08-24", toDay: "2026-08-30" } },
          { offset: 0, limit: 50 },
        ],
      },
    ]);
  });

  it("新指标字段显式透传且 null 保真：summary 有值 / bucket 存量 null（T-IP1）", async () => {
    const calls = installStubRuntime();
    const summaryRes = await handleUsageStatsQuery({
      kind: "summary",
      filter: RANGE_FILTER,
    });
    assert.equal(summaryRes.ok, true);
    if (!summaryRes.ok) {
      return;
    }
    const summary = summaryRes.data;
    assert.equal(
      typeof summary === "object" && summary != null && "avgFirstTokenMs" in summary,
      true
    );
    if (
      typeof summary === "object" &&
      summary != null &&
      "avgFirstTokenMs" in summary
    ) {
      assert.equal(summary.avgFirstTokenMs, 850.5);
      assert.equal(summary.avgTokensPerSecond, 42.25);
    }

    const dailyRes = await handleUsageStatsQuery({
      kind: "daily",
      filter: RANGE_FILTER,
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

  it("区间校验：fromDay > toDay 在 IPC 边界拒绝，不触达 service", async () => {
    const calls = installStubRuntime();
    const res = await handleUsageStatsQuery({
      kind: "summary",
      filter: { range: { fromDay: "2026-08-31", toDay: "2026-08-24" } },
    });
    assert.equal(res.ok, false);
    if (res.ok) {
      return;
    }
    assert.equal(res.error.code, "ERROR");
    assert.ok(res.error.message.includes("fromDay 不能晚于 toDay"));
    assert.equal(calls.length, 0, "校验失败不应转发 service");
  });

  it("区间校验：非法格式与溢出日历日（02-30）在 IPC 边界拒绝", async () => {
    const calls = installStubRuntime();
    const badCases: Array<{ range: { fromDay: string; toDay: string }; hint: string }> = [
      { range: { fromDay: "2026/08/24", toDay: "2026-08-30" }, hint: "格式" },
      { range: { fromDay: "2026-02-30", toDay: "2026-03-01" }, hint: "合法日期" },
      { range: { fromDay: "2026-08-24", toDay: "2026-13-01" }, hint: "合法日期" },
    ];
    for (const { range, hint } of badCases) {
      const res = await handleUsageStatsQuery({ kind: "summary", filter: { range } });
      assert.equal(res.ok, false, `区间 ${JSON.stringify(range)} 应被拒绝`);
      if (!res.ok) {
        assert.ok(res.error.message.includes(hint));
      }
    }
    assert.equal(calls.length, 0, "校验失败不应转发 service");
  });

  it("service 抛 ChatError 时返回 IpcResult error 形态（code/message 透传）", async () => {
    // 构造带 domain code 的 ChatError 形状（core 主入口未导出该类，
    // formatIpcError 按 name ∈ TYPED_ERROR_NAMES + code 字段识别）
    const chatError = Object.assign(new Error("自然日区间不合法"), {
      name: "ChatError",
      code: "INVALID_ARGUMENT",
    });
    const calls = installStubRuntime(chatError);
    const res = await handleUsageStatsQuery({
      kind: "summary",
      filter: RANGE_FILTER,
    });
    assert.deepEqual(res, {
      ok: false,
      error: {
        code: "INVALID_ARGUMENT",
        message: "自然日区间不合法",
      },
    });
    assert.equal(calls.length, 1);
  });
});

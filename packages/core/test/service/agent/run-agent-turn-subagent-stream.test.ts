/**
 * T-S1~T-S4（phase-core-consume / subagent-stream-toggle）：runChildAgent 的
 * stream 传导由 `chat.subagentStream` 偏好决定的集成测试。
 *
 * 走 runAgentTurn 完整路径（真实 in-memory DB + scriptedModel 按调用序回放），
 * 让 task 工具触发 runChildAgent，在 ModelRequestService.request 的 options
 * 缝上断言子 run 的 stream：偏好关 → false、偏好开（默认）→ true、runtime
 * 未注入 preferences → true（兼容口径）、偏好键脏值 → 回退 true 且 run 不炸。
 *
 * @module test/service/agent/run-agent-turn-subagent-stream.test
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createAgentRegistryService,
  runAgentTurn,
  type AgentDefinition,
  type AgentTurnRuntimePort,
} from "@novel-master/core/agent";
import type { LlmChatResult } from "@novel-master/core/provider";
import type {
  ModelRequestService,
  ModelRequestOptions,
} from "@/service/provider/model-request.port.js";
import { createAgentAbortRegistry } from "@/service/agent/create-agent-abort-registry.js";
import type { UserVfsTurnService } from "@/service/chat/user-vfs-turn.port.js";
import { createKkvService } from "@/service/kkv/create-kkv-service.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../../helpers/novel-master-fixture.js";

novelMasterTestFixture();

const TEST_SAVED_MODEL_ID = "00000000-0000-4000-8000-0000000000a4";
const PROJECT_MODEL_ID = "00000000-0000-4000-8000-0000000000a5";

/** 子代理 def：被 task 工具派生时用（name 不能用内置名 general）。 */
const childAgentDef: AgentDefinition = {
  name: "child-worker",
  prompts: { persist: [], dynamic: [] },
  model: PROJECT_MODEL_ID,
  mode: "subagent",
};

function mockUserVfsTurn(): UserVfsTurnService {
  return {
    executeOp: async () => ({ ok: true }),
  };
}

/** 构造一轮 task tool_use 的 model 响应。 */
function taskToolUseResponse(toolUseId: string): LlmChatResult {
  return {
    assistantText: "",
    blocks: [
      {
        type: "tool_use",
        id: toolUseId,
        name: "task",
        input: {
          description: "子任务",
          prompt: "请完成子任务",
          subagentName: "child-worker",
        },
      },
    ],
    raw: {},
  };
}

/** 构造一轮纯文本完成响应。 */
function textDoneResponse(text: string): LlmChatResult {
  return {
    assistantText: text,
    blocks: [{ type: "text", text }],
    raw: {},
  };
}

/**
 * 按调用序回放的 mock modelRequests：同时记录每次 request 的
 * `options.stream`，作为断言缝（主 run 与子 run 同源传导）。
 */
function scriptedModel(
  responses: readonly LlmChatResult[],
): ModelRequestService & { readonly streams: boolean[] } {
  const streams: boolean[] = [];
  let calls = 0;
  return {
    streams,
    request: async (
      _savedModelId: string,
      _userContent: string,
      options?: ModelRequestOptions,
    ): Promise<LlmChatResult> => {
      const idx = calls;
      calls += 1;
      streams.push(options?.stream ?? false);
      const r = responses[idx];
      if (r == null) {
        throw new Error(
          `scriptedModel: 第 ${idx} 次调用无预设响应（responses.length=${responses.length}）`,
        );
      }
      return r;
    },
  };
}

function makeRuntime(
  ctx: ReturnType<typeof getNovelMasterTestContext>,
  args: {
    readonly modelRequests: ModelRequestService;
    /** 不传（undefined）即模拟旧测试 mock 未注入 preferences 字段的口径。 */
    readonly preferences?: AgentTurnRuntimePort["preferences"];
  },
): AgentTurnRuntimePort {
  const registry = createAgentRegistryService(ctx.conn, ctx.state);
  return {
    state: {
      getCurrentAgentId: () => ctx.state.getCurrentAgentId(),
      getCurrentModelId: async () => TEST_SAVED_MODEL_ID,
      getSubagentNames: async () => [],
    },
    agentRegistry: registry,
    abortRegistry: createAgentAbortRegistry(),
    ...(args.preferences != null ? { preferences: args.preferences } : {}),
    projects: ctx.projects,
    messages: ctx.messages,
    messageCheckpoint: ctx.messageCheckpoint,
    modelRequests: args.modelRequests,
    savedModelRepo: {
      findById: async () => ({
        id: TEST_SAVED_MODEL_ID,
        providerId: "test-provider",
        alias: "test-model",
        protocolName: "anthropic",
        protocolModelId: "claude-test",
        thinkingEnabled: false,
        createdAt: 0,
        settings: {
          schemaVersion: 2,
          internal: { contextWindowTokens: 100000, tokenCounterMode: "auto" },
          generation: { sampling: { enabled: false }, thinkingLevel: "off" },
        },
      }),
    } as AgentTurnRuntimePort["savedModelRepo"],
    providerRepo: {
      findById: async () => ({
        id: "test-provider",
        name: "test",
        protocolName: "anthropic",
        baseUrl: "https://example.invalid",
        authToken: "",
        createdAt: 0,
      }),
    },
    eventBus: ctx.sessionKkv as unknown as never, // 占位，下方真 eventBus 用
    compactionConditionEvaluator:
      undefined as unknown as AgentTurnRuntimePort["compactionConditionEvaluator"],
    eventOrchestrator:
      undefined as unknown as AgentTurnRuntimePort["eventOrchestrator"],
    sessionKkv: ctx.sessionKkv,
    sessionVfs: (projectId, sessionId) =>
      ctx.sessionVfs(projectId, sessionId),
    workplace: () =>
      ({
        renderDisplay: async () => "",
        buildListRows: async () => [],
        materializePersistBlock: async () => ({ workplaceDisplay: "" }),
        evaluateRuleView: async () => ({
          rows: [],
          displayByPath: new Map(),
        }),
      }) as ReturnType<AgentTurnRuntimePort["workplace"]>,
    userVfsTurn: mockUserVfsTurn(),
    sessions: ctx.sessions,
  };
}

/** 装配一个 real eventBus（runChildAgent publishRunLifecycle=true 会发事件）。 */
function realEventBus(): AgentTurnRuntimePort["eventBus"] {
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  return {
    publish: (type: string, payload: unknown) => {
      const set = handlers.get(type);
      if (set != null) for (const h of set) h(payload);
    },
    subscribe: (type: string, handler: (payload: unknown) => void) => {
      let set = handlers.get(type);
      if (set == null) {
        set = new Set();
        handlers.set(type, set);
      }
      set.add(handler);
      return () => set!.delete(handler);
    },
    unsubscribe: (type: string, handler: (payload: unknown) => void) => {
      handlers.get(type)?.delete(handler);
    },
  } as AgentTurnRuntimePort["eventBus"];
}

/**
 * 给 test-default-agent 设置 model 字段（resolveApplicationModelIdForRun 不再从
 * getCurrentModelId 回退 savedModelId，必须 agent def 或 session config 带 model）。
 */
async function ensureDefaultAgentModel(
  ctx: ReturnType<typeof getNovelMasterTestContext>,
): Promise<void> {
  const registry = createAgentRegistryService(ctx.conn, ctx.state);
  await registry.upsert("test-default-agent", {
    name: "测试默认 Agent",
    prompts: { persist: [], dynamic: [] },
    model: TEST_SAVED_MODEL_ID,
  });
}

/** 注册子代理 def 到 registry（mode=subagent，确保可被 task 工具调用）。 */
async function seedChildAgent(
  ctx: ReturnType<typeof getNovelMasterTestContext>,
): Promise<void> {
  const registry = createAgentRegistryService(ctx.conn, ctx.state);
  await registry.upsert("child-worker", childAgentDef);
}

/**
 * 跑一轮「主 agent 发 task → 子 agent 完成 → 主 agent 收尾」的完整 turn。
 *
 * 回放序：index=0 主 run（task tool_use）→ index=1 子 run（完成文本）→
 * index=2 主 run（收到 tool_result 后收尾）。返回记录到的各次 stream。
 */
async function runTaskTurn(
  preferences: AgentTurnRuntimePort["preferences"],
): Promise<readonly boolean[]> {
  const ctx = getNovelMasterTestContext();
  await seedChildAgent(ctx);
  await ensureDefaultAgentModel(ctx);

  const modelRequests = scriptedModel([
    taskToolUseResponse("tu-s"),
    textDoneResponse("子代理已完成"),
    textDoneResponse("主代理收到结果"),
  ]);

  const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
  const session = await ctx.sessions.create(project.id, "S-STREAM");

  const runtime = makeRuntime(ctx, { modelRequests, preferences });
  runtime.eventBus = realEventBus();

  await ctx.state.setCurrentAgentId("test-default-agent");
  await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_ID);

  const result = await runAgentTurn(
    runtime,
    { projectId: project.id, sessionId: session.id },
    "请派生子代理完成任务",
    // 主会话开关走 options.stream 链路（本测试不动它）：固定 false，
    // 便于把「子 run 的 stream」与「主 run 的 stream」区分开。
    { stream: false, onStream: () => {} },
  );
  assert.equal(result.stopReason, "completed");

  assert.equal(
    modelRequests.streams.length,
    3,
    `应有 3 次 model 调用（主/子/主），实际=${modelRequests.streams.length}`,
  );
  // 第一次调用是主 run：stream 跟随 runAgentTurn 的 options.stream（false），
  // 证明子 run 的取值不是被主会话链路带过去的。
  assert.equal(modelRequests.streams[0], false, "主 run 应跟随主会话开关 false");
  return modelRequests.streams;
}

describe("runChildAgent stream 传导（chat.subagentStream 偏好）", () => {
  it("T-S1：偏好设 false → 子 run 的请求 stream === false", async () => {
    const ctx = getNovelMasterTestContext();
    await ctx.preferences.setSubagentStreamEnabled(false);
    try {
      const streams = await runTaskTurn(ctx.preferences);
      assert.equal(streams[1], false, "子 run 的 stream 应跟随偏好 false");
    } finally {
      await ctx.preferences.resetSubagentStreamEnabled();
    }
  });

  it("T-S2：偏好 true（默认，unset）→ 子 run 的请求 stream === true", async () => {
    const ctx = getNovelMasterTestContext();
    // 先保证键 unset（同文件共享一条 in-memory DB，防前序用例串扰）
    await ctx.preferences.resetSubagentStreamEnabled();
    const streams = await runTaskTurn(ctx.preferences);
    assert.equal(streams[1], true, "子 run 的 stream 应为默认 true");
  });

  it("T-S3：runtime 不注入 preferences 字段 → 子 run 的请求 stream === true", async () => {
    const ctx = getNovelMasterTestContext();
    await ctx.preferences.resetSubagentStreamEnabled();
    // 故意不注入 preferences（旧测试 mock 的兼容口径）
    const streams = await runTaskTurn(undefined);
    assert.equal(streams[1], true, "未注入 preferences 时子 run 应回退 true");
  });

  it("T-S4：偏好键直写脏值 → 回退 true 且 run 不抛", async () => {
    const ctx = getNovelMasterTestContext();
    const kkv = createKkvService(ctx.conn);
    await kkv.set("nm-preferences", "chat.subagentStream", "not-a-bool");
    try {
      // runTaskTurn 内部已断言 stopReason === completed（run 不抛）
      const streams = await runTaskTurn(ctx.preferences);
      assert.equal(
        streams[1],
        true,
        "偏好脏值时子 run 应回退默认流式 true",
      );
    } finally {
      await ctx.preferences.resetSubagentStreamEnabled();
    }
  });
});

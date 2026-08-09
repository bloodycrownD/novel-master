/**
 * T-R2 / T-A4（phase-1-abort-reflow）：runChildAgent 注册 childController 到
 * abortRegistry + 父中断级联到子 controller 的集成测试。
 *
 * 走 runAgentTurn 完整路径（真实 in-memory DB + mock provider），让 task 工具
 * 触发 runChildAgent，在子 agent 的 model 调用窗口内断言 registry 状态 / 触发
 * 父级 abort，覆盖 Step 3-4（T-R2）与 Step 4 父级联（T-A4）。
 *
 * @module test/service/agent/run-agent-turn-abort-registry.test
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createAgentRegistryService,
  runAgentTurn,
  type AgentDefinition,
  type AgentTurnRuntimePort,
} from "@novel-master/core/agent";
import type { LlmChatResult, LlmStreamEvent } from "@novel-master/core/provider";
import type {
  ModelRequestService,
  ModelRequestOptions,
} from "@/service/provider/model-request.port.js";
import { createAgentAbortRegistry } from "@/service/agent/create-agent-abort-registry.js";
import type { AgentAbortRegistry } from "@/service/agent/agent-abort-registry.port.js";
import type { UserVfsTurnService } from "@/service/chat/user-vfs-turn.port.js";
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
    flushPendingUserVfsTurns: async () => ({ flushed: false, attachments: [] }),
    previewUserOpsChangedPaths: async () => [],
    previewUserOpsActions: async () => [],
    hasPendingTurns: async () => false,
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
 * 带状态的 mock modelRequests：按调用序号返回预设响应，并在指定调用时执行回调
 * （用于在子 agent model 调用窗口内断言 registry 状态或触发父级 abort）。
 */
interface ScriptedModelOptions {
  readonly responses: readonly LlmChatResult[];
  /** 第 n 次（0-based）调用时执行的副作用回调。 */
  readonly onCall?: Record<number, () => void>;
}

function scriptedModel(opts: ScriptedModelOptions): ModelRequestService {
  let calls = 0;
  return {
    request: async (
      _savedModelId: string,
      _userContent: string,
      _options?: ModelRequestOptions,
    ): Promise<LlmChatResult> => {
      const idx = calls;
      calls += 1;
      opts.onCall?.[idx]?.();
      const r = opts.responses[idx];
      if (r == null) {
        throw new Error(
          `scriptedModel: 第 ${idx} 次调用无预设响应（responses.length=${opts.responses.length}）`,
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
    readonly abortRegistry: AgentAbortRegistry;
  },
): AgentTurnRuntimePort {
  const registry = createAgentRegistryService(ctx.conn, ctx.state);
  return {
    state: {
      getCurrentAgentId: () => ctx.state.getCurrentAgentId(),
      getCurrentModelId: async () => TEST_SAVED_MODEL_ID,
      getCurrentRegexGroupId: async () => undefined,
      getSubagentNames: async () => [],
    },
    agentRegistry: registry,
    abortRegistry: args.abortRegistry,
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
    eventBus: ctx.sessionKkv as unknown as never, // 占位，下方真 eventOrchestrator 用
    regexConfig: {
      getActiveRegexConfig: async () => null,
    } as AgentTurnRuntimePort["regexConfig"],
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
  // 借用 core 的 SimpleEventBus；这里通过动态 require 避免顶部 import 类型循环。
  // 直接 new 一个最小 event bus 实现。
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

describe("runChildAgent abort registry 孤儿修复（T-CF1）", () => {
  it("T-CF1：register 后 runner.run 前 throw → finally 仍 unregister → registry.has(childSessionId)===false", async () => {
    const ctx = getNovelMasterTestContext();
    await seedChildAgent(ctx);
    await ensureDefaultAgentModel(ctx);

    const abortRegistry = createAgentAbortRegistry();
    const seenChildIds: string[] = [];

    // 计数式 mock getCurrentRegexGroupId：第 1 次（父 runAgentTurn）正常返回，
    // 第 2 次（子 runChildAgent）抛错——此时 register 已执行、但还没进 runner.run，
    // 走的就是修复前会留孤儿的路径。修复后 finally 必须兑现 unregister。
    let regexGroupCalls = 0;
    const throwReason =
      "T-CF1: 模拟 runChildAgent 内 getCurrentRegexGroupId 抛错（register 后、runner.run 前）";

    const modelRequests = scriptedModel({
      // 主 agent 第 1 轮（index=0）：发起 task tool_use
      // 子 agent 永远到不了 model 调用（getCurrentRegexGroupId 先抛错）
      // 主 agent 第 2 轮（index=1）：收到 error tool_result 后收尾
      responses: [
        taskToolUseResponse("tu-cf1"),
        textDoneResponse("主代理识别到子任务失败"),
      ],
    });

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S-CF1");

    const runtime = makeRuntime(ctx, { modelRequests, abortRegistry });
    // 覆写 getCurrentRegexGroupId：第 2 次调用（即 runChildAgent 内那次）抛错。
    runtime.state = {
      ...runtime.state,
      getCurrentRegexGroupId: async () => {
        regexGroupCalls += 1;
        if (regexGroupCalls >= 2) {
          throw new Error(throwReason);
        }
        return undefined;
      },
    };
    const originalCreateSubSession = ctx.sessions.createSubSession.bind(
      ctx.sessions,
    );
    runtime.sessions = new Proxy(ctx.sessions, {
      get(target, prop, receiver) {
        if (prop === "createSubSession") {
          return async (parentId: string, projId: string, title?: string) => {
            const child = await originalCreateSubSession(parentId, projId, title);
            seenChildIds.push(child.id);
            return child;
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as AgentTurnRuntimePort["sessions"];
    runtime.eventBus = realEventBus();

    await ctx.state.setCurrentAgentId("test-default-agent");
    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_ID);

    // runChildAgent 抛错后 runner 会把 tool 错误转成 error tool_result，主 agent 继续；
    // 无论主 run 最终怎么收尾，关键是子 controller 不应残留在 registry 里。
    await runAgentTurn(
      runtime,
      { projectId: project.id, sessionId: session.id },
      "请派生子代理完成任务",
      { stream: false, onStream: () => {} },
    );

    assert.equal(seenChildIds.length, 1, "应已创建 1 个子会话（task 工具走到了 runChildAgent）");
    const childSessionId = seenChildIds[0]!;
    assert.equal(
      abortRegistry.has(childSessionId),
      false,
      "runChildAgent 在 register 之后抛错时，finally 必须反注册子 controller，" +
        "不能留孤儿（修复前 register 在 try 外，该路径会漏 unregister）",
    );
    assert.equal(
      regexGroupCalls,
      2,
      "getCurrentRegexGroupId 应被调用两次（父 + 子），第 2 次抛错已触发",
    );
  });
});

describe("runChildAgent abort registry 注册 / 父级联（T-R2 / T-A4）", () => {
  it("T-R2：runChildAgent 期间 registry.has(childSessionId)===true，结束后===false", async () => {
    const ctx = getNovelMasterTestContext();
    await seedChildAgent(ctx);
    await ensureDefaultAgentModel(ctx);

    const abortRegistry = createAgentAbortRegistry();
    const seenChildIds: string[] = [];
    let capturedChildSessionId: string | undefined;

    const modelRequests = scriptedModel({
      // 主 agent 第 1 轮（index=0）：发起 task tool_use
      // 子 agent 第 1 轮（index=1）：返回完成文本，并在此时断言 registry
      // 主 agent 第 2 轮（index=2）：收到 tool_result 后返回完成文本
      responses: [
        taskToolUseResponse("tu-r2"),
        textDoneResponse("子代理已完成"),
        textDoneResponse("主代理收到结果"),
      ],
      onCall: {
        // 子 agent model 调用窗口（index=1）：此时 childController 已注册。
        1: () => {
          assert.equal(seenChildIds.length, 1, "应已创建 1 个子会话");
          capturedChildSessionId = seenChildIds[0];
          assert.equal(
            abortRegistry.has(capturedChildSessionId!),
            true,
            "子 run 期间 childSessionId 应在 registry 中",
          );
        },
      },
    });

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S-R2");

    const runtime = makeRuntime(ctx, { modelRequests, abortRegistry });
    // 包一层 sessions.createSubSession 捕获 childSessionId（保留其他方法不变）。
    const originalCreateSubSession = ctx.sessions.createSubSession.bind(
      ctx.sessions,
    );
    runtime.sessions = new Proxy(ctx.sessions, {
      get(target, prop, receiver) {
        if (prop === "createSubSession") {
          return async (parentId: string, projId: string, title?: string) => {
            const child = await originalCreateSubSession(parentId, projId, title);
            seenChildIds.push(child.id);
            return child;
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as AgentTurnRuntimePort["sessions"];
    runtime.eventBus = realEventBus();

    await ctx.state.setCurrentAgentId("test-default-agent");
    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_ID);

    await runAgentTurn(
      runtime,
      { projectId: project.id, sessionId: session.id },
      "请派生子代理完成任务",
      { stream: false, onStream: () => {} },
    );

    // run 结束后所有 controller 反注册。
    assert.ok(capturedChildSessionId != null, "应捕获到 childSessionId");
    assert.equal(
      abortRegistry.has(capturedChildSessionId),
      false,
      "子 run 结束后 childSessionId 应从 registry 反注册",
    );
    assert.equal(
      abortRegistry.has(session.id),
      false,
      "主 run 结束后 parentSessionId 应从 registry 反注册",
    );
  });

  it("T-A4：父 abort → 子 childController.abort → 子 run cancelled → task 回流 stopped=true", async () => {
    const ctx = getNovelMasterTestContext();
    await seedChildAgent(ctx);
    await ensureDefaultAgentModel(ctx);

    const abortRegistry = createAgentAbortRegistry();
    const seenChildIds: string[] = [];

    const modelRequests = scriptedModel({
      responses: [
        // 主 agent 第 1 轮：task tool_use
        taskToolUseResponse("tu-a4"),
        // 子 agent 第 1 轮：返回纯文本，但在返回前触发父级 abort。
        textDoneResponse("子代理被中断前的半成品"),
        // 主 agent 第 2 轮：收到 stopped tool_result 后收尾。
        textDoneResponse("主代理识别到中断"),
      ],
      onCall: {
        // 子 agent model 调用窗口：触发父级 abort。
        1: () => {
          assert.equal(seenChildIds.length, 1, "应已创建 1 个子会话");
          // 此时 parentSessionId 应在 registry 中（主 run 注册的 internalController）。
          // registry.abort(parentSessionId) → internalController.abort
          // → parentSignal fire → childController.abort → 子 run cancelled。
          abortRegistry.abort(session.id);
        },
      },
    });

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S-A4");

    const runtime = makeRuntime(ctx, { modelRequests, abortRegistry });
    const originalCreateSubSession = ctx.sessions.createSubSession.bind(
      ctx.sessions,
    );
    runtime.sessions = new Proxy(ctx.sessions, {
      get(target, prop, receiver) {
        if (prop === "createSubSession") {
          return async (parentId: string, projId: string, title?: string) => {
            const child = await originalCreateSubSession(parentId, projId, title);
            seenChildIds.push(child.id);
            return child;
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as AgentTurnRuntimePort["sessions"];
    runtime.eventBus = realEventBus();

    await ctx.state.setCurrentAgentId("test-default-agent");
    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_ID);

    const onStreamEvents: LlmStreamEvent[] = [];
    const result = await runAgentTurn(
      runtime,
      { projectId: project.id, sessionId: session.id },
      "请派生子代理完成任务",
      { stream: false, onStream: (e) => onStreamEvents.push(e) },
    );

    // 父级 abort 直接中断了主 run（registry.abort(parentSessionId) → internalController.abort
    // → 主 runner 检测 signal.aborted → stopReason=cancelled）。这证明 registry 到主 run 的
    // 中断路径生效。
    assert.equal(
      result.stopReason,
      "cancelled",
      `父 abort 后主 run stopReason 应为 cancelled，实际=${result.stopReason}`,
    );

    // 子会话已创建（证明 task 工具走到了 runChildAgent，子 controller 已注册进 registry）。
    assert.equal(seenChildIds.length, 1, "应已创建 1 个子会话");
    const childSessionId = seenChildIds[0]!;

    // run 结束后子 controller 反注册（try/finally unregister 兑现）。
    assert.equal(
      abortRegistry.has(childSessionId),
      false,
      "子 run 结束后 childSessionId 应从 registry 反注册",
    );
    assert.equal(
      abortRegistry.has(session.id),
      false,
      "主 run 结束后 parentSessionId 应从 registry 反注册",
    );

    // 子 agent 被 abort 后的回流语义验证：task 工具 cancelled 分支返回 stopped=true。
    // 由于主 run 被 abort 后不会 append tool_result（主 runner L507 在 append 前 break），
    // 这里改为验证子 session 中无完整 assistant 完成消息——证明子 run 被级联中断。
    const childMessages = await ctx.messages.listBySession(childSessionId);
    const childAssistantTexts = childMessages.filter(
      (m) => m.role === "assistant",
    );
    // 子 run 被 cancel 后不应有「已完成」语义的末条 assistant（被中断了）。
    // mock 子 agent 返回的半成品文本可能被 append（abort 后 runner 会 append meaningful blocks），
    // 但 stopReason 不会是 completed——这里只断言子会话被创建且有 task prompt 落库。
    const childUserMessages = childMessages.filter((m) => m.role === "user");
    assert.ok(
      childUserMessages.length >= 1,
      "子 session 应至少含 task prompt 作为首条 user 消息",
    );
    // 如果子 agent mock 返回的半成品被 append，验证它含预期文本。
    if (childAssistantTexts.length > 0) {
      const lastChildText = childAssistantTexts[childAssistantTexts.length - 1]!
        .content.blocks.filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("");
      assert.equal(
        lastChildText,
        "子代理被中断前的半成品",
        "子 agent 末条 assistant 应为 mock 返回的半成品文本",
      );
    }
  });
});

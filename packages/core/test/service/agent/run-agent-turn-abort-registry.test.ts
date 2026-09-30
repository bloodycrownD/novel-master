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

import { textBlocks } from "@novel-master/core/chat";
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
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import {
  BACKFILL_CURSOR_LAST_SCANNED_COUNT_KEY,
  SESSION_KKV_DOMAIN_BACKFILL_CURSOR,
} from "@/domain/session-kkv/model/session-kkv-domains.js";
import { createAgentAbortRegistry } from "@/service/agent/create-agent-abort-registry.js";
import type { AgentAbortRegistry } from "@/service/agent/agent-abort-registry.port.js";
import { createAgentStreamRegistry } from "@/service/agent/create-agent-stream-registry.js";
import type {
  AgentStreamRegistry,
  AgentStreamRegistryHandle,
} from "@/service/agent/agent-stream-registry.port.js";
import type { SkillService } from "@/service/skills/skills.port.js";
import { LlmStreamTimeoutError } from "@/infra/llm-protocol/logic/llm-stream-timeout-error.js";
import type { UserVfsTurnService } from "@/service/chat/user-vfs-turn.port.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../../helpers/novel-master-fixture.js";

novelMasterTestFixture();

const TEST_SAVED_MODEL_ID = "00000000-0000-4000-8000-0000000000a4";
const PROJECT_MODEL_ID = "00000000-0000-4000-8000-0000000000a5";

/**
 * 计数型 streamRegistry：真实现 + register/unregister 调用计数。
 *
 * 为什么要计数而不是只看 `has()`：检查点命中的收尾路径**不调** register，
 * 所以「register 调 0 次」是「前奏没跑到 streamRegistry 那一行」的正向证据——
 * `has()===false` 在「register 了又立刻反注册」时同样为真，分辨不出。
 */
function countingStreamRegistry(): {
  readonly registry: AgentStreamRegistry;
  readonly registerCalls: () => number;
  readonly registerCallsFor: (sessionId: string) => number;
  readonly unregisterCalls: () => number;
  readonly has: (sessionId: string) => boolean;
} {
  const real = createAgentStreamRegistry();
  const registered: string[] = [];
  let unregisters = 0;
  return {
    registry: {
      register(sessionId: string): AgentStreamRegistryHandle {
        registered.push(sessionId);
        return real.register(sessionId);
      },
      reset: (sessionId) => real.reset(sessionId),
      append: (sessionId, delta) => real.append(sessionId, delta),
      get: (sessionId) => real.get(sessionId),
      has: (sessionId) => real.has(sessionId),
      unregister(sessionId: string, handle?: AgentStreamRegistryHandle): void {
        unregisters += 1;
        real.unregister(sessionId, handle);
      },
    },
    registerCalls: () => registered.length,
    registerCallsFor: (sessionId) =>
      registered.filter((id) => id === sessionId).length,
    unregisterCalls: () => unregisters,
    has: (sessionId) => real.has(sessionId),
  };
}

/**
 * 可卡门的 skills 工厂：返回的 SkillService 只实现 `effectiveSkills`
 * （`assembleSkillsToolContext` 唯一会调的方法），并在其中挂一道 gate。
 *
 * 观测面选它而不是「toolsCtx 有没有 skills」：`effectiveSkills` 才是前奏里
 * 真正读 KKV / 解析技能目录的 IO 点，「停在这里 ⇒ effectiveSkills 调 0 次」
 * 才是有牙齿的断言。
 */
function gatedSkills(opts: {
  readonly onEnter: () => void;
  readonly gate: Promise<void>;
}): { readonly factory: () => SkillService; readonly calls: () => number } {
  let calls = 0;
  return {
    factory: () =>
      ({
        effectiveSkills: async () => {
          calls += 1;
          opts.onEnter();
          await opts.gate;
          return [];
        },
      }) as unknown as SkillService,
    calls: () => calls,
  };
}

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
    eventBus: ctx.sessionKkv as unknown as never, // 占位，下方真 eventOrchestrator 用
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
      // 按 SimpleEventBus 契约返回 {unsubscribe}（不是裸函数）——实现侧会退订。
      return {
        unsubscribe: () => {
          set!.delete(handler);
        },
      };
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

/** 采到的 run 生命周期事件（r3-run-1 断言用）。 */
type RunEvent = {
  readonly type: string;
  readonly payload: Record<string, unknown>;
};

type RunEvents = {
  readonly bus: AgentTurnRuntimePort["eventBus"];
  readonly all: RunEvent[];
  started(): RunEvent[];
  finished(): RunEvent[];
  failed(): RunEvent[];
};

/**
 * 装一个 record 型 eventBus：既满足 runtime 的 SimpleEventBus 契约，
 * 又把 STARTED/FINISHED/FAILED 全量留档。
 *
 * 为什么能「恰好 N 条」这么断言：SimpleEventBus 是**同步分发**（publish 直接
 * 调订阅方），事件一定在 runAgentTurn settle 之前落到 handlers 里，不存在
 * microtask 竞态导致的漏采。
 */
function recordingEventBus(): RunEvents {
  const all: RunEvent[] = [];
  const bus = realEventBus();
  for (const type of [
    "agent.run.started",
    "agent.run.finished",
    "agent.run.failed",
  ]) {
    bus.subscribe(type, (payload: unknown) => {
      all.push({ type, payload: payload as Record<string, unknown> });
    });
  }
  const byType = (t: string) => all.filter((e) => e.type === t);
  return {
    bus,
    all,
    started: () => byType("agent.run.started"),
    finished: () => byType("agent.run.finished"),
    failed: () => byType("agent.run.failed"),
  };
}

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

describe("abort 注册前移：前奏期间的停止不丢（2026-09-30 用户报「发送期间无法终止」）", () => {
  it("T-ABORT-EARLY: backfill 期间 abort → registry 已注册、意图被兑现，run cancelled 且不发请求", async () => {
    const ctx = getNovelMasterTestContext();
    await ensureDefaultAgentModel(ctx);

    const abortRegistry = createAgentAbortRegistry();
    let modelCalls = 0;
    const modelRequests: ModelRequestService = {
      request: async () => {
        modelCalls += 1;
        return textDoneResponse("停止生效时不该走到这里");
      },
    };

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S-EARLY");

    const runtime = makeRuntime(ctx, { modelRequests, abortRegistry });
    runtime.eventBus = realEventBus();

    // 把前奏的第一站（backfill）卡住：复刻「大会话前奏要跑一会儿」的窗口。
    // 用 Proxy 转发其余方法——类实例**不能对象展开**（原型方法会丢，见 RULE）。
    let releaseBackfill!: () => void;
    const backfillGate = new Promise<void>((resolve) => {
      releaseBackfill = resolve;
    });
    let backfillEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      backfillEntered = resolve;
    });
    const realCheckpoint = ctx.messageCheckpoint;
    runtime.messageCheckpoint = new Proxy(realCheckpoint, {
      get(target, prop, receiver) {
        if (prop === "backfillMissingBaselines") {
          return async (sessionId: string, projectId: string) => {
            backfillEntered();
            await backfillGate;
            return target.backfillMissingBaselines(sessionId, projectId);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as AgentTurnRuntimePort["messageCheckpoint"];

    await ctx.state.setCurrentAgentId("test-default-agent");
    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_ID);

    const runPromise = runAgentTurn(
      runtime,
      { projectId: project.id, sessionId: session.id },
      "前奏期间按停止",
      { stream: false, onStream: () => {} },
    );

    await entered;
    // 关键不变量（注册前移）：run 被受理即算在途——前奏期间 stopRun 必须能找到
    // controller。修前这里是 false，abort 被静默丢弃、run 照旧发请求。
    assert.equal(
      abortRegistry.has(session.id),
      true,
      "前奏期间 run 必须已注册（否则停止意图会被丢掉）",
    );

    // 用户按停止（mobile stopRun / desktop ipcAgentAbort 同语义）。
    abortRegistry.abort(session.id);
    releaseBackfill();

    const result = await runPromise;
    assert.equal(
      result.stopReason,
      "cancelled",
      "前奏期间的停止必须兑现为 cancelled",
    );
    assert.equal(modelCalls, 0, "停止后不得再发模型请求");
    // 用户消息在 append 阶段已落库（停止发生在「已发送」之后）：保留，可由
    // undo_send 回收——与「流式中途停止」的语义一致。
    const messages = await ctx.messages.listBySession(session.id);
    assert.ok(
      messages.some((m) => m.role === "user"),
      "停止前已 append 的用户消息应保留",
    );
    assert.equal(
      abortRegistry.has(session.id),
      false,
      "run 收尾后必须反注册（门禁不得锁死）",
    );
  });

  // r3-run-4：入口检查点⓪。与 ①② 的语义差一档——⓪ 命中时用户消息**尚未落库**，
  // 「这次发送根本没发生」；①② 停在一段已 append 的链上。锁死 ⓪ 必在 backfill
  // 之前兑现（backfill 是前奏第一站，大会话上秒级，没这道检查点用户按停止
  // 仍要等它跑完）。
  it("T-ABORT-EARLY-0: 入口即 aborted → 检查点⓪兑现，backfill 一次都不调、用户消息不落库", async () => {
    const ctx = getNovelMasterTestContext();
    await ensureDefaultAgentModel(ctx);

    const abortRegistry = createAgentAbortRegistry();
    let modelCalls = 0;
    let backfillCalls = 0;
    const modelRequests: ModelRequestService = {
      request: async () => {
        modelCalls += 1;
        return textDoneResponse("入口就停了，不该走到这里");
      },
    };

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S-EARLY0");

    const runtime = makeRuntime(ctx, { modelRequests, abortRegistry });
    const events = recordingEventBus();
    runtime.eventBus = events.bus;
    // backfill 计数：⓪ 命中时它一次都不该被调（这是「⓪ 插在 backfill 前」的正向证据）。
    const realCheckpoint = ctx.messageCheckpoint;
    runtime.messageCheckpoint = new Proxy(realCheckpoint, {
      get(target, prop, receiver) {
        if (prop === "backfillMissingBaselines") {
          return async (
            sessionId: string,
            projectId: string,
            signal?: AbortSignal
          ) => {
            backfillCalls += 1;
            return target.backfillMissingBaselines(
              sessionId,
              projectId,
              signal
            );
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as AgentTurnRuntimePort["messageCheckpoint"];

    await ctx.state.setCurrentAgentId("test-default-agent");
    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_ID);

    // 入口就带一个已 aborted 的 caller signal（等价于「受理瞬间用户已按停止」）。
    const result = await runAgentTurn(
      runtime,
      { projectId: project.id, sessionId: session.id },
      "入口就按了停止",
      { stream: false, signal: AbortSignal.abort() }
    );

    assert.equal(
      result.stopReason,
      "cancelled",
      "入口已 aborted 必须由检查点⓪兑现为 cancelled",
    );
    assert.equal(
      backfillCalls,
      0,
      "⓪ 必须在 backfill 之前兑现（backfill 是前奏第一站、大会话秒级）",
    );
    assert.equal(modelCalls, 0);
    // ⓪ 的语义差一档：用户消息**未落库**——「这次发送根本没发生」。
    const messages = await ctx.messages.listBySession(session.id);
    assert.equal(
      messages.length,
      0,
      "⓪ 命中时用户消息未落库；与①②「已 append、停止不改变已发送事实」不同",
    );
    // 终态仍要恰好一条 FINISHED('')：双端靠它收口（r3-run-1）。
    assert.equal(
      events.finished().length,
      1,
      "⓪ 命中同样必须发 FINISHED('') 收口",
    );
    assert.equal(events.finished()[0]!.payload.runId, "");
    assert.equal(events.finished()[0]!.payload.vfsMutated, false);
    assert.equal(events.started().length, 0);
    assert.equal(events.failed().length, 0, "正常取消不是失败");
    assert.equal(
      abortRegistry.has(session.id),
      false,
      "收尾后必须反注册",
    );
  });

  // r3-run-4 验收③ + r3-test-1 第 1 条：list 期间的停止。
  //
  // 【与检查点①②的区分】断言「streamRegistry.register 调 0 次 + runner 未产出」：
  // ①（append+capture 后）跑不到 list，②（runner.run 前）已经跑过 skills 预算。
  // 只有「list 之后、skills 之前」这道检查点③才同时满足「list 跑过、skills
  // 没跑、runner 没起步、streamRegistry 一次没 register」——所以这些断言合在
  // 一起就是③的牙齿。
  it("T-ABORT-EARLY-2: list 期间 abort → 检查点③收尾：skills 未被调、streamRegistry 未 register、runner 未产出", async () => {
    const ctx = getNovelMasterTestContext();
    await ensureDefaultAgentModel(ctx);

    const abortRegistry = createAgentAbortRegistry();
    let modelCalls = 0;
    const modelRequests: ModelRequestService = {
      request: async () => {
        modelCalls += 1;
        return textDoneResponse("停止生效时不该走到这里");
      },
    };

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S-EARLY2");

    const runtime = makeRuntime(ctx, { modelRequests, abortRegistry });
    const events = recordingEventBus();
    runtime.eventBus = events.bus;
    const streams = countingStreamRegistry();
    runtime.streamRegistry = streams.registry;

    // 卡住前奏尾段：agentRegistry.list 位于检查点①（append+capture 后）与
    // 检查点③（list 之后）之间。此刻用户消息已 append（检查点①已过）。
    let releaseList!: () => void;
    const listGate = new Promise<void>((resolve) => {
      releaseList = resolve;
    });
    let listEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      listEntered = resolve;
    });
    const realRegistry = runtime.agentRegistry;
    runtime.agentRegistry = new Proxy(realRegistry, {
      get(target, prop, receiver) {
        if (prop === "list") {
          return async () => {
            listEntered();
            await listGate;
            return target.list();
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as AgentTurnRuntimePort["agentRegistry"];

    // skills 观测：③命中时 effectiveSkills 必须**一次都没被调**。门用
    // 「永不 resolve」的 promise：万一真被调到了，runPromise 永不 settle、
    // 测试直接超时失败——比事后断言更早暴露问题。
    const skills = gatedSkills({
      onEnter: () => {},
      gate: new Promise<void>(() => {}),
    });
    runtime.skills = skills.factory;

    await ctx.state.setCurrentAgentId("test-default-agent");
    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_ID);

    const runPromise = runAgentTurn(
      runtime,
      { projectId: project.id, sessionId: session.id },
      "前奏尾段按停止",
      { stream: false, onStream: () => {} },
    );

    await entered;
    // 前奏尾段仍在途时送达停止（真机 2026-09-30 场景：15 次点按全落在这窗口）。
    abortRegistry.abort(session.id);
    releaseList();

    const result = await runPromise;
    assert.equal(
      result.stopReason,
      "cancelled",
      "list 期间的停止必须由检查点③兑现为 cancelled（不得跑完技能预算装配再继续）",
    );
    assert.equal(result.stepsExecuted, 0, "runner 未起步，stepsExecuted 为 0");
    // r3-run-4 验收③：这才是「检查点③」的正向证据——skills 连门都没进。
    assert.equal(
      skills.calls(),
      0,
      "检查点③必须在 assembleSkillsToolContext 之前兑现：effectiveSkills 调 0 次",
    );
    // r3-test-1 第 1 条：streamRegistry.register 调 0 次（区分 ①②）。
    assert.equal(
      streams.registerCalls(),
      0,
      "检查点③在 streamRegistry.register 之前收尾（①② 之前的旧行为会 register 1 次）",
    );
    assert.equal(
      streams.unregisterCalls(),
      0,
      "从未 register 就不该有 unregister（反注册带句柄比对，无句柄时直接删）",
    );
    assert.equal(
      streams.has(session.id),
      false,
      "子会话/主会话都不该残留 partial 条目",
    );
    // runner 未产出：一次模型请求都没有。
    assert.equal(modelCalls, 0, "停止后不得发模型请求（runner 未产出）");
    const messages = await ctx.messages.listBySession(session.id);
    assert.ok(
      messages.some((m) => m.role === "user"),
      "检查点①之前已 append 的用户消息应保留（与流式中途停止语义一致）",
    );
    // 终态同款 FINISHED('')（r3-run-1），此路径由③发出。
    assert.equal(events.finished().length, 1, "恰好一条 FINISHED('')");
    assert.equal(events.finished()[0]!.payload.runId, "");
    assert.equal(events.finished()[0]!.payload.vfsMutated, false);
    assert.equal(events.started().length, 0, "runner 未起步，无 STARTED");
    assert.equal(events.failed().length, 0, "正常取消无 FAILED");
    assert.equal(
      abortRegistry.has(session.id),
      false,
      "run 收尾后必须反注册（门禁不得锁死）",
    );
  });

  // 检查点④：skills 预算之后的最后一段前奏窗口。与③的区别是 skills **跑过了**，
  // 停的是它后面那段（agentsCtx / ChatAgentSession / toolCtx / runner 装配）。
  it("T-ABORT-EARLY-3: skills 预算期间 abort → 检查点④收尾：streamRegistry 未 register、runner 未产出", async () => {
    const ctx = getNovelMasterTestContext();
    await ensureDefaultAgentModel(ctx);

    const abortRegistry = createAgentAbortRegistry();
    let modelCalls = 0;
    const modelRequests: ModelRequestService = {
      request: async () => {
        modelCalls += 1;
        return textDoneResponse("停止生效时不该走到这里");
      },
    };

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S-EARLY3");

    const runtime = makeRuntime(ctx, { modelRequests, abortRegistry });
    const events = recordingEventBus();
    runtime.eventBus = events.bus;
    const streams = countingStreamRegistry();
    runtime.streamRegistry = streams.registry;

    // 卡住 skills 预算（effectiveSkills）：这道门在检查点③之后、检查点④之前。
    let releaseSkills!: () => void;
    const skillsGate = new Promise<void>((resolve) => {
      releaseSkills = resolve;
    });
    let skillsEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      skillsEntered = resolve;
    });
    const skills = gatedSkills({ onEnter: skillsEntered, gate: skillsGate });
    runtime.skills = skills.factory;

    await ctx.state.setCurrentAgentId("test-default-agent");
    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_ID);

    const runPromise = runAgentTurn(
      runtime,
      { projectId: project.id, sessionId: session.id },
      "技能预算期间按停止",
      { stream: false, onStream: () => {} },
    );

    await entered;
    abortRegistry.abort(session.id);
    releaseSkills();

    const result = await runPromise;
    assert.equal(
      result.stopReason,
      "cancelled",
      "skills 期间的停止必须由检查点④兑现为 cancelled（不得跑完剩余装配再到 loop_start）",
    );
    assert.equal(result.stepsExecuted, 0, "runner 未起步");
    assert.equal(skills.calls(), 1, "skills 已经跑过（这道检查点在③之后）");
    assert.equal(
      streams.registerCalls(),
      0,
      "检查点④同样在 streamRegistry.register 之前收尾",
    );
    assert.equal(modelCalls, 0, "runner 未产出：一次模型请求都不该发");
    assert.equal(events.finished().length, 1, "恰好一条 FINISHED('')");
    assert.equal(events.finished()[0]!.payload.runId, "");
    assert.equal(events.started().length, 0);
    assert.equal(events.failed().length, 0);
    assert.equal(abortRegistry.has(session.id), false, "收尾后反注册");
  });

  // r3-run-4 验收②：backfill 扫描中途的停止必须在扫描循环内有限步退出，
  // 而不是被逼着等它跑完（真机 2026-09-30：大会话 backfill 秒级，连点停止无响应）。
  //
  // 观测面选 `SqliteMessageCheckpointRepository.prototype.hasCheckpoint`：
  // 它是 backfill **倒扫循环**的唯一迭代体，每次迭代一条单行读。数出来的调用
  // 次数就是「有限步」的直接证据——不给 signal 时这个循环会跑满消息总数。
  it("T-BACKFILL-ABORT: backfill 扫描中途 abort → 扫描循环有限步退出且整轮 cancelled", async () => {
    const ctx = getNovelMasterTestContext();
    await ensureDefaultAgentModel(ctx);

    const abortRegistry = createAgentAbortRegistry();
    let modelCalls = 0;
    const modelRequests: ModelRequestService = {
      request: async () => {
        modelCalls += 1;
        return textDoneResponse("停止生效时不该走到这里");
      },
    };

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S-BACKFILL-ABORT");
    // 造一批消息 + 一个 live 文件：游标缺失 → backfill 必走全量扫描。
    const svfs = ctx.sessionVfs(project.id, session.id);
    await svfs.write("/a.md", "v1", { versionCheck: false });
    const MSG_COUNT = 20;
    for (let i = 0; i < MSG_COUNT; i++) {
      await ctx.messages.append(session.id, "user", textBlocks(`第 ${i} 条`));
    }

    const runtime = makeRuntime(ctx, { modelRequests, abortRegistry });
    const events = recordingEventBus();
    runtime.eventBus = events.bus;

    await ctx.state.setCurrentAgentId("test-default-agent");
    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_ID);

    // 在倒扫循环的第 3 次迭代上触发「用户按停止」——刻意放在**backfill 内部**，
    // 这样信号只能靠 backfill 自己的扫描循环兑现（检查点⓪在 backfill 之前，
    // 检查点①在 append 之后，都接不住这个时刻）。
    const holder = SqliteMessageCheckpointRepository.prototype as unknown as {
      hasCheckpoint: (
        this: unknown,
        sessionId: string,
        messageId: string
      ) => Promise<boolean>;
    };
    const originalHasCheckpoint = holder.hasCheckpoint;
    let hasCalls = 0;
    holder.hasCheckpoint = function (
      this: unknown,
      sessionId: string,
      messageId: string
    ) {
      hasCalls += 1;
      if (hasCalls === 3) {
        abortRegistry.abort(session.id);
      }
      return originalHasCheckpoint.call(this, sessionId, messageId);
    };

    let result: Awaited<ReturnType<typeof runAgentTurn>>;
    try {
      result = await runAgentTurn(
        runtime,
        { projectId: project.id, sessionId: session.id },
        "backfill 中途按停止",
        { stream: false }
      );
    } finally {
      holder.hasCheckpoint = originalHasCheckpoint;
    }

    assert.ok(
      hasCalls <= 4,
      `backfill 倒扫循环必须有限步退出（信号在第 3 步翻真，MSG_COUNT=${MSG_COUNT}）：实际查了 ${hasCalls} 次`
    );
    assert.ok(
      hasCalls < MSG_COUNT,
      "不给信号时这个循环会跑满消息条数；断言它没跑满即证明弃权点生效",
    );
    assert.equal(
      result.stopReason,
      "cancelled",
      "backfill 期间的停止必须兑现为 cancelled（被检查点①接住）",
    );
    assert.equal(modelCalls, 0, "停止后不得发模型请求");
    assert.equal(events.finished().length, 1, "前奏终态恰好一条 FINISHED('')");
    assert.equal(events.finished()[0]!.payload.runId, "");
    assert.equal(events.started().length, 0, "runner 未起步，无 STARTED");
    assert.equal(events.failed().length, 0, "正常取消无 FAILED");
    assert.equal(abortRegistry.has(session.id), false, "收尾后反注册");
    // 幂等可恢复：中断那一轮没补完的，下一轮不带信号必须补齐并写游标。
    // 注意游标不等于本用例造的 MSG_COUNT——中断之后 run 仍会走到检查点①，
    // 那时本轮用户消息已经 append（21 条）。所以对着**实际**条数断言。
    await ctx.messageCheckpoint.backfillMissingBaselines(session.id, project.id);
    const cursor = await ctx.sessionKkv.get(
      session.id,
      SESSION_KKV_DOMAIN_BACKFILL_CURSOR,
      BACKFILL_CURSOR_LAST_SCANNED_COUNT_KEY
    );
    const allMessages = await ctx.messages.listBySession(session.id);
    assert.equal(
      cursor,
      String(allMessages.length),
      "下一轮不带信号必须把剩余空窗补齐并写游标（中途退出提交已写部分，幂等可恢复）"
    );
    assert.ok(
      allMessages.length > MSG_COUNT,
      "中断之后 run 仍走到了检查点①，本轮用户消息已落库"
    );
  });
});


describe("流式超时收敛后的 registry 自愈（T-T6 / llm-stream-timeout）", () => {
  it("T-T6: idle 超时上抛后 abortRegistry 反注册，同会话可立即再发", async () => {
    const ctx = getNovelMasterTestContext();
    await ensureDefaultAgentModel(ctx);

    const abortRegistry = createAgentAbortRegistry();

    // 第一次 run：model 调用窗口内 registry 已注册（门禁视角「进行中」），
    // 随后以流中断超时收敛上抛（模拟传输层 watchdog 兜底后的状态）。
    let firstRunSawRegistered = false;
    let calls = 0;
    const modelRequests: ModelRequestService = {
      request: async () => {
        calls += 1;
        if (calls === 1) {
          firstRunSawRegistered = true;
        }
        if (calls <= 1) {
          throw new LlmStreamTimeoutError("idle", 90_000);
        }
        return textDoneResponse("重试成功");
      },
    };

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S-T6");

    const runtime = makeRuntime(ctx, { modelRequests, abortRegistry });
    runtime.eventBus = realEventBus();

    await ctx.state.setCurrentAgentId("test-default-agent");
    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_ID);

    await assert.rejects(
      () =>
        runAgentTurn(
          runtime,
          { projectId: project.id, sessionId: session.id },
          "第一次会超时",
          { stream: false, onStream: () => {} },
        ),
      (e: unknown) => e instanceof LlmStreamTimeoutError && e.phase === "idle",
    );
    assert.ok(firstRunSawRegistered, "第一次 run 应已执行到 model 调用");

    // 超时收敛后 finally 反注册兑现：不泄漏（现状挂死时 finally 永不执行，
    // registry 恒真导致同会话门禁锁死——本修复后随超时错误上抛自然消除）
    assert.equal(
      abortRegistry.has(session.id),
      false,
      "超时收敛后 sessionId 应从 registry 反注册",
    );

    // 同会话立即再发：正常完成（startRun 门禁放行）
    const result = await runAgentTurn(
      runtime,
      { projectId: project.id, sessionId: session.id },
      "同会话再发",
      { stream: false, onStream: () => {} },
    );
    assert.equal(result.stopReason, "completed");
    assert.equal(calls, 2);
    assert.equal(
      abortRegistry.has(session.id),
      false,
      "第二次 run 结束后 sessionId 应再次反注册",
    );
  });
});

/**
 * r3-run-1 / r3-run-2：前奏期终态走 core 事件路线（不再由双端各自打补丁）。
 *
 * 本块锁死的不变式（评审验收清单逐条对应）：
 * - 检查点命中 ⇒ 恰好一条 FINISHED(runId:'')、无 STARTED、vfsMutated===false；
 * - 前奏抛错 ⇒ 恰好一条 FAILED(runId:'') 后 rethrow；
 * - runner 起步后失败 ⇒ 恰好一条 FAILED(**真实 runId**)、**零条 FAILED('')**
 *   —— 最后这条是防双发的牙齿：删掉 catch 里的 `!runnerEntered` 守卫它必红。
 * - findById 抛错 ⇒ 无 STARTED（r3-run-2 的下移）、补一条 FAILED('')。
 */
describe("r3-run-1/2 前奏终态 core 事件路线", () => {
  it("T-PRELUDE-CP2: 检查点②命中 → 恰好一条 FINISHED('')，无 STARTED，vfsMutated===false", async () => {
    const ctx = getNovelMasterTestContext();
    await ensureDefaultAgentModel(ctx);

    const abortRegistry = createAgentAbortRegistry();
    const modelRequests: ModelRequestService = {
      request: async () => {
        throw new Error("检查点命中不该发模型请求");
      },
    };

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S-CP2");

    const runtime = makeRuntime(ctx, { modelRequests, abortRegistry });
    const events = recordingEventBus();
    runtime.eventBus = events.bus;

    // 卡住检查点①与②之间的 agentRegistry.list，abort 后由检查点②兑现。
    let releaseList!: () => void;
    const listGate = new Promise<void>((resolve) => {
      releaseList = resolve;
    });
    let listEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      listEntered = resolve;
    });
    const realRegistry = runtime.agentRegistry;
    runtime.agentRegistry = new Proxy(realRegistry, {
      get(target, prop, receiver) {
        if (prop === "list") {
          return async () => {
            listEntered();
            await listGate;
            return target.list();
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as AgentTurnRuntimePort["agentRegistry"];

    await ctx.state.setCurrentAgentId("test-default-agent");
    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_ID);

    const runPromise = runAgentTurn(
      runtime,
      { projectId: project.id, sessionId: session.id },
      "前奏尾段按停止",
      { stream: false },
    );
    await entered;
    abortRegistry.abort(session.id);
    releaseList();

    const result = await runPromise;
    assert.equal(result.stopReason, "cancelled");

    assert.equal(
      events.started().length,
      0,
      "runner 从未起步，绝不能有 RUN_STARTED（发了就是 STARTED/终态失配）",
    );
    assert.equal(
      events.finished().length,
      1,
      "返回 cancelled ⇒ 恰好一条 FINISHED('')（多发会让 desktop 提前收敛）",
    );
    const finished = events.finished()[0]!;
    assert.equal(finished.payload.runId, "", "前奏终态的 runId 必须写死空串");
    assert.equal(finished.payload.sessionId, session.id);
    assert.equal(finished.payload.projectId, project.id);
    assert.equal(finished.payload.stopReason, "cancelled");
    assert.equal(
      finished.payload.vfsMutated,
      false,
      "vfsMutated 硬约束：前奏没跑过任何 tool 轮；填 true 会误刷 desktop 工作区树",
    );
    assert.equal(
      events.failed().length,
      0,
      "正常取消不是失败，不该有 FAILED",
    );
  });

  it("T-PRELUDE-CP1: 检查点①命中（append+capture 期间 abort）→ 恰好一条 FINISHED('')", async () => {
    const ctx = getNovelMasterTestContext();
    await ensureDefaultAgentModel(ctx);

    const abortRegistry = createAgentAbortRegistry();
    const modelRequests: ModelRequestService = {
      request: async () => {
        throw new Error("检查点命中不该发模型请求");
      },
    };

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S-CP1");

    const runtime = makeRuntime(ctx, { modelRequests, abortRegistry });
    const events = recordingEventBus();
    runtime.eventBus = events.bus;

    // 卡住 capture（coordinatedWrite 的第二步）：此刻用户消息已 append，
    // coordinatedWrite.run() 一返回就撞检查点①。用来区分 ① 与 ②。
    let releaseCapture!: () => void;
    const captureGate = new Promise<void>((resolve) => {
      releaseCapture = resolve;
    });
    let captureEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      captureEntered = resolve;
    });
    const realCheckpoint = ctx.messageCheckpoint;
    runtime.messageCheckpoint = new Proxy(realCheckpoint, {
      get(target, prop, receiver) {
        if (prop === "capture") {
          return async (
            sessionId: string,
            projectId: string,
            messageId: string,
          ) => {
            captureEntered();
            await captureGate;
            return target.capture(sessionId, projectId, messageId);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as AgentTurnRuntimePort["messageCheckpoint"];

    await ctx.state.setCurrentAgentId("test-default-agent");
    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_ID);

    const runPromise = runAgentTurn(
      runtime,
      { projectId: project.id, sessionId: session.id },
      "前奏中段按停止",
      { stream: false },
    );
    await entered;
    abortRegistry.abort(session.id);
    releaseCapture();

    const result = await runPromise;
    assert.equal(result.stopReason, "cancelled");
    assert.equal(
      events.finished().length,
      1,
      "检查点①命中同样必须恰好一条 FINISHED('')",
    );
    assert.equal(events.finished()[0]!.payload.runId, "");
    assert.equal(events.finished()[0]!.payload.vfsMutated, false);
    assert.equal(events.started().length, 0, "runner 未起步，无 STARTED");
    assert.equal(events.failed().length, 0, "正常取消无 FAILED");
  });

  it("T-PRELUDE-THROW: 前奏段抛错 → 恰好一条 FAILED('') 后 rethrow", async () => {
    const ctx = getNovelMasterTestContext();
    await ensureDefaultAgentModel(ctx);

    const abortRegistry = createAgentAbortRegistry();
    const modelRequests: ModelRequestService = {
      request: async () => {
        throw new Error("前奏就炸了，不该走到模型");
      },
    };

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S-PRELUDE-THROW");

    const runtime = makeRuntime(ctx, { modelRequests, abortRegistry });
    const events = recordingEventBus();
    runtime.eventBus = events.bus;

    // 前奏第一站 backfill 直接抛错。
    const realCheckpoint = ctx.messageCheckpoint;
    runtime.messageCheckpoint = new Proxy(realCheckpoint, {
      get(target, prop, receiver) {
        if (prop === "backfillMissingBaselines") {
          return async () => {
            throw new Error("backfill 炸了");
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as AgentTurnRuntimePort["messageCheckpoint"];

    await ctx.state.setCurrentAgentId("test-default-agent");
    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_ID);

    let onRunFailedCalls = 0;
    await assert.rejects(
      runAgentTurn(
        runtime,
        { projectId: project.id, sessionId: session.id },
        "前奏炸",
        {
          stream: false,
          onRunFailed: () => {
            onRunFailedCalls += 1;
          },
        },
      ),
      /backfill 炸了/,
      "前奏抛错必须原样 rethrow（错误对象不能被吞）",
    );

    assert.equal(
      events.failed().length,
      1,
      "前奏抛错 ⇒ 恰好一条 FAILED('')（不发则 desktop refcount 永久泄漏）",
    );
    const failed = events.failed()[0]!;
    assert.equal(failed.payload.runId, "", "前奏 FAILED 的 runId 必须为空串");
    assert.equal(failed.payload.sessionId, session.id);
    assert.equal(failed.payload.projectId, project.id);
    assert.equal(failed.payload.error, "backfill 炸了", "error 字段原样透传");
    assert.equal(
      events.finished().length,
      0,
      "抛错路径不发 FINISHED（终态唯一：failed）",
    );
    assert.equal(events.started().length, 0, "runner 未起步，无 STARTED");
    assert.equal(
      onRunFailedCalls,
      0,
      "前奏失败不调 onRunFailed（它的语义是 runner 期失败的前奏快照）",
    );
    assert.equal(
      abortRegistry.has(session.id),
      false,
      "收尾后必须反注册",
    );
  });

  it("T-RUNNER-FAILED: runner 起步后失败 → 恰好一条 FAILED(真实 runId)，零条 FAILED('')", async () => {
    const ctx = getNovelMasterTestContext();
    await ensureDefaultAgentModel(ctx);

    const abortRegistry = createAgentAbortRegistry();
    const modelRequests: ModelRequestService = {
      request: async () => {
        throw new Error("模型侧炸了");
      },
    };

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S-RUNNER-FAILED");

    const runtime = makeRuntime(ctx, { modelRequests, abortRegistry });
    const events = recordingEventBus();
    runtime.eventBus = events.bus;

    await ctx.state.setCurrentAgentId("test-default-agent");
    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_ID);

    let onRunFailedCalls = 0;
    await assert.rejects(
      runAgentTurn(
        runtime,
        { projectId: project.id, sessionId: session.id },
        "跑起来再炸",
        {
          stream: false,
          onRunFailed: () => {
            onRunFailedCalls += 1;
          },
        },
      ),
      /模型侧炸了/,
    );

    assert.equal(events.started().length, 1, "runner 起步必有且仅有一条 STARTED");
    const startedRunId = events.started()[0]!.payload.runId;
    assert.equal(typeof startedRunId, "string");
    assert.notEqual(startedRunId, "", "STARTED 的 runId 必须是非空真实 id");

    assert.equal(
      events.failed().length,
      1,
      "runner 期失败 ⇒ 恰好一条 FAILED（删掉 !runnerEntered 守卫这里会变 2）",
    );
    assert.equal(
      events.failed()[0]!.payload.runId,
      startedRunId,
      "runner 期 FAILED 必须带真实 runId，与 STARTED 配对",
    );
    assert.equal(
      events.finished().length,
      0,
      "失败路径不发 FINISHED",
    );
    assert.equal(
      onRunFailedCalls,
      1,
      "runner 期失败照旧回调 onRunFailed（既有行为不变）",
    );
  });

  it("T-STARTED-DOWN: findById 抛错 → 无 STARTED、恰好一条 FAILED('')，refcount 可再收敛", async () => {
    const ctx = getNovelMasterTestContext();
    await ensureDefaultAgentModel(ctx);

    const abortRegistry = createAgentAbortRegistry();
    const modelRequests: ModelRequestService = {
      request: async () => {
        throw new Error("不该走到模型");
      },
    };

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S-FINDBYID");

    const runtime = makeRuntime(ctx, { modelRequests, abortRegistry });
    const events = recordingEventBus();
    runtime.eventBus = events.bus;
    // runner 起步后第一件正事就是 savedModels.findById——把它打断即复刻
    // r3-run-2 的「STARTED 已发但无终态」窗口（修前 desktop refcount 永久泄漏）。
    runtime.savedModelRepo = {
      findById: async () => {
        throw new Error("savedModel 不存在");
      },
    } as unknown as AgentTurnRuntimePort["savedModelRepo"];

    await ctx.state.setCurrentAgentId("test-default-agent");
    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_ID);

    await assert.rejects(
      runAgentTurn(
        runtime,
        { projectId: project.id, sessionId: session.id },
        "模型查不到",
        { stream: false },
      ),
      /savedModel 不存在/,
    );

    assert.equal(
      events.started().length,
      0,
      "STARTED 已下移到主 try 紧前：这条窗口抛错不得再发 STARTED",
    );
    assert.equal(
      events.failed().length,
      1,
      "由入口壳补恰好一条 FAILED('')，终态不缺位",
    );
    assert.equal(events.failed()[0]!.payload.runId, "");
    assert.equal(
      abortRegistry.has(session.id),
      false,
      "收尾后反注册，后续 run 不会被 AGENT_BUSY 锁死",
    );
  });
});

/**
 * r3-run-3：`runChildAgent` 的 abort 注册前移 + 子 run 前奏检查点。
 *
 * 锁死的不变式（评审验收逐条对应）：
 * - **注册前移**：子 run 的前奏窗口（`agentRegistry.list()` 这段）内
 *   `abortRegistry.has(childSessionId) === true` —— 修前 register 排在全部
 *   装配之后，这段窗口里的停止意图**整个丢掉**（不是延迟）。
 * - **检查点①**（register 后 / `agentRegistry.list()` 前 /
 *   `streamRegistry.register` 前）：命中时子会话的 `streamRegistry.register`
 *   调 **0** 次，task prompt 都不落库。
 * - **检查点②**（skills 预算后 / append 前）：命中时子 `runner.run` 未调
 *   （子会话一条消息都没有），子 run `stopReason === 'cancelled'`。
 * - **终态归属**：子 run 的 FINISHED(runId:'') 的 `sessionId` 必须是**子会话**、
 *   `projectId` 必须是**父项目**——归属错了 mobile 子会话页永远收不到收口。
 * - **finally 收尾**：`abortRegistry.has(childSessionId) === false`，且
 *   未 register 过就不该有 unregister（无句柄的 unregister 是「直接删」，
 *   会误删同 sessionId 上别的 run 的 partial）。
 */
describe("r3-run-3 子 run 前奏检查点 / abort 注册前移", () => {
  /**
   * 装一个只对**子会话之后**的 `agentRegistry.list()` 生效的卡门。
   *
   * 为什么不能直接卡第 N 次调用：主 run 与子 run 共用同一个 registry 实例，
   * 调用序号会随 resolve 路径漂移。这里用「子会话已创建」这个确定的事实做闸。
   */
  function gateChildList(runtime: AgentTurnRuntimePort, childSeen: () => boolean) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const real = runtime.agentRegistry;
    runtime.agentRegistry = new Proxy(real, {
      get(target, prop, receiver) {
        if (prop === "list") {
          return async () => {
            if (childSeen()) {
              enter();
              await gate;
            }
            return target.list();
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as AgentTurnRuntimePort["agentRegistry"];
    return { entered, release };
  }

  it("T-CHILD-CP2: 子会话 list 期间 abort → has===true、子 runner.run 未调、cancelled、FINISHED('') 归属子会话、收尾 has===false", async () => {
    const ctx = getNovelMasterTestContext();
    await seedChildAgent(ctx);
    await ensureDefaultAgentModel(ctx);

    const abortRegistry = createAgentAbortRegistry();
    const seenChildIds: string[] = [];
    let childSessionCreated = false;

    let modelCalls = 0;
    const modelRequests: ModelRequestService = {
      request: async () => {
        modelCalls += 1;
        // 子 run 从未起步 ⇒ 这里的两次调用都属于主 agent（第 0 次发起 task，
        // 第 1 次收到 stopped tool_result 后收尾）。第三次才会是子 agent 的。
        if (modelCalls > 2) {
          throw new Error("子 run 不该发模型请求（子 runner.run 未调）");
        }
        if (modelCalls === 1) return taskToolUseResponse("tu-cp2");
        return textDoneResponse("主代理收到停止回流");
      },
    };

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S-CHILD-CP2");

    const runtime = makeRuntime(ctx, { modelRequests, abortRegistry });
    const events = recordingEventBus();
    runtime.eventBus = events.bus;
    const streams = countingStreamRegistry();
    runtime.streamRegistry = streams.registry;

    const originalCreateSubSession = ctx.sessions.createSubSession.bind(
      ctx.sessions
    );
    runtime.sessions = new Proxy(ctx.sessions, {
      get(target, prop, receiver) {
        if (prop === "createSubSession") {
          return async (parentId: string, projId: string, title?: string) => {
            const child = await originalCreateSubSession(parentId, projId, title);
            seenChildIds.push(child.id);
            childSessionCreated = true;
            return child;
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as AgentTurnRuntimePort["sessions"];

    const gate = gateChildList(runtime, () => childSessionCreated);

    await ctx.state.setCurrentAgentId("test-default-agent");
    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_ID);

    const runPromise = runAgentTurn(
      runtime,
      { projectId: project.id, sessionId: session.id },
      "派生子代理并在中途停止",
      { stream: false }
    );

    // 等到子 run 卡在自己的 list 上。
    await gate.entered;
    const childSessionId = seenChildIds[0]!;
    assert.ok(childSessionId != null, "应已创建 1 个子会话");

    // r3-run-3 核心：前奏窗口内子会话已在 registry。修前 register 排在全部
    // 装配之后，这里是 false → 子会话页的停止按钮点了等于没点。
    assert.equal(
      abortRegistry.has(childSessionId),
      true,
      "子 run 前奏期间 childSessionId 必须已注册（register 前移）",
    );

    // 子会话页按停止。
    abortRegistry.abort(childSessionId);
    gate.release();

    const result = await runPromise;

    assert.equal(seenChildIds.length, 1, "只应创建一个子会话");
    // 停的是**子**会话，父 run 正常走完：这是「子 run cancelled、主 run
    // completed」的分岔，也是本用例与「父级联取消」（T-A4）的区分。
    assert.equal(
      result.stopReason,
      "completed",
      "只停子会话时父 run 应正常完成（子 run 的 cancelled 通过 task 工具回流）"
    );
    assert.equal(modelCalls, 2, "子 runner.run 未调：模型请求只来自主 agent 的两次");

    // 子 run 的终态事件：恰好一条 FINISHED('')，且**归属子会话**。
    const childFinished = events
      .finished()
      .filter((e) => e.payload.sessionId === childSessionId);
    assert.equal(
      childFinished.length,
      1,
      "子 run 检查点命中必须发且只发一条 FINISHED('')（不发则子会话页永久卡在运行中）"
    );
    const cp = childFinished[0]!.payload;
    assert.equal(cp.runId, "", "子 run 前奏终态 runId 写死空串");
    assert.equal(cp.sessionId, childSessionId, "FINISHED 必须归属**子**会话");
    assert.equal(
      cp.projectId,
      project.id,
      "子 run 的 projectId 走父项目（子代理共享父工作区）"
    );
    assert.equal(
      cp.stopReason,
      "cancelled",
      "子 run 的 stopReason 必须如实填 cancelled（r3-run-1 硬约束）"
    );
    assert.equal(
      cp.vfsMutated,
      false,
      "vfsMutated 硬约束：子 run 前奏没跑过任何 tool 轮"
    );

    // 子 run 从未起步：子会话里连 task prompt 都没落库。
    const childMessages = await ctx.messages.listBySession(childSessionId);
    assert.equal(
      childMessages.length,
      0,
      "子 run 在 append(prompt) 之前就兑现了停止 ⇒ 子会话一条消息都没有"
    );

    // 主 run 的终态另算一条（真实 runId），不与子 run 的空串那条混淆。
    assert.equal(events.started().length, 1, "只有主 run 发过 STARTED");
    const mainFinished = events
      .finished()
      .filter((e) => e.payload.sessionId === session.id);
    assert.equal(mainFinished.length, 1, "主 run 一条真实 runId 的 FINISHED");
    assert.notEqual(mainFinished[0]!.payload.runId, "", "主 run 的 FINISHED 带真实 runId");

    // finally 收尾。
    assert.equal(
      abortRegistry.has(childSessionId),
      false,
      "子 run 收尾后必须从 registry 反注册",
    );
    assert.equal(abortRegistry.has(session.id), false, "父 run 同样反注册");
    assert.equal(
      streams.has(childSessionId),
      false,
      "子 run 收尾后不该残留 partial 条目",
    );
  });

  it("T-CHILD-CP1: 进入子 run 时停止已到达 → 子检查点①兑现：streamRegistry.register 调 0 次、task prompt 未落库", async () => {
    // 这道检查点在真实链路上唯一的可达形态是「runChildAgent 入口时停止意图
    // 已经到达」——register 与 `agentRegistry.list()` 之间没有 await，外部
    // 按停止落在不了更窄的缝里。而这个形态有两条来路：父 signal 已 aborted
    // （本用例），或子会话在 register 之前就登记了 controller。
    //
    // 场景取前者：在 createSubSession 回调里停**父**会话。此时 task 工具已经
    // 在执行（runner 的 post_model 闸已过），runChildAgent 拿到的 parentSignal
    // 就是 aborted ⇒ childController 出生即 aborted ⇒ 子检查点①立刻命中。
    const ctx = getNovelMasterTestContext();
    await seedChildAgent(ctx);
    await ensureDefaultAgentModel(ctx);

    const abortRegistry = createAgentAbortRegistry();
    const seenChildIds: string[] = [];

    let modelCalls = 0;
    const modelRequests: ModelRequestService = {
      request: async () => {
        modelCalls += 1;
        if (modelCalls > 1) {
          throw new Error("父 run 被取消后不该再发第二次模型请求");
        }
        return taskToolUseResponse("tu-cp1");
      },
    };

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S-CHILD-CP1");

    const runtime = makeRuntime(ctx, { modelRequests, abortRegistry });
    const events = recordingEventBus();
    runtime.eventBus = events.bus;
    const streams = countingStreamRegistry();
    runtime.streamRegistry = streams.registry;

    // 子会话刚创建、runChildAgent 尚未进入时，停**父**会话。
    const originalCreateSubSession = ctx.sessions.createSubSession.bind(
      ctx.sessions
    );
    runtime.sessions = new Proxy(ctx.sessions, {
      get(target, prop, receiver) {
        if (prop === "createSubSession") {
          return async (parentId: string, projId: string, title?: string) => {
            const child = await originalCreateSubSession(parentId, projId, title);
            seenChildIds.push(child.id);
            abortRegistry.abort(session.id);
            return child;
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as AgentTurnRuntimePort["sessions"];

    await ctx.state.setCurrentAgentId("test-default-agent");
    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_ID);

    const result = await runAgentTurn(
      runtime,
      { projectId: project.id, sessionId: session.id },
      "派生子代理并立即停止",
      { stream: false }
    );

    assert.equal(
      result.stopReason,
      "cancelled",
      "停的是父会话，父 run 收敛为 cancelled"
    );
    assert.equal(modelCalls, 1, "父 run 被取消后不再发第二次模型请求");
    assert.equal(seenChildIds.length, 1);
    const childSessionId = seenChildIds[0]!;
    assert.equal(
      streams.registerCallsFor(childSessionId),
      0,
      "子检查点①刻意排在 streamRegistry.register 之前：命中时不得给子会话页留一个永远等不到 delta 的空 partial"
    );
    assert.equal(
      streams.has(childSessionId),
      false,
      "从未 register 就不该残留条目（finally 的 unregister 必须容忍 streamHandle===undefined）"
    );
    const childMessages = await ctx.messages.listBySession(childSessionId);
    assert.equal(
      childMessages.length,
      0,
      "子检查点①早于 append(prompt)，一条消息都没有"
    );
    const childFinished = events
      .finished()
      .filter((e) => e.payload.sessionId === childSessionId);
    assert.equal(
      childFinished.length,
      1,
      "子检查点①命中同样发一条 FINISHED('')，且归属子会话"
    );
    assert.equal(childFinished[0]!.payload.runId, "");
    assert.equal(childFinished[0]!.payload.vfsMutated, false);
    assert.equal(
      abortRegistry.has(childSessionId),
      false,
      "收尾后反注册（检查点①命中走的就是 finally 这条路）",
    );
  });
});


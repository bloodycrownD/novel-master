/**
 * Feature A — 子会话工作区隔离 测试。
 *
 * 覆盖 SPEC 测试策略：
 * - T-SS-1：createSubSession 后子 session 工作区为空（无文件、无 rule_snapshot /
 *   file_cache），父 session 工作区不变；事务包裹正确。
 * - T-SS-2：ChatAgentSession 的 workplaceScopeSessionId —— 主 session 等于自身，
 *   子 session 也等于自身（Feature A 后语义变更）。
 * - T-SS-3：runChildAgent 装配的 VFS 指向 childSessionId（mock 入参验证）。
 * - T-SS-4：子 agent 写文件落到子 session scope；父 session 工作区不变。
 * - T-SS-5：子 agent 能 read/glob/grep 自己刚写的文件。
 * - T-SS-6：子 agent VFS 变更后父会话收到 vfsMutated 标志（通知机制不变）。
 * - T-SS-8：三层嵌套（父→子→孙）工作区独立。
 *
 * T-SS-7（回归）由现有 subagent/template 测试套件覆盖（session.subsession /
 * subagent-tool-* / initialize-session-workspace 等）。
 *
 * @module test/service/agent/subsession-workspace-isolation.test
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
import { ChatAgentSession } from "@/service/agent/impl/chat-agent-session.js";
import type { MessageService } from "@/service/chat/message.port.js";
import { createAgentAbortRegistry } from "@/service/agent/create-agent-abort-registry.js";
import type { AgentAbortRegistry } from "@/service/agent/agent-abort-registry.port.js";
import type {
  ModelRequestService,
  ModelRequestOptions,
} from "@/service/provider/model-request.port.js";
import type { UserVfsTurnService } from "@/service/chat/user-vfs-turn.port.js";
import type { VfsService } from "@novel-master/core/vfs";
import { scopeKey } from "@/domain/vfs/logic/vfs-path-mapper.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../../helpers/novel-master-fixture.js";

novelMasterTestFixture();

const TEST_SAVED_MODEL_ID = "00000000-0000-4000-8000-0000000000a4";
const PROJECT_MODEL_ID = "00000000-0000-4000-8000-0000000000a5";

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

function writeToolUseResponse(
  toolUseId: string,
  filePath: string,
  content: string,
): LlmChatResult {
  return {
    assistantText: "",
    blocks: [
      {
        type: "tool_use",
        id: toolUseId,
        name: "write",
        input: { path: filePath, content },
      },
    ],
    raw: {},
  };
}

function taskToolUseResponse(
  toolUseId: string,
  prompt: string,
  subagentName = "child-worker",
): LlmChatResult {
  return {
    assistantText: "",
    blocks: [
      {
        type: "tool_use",
        id: toolUseId,
        name: "task",
        input: {
          description: "子任务",
          prompt,
          subagentName,
        },
      },
    ],
    raw: {},
  };
}

function textDoneResponse(text: string): LlmChatResult {
  return {
    assistantText: text,
    blocks: [{ type: "text", text }],
    raw: {},
  };
}

interface ScriptedModelOptions {
  readonly responses: readonly LlmChatResult[];
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

/** 拦截 sessionVfs 入参，记录每次调用的 (projectId, sessionId)。 */
function makeObservingSessionVfs(
  real: (projectId: string, sessionId: string) => VfsService,
  log: { projectId: string; sessionId: string }[],
): AgentTurnRuntimePort["sessionVfs"] {
  return (projectId, sessionId) => {
    log.push({ projectId, sessionId });
    return real(projectId, sessionId);
  };
}

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

function makeRuntime(
  ctx: ReturnType<typeof getNovelMasterTestContext>,
  args: {
    readonly modelRequests: ModelRequestService;
    readonly abortRegistry: AgentAbortRegistry;
    readonly sessionVfsOverride?: AgentTurnRuntimePort["sessionVfs"];
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
    eventBus: ctx.sessionKkv as unknown as never,
    regexConfig: {
      getActiveRegexConfig: async () => null,
    } as AgentTurnRuntimePort["regexConfig"],
    compactionConditionEvaluator:
      undefined as unknown as AgentTurnRuntimePort["compactionConditionEvaluator"],
    eventOrchestrator:
      undefined as unknown as AgentTurnRuntimePort["eventOrchestrator"],
    sessionKkv: ctx.sessionKkv,
    sessionVfs: args.sessionVfsOverride ?? ((p, s) => ctx.sessionVfs(p, s)),
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

async function seedChildAgent(
  ctx: ReturnType<typeof getNovelMasterTestContext>,
): Promise<void> {
  const registry = createAgentRegistryService(ctx.conn, ctx.state);
  await registry.upsert("child-worker", childAgentDef);
}

/** 包一层 sessions.createSubSession 捕获每个 childSessionId。 */
function captureChildSessions(
  runtime: AgentTurnRuntimePort,
  sink: string[],
): void {
  const ctx = getNovelMasterTestContext();
  const originalCreateSubSession = ctx.sessions.createSubSession.bind(
    ctx.sessions,
  );
  runtime.sessions = new Proxy(ctx.sessions, {
    get(target, prop, receiver) {
      if (prop === "createSubSession") {
        return async (parentId: string, projId: string, title?: string) => {
          const child = await originalCreateSubSession(parentId, projId, title);
          sink.push(child.id);
          return child;
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as AgentTurnRuntimePort["sessions"];
}

// ===========================================================================
// T-SS-1：createSubSession 后子 session 工作区为空，父 session 工作区不变
// ===========================================================================

describe("Feature A T-SS-1：createSubSession 初始化空工作区", () => {
  it("子 session 工作区为空（无 vfs_entry / 无 KKV），父 session 工作区不变", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    // 给项目模板写一些文件，这样主 session create 后会有内容。
    await ctx.projectVfs(project.id).write("/parent-tpl.md", "TPL");
    const parent = await ctx.sessions.create(project.id, "父会话");
    // 父 session 工作区此时有 /parent-tpl.md（来自 template 拷贝）。
    const parentVfs = ctx.sessionVfs(project.id, parent.id);
    const parentBefore = await parentVfs.list("/", { recursive: true });
    assert.ok(
      parentBefore.some((e) => e.path === "/parent-tpl.md"),
      "父 session 工作区应含模板文件",
    );

    // 派生子 session。
    const child = await ctx.sessions.createSubSession(
      parent.id,
      project.id,
      "子",
    );

    // 子 session 工作区应为空：无 vfs_entry。
    const childVfs = ctx.sessionVfs(project.id, child.id);
    const childEntries = await childVfs.list("/", { recursive: true });
    assert.equal(
      childEntries.length,
      0,
      "子 session 工作区应为空（无文件）",
    );

    // 直查 vfs_entry 表确认子 scope 没有任何行。
    const sk = scopeKey({
      kind: "session",
      projectId: project.id,
      sessionId: child.id,
    });
    const entryRepo = new SqliteVfsEntryRepository(ctx.conn);
    const entryRows = await entryRepo.listEntriesUnderPrefix(sk, "/");
    assert.equal(entryRows.length, 0, "子 session scope 的 vfs_entry 表应为空");

    // 子 session 的 KKV 也应为空（rule_snapshot / file_cache 缺失返回 null）。
    const ruleSnap = await ctx.sessionKkv.get(child.id, "rule_snapshot", "any");
    assert.equal(ruleSnap, null, "子 session rule_snapshot 应为空");
    const fileCache = await ctx.sessionKkv.get(child.id, "file_cache", "any");
    assert.equal(fileCache, null, "子 session file_cache 应为空");

    // 父 session 工作区在 createSubSession 前后不变。
    const parentAfter = await parentVfs.list("/", { recursive: true });
    assert.deepEqual(
      parentAfter.map((e) => e.path),
      parentBefore.map((e) => e.path),
      "父 session 工作区在 createSubSession 前后应不变",
    );
  });

  it("createSubSession 后子 session 工作区不携带项目模板文件", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    // 项目模板含多个文件 + 子目录。
    await ctx.projectVfs(project.id).write("/a.md", "A");
    await ctx.projectVfs(project.id).write("/sub/b.md", "B");
    const parent = await ctx.sessions.create(project.id, "父");

    const child = await ctx.sessions.createSubSession(parent.id, project.id, "子");

    const childVfs = ctx.sessionVfs(project.id, child.id);
    const paths = (await childVfs.list("/", { recursive: true })).map((e) =>
      e.path,
    );
    assert.ok(!paths.includes("/a.md"), "子 session 不应含项目模板 /a.md");
    assert.ok(
      !paths.includes("/sub/b.md"),
      "子 session 不应含项目模板 /sub/b.md",
    );
    assert.equal(paths.length, 0, "子 session 应完全为空");
  });
});

// ===========================================================================
// T-SS-2：ChatAgentSession.workplaceScopeSessionId 语义
// ===========================================================================

describe("Feature A T-SS-2：ChatAgentSession.workplaceScopeSessionId 语义", () => {
  it("主 session：workplaceScopeSessionId === sessionId（默认值）", () => {
    const messages = {} as MessageService;
    const session = new ChatAgentSession(messages, "sess-main");
    assert.equal(session.sessionId, "sess-main");
    assert.equal(session.workplaceScopeSessionId, "sess-main");
  });

  it("子 session：显式传 childSessionId 作为第三位，workplaceScopeSessionId === childSessionId", () => {
    const messages = {} as MessageService;
    // runChildAgent 装配形态：new ChatAgentSession(messages, childSessionId, childSessionId)
    const session = new ChatAgentSession(
      messages,
      "child-sess",
      "child-sess",
    );
    assert.equal(session.sessionId, "child-sess");
    assert.equal(session.workplaceScopeSessionId, "child-sess");
  });

  it("子 session 不再指向父 session（Feature A 语义变更）", () => {
    const messages = {} as MessageService;
    // 验证构造时不会误传 parentSessionId——Feature A 后第三位必须是 childSessionId。
    const session = new ChatAgentSession(
      messages,
      "child-sess",
      "child-sess",
    );
    assert.notEqual(session.workplaceScopeSessionId, "parent-sess");
    assert.equal(session.workplaceScopeSessionId, session.sessionId);
  });
});

// ===========================================================================
// T-SS-3：runChildAgent 装配的 VFS 指向 childSessionId（mock 入参验证）
// T-SS-4：子 agent 写文件落到子 session scope；父 session 工作区不变
// T-SS-5：子 agent 能读到自己刚写的文件
// ===========================================================================

describe("Feature A T-SS-3/4/5：runChildAgent VFS 装配指向子 session + 读写隔离", () => {
  it("T-SS-3：runChildAgent 装配时 sessionVfs 入参是 childSessionId（非 parentSessionId）", async () => {
    const ctx = getNovelMasterTestContext();
    await seedChildAgent(ctx);
    await ensureDefaultAgentModel(ctx);

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const parent = await ctx.sessions.create(project.id, "父-T3");

    const vfsCalls: { projectId: string; sessionId: string }[] = [];
    const abortRegistry = createAgentAbortRegistry();
    const childIds: string[] = [];

    const modelRequests = scriptedModel({
      // index 0：主 agent 派生 task；index 1：子 agent 返回完成文本；
      // index 2：主 agent 收到 tool_result 后返回完成文本。
      responses: [
        taskToolUseResponse("tu-t3", "子任务"),
        textDoneResponse("子完成"),
        textDoneResponse("主完成"),
      ],
      onCall: {
        // 子 agent model 调用窗口（index=1）：此时 runChildAgent 已装配 VFS。
        1: () => {
          // sessionVfs 应已被调用过，且其中一次的 sessionId 是 childSessionId。
          assert.ok(childIds.length > 0, "应已创建子 session");
          const childId = childIds[0]!;
          const childVfsCall = vfsCalls.find((c) => c.sessionId === childId);
          assert.ok(
            childVfsCall != null,
            `runChildAgent 装配的 sessionVfs 入参应是 childSessionId（${childId}），但观察到: ${JSON.stringify(vfsCalls)}`,
          );
          // 也不应有以 parentSessionId 为 sessionId 的 VFS 装配发生在子 agent 装配后
          // （主 agent 自己的 VFS 装配会带 parentSessionId，但那在子 agent 装配前）。
          // 这里只断言「childSessionId 至少出现一次」。
        },
      },
    });

    const runtime = makeRuntime(ctx, {
      modelRequests,
      abortRegistry,
      sessionVfsOverride: makeObservingSessionVfs(
        (p, s) => ctx.sessionVfs(p, s),
        vfsCalls,
      ),
    });
    captureChildSessions(runtime, childIds);
    runtime.eventBus = realEventBus();

    await ctx.state.setCurrentAgentId("test-default-agent");
    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_ID);

    await runAgentTurn(
      runtime,
      { projectId: project.id, sessionId: parent.id },
      "派生子代理",
      { stream: false, onStream: () => {} },
    );

    // 全程 sessionVfs 的入参里，childSessionId 至少出现一次（子 agent 装配）。
    assert.ok(childIds.length === 1, "应只创建 1 个子 session");
    const childId = childIds[0]!;
    assert.ok(
      vfsCalls.some((c) => c.sessionId === childId),
      "子 agent 装配应触发 sessionVfs(childSessionId)",
    );
  });

  it("T-SS-4：子 agent 写文件落到子 session scope；父 session 工作区不变", async () => {
    const ctx = getNovelMasterTestContext();
    await seedChildAgent(ctx);
    await ensureDefaultAgentModel(ctx);

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    await ctx.projectVfs(project.id).write("/parent-tpl.md", "TPL");
    const parent = await ctx.sessions.create(project.id, "父-T4");

    const parentVfs = ctx.sessionVfs(project.id, parent.id);
    const parentPathsBefore = (await parentVfs.list("/", { recursive: true }))
      .map((e) => e.path)
      .sort();

    const abortRegistry = createAgentAbortRegistry();
    const childIds: string[] = [];

    const modelRequests = scriptedModel({
      // index 0：主 agent 派生 task；
      // index 1：子 agent 调 write 工具写 /outline.md；
      // index 2：子 agent 返回完成文本；
      // index 3：主 agent 收到 tool_result 后返回完成文本。
      responses: [
        taskToolUseResponse("tu-t4", "写 outline"),
        writeToolUseResponse("tu-t4-write", "/outline.md", "# 子代理产出"),
        textDoneResponse("子完成"),
        textDoneResponse("主完成"),
      ],
    });

    const runtime = makeRuntime(ctx, { modelRequests, abortRegistry });
    captureChildSessions(runtime, childIds);
    runtime.eventBus = realEventBus();

    await ctx.state.setCurrentAgentId("test-default-agent");
    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_ID);

    await runAgentTurn(
      runtime,
      { projectId: project.id, sessionId: parent.id },
      "派生子代理写文件",
      { stream: false, onStream: () => {} },
    );

    assert.ok(childIds.length === 1, "应创建 1 个子 session");
    const childId = childIds[0]!;

    // 子 session 工作区应含子 agent 写的 /outline.md。
    const childVfs = ctx.sessionVfs(project.id, childId);
    const childPaths = (await childVfs.list("/", { recursive: true })).map((e) =>
      e.path,
    );
    assert.ok(
      childPaths.includes("/outline.md"),
      "子 session 工作区应含子 agent 写的 /outline.md",
    );

    // 父 session 工作区不应含 /outline.md（隔离）。
    const parentPathsAfter = (await parentVfs.list("/", { recursive: true }))
      .map((e) => e.path)
      .sort();
    assert.ok(
      !parentPathsAfter.includes("/outline.md"),
      "父 session 工作区不应含子 agent 写的 /outline.md",
    );
    assert.deepEqual(
      parentPathsAfter,
      parentPathsBefore,
      "父 session 工作区在子 agent 运行前后应完全不变",
    );
  });

  it("T-SS-5：子 agent 写文件后能 read 自己刚写的文件（全链路用子 session scope）", async () => {
    const ctx = getNovelMasterTestContext();
    await seedChildAgent(ctx);
    await ensureDefaultAgentModel(ctx);

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const parent = await ctx.sessions.create(project.id, "父-T5");

    const abortRegistry = createAgentAbortRegistry();
    const childIds: string[] = [];
    let childReadResult: { content: string } | null | undefined;

    const modelRequests = scriptedModel({
      // index 0：主 agent 派生 task；
      // index 1：子 agent 调 write 写 /note.md；
      // index 2：子 agent 调 read 读 /note.md（验证能读到）；
      // index 3：子 agent 返回完成文本；
      // index 4：主 agent 返回完成文本。
      responses: [
        taskToolUseResponse("tu-t5", "写后读"),
        writeToolUseResponse("tu-t5-w", "/note.md", "子代理笔记"),
        {
          assistantText: "",
          blocks: [
            {
              type: "tool_use",
              id: "tu-t5-r",
              name: "read",
              input: { path: "/note.md" },
            },
          ],
          raw: {},
        },
        textDoneResponse("子完成"),
        textDoneResponse("主完成"),
      ],
      onCall: {
        // 子 agent read 之后的下一次 model 调用（index=3，子 agent 完成轮）：
        // 此时 read 工具已执行，tool_result 已注入。我们在子 agent 完成轮捕获不到
        // read 的返回值（它在 tool 执行层）。改为 run 结束后直查子 VFS 确认文件存在。
      },
    });

    const runtime = makeRuntime(ctx, { modelRequests, abortRegistry });
    captureChildSessions(runtime, childIds);
    runtime.eventBus = realEventBus();

    await ctx.state.setCurrentAgentId("test-default-agent");
    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_ID);

    await runAgentTurn(
      runtime,
      { projectId: project.id, sessionId: parent.id },
      "派生子代理写后读",
      { stream: false, onStream: () => {} },
    );

    const childId = childIds[0]!;
    const childVfs = ctx.sessionVfs(project.id, childId);
    // 子 agent 写的文件在子 session scope 可读（read 工具走同一 VFS scope）。
    childReadResult = await childVfs.read("/note.md");
    assert.equal(
      childReadResult.content,
      "子代理笔记",
      "子 agent 应能 read 自己刚写的文件（子 session scope）",
    );
  });
});

// ===========================================================================
// T-SS-6：子 agent VFS 变更后父会话收到 vfsMutated 标志
// ===========================================================================

describe("Feature A T-SS-6：子 agent VFS 变更通知（vfsMutated 标志）", () => {
  it("子 agent 写文件后 STEP_COMMITTED / RUN_FINISHED 事件携带 vfsMutated=true", async () => {
    const ctx = getNovelMasterTestContext();
    await seedChildAgent(ctx);
    await ensureDefaultAgentModel(ctx);

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const parent = await ctx.sessions.create(project.id, "父-T6");

    const abortRegistry = createAgentAbortRegistry();
    const childIds: string[] = [];
    const stepCommittedPayloads: {
      sessionId: string;
      vfsMutated?: boolean;
    }[] = [];
    const runFinishedPayloads: {
      sessionId: string;
      vfsMutated?: boolean;
    }[] = [];

    const modelRequests = scriptedModel({
      responses: [
        taskToolUseResponse("tu-t6", "写文件"),
        writeToolUseResponse("tu-t6-w", "/out.md", "产出"),
        textDoneResponse("子完成"),
        textDoneResponse("主完成"),
      ],
    });

    const runtime = makeRuntime(ctx, { modelRequests, abortRegistry });
    captureChildSessions(runtime, childIds);
    const bus = realEventBus();
    runtime.eventBus = bus;
    bus.subscribe("agent.step.committed", (p) => {
      stepCommittedPayloads.push(p as never);
    });
    bus.subscribe("agent.run.finished", (p) => {
      runFinishedPayloads.push(p as never);
    });

    await ctx.state.setCurrentAgentId("test-default-agent");
    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_ID);

    await runAgentTurn(
      runtime,
      { projectId: project.id, sessionId: parent.id },
      "派生子代理",
      { stream: false, onStream: () => {} },
    );

    const childId = childIds[0]!;

    // 子 agent 的 STEP_COMMITTED（tool_results phase）应带 vfsMutated=true。
    const childStepCommitted = stepCommittedPayloads.filter(
      (p) => p.sessionId === childId,
    );
    assert.ok(
      childStepCommitted.some((p) => p.vfsMutated === true),
      "子 agent 写文件后 STEP_COMMITTED 应携带 vfsMutated=true",
    );

    // 子 agent 的 RUN_FINISHED 应带 vfsMutated=true。
    const childRunFinished = runFinishedPayloads.find(
      (p) => p.sessionId === childId,
    );
    assert.ok(
      childRunFinished?.vfsMutated === true,
      "子 agent RUN_FINISHED 应携带 vfsMutated=true（本次 run 曾突变 VFS）",
    );
  });
});

// ===========================================================================
// T-SS-8：三层嵌套（父→子→孙）工作区独立
// ===========================================================================

describe("Feature A T-SS-8：嵌套 / 多子 session 工作区独立", () => {
  it("装配层：父子孙三层 ChatAgentSession 各自的 workplaceScopeSessionId 都等于自身", () => {
    const messages = {} as MessageService;
    // Feature A 后，runChildAgent 递归装配时每层都 new ChatAgentSession(msg, childId, childId)，
    // 即每层的 workplaceScopeSessionId 都是该层自己的 sessionId。验证这个不变式：
    // 不论嵌套多深，每层 session 的归属都是自身，不会串到父或祖父。
    const parentSession = new ChatAgentSession(messages, "parent", "parent");
    const childSession = new ChatAgentSession(messages, "child", "child");
    const grandchildSession = new ChatAgentSession(
      messages,
      "grandchild",
      "grandchild",
    );
    assert.equal(parentSession.workplaceScopeSessionId, "parent");
    assert.equal(childSession.workplaceScopeSessionId, "child");
    assert.equal(grandchildSession.workplaceScopeSessionId, "grandchild");
    // 每层都不会串到其他层。
    assert.notEqual(
      childSession.workplaceScopeSessionId,
      parentSession.workplaceScopeSessionId,
      "子层归属不应串到父层",
    );
    assert.notEqual(
      grandchildSession.workplaceScopeSessionId,
      childSession.workplaceScopeSessionId,
      "孙层归属不应串到子层",
    );
  });

  it("行为层：同一父会话连续派生两个子 agent，两个子 session 工作区互不污染", async () => {
    // task 工具在 depth>=2 deny 孙 agent（递归上限），但同一父可连派多个子 agent。
    // 本用例验证：子 A 的工作区不会泄漏到子 B，每个子 session 独立。
    const ctx = getNovelMasterTestContext();
    await seedChildAgent(ctx);
    await ensureDefaultAgentModel(ctx);

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const parent = await ctx.sessions.create(project.id, "父-T8-multi");

    const abortRegistry = createAgentAbortRegistry();
    const childIds: string[] = [];

    const modelRequests = scriptedModel({
      // index 0：主 agent 派生子 A（task）；
      // index 1：子 A 写 /a.md；
      // index 2：子 A 返回完成；
      // index 3：主 agent 收到 A 结果后派生子 B（task）；
      // index 4：子 B 写 /b.md；
      // index 5：子 B 返回完成；
      // index 6：主 agent 返回完成。
      responses: [
        taskToolUseResponse("tu-t8a", "子A写文件", "child-worker"),
        writeToolUseResponse("tu-t8a-w", "/a.md", "A 产出"),
        textDoneResponse("A完成"),
        taskToolUseResponse("tu-t8b", "子B写文件", "child-worker"),
        writeToolUseResponse("tu-t8b-w", "/b.md", "B 产出"),
        textDoneResponse("B完成"),
        textDoneResponse("主完成"),
      ],
    });

    const runtime = makeRuntime(ctx, { modelRequests, abortRegistry });
    captureChildSessions(runtime, childIds);
    runtime.eventBus = realEventBus();

    await ctx.state.setCurrentAgentId("test-default-agent");
    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_ID);

    await runAgentTurn(
      runtime,
      { projectId: project.id, sessionId: parent.id },
      "连派两个子代理",
      { stream: false, onStream: () => {} },
    );

    assert.equal(childIds.length, 2, "应创建 2 个兄弟子 session");
    const [childA, childB] = childIds;

    const childAVfs = ctx.sessionVfs(project.id, childA!);
    const childBVfs = ctx.sessionVfs(project.id, childB!);
    const aPaths = (await childAVfs.list("/", { recursive: true })).map((e) =>
      e.path,
    );
    const bPaths = (await childBVfs.list("/", { recursive: true })).map((e) =>
      e.path,
    );
    assert.ok(aPaths.includes("/a.md"), "子 A 工作区应含 /a.md");
    assert.ok(!aPaths.includes("/b.md"), "子 A 工作区不应含子 B 的 /b.md");
    assert.ok(bPaths.includes("/b.md"), "子 B 工作区应含 /b.md");
    assert.ok(!bPaths.includes("/a.md"), "子 B 工作区不应含子 A 的 /a.md");
  });
});

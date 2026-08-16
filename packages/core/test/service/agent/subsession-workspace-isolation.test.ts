/**
 * 子会话工作区语义测试（共享父工作区 + 规则快照隔离）。
 *
 * 正确语义（Feature A 修正后）：
 * - 文件只有一个工作区——父 session 的 VFS。子 agent 的 read/write/edit/glob/grep
 *   全部在父 session VFS scope 操作，写入直接出现在父工作区。
 * - 仅规则快照隔离：子会话拼常驻工作区前缀时，rule_snapshot / file_cache 存取走
 *   子 session 自己的 KKV，但规则评估按父工作区（wtScope = 父 session）。
 * - 嵌套时孙 agent 也指向根父会话工作区（不是中间子会话）。
 *
 * 覆盖用例：
 * - T-SS-1：createSubSession 仅 insert session 记录——子 session 的 VFS scope
 *   天然为空、不初始化任何工作区，父 session 工作区不变。
 * - T-SS-2：ChatAgentSession 的 workplaceScopeSessionId 子 session 指向父；
 *   kkvScopeSessionId 恒等自身。
 * - T-SS-3：runChildAgent 装配的 VFS 指向 parentSessionId（mock 入参验证）。
 * - T-SS-4：子 agent 写文件落到父 session scope；子 session scope 仍为空。
 * - T-SS-5：子 agent 写文件后能经父 scope 视图 read 回来。
 * - T-SS-6：子 agent VFS 变更后 vfsMutated 事件仍按会话树语义通知
 *   （payload sessionId = childSessionId，机制不变）。
 * - T-SS-7：子会话首次装配 workplace 后 rule_snapshot / file_cache 写入子 session
 *   自己的 KKV、父 KKV 无这两域，且文件内容来自父 VFS。
 * - T-SS-8：三层嵌套（父→子→孙）工作区归属都指向根父；同一父会话连派的
 *   两个子 agent 写入落同一父工作区（共享语义）。
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
  fileCacheKey,
  RULE_SNAPSHOT_CANON_KEY,
  SESSION_KKV_DOMAIN_FILE_CACHE,
  SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
} from "@/domain/session-kkv/model/session-kkv-domains.js";
import { parseFileCachePayload } from "@/domain/workplace/logic/rule-snapshot-codec.js";
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

/** T-SS-7 用：开启常驻工作区的子 agent（触发 workplace 装配 + KKV 快照写入）。 */
const workplaceChildAgentDef: AgentDefinition = {
  ...childAgentDef,
  prompts: { persist: [], dynamic: [], workplace: "i have seen workplace" },
};

function mockUserVfsTurn(): UserVfsTurnService {
  return {
    executeOp: async () => ({ ok: true }),
    previewUserOpsChangedPaths: async () => [],
    previewUserOpsActions: async () => [],
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

function readToolUseResponse(toolUseId: string, filePath: string): LlmChatResult {
  return {
    assistantText: "",
    blocks: [
      {
        type: "tool_use",
        id: toolUseId,
        name: "read",
        input: { path: filePath },
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
    readonly workplaceOverride?: AgentTurnRuntimePort["workplace"];
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
    workplace:
      args.workplaceOverride ??
      (() =>
        ({
          renderDisplay: async () => "",
          buildListRows: async () => [],
          materializePersistBlock: async () => ({ workplaceDisplay: "" }),
          evaluateRuleView: async () => ({
            rows: [],
            displayByPath: new Map(),
          }),
        }) as ReturnType<AgentTurnRuntimePort["workplace"]>),
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
  def: AgentDefinition = childAgentDef,
): Promise<void> {
  const registry = createAgentRegistryService(ctx.conn, ctx.state);
  await registry.upsert(def.name, def);
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

/** 从 session 消息里提取全部 tool_result 文本，供共享工作区读回断言。 */
async function collectToolResultTexts(
  ctx: ReturnType<typeof getNovelMasterTestContext>,
  sessionId: string,
): Promise<string[]> {
  const messages = await ctx.messages.listBySession(sessionId);
  const texts: string[] = [];
  for (const m of messages) {
    for (const block of m.content.blocks) {
      if (block.type === "tool_result") {
        texts.push(block.content);
      }
    }
  }
  return texts;
}

// ===========================================================================
// T-SS-1：createSubSession 仅 insert——子 session scope 天然为空，父工作区不变
// ===========================================================================

describe("T-SS-1：createSubSession 不初始化任何工作区", () => {
  it("子 session 的 VFS scope 天然为空（无 vfs_entry / 无 KKV），父 session 工作区不变", async () => {
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

    // 子 session 的 VFS scope 天然为空：createSubSession 从不为其写入任何 entry。
    const childVfs = ctx.sessionVfs(project.id, child.id);
    const childEntries = await childVfs.list("/", { recursive: true });
    assert.equal(
      childEntries.length,
      0,
      "子 session 的 VFS scope 应为空（无文件）",
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

    // 子 session 的 KKV 也为空（不预写 rule_snapshot / file_cache）。
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
    assert.ok(!paths.includes("/a.md"), "子 session scope 不应含项目模板 /a.md");
    assert.ok(
      !paths.includes("/sub/b.md"),
      "子 session scope 不应含项目模板 /sub/b.md",
    );
    assert.equal(paths.length, 0, "子 session scope 应完全为空");
  });
});

// ===========================================================================
// T-SS-2：workplaceScopeSessionId 子 session 指向父；kkvScopeSessionId 恒等自身
// ===========================================================================

describe("T-SS-2：ChatAgentSession 工作区 / KKV 归属语义", () => {
  it("主 session：workplaceScopeSessionId 与 kkvScopeSessionId 都等于 sessionId（默认值）", () => {
    const messages = {} as MessageService;
    const session = new ChatAgentSession(messages, "sess-main");
    assert.equal(session.sessionId, "sess-main");
    assert.equal(session.workplaceScopeSessionId, "sess-main");
    assert.equal(session.kkvScopeSessionId, "sess-main");
  });

  it("子 session：workplaceScopeSessionId 指向父，kkvScopeSessionId 恒等自身", () => {
    const messages = {} as MessageService;
    // runChildAgent 装配形态：new ChatAgentSession(messages, childSessionId, parentSessionId)
    // 第三位 = 工作区归属（父）；第四位 kkvScopeSessionId 走默认值 = 自身。
    const session = new ChatAgentSession(
      messages,
      "child-sess",
      "parent-sess",
    );
    assert.equal(session.sessionId, "child-sess");
    assert.equal(
      session.workplaceScopeSessionId,
      "parent-sess",
      "子 session 的工作区归属应指向父 session",
    );
    assert.equal(
      session.kkvScopeSessionId,
      "child-sess",
      "子 session 的 KKV 归属应恒等自身（快照隔离）",
    );
  });
});

// ===========================================================================
// T-SS-3：runChildAgent 装配的 VFS 指向 parentSessionId（mock 入参验证）
// T-SS-4：子 agent 写文件落到父 session scope
// T-SS-5：子 agent 能经父 scope 视图读回刚写的文件
// ===========================================================================

describe("T-SS-3/4/5：runChildAgent VFS 装配指向父 session + 共享读写", () => {
  it("T-SS-3：runChildAgent 装配时 sessionVfs 入参是 parentSessionId（非 childSessionId）", async () => {
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

    assert.ok(childIds.length === 1, "应只创建 1 个子 session");
    const childId = childIds[0]!;
    // 子 agent 装配的 sessionVfs 入参是 parentSessionId：主装配 1 次 + 子装配 1 次，
    // 共 2 次都以 parent.id 为 sessionId。
    const parentCalls = vfsCalls.filter((c) => c.sessionId === parent.id);
    assert.ok(
      parentCalls.length >= 2,
      `runChildAgent 装配应以 parentSessionId 调 sessionVfs（期望 >=2 次，实际 ${parentCalls.length}）：${JSON.stringify(vfsCalls)}`,
    );
    // 全程不应有任何以 childSessionId 装配的 VFS。
    assert.ok(
      !vfsCalls.some((c) => c.sessionId === childId),
      `不应以 childSessionId 装配 VFS：${JSON.stringify(vfsCalls)}`,
    );
  });

  it("T-SS-4：子 agent 写文件落到父 session scope；子 session scope 仍为空", async () => {
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

    // 父 session 工作区应含子 agent 写的 /outline.md（共享工作区语义）。
    const parentPathsAfter = (await parentVfs.list("/", { recursive: true }))
      .map((e) => e.path)
      .sort();
    assert.ok(
      parentPathsAfter.includes("/outline.md"),
      "父 session 工作区应含子 agent 写的 /outline.md",
    );
    assert.deepEqual(
      parentPathsAfter,
      [...parentPathsBefore, "/outline.md"].sort(),
      "父 session 工作区除子 agent 写入外应无其他变化",
    );

    // 子 session 自己的 scope 仍为空（子 agent 从不在子 scope 写文件）。
    const childVfs = ctx.sessionVfs(project.id, childId);
    const childPaths = (await childVfs.list("/", { recursive: true })).map((e) =>
      e.path,
    );
    assert.equal(
      childPaths.length,
      0,
      "子 session 自己的 VFS scope 应始终为空",
    );
  });

  it("T-SS-5：子 agent 写文件后能 read 回来（读写都经父 scope 视图）", async () => {
    const ctx = getNovelMasterTestContext();
    await seedChildAgent(ctx);
    await ensureDefaultAgentModel(ctx);

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const parent = await ctx.sessions.create(project.id, "父-T5");

    const abortRegistry = createAgentAbortRegistry();
    const childIds: string[] = [];

    const modelRequests = scriptedModel({
      // index 0：主 agent 派生 task；
      // index 1：子 agent 调 write 写 /note.md；
      // index 2：子 agent 调 read 读 /note.md（经父 scope 视图，应能读到）；
      // index 3：子 agent 返回完成文本；
      // index 4：主 agent 返回完成文本。
      responses: [
        taskToolUseResponse("tu-t5", "写后读"),
        writeToolUseResponse("tu-t5-w", "/note.md", "子代理笔记"),
        readToolUseResponse("tu-t5-r", "/note.md"),
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
      "派生子代理写后读",
      { stream: false, onStream: () => {} },
    );

    // 子 agent read/write 走同一父 scope 视图：read 的 tool_result 应含刚写的内容。
    const childId = childIds[0]!;
    const toolResults = await collectToolResultTexts(ctx, childId);
    assert.ok(
      toolResults.some((t) => t.includes("子代理笔记")),
      "子 agent read 应能读到刚写的文件内容（经父 scope 视图）",
    );

    // 父 VFS 直接可读（写入落在父 scope）。
    const parentVfs = ctx.sessionVfs(project.id, parent.id);
    const readBack = await parentVfs.read("/note.md");
    assert.equal(readBack.content, "子代理笔记");
    // 子 session 自己的 scope 仍为空。
    const childPaths = (await ctx.sessionVfs(project.id, childId).list("/", {
      recursive: true,
    })).map((e) => e.path);
    assert.equal(childPaths.length, 0, "子 session 自己的 VFS scope 应为空");
  });
});

// ===========================================================================
// T-SS-6：子 agent VFS 变更通知（vfsMutated 标志，payload 保持会话树语义）
// ===========================================================================

describe("T-SS-6：子 agent VFS 变更通知（vfsMutated 标志）", () => {
  it("子 agent 写文件后 STEP_COMMITTED / RUN_FINISHED 事件携带 vfsMutated=true（sessionId=子会话）", async () => {
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
    // payload 的 sessionId 保持会话树语义（= childSessionId）：子会话浏览页靠它
    // 匹配刷新 transcript / 生命周期。写入落点（父 scope）由 ToolResultBlock 的
    // vfsScope 元数据表达，不占用生命周期事件的 sessionId。
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
// T-SS-7：子会话首次装配 workplace——KKV 写子 session，内容来自父 VFS
// ===========================================================================

describe("T-SS-7：子会话首次装配 workplace 的 KKV 快照隔离", () => {
  it("rule_snapshot / file_cache 写入子 session 自己的 KKV，父 KKV 无这两域，内容来自父 VFS", async () => {
    const ctx = getNovelMasterTestContext();
    await seedChildAgent(ctx, workplaceChildAgentDef);
    await ensureDefaultAgentModel(ctx);

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const parent = await ctx.sessions.create(project.id, "父-T7");

    const abortRegistry = createAgentAbortRegistry();
    const childIds: string[] = [];

    const modelRequests = scriptedModel({
      // index 0：主 agent 派生 task；
      // index 1：子 agent 调 write 写 /outline.md（成功后 upsert file_cache 到子 KKV）；
      // index 2：子 agent 返回完成文本（该 step 装配 workplace：评估规则按父工作区，
      //          快照与缓存写入子 KKV）；
      // index 3：主 agent 返回完成文本。
      responses: [
        taskToolUseResponse("tu-t7", "写 outline"),
        writeToolUseResponse("tu-t7-write", "/outline.md", "# 子代理产出"),
        textDoneResponse("子完成"),
        textDoneResponse("主完成"),
      ],
    });

    // workplace mock：evaluateRuleView 恒返回 /outline.md 的 full 行（规则视图）。
    // 注意 mock 不区分 scope——真实实现按 wtScope（=父 scope）评估，与本测试意图一致。
    const runtime = makeRuntime(ctx, {
      modelRequests,
      abortRegistry,
      workplaceOverride: (() =>
        ({
          renderDisplay: async () => "",
          buildListRows: async () => [],
          materializePersistBlock: async () => ({ workplaceDisplay: "" }),
          evaluateRuleView: async () => ({
            rows: [
              {
                kind: "file",
                path: "/outline.md",
                inclusionMode: "show",
                displayState: "full",
              },
            ],
            displayByPath: new Map([["/outline.md", "full"]]),
          }),
        }) as ReturnType<AgentTurnRuntimePort["workplace"]>),
    });
    captureChildSessions(runtime, childIds);
    runtime.eventBus = realEventBus();

    await ctx.state.setCurrentAgentId("test-default-agent");
    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_ID);

    await runAgentTurn(
      runtime,
      { projectId: project.id, sessionId: parent.id },
      "派生子代理装配工作区",
      { stream: false, onStream: () => {} },
    );

    assert.ok(childIds.length === 1, "应创建 1 个子 session");
    const childId = childIds[0]!;

    // 子 session 自己的 KKV：rule_snapshot 快照含 /outline.md。
    const childSnapshotRaw = await ctx.sessionKkv.get(
      childId,
      SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
      RULE_SNAPSHOT_CANON_KEY,
    );
    assert.ok(
      childSnapshotRaw != null && childSnapshotRaw.includes("/outline.md"),
      "子 session 的 rule_snapshot 应已写入且含 /outline.md",
    );

    // 子 session 自己的 KKV：file_cache 缓存了来自父 VFS 的文件内容。
    const childCacheRaw = await ctx.sessionKkv.get(
      childId,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      fileCacheKey("full", "/outline.md"),
    );
    assert.ok(childCacheRaw != null, "子 session 的 file_cache 应已写入");
    const parsed = parseFileCachePayload(childCacheRaw);
    assert.equal(
      parsed?.body,
      "# 子代理产出",
      "file_cache 内容应来自父 VFS 中的文件",
    );

    // 父 session 的 KKV：两域均未写入（快照隔离——父的 KKV 不被子会话装配触碰）。
    const parentSnapshot = await ctx.sessionKkv.get(
      parent.id,
      SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
      RULE_SNAPSHOT_CANON_KEY,
    );
    assert.equal(
      parentSnapshot,
      null,
      "父 session 的 rule_snapshot 不应被子会话装配写入",
    );
    const parentCache = await ctx.sessionKkv.get(
      parent.id,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      fileCacheKey("full", "/outline.md"),
    );
    assert.equal(
      parentCache,
      null,
      "父 session 的 file_cache 不应被子会话装配写入",
    );

    // 文件本体在父 VFS（快照指向的内容来自父工作区）。
    const parentRead = await ctx
      .sessionVfs(project.id, parent.id)
      .read("/outline.md");
    assert.equal(parentRead.content, "# 子代理产出");
  });
});

// ===========================================================================
// T-SS-8：三层嵌套工作区归属指向根父；多子 agent 写入落同一父工作区（共享）
// ===========================================================================

describe("T-SS-8：嵌套 / 多子 session 共享父工作区", () => {
  it("装配层：父子孙三层 workplaceScopeSessionId 都指向根父；kkvScopeSessionId 各自等于自身", () => {
    const messages = {} as MessageService;
    // runChildAgent 装配：主 session 归属自身；子 session 传 parentSessionId（根父）；
    // 递归装配孙 session 时透传同一 parentSessionId（根父），不指向中间子会话。
    const parentSession = new ChatAgentSession(messages, "root", "root");
    const childSession = new ChatAgentSession(messages, "child", "root");
    const grandchildSession = new ChatAgentSession(messages, "grandchild", "root");
    // 三层工作区归属都指向根父。
    assert.equal(parentSession.workplaceScopeSessionId, "root");
    assert.equal(childSession.workplaceScopeSessionId, "root");
    assert.equal(grandchildSession.workplaceScopeSessionId, "root");
    // KKV 归属恒等自身（快照隔离，各层独立）。
    assert.equal(parentSession.kkvScopeSessionId, "root");
    assert.equal(childSession.kkvScopeSessionId, "child");
    assert.equal(grandchildSession.kkvScopeSessionId, "grandchild");
    // 孙层归属不串到中间子会话。
    assert.notEqual(
      grandchildSession.workplaceScopeSessionId,
      childSession.sessionId,
      "孙层归属不应指向中间子会话",
    );
  });

  it("行为层：同一父会话连续派生两个子 agent，两个子写入都落同一父工作区（共享）", async () => {
    // task 工具在 depth>=2 deny 孙 agent（递归上限），但同一父可连派多个子 agent。
    // 本用例验证共享语义：子 B 能看到子 A 写入父工作区的文件。
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
      // index 4：子 B read /a.md（共享工作区：应能读到子 A 的产出）；
      // index 5：子 B 写 /b.md；
      // index 6：子 B 返回完成；
      // index 7：主 agent 返回完成。
      responses: [
        taskToolUseResponse("tu-t8a", "子A写文件", "child-worker"),
        writeToolUseResponse("tu-t8a-w", "/a.md", "A 产出"),
        textDoneResponse("A完成"),
        taskToolUseResponse("tu-t8b", "子B读写文件", "child-worker"),
        readToolUseResponse("tu-t8b-r", "/a.md"),
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

    // 两个子的写入都落同一父工作区。
    const parentVfs = ctx.sessionVfs(project.id, parent.id);
    const parentPaths = (await parentVfs.list("/", { recursive: true })).map(
      (e) => e.path,
    );
    assert.ok(parentPaths.includes("/a.md"), "父工作区应含子 A 写的 /a.md");
    assert.ok(parentPaths.includes("/b.md"), "父工作区应含子 B 写的 /b.md");

    // 子 B 能看到子 A 写入的文件（共享语义，不再是隔离）：read 的 tool_result 含内容。
    const childBToolResults = await collectToolResultTexts(ctx, childB!);
    assert.ok(
      childBToolResults.some((t) => t.includes("A 产出")),
      "子 B 应能 read 到子 A 写入父工作区的 /a.md",
    );

    // 两个子 session 自己的 scope 仍各自为空。
    for (const [label, childId] of [
      ["子 A", childA],
      ["子 B", childB],
    ] as const) {
      const paths = (
        await ctx.sessionVfs(project.id, childId!).list("/", { recursive: true })
      ).map((e) => e.path);
      assert.equal(paths.length, 0, `${label} 自己的 VFS scope 应为空`);
    }
  });
});

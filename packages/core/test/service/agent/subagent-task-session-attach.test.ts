/**
 * task `sessionId` / `fileAttachment` 的**集成**测试（task-attach-unref Step 9+11）。
 *
 * 走 runAgentTurn 完整路径（真实 in-memory DB + mock provider），覆盖只在真实
 * 装配层才成立的三件事：
 * - T-TS3：`runChildAgent` 的 `tryRegister` claim 是并发硬互斥的**落点**，且排在
 *   `session.append` 之前——claim 失败方不得在子会话留下 user 消息；
 * - T-TA1b：续用时首条 user 消息带 `attachments` 落库（`attachments_json` 形态合法）；
 * - T-INT1：同一子会话连续两次 run 的 in-flight 事件正确收口（每次恰好
 *   STARTED…FINISHED 一对一，UI 的 in-flight 计数不会漏收）。
 *
 * 单测（形态/文案/预算）在 `test/tool/subagent-tool-session-file.test.ts`。
 *
 * @module test/service/agent/subagent-task-session-attach
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
import {
  attachmentStorageName,
  parseAttachmentsJson,
} from "@/domain/chat/model/message-attachment.schema.js";
import type { ModelRequestService } from "@/service/provider/model-request.port.js";
import { createAgentAbortRegistry } from "@/service/agent/create-agent-abort-registry.js";
import type { AgentAbortRegistry } from "@/service/agent/agent-abort-registry.port.js";
import type { UserVfsTurnService } from "@/service/chat/user-vfs-turn.port.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../../helpers/novel-master-fixture.js";

novelMasterTestFixture();

const TEST_SAVED_MODEL_ID = "00000000-0000-4000-8000-0000000000b1";

const childAgentDef: AgentDefinition = {
  name: "attach-worker",
  prompts: { persist: [], dynamic: [] },
  model: TEST_SAVED_MODEL_ID,
  mode: "subagent",
};

function mockUserVfsTurn(): UserVfsTurnService {
  return { executeOp: async () => ({ ok: true }) };
}

function taskToolUseResponse(
  toolUseId: string,
  input: Record<string, unknown>
): LlmChatResult {
  return {
    assistantText: "",
    blocks: [{ type: "tool_use", id: toolUseId, name: "task", input }],
    raw: {},
  };
}

/** 一条 assistant 消息里并发发两个 task tool_use（单 step 并发的真实形态）。 */
function twoTaskResponse(
  sessionId: string,
  prompts: readonly [string, string]
): LlmChatResult {
  return {
    assistantText: "",
    blocks: [
      {
        type: "tool_use",
        id: "tu-a",
        name: "task",
        input: {
          description: "并发 A",
          prompt: prompts[0],
          subagentName: "attach-worker",
          sessionId,
        },
      },
      {
        type: "tool_use",
        id: "tu-b",
        name: "task",
        input: {
          description: "并发 B",
          prompt: prompts[1],
          subagentName: "attach-worker",
          sessionId,
        },
      },
    ],
    raw: {},
  };
}

function textDoneResponse(text: string): LlmChatResult {
  return { assistantText: text, blocks: [{ type: "text", text }], raw: {} };
}

function makeRuntime(
  ctx: ReturnType<typeof getNovelMasterTestContext>,
  args: {
    readonly modelRequests: ModelRequestService;
    readonly abortRegistry: AgentAbortRegistry;
  }
): AgentTurnRuntimePort {
  return {
    state: {
      getCurrentAgentId: () => ctx.state.getCurrentAgentId(),
      getCurrentModelId: async () => TEST_SAVED_MODEL_ID,
      getSubagentNames: async () => [],
    },
    agentRegistry: createAgentRegistryService(ctx.conn, ctx.state),
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
    eventBus: undefined as unknown as AgentTurnRuntimePort["eventBus"],
    compactionConditionEvaluator:
      undefined as unknown as AgentTurnRuntimePort["compactionConditionEvaluator"],
    eventOrchestrator:
      undefined as unknown as AgentTurnRuntimePort["eventOrchestrator"],
    sessionKkv: ctx.sessionKkv,
    sessionVfs: (projectId, sessionId) => ctx.sessionVfs(projectId, sessionId),
    workplace: () =>
      ({
        renderDisplay: async () => "",
        buildListRows: async () => [],
        materializePersistBlock: async () => ({ workplaceDisplay: "" }),
        evaluateRuleView: async () => ({ rows: [], displayByPath: new Map() }),
      }) as ReturnType<AgentTurnRuntimePort["workplace"]>,
    userVfsTurn: mockUserVfsTurn(),
    sessions: ctx.sessions,
  };
}

/** 记录 run 生命周期事件的 eventBus。 */
function recordingEventBus(): {
  readonly bus: AgentTurnRuntimePort["eventBus"];
  readonly events: { type: string; payload: Record<string, unknown> }[];
} {
  const events: { type: string; payload: Record<string, unknown> }[] = [];
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  const bus = {
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
      return { unsubscribe: () => set!.delete(handler) };
    },
    unsubscribe: (type: string, handler: (payload: unknown) => void) => {
      handlers.get(type)?.delete(handler);
    },
  } as unknown as AgentTurnRuntimePort["eventBus"];
  for (const type of [
    "agent.run.started",
    "agent.run.finished",
    "agent.run.failed",
  ]) {
    bus.subscribe(type, (payload: unknown) => {
      events.push({ type, payload: payload as Record<string, unknown> });
    });
  }
  return { bus, events };
}

async function ensureDefaultAgentModel(
  ctx: ReturnType<typeof getNovelMasterTestContext>
): Promise<void> {
  const registry = createAgentRegistryService(ctx.conn, ctx.state);
  await registry.upsert("test-default-agent", {
    name: "测试默认 Agent",
    prompts: { persist: [], dynamic: [] },
    model: TEST_SAVED_MODEL_ID,
  });
}

async function seedChildAgent(
  ctx: ReturnType<typeof getNovelMasterTestContext>
): Promise<void> {
  await createAgentRegistryService(ctx.conn, ctx.state).upsert(
    "attach-worker",
    childAgentDef
  );
}

/**
 * 绕开 task 工具的 `isSessionRunActive` 软闸，让并发硬互斥**只由 claim 裁决**。
 *
 * 软闸（`abortRegistry.has`）在真实链路里本来就会先挡掉一部分并发；把 `has`
 * 固定成 false 之后，唯一能拒绝败方的就是 `tryRegister`——这正是 T-TS3 要验的
 * 落点（claim 排在 `session.append` 之前）。
 */
function alwaysInactiveRegistry(): AgentAbortRegistry {
  const real = createAgentAbortRegistry();
  return {
    register: (s, c) => real.register(s, c),
    tryRegister: (s, c) => real.tryRegister(s, c),
    abort: (s) => real.abort(s),
    unregister: (s, c) => real.unregister(s, c),
    has: () => false,
  };
}

describe("task 续用并发硬互斥（T-TS3）", () => {
  it("同 step 两个 task 续用同一子会话：一成一败，且败方不在子会话留下 user 消息", async () => {
    const ctx = getNovelMasterTestContext();
    await seedChildAgent(ctx);
    await ensureDefaultAgentModel(ctx);

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S-TS3");
    // 先造一个属于本会话的既有子会话（父 = 主会话）。
    const kid = await ctx.sessions.createSubSession(
      session.id,
      project.id,
      "既有子会话"
    );

    const abortRegistry = alwaysInactiveRegistry();
    let modelCalls = 0;
    const modelRequests: ModelRequestService = {
      request: async () => {
        modelCalls += 1;
        // 0: 主 agent 发两个并发 task；1: 赢家子 agent 完成；2: 主 agent 收尾。
        if (modelCalls === 1) {
          return twoTaskResponse(kid.id, ["A 的正文", "B 的正文"]);
        }
        if (modelCalls === 2) return textDoneResponse("子代理完成");
        return textDoneResponse("主代理收尾");
      },
    };

    const runtime = makeRuntime(ctx, { modelRequests, abortRegistry });
    const events = recordingEventBus();
    runtime.eventBus = events.bus;
    await ctx.state.setCurrentAgentId("test-default-agent");
    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_ID);

    await runAgentTurn(
      runtime,
      { projectId: project.id, sessionId: session.id },
      "并发续用同一个子会话",
      { stream: false }
    );

    // claim 失败方不留孤儿 user 消息：子会话里**恰好一条** task prompt。
    const childUserMessages = (
      await ctx.messages.listBySession(kid.id)
    ).filter((m) => m.role === "user");
    assert.equal(
      childUserMessages.length,
      1,
      `claim 失败方不得在子会话留下 user 消息；实得 ${childUserMessages.length} 条`
    );
    // 胜者的正文确实进去了（不是「两个都被拒」也不是「都跑了」）。
    const body = childUserMessages[0]!.content.blocks
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("");
    assert.ok(
      body === "A 的正文" || body === "B 的正文",
      `胜者正文应落库，实际：${body}`
    );
    // 子 run 终态恰好一条（一成一败的另一面：败方没起步，不发 STARTED/FINISHED）。
    const childTerminal = events.events.filter(
      (e) => e.payload.sessionId === kid.id
    );
    assert.equal(
      childTerminal.filter((e) => e.type === "agent.run.finished").length,
      1,
      "子会话只应有一条 FINISHED（败方未起步）"
    );
    assert.equal(
      childTerminal.filter((e) => e.type === "agent.run.started").length,
      1,
      "子会话只应有一条 STARTED"
    );
    // claim 收尾：失败方的 finally 不得把赢家的记录误删。
    assert.equal(abortRegistry.has(kid.id), false, "全部 run 收尾后必须反注册");
  });

  it("claim 败方回流的 tool_result 必须标 ok=false 且文案引导去掉 sessionId", async () => {
    // 上一个用例只从子会话侧看「没留 user 消息」；这里看主会话侧模型实际收到什么：
    // 败方若被当成成功回流，主 agent 会以为并发续用成功，下一轮接着用同一个
    // sessionId 反复撞墙。
    const ctx = getNovelMasterTestContext();
    await seedChildAgent(ctx);
    await ensureDefaultAgentModel(ctx);

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S-TS3-ERR");
    const kid = await ctx.sessions.createSubSession(
      session.id,
      project.id,
      "既有子会话"
    );

    const abortRegistry = alwaysInactiveRegistry();
    let modelCalls = 0;
    const modelRequests: ModelRequestService = {
      request: async () => {
        modelCalls += 1;
        if (modelCalls === 1) {
          return twoTaskResponse(kid.id, ["A 的正文", "B 的正文"]);
        }
        if (modelCalls === 2) return textDoneResponse("子代理完成");
        return textDoneResponse("主代理收尾");
      },
    };

    const runtime = makeRuntime(ctx, { modelRequests, abortRegistry });
    runtime.eventBus = recordingEventBus().bus;
    await ctx.state.setCurrentAgentId("test-default-agent");
    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_ID);

    await runAgentTurn(
      runtime,
      { projectId: project.id, sessionId: session.id },
      "并发续用同一个子会话",
      { stream: false }
    );

    // 主会话里 task 的 tool_result 恰好两条：一成功、一失败。
    // 注意 tool_result 落在 **user** 角色消息里（runner 的 tool_results 段）。
    const toolResults = (await ctx.messages.listBySession(session.id))
      .filter((m) => m.role === "user")
      .flatMap((m) => m.content.blocks)
      .filter((b): b is Extract<typeof b, { type: "tool_result" }> =>
        b.type === "tool_result"
      );
    assert.equal(toolResults.length, 2, "两个 task 各回一条 tool_result");
    const failed = toolResults.filter((b) => b.ok === false);
    assert.equal(failed.length, 1, "恰好一败");
    const failedContent =
      typeof failed[0]!.content === "string"
        ? failed[0]!.content
        : failed[0]!.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    assert.match(failedContent, /去掉 sessionId/, "败方文案必须给出可执行引导");
  });
});

describe("task fileAttachment 落库与续用追加（T-TA1b / T-INT1）", () => {
  it("续用时 user 消息带合规附件落库；同一子会话连续两次 run 的事件正确收口", async () => {
    const ctx = getNovelMasterTestContext();
    await seedChildAgent(ctx);
    await ensureDefaultAgentModel(ctx);

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S-ATT");
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/设定/角色.md", "林白，男主");
    const kid = await ctx.sessions.createSubSession(
      session.id,
      project.id,
      "既有子会话"
    );

    const abortRegistry = createAgentAbortRegistry();
    let modelCalls = 0;
    const modelRequests: ModelRequestService = {
      request: async () => {
        modelCalls += 1;
        // 第 1 轮：新开子会话并带 fileAttachment。
        if (modelCalls === 1) {
          return taskToolUseResponse("tu-new", {
            description: "新建并附文件",
            prompt: "请看这份设定",
            subagentName: "attach-worker",
            fileAttachment: ["设定/角色.md"],
          });
        }
        if (modelCalls === 2) return textDoneResponse("子代理第一轮完成");
        if (modelCalls === 3) return textDoneResponse("主代理收尾");
        // 第二轮主 agent：续用刚建的子会话。
        if (modelCalls === 4) {
          return taskToolUseResponse("tu-resume", {
            description: "续用",
            prompt: "接着做下一步",
            subagentName: "attach-worker",
            sessionId: capturedChildId ?? "",
          });
        }
        if (modelCalls === 5) return textDoneResponse("子代理第二轮完成");
        return textDoneResponse("主代理最终收尾");
      },
    };

    // 捕获第一轮新建的子会话 id（续用入参要用）。
    let capturedChildId: string | undefined;
    const originalCreateSubSession = ctx.sessions.createSubSession.bind(
      ctx.sessions
    );
    // Proxy 转发其余方法——类实例**不能对象展开**（原型方法会丢，见 RULE）。
    const trackingSessions = new Proxy(ctx.sessions, {
      get(target, prop, receiver) {
        if (prop === "createSubSession") {
          return async (
            parentId: string,
            projId: string,
            title?: string | null
          ) => {
            const child = await originalCreateSubSession(
              parentId,
              projId,
              title
            );
            capturedChildId ??= child.id;
            return child;
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as unknown as AgentTurnRuntimePort["sessions"];

    const runtime = makeRuntime(ctx, { modelRequests, abortRegistry });
    runtime.sessions = trackingSessions;
    const events = recordingEventBus();
    runtime.eventBus = events.bus;
    await ctx.state.setCurrentAgentId("test-default-agent");
    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_ID);

    await runAgentTurn(
      runtime,
      { projectId: project.id, sessionId: session.id },
      "第一轮：派子代理并附文件",
      { stream: false }
    );

    assert.ok(capturedChildId != null, "应新建一个子会话");
    const childSessionId = capturedChildId!;
    assert.notEqual(
      childSessionId,
      kid.id,
      "本用例新建自己的子会话（kid 只作对照）"
    );

    // 附件落库形态：source/action/content/name 与 T-TA1 单测同一口径。
    const firstChildUser = (
      await ctx.messages.listBySession(childSessionId)
    ).find((m) => m.role === "user");
    assert.ok(firstChildUser != null, "子会话首条 user 消息应落库");
    const storedAtts = firstChildUser.attachments ?? [];
    assert.equal(storedAtts.length, 1, "fileAttachment 应挂 1 条附件");
    const a0 = storedAtts[0]!;
    assert.equal(a0.path, "/设定/角色.md");
    assert.equal(a0.name, attachmentStorageName(a0.path));
    assert.equal(a0.action, "userAttach");
    assert.equal(a0.source, "attach");
    assert.equal(a0.content, null, "content:null 落库，全文在 view-time hydrate");
    // 落库往返：attachments_json 能被硬 parse 读回（DB 真源解析）。
    const reparsed = parseAttachmentsJson(JSON.stringify(storedAtts));
    assert.ok(reparsed != null && reparsed.length === 1);

    // ---- 第二轮：续用同一子会话（T-INT1 的前半：追加 + 事件收口）----
    events.events.length = 0;
    await runAgentTurn(
      runtime,
      { projectId: project.id, sessionId: session.id },
      "第二轮：续用子会话",
      { stream: false }
    );

    const childMessages = await ctx.messages.listBySession(childSessionId);
    const childUserMessages = childMessages.filter((m) => m.role === "user");
    assert.equal(
      childUserMessages.length,
      2,
      "续用应**追加**一条 user 消息（不新建会话、不覆盖历史）"
    );
    const resumeBody = childUserMessages[1]!.content.blocks
      .map((bl) => (bl.type === "text" ? bl.text : ""))
      .join("");
    assert.equal(resumeBody, "接着做下一步");
    assert.deepEqual(
      childUserMessages[1]!.attachments ?? [],
      [],
      "续用那轮没给 fileAttachment → 不挂附件（attachments 为空/undefined）"
    );

    // T-INT1：连续两次 run 的 in-flight 事件必须正确收口——每次恰好
    // STARTED 一条、FINISHED 一条，且子会话归属正确（UI 靠它把 in-flight 计数归零）。
    const childEvents = events.events.filter(
      (e) => e.payload.sessionId === childSessionId
    );
    assert.equal(
      childEvents.filter((e) => e.type === "agent.run.started").length,
      1,
      "第二轮子 run 恰好一条 STARTED"
    );
    assert.equal(
      childEvents.filter((e) => e.type === "agent.run.finished").length,
      1,
      "第二轮子 run 恰好一条 FINISHED（不多不少 = in-flight 收口）"
    );
    assert.equal(
      childEvents.filter((e) => e.type === "agent.run.failed").length,
      0,
      "正常完成不发 FAILED"
    );
    assert.equal(abortRegistry.has(childSessionId), false, "收尾反注册");
  });
});

describe("task 附件预算的真实 VfsContentSize 映射（G-2）", () => {
  /**
   * 用**裸 SQL** 造一条遗留 inline 行：`content` 有明文、`content_hash` 为 NULL。
   *
   * 写侧（`insert` / `insertWithContentHash`）恒 `content=NULL`+`content_hash`，
   * 真写文件永远造不出 inline 行——而 `findContentSizeByPath` 两条分支都会命中。
   * 预算计量是「映射后的形态」（`{kind:"inline"|"blob"}`），所有预算用例都直接喂
   * 映射后形态，于是 `inlineChars` 与 `blobCompressedBytes` 写反（run-agent-turn 的
   * 映射闭包）全部照绿。本用例走真 `findContentSize` + 真映射，把那层闭包钉住。
   */
  async function seedLegacyInlineFile(
    ctx: ReturnType<typeof getNovelMasterTestContext>,
    projectId: string,
    sessionId: string,
    path: string,
    chars: number
  ): Promise<void> {
    const vfs = ctx.sessionVfs(projectId, sessionId);
    await vfs.write(path, "占位");
    await ctx.conn.execute(
      `UPDATE vfs_entry
          SET content = ?, content_hash = NULL
        WHERE scope_key = ? AND path = ?`,
      ["字".repeat(chars), `session:${projectId}:${sessionId}`, path]
    );
  }

  it("G-2: 遗留 inline 行 30_000 字符 → 映射为 inline 档计 30_000 ≤ 预算 → 仍挂附件", async () => {
    const ctx = getNovelMasterTestContext();
    await seedChildAgent(ctx);
    await ensureDefaultAgentModel(ctx);

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S-G2");
    await seedLegacyInlineFile(
      ctx,
      project.id,
      session.id,
      "/设定/遗留长文.md",
      30_000
    );

    // 先确认真探针确实落在 inlineChars 档（否则本用例证明不了映射）。
    const probed = await ctx
      .sessionVfs(project.id, session.id)
      .findContentSize("/设定/遗留长文.md");
    assert.equal(probed?.kind, "inlineChars", "夹具必须是 inline 行");
    assert.equal(probed?.size, 30_000);

    const abortRegistry = createAgentAbortRegistry();
    let modelCalls = 0;
    const modelRequests: ModelRequestService = {
      request: async () => {
        modelCalls += 1;
        if (modelCalls === 1) {
          return taskToolUseResponse("tu-g2", {
            description: "读遗留长文",
            prompt: "请通读这份设定",
            subagentName: "attach-worker",
            fileAttachment: ["设定/遗留长文.md"],
          });
        }
        if (modelCalls === 2) return textDoneResponse("子代理完成");
        return textDoneResponse("主代理收尾");
      },
    };

    const runtime = makeRuntime(ctx, { modelRequests, abortRegistry });
    runtime.eventBus = recordingEventBus().bus;
    await ctx.state.setCurrentAgentId("test-default-agent");
    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_ID);

    let capturedChildId: string | undefined;
    const originalCreateSubSession = ctx.sessions.createSubSession.bind(
      ctx.sessions
    );
    runtime.sessions = new Proxy(ctx.sessions, {
      get(target, prop, receiver) {
        if (prop === "createSubSession") {
          return async (
            parentId: string,
            projId: string,
            title?: string | null
          ) => {
            const child = await originalCreateSubSession(
              parentId,
              projId,
              title
            );
            capturedChildId ??= child.id;
            return child;
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as unknown as AgentTurnRuntimePort["sessions"];

    await runAgentTurn(
      runtime,
      { projectId: project.id, sessionId: session.id },
      "派子代理读遗留长文",
      { stream: false }
    );

    assert.ok(capturedChildId != null, "应新建一个子会话");
    const childUser = (await ctx.messages.listBySession(capturedChildId!)).find(
      (m) => m.role === "user"
    );
    assert.ok(childUser != null, "子会话首条 user 消息应落库");
    const body = childUser.content.blocks
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("");
    // 牙齿：映射若把 inline 当 blob（×4 = 12 万 > 10 万预算），附件会被降级成
    // 尾注里的路径清单，本条断言随之变红。
    assert.equal(
      (childUser.attachments ?? []).length,
      1,
      "inline 30_000 字符在预算内 → 必须挂附件"
    );
    assert.equal(
      (childUser.attachments ?? [])[0]!.path,
      "/设定/遗留长文.md"
    );
    assert.doesNotMatch(body, /超出附件预算/, "预算内不得出现路径清单尾注");
  });
});

describe("task 附件不随空白 prompt 蒸发（C-orch-1）", () => {
  it("prompt 纯空白 + 有效附件 → 附件仍落库（append 守卫含 attachments 非空）", async () => {
    const ctx = getNovelMasterTestContext();
    await seedChildAgent(ctx);
    await ensureDefaultAgentModel(ctx);

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id, "S-BLANK");
    await ctx.sessionVfs(project.id, session.id).write("/设定/角色.md", "林白，男主");

    const abortRegistry = createAgentAbortRegistry();
    let modelCalls = 0;
    const modelRequests: ModelRequestService = {
      request: async () => {
        modelCalls += 1;
        if (modelCalls === 1) {
          return taskToolUseResponse("tu-blank", {
            description: "空白 prompt",
            // schema 的 z.string().min(1) 放行纯空白串；模型偶尔会真发这种。
            prompt: " ",
            subagentName: "attach-worker",
            fileAttachment: ["设定/角色.md"],
          });
        }
        if (modelCalls === 2) return textDoneResponse("子代理完成");
        return textDoneResponse("主代理收尾");
      },
    };

    const runtime = makeRuntime(ctx, { modelRequests, abortRegistry });
    runtime.eventBus = recordingEventBus().bus;
    await ctx.state.setCurrentAgentId("test-default-agent");
    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_ID);

    let capturedChildId: string | undefined;
    const originalCreateSubSession = ctx.sessions.createSubSession.bind(
      ctx.sessions
    );
    runtime.sessions = new Proxy(ctx.sessions, {
      get(target, prop, receiver) {
        if (prop === "createSubSession") {
          return async (
            parentId: string,
            projId: string,
            title?: string | null
          ) => {
            const child = await originalCreateSubSession(
              parentId,
              projId,
              title
            );
            capturedChildId ??= child.id;
            return child;
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as unknown as AgentTurnRuntimePort["sessions"];

    await runAgentTurn(
      runtime,
      { projectId: project.id, sessionId: session.id },
      "空白 prompt 派子代理",
      { stream: false }
    );

    assert.ok(capturedChildId != null, "应新建一个子会话");
    const childUser = (await ctx.messages.listBySession(capturedChildId!)).find(
      (m) => m.role === "user"
    );
    assert.ok(childUser != null, "空白 prompt 也应落一条 user 消息（承载附件）");
    const stored = childUser.attachments ?? [];
    assert.equal(stored.length, 1, "附件不得随空白 prompt 静默蒸发");
    assert.equal(stored[0]!.path, "/设定/角色.md");
  });
});
/**
 * read-tool-result-ref Step 6 生产装配 smoke（phase-read-ref-apps）。
 *
 * 三端 runtime 打开生产开关后的真实形态：只注入 `revisionRepo`（不带显式
 * `adjustRevisionRefCount`）。链路断言：
 *
 * ① `resolveReadRefCountChannel`：从 revisionRepo 推导出 +1 通道；显式
 *    通道优先；两者都缺时 undefined（legacy 全文回落）。
 * ② agent-runner 走 `assembleAgentRunnerDeps` 装配（revisionRepo 透传到
 *    prepare），read 工具执行时经通道同步 +1，落库的 tool_result 块带
 *    contentRef 且 content=""（占位空串）。
 * ③ 下一轮模型请求的 history 经 prepare hydrate 后携带 wire 全文
 *    （formatReadOutput 重放），与 read 执行时的输出逐字节一致。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SimpleEventBus } from "@novel-master/core/events";
import { textBlocks } from "@novel-master/core/chat";
import { assembleAgentRunnerDeps } from "../../../src/service/agent/logic/assemble-agent-runner-deps.js";
import { createAgentRunner } from "../../../src/service/agent/create-agent-runner.js";
import { ChatAgentSession } from "../../../src/service/agent/impl/chat-agent-session.js";
import { resolveReadRefCountChannel } from "../../../src/service/agent/logic/run-agent-turn.js";
import type { AgentTurnRuntimePort } from "../../../src/service/agent/logic/run-agent-turn.js";
import { createMessageTranscriptEffectsService } from "../../../src/service/chat/create-message-transcript-effects.js";
import { createWorkplaceService } from "../../../src/service/workplace/create-workplace-service.js";
import { normalizeOrphanToolResultsForLlm } from "../../../src/service/prompt/normalize-orphan-tool-results-for-llm.js";
import { chatMessagesToGeminiContents } from "../../../src/infra/llm-protocol/logic/gemini-content-mapper.js";
import { registerBuiltinTools } from "../../../src/domain/tool/builtin/register-builtin-tools.js";
import { ToolRegistry } from "../../../src/domain/tool/logic/tool-registry.js";
import type { BuiltinToolContext } from "../../../src/domain/tool/builtin/builtin-tool-context.js";
import { SqliteVfsRevisionRepository } from "../../../src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import type { ModelRequestService } from "../../../src/service/provider/model-request.port.js";
import type { AgentDefinition } from "../../../src/domain/agent/model/agent-definition.js";
import type { ChatMessage } from "../../../src/domain/chat/model/message.js";
import type { ToolResultBlock } from "../../../src/domain/chat/model/content-block.js";
import { BUILTIN_PROVIDER_UUID_GOOGLE } from "../../../src/domain/provider/logic/builtin-providers.js";
import type { SavedModel } from "../../../src/domain/provider/model/saved-model.js";
import type { SavedModelRepository } from "../../../src/domain/provider/repositories/saved-model.port.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../../helpers/novel-master-fixture.js";

/**
 * gemini 协议 stub：agent-runner 的 tool_use 查找源**仅在该协议下读取**
 * （openai / anthropic 不消费，main 侧收窄），而本测试的查找源断言
 * （④ 可见-only 收窄）必须在查找源真实存在的路径上验证才非恒真。
 */
function geminiSavedModelRepository(): SavedModelRepository {
  const fake = {
    id: "smoke/model",
    providerId: BUILTIN_PROVIDER_UUID_GOOGLE,
    settings: { generation: { thinkingLevel: "off" } },
  } as unknown as SavedModel;
  return {
    listByProvider: async () => [],
    findById: async (id: string) =>
      id.trim() === "smoke/model" ? fake : null,
    insert: async () => undefined,
    updateById: async () => undefined,
    deleteById: async () => false,
    deleteByProvider: async () => undefined,
  };
}

novelMasterTestFixture();

function minimalDefinition(): AgentDefinition {
  return {
    name: "smoke",
    prompts: { persist: [], dynamic: [] },
  };
}

describe("read-tool-result-ref Step 6: resolveReadRefCountChannel 装配推导", () => {
  it("只注入 revisionRepo（三端生产形态）→ 通道非空且调用打到 batchAdjustRefCountWithDelta", async () => {
    const calls: Array<{ pointers: unknown; delta: number }> = [];
    const revisionRepo = {
      batchAdjustRefCountWithDelta: async (pointers: unknown, delta: number) => {
        calls.push({ pointers, delta });
      },
    } as unknown as SqliteVfsRevisionRepository;

    const channel = resolveReadRefCountChannel({ revisionRepo });
    assert.ok(channel != null, "生产形态（仅 revisionRepo）必须推导出通道");
    await channel([{ entryId: 1, version: 3 }], +1);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]!.pointers, [{ entryId: 1, version: 3 }]);
    assert.equal(calls[0]!.delta, +1);
  });

  it("显式 adjustRevisionRefCount 优先（测试探针口子不被 repo 覆盖）", async () => {
    const explicitCalls: number[] = [];
    const repoCalls: number[] = [];
    const channel = resolveReadRefCountChannel({
      adjustRevisionRefCount: async () => {
        explicitCalls.push(1);
      },
      revisionRepo: {
        batchAdjustRefCountWithDelta: async () => {
          repoCalls.push(1);
        },
      } as unknown as SqliteVfsRevisionRepository,
    });
    assert.ok(channel != null);
    await channel([{ entryId: 1, version: 1 }], +1);
    assert.equal(explicitCalls.length, 1);
    assert.equal(repoCalls.length, 0);
  });

  it("两者都缺 → undefined（legacy 全文回落，不 +1 不产引用块）", () => {
    assert.equal(resolveReadRefCountChannel({}), undefined);
  });
});

describe("read-tool-result-ref Step 6: 生产链路 smoke（runner 全链）", () => {
  it("revisionRepo 注入 → read +1 产 contentRef 落库 → 下轮请求 history 含 hydrate 全文", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`pj-rrsmoke-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const projectId = project.id;
    const sessionId = session.id;
    const vfs = ctx.sessionVfs(projectId, sessionId);
    await vfs.write("/smoke.md", "smoke line one\nsmoke line two");

    // 生产装配形态：revisionRepo 单实例（同 conn），无显式 adjust 通道。
    const revisionRepo = new SqliteVfsRevisionRepository(ctx.conn);
    const scope = { kind: "session" as const, projectId, sessionId };

    // run-agent-turn 主装配点同款：通道推导 → toolCtx。
    const readRefCountChannel = resolveReadRefCountChannel({ revisionRepo });
    assert.ok(readRefCountChannel != null);
    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const toolCtx: BuiltinToolContext = {
      vfs,
      projectId,
      sessionId,
      sessionKkv: ctx.sessionKkv,
      ...(readRefCountChannel != null
        ? { adjustRevisionRefCount: readRefCountChannel }
        : {}),
      workplace: createWorkplaceService(ctx.conn, scope),
    };

    // 捕获每轮发给模型的 history（prepare 之后的内存态）与 tool_use 查找源。
    const histories: Array<readonly ChatMessage[]> = [];
    const lookups: Array<readonly ChatMessage[]> = [];
    let modelCall = 0;
    const model: ModelRequestService = {
      request: async (_savedModelId, _userContent, options) => {
        histories.push(options?.history ?? []);
        lookups.push(options?.toolUseLookupMessages ?? []);
        modelCall += 1;
        if (modelCall === 1) {
          return {
            assistantText: "",
            blocks: [
              {
                type: "tool_use",
                id: "tu-rrsmoke",
                name: "read",
                input: { path: "/smoke.md" },
              },
            ],
            raw: {},
          };
        }
        return {
          assistantText: "done",
          blocks: [{ type: "text", text: "done" }],
          raw: {},
        };
      },
    };

    const agentSession = new ChatAgentSession(ctx.messages, sessionId);
    await agentSession.append("user", textBlocks("请读取 smoke.md"));
    // 收窄验证用：库里放一条 hidden 行（压缩/置位产物形态），
    // 全量读含它、可见-only 读不含它——下面的查找源断言因此非恒真。
    const hiddenSeed = await agentSession.append("user", textBlocks("更早的旧轮次"));
    await agentSession.hideRange(hiddenSeed.seq, hiddenSeed.seq);

    // assembleAgentRunnerDeps 装配（生产单点）：runtime.revisionRepo 透传到
    // runner deps，再由 prepare 消费（hydrate 主链接线验证）。
    const deps = assembleAgentRunnerDeps({
      session: agentSession,
      runtime: {
        messages: ctx.messages,
        messageTranscriptEffects:
          createMessageTranscriptEffectsService(ctx.conn),
        modelRequests: model,
        messageCheckpoint: ctx.messageCheckpoint,
        eventBus: new SimpleEventBus(),
        sessionKkv: ctx.sessionKkv,
        revisionRepo,
        workplace: (wtScope) => createWorkplaceService(ctx.conn, wtScope),
        savedModelRepo: geminiSavedModelRepository(),
      } as Pick<
        AgentTurnRuntimePort,
        | "messages"
        | "messageTranscriptEffects"
        | "modelRequests"
        | "messageCheckpoint"
        | "eventBus"
        | "sessionKkv"
        | "revisionRepo"
      > & {
        workplace: AgentTurnRuntimePort["workplace"];
        savedModelRepo: ReturnType<typeof geminiSavedModelRepository>;
      },
      registry,
      toolCtx,
      includeCompactionOrchestrator: false,
    });

    const runner = createAgentRunner(deps);
    const result = await runner.run({
      maxSteps: 4,
      definition: minimalDefinition(),
      projectId,
      sessionId,
      savedModelId: "smoke/model",
      workspaceModelId: "smoke/model",
    });

    assert.equal(modelCall, 2, "两步：read 工具轮 + 文本收尾轮");
    assert.notEqual(result.stopReason, "error");

    // ① 落库形态：assistant 带 tool_use；user 的 tool_result 块带
    // contentRef 且 content=""（引用态占位空串，DB 里不存全文）。
    const persisted = await ctx.messages.listBySession(sessionId);
    const toolResultMsg = persisted.find((m) =>
      m.content.blocks.some((b) => b.type === "tool_result")
    );
    assert.ok(toolResultMsg != null, "tool_result 消息必须已落库");
    const block = toolResultMsg.content.blocks.find(
      (b): b is ToolResultBlock => b.type === "tool_result"
    );
    assert.ok(block != null);
    assert.equal(block.toolUseId, "tu-rrsmoke");
    assert.equal(block.content, "", "落库引用态块 content 必须是占位空串");
    const ref = block.contentRef;
    assert.ok(ref != null, "落库块必须带 contentRef");
    assert.equal(ref.path, "/smoke.md");
    assert.equal(ref.version, 1);
    assert.equal(ref.returnedLines, 2);
    assert.equal(ref.totalLines, 2);
    assert.equal(ref.truncated, false);
    assert.ok(ref.entryId > 0);

    // ② 保活：read 同步 +1 已发生（live head 1 + read 引用 1 = 2）。
    const rows = await ctx.conn.query<{ ref_count: number }>(
      `SELECT ref_count FROM vfs_revision WHERE entry_id = ? AND version = ?`,
      [ref.entryId, ref.version]
    );
    assert.equal(rows[0]!.ref_count, 2);

    // ③ wire：下一轮请求的 history 经 prepare hydrate 后含全文——
    // 引用块在请求历史里不再是空串（formatReadOutput 逐字节重放）。
    const secondHistory = histories[1]!;
    const wireBlock = secondHistory
      .flatMap((m) => m.content.blocks as readonly ToolResultBlock[])
      .find((b) => b.type === "tool_result" && b.toolUseId === "tu-rrsmoke");
    assert.ok(wireBlock != null, "第二轮请求历史必须包含 read 的 tool_result");
    assert.equal(
      wireBlock.content,
      "     1|smoke line one\n     2|smoke line two",
      "hydrate 重放的 wire 文本（6 位行号格式）"
    );
    // contentRef 原样保留（块身份不变）
    assert.deepEqual(wireBlock.contentRef, ref);

    // ④ 每步 tool_use 查找源收窄为可见-only（P1-3）：hidden 行不进；
    //    但仍然覆盖本轮 tool_result 的 tool_use id（解析力不降级）。
    const persistedFull = await ctx.messages.listBySession(sessionId);
    const hiddenRows = persistedFull.filter((m) => m.hidden);
    assert.equal(hiddenRows.length, 1, "库里确有 hidden 行（断言非恒真的前提）");
    assert.ok(lookups.length >= 2, "两步请求都应带查找源");
    for (const [i, lookup] of lookups.entries()) {
      assert.ok(lookup.length > 0, `第 ${i + 1} 步查找源非空`);
      assert.ok(
        lookup.every((m) => !m.hidden),
        `第 ${i + 1} 步查找源不含 hidden 行（收窄生效）`
      );
    }
    const lookupToolUseIds = lookups[1]!.flatMap((m) =>
      m.content.blocks.filter((b) => b.type === "tool_use").map((b) => b.id)
    );
    assert.ok(
      lookupToolUseIds.includes("tu-rrsmoke"),
      "可见-only 查找源仍覆盖本轮 tool_use（functionResponse.name 解析不受影响）"
    );
  });
});

// ---------------------------------------------------------------------------
// RT-01：gemini 每 step 全可见正文拉回、无复用。
// 修法（§8.1 终裁）：本 step 未触发压缩 ⇒ 复用 step 开头 session.list() 已拿到的
// 可见集（零额外读）；只有 runCompaction 触发过才重读一次。
// 观测面纪律：计数打在**依赖注入点** `deps.listVisibleSessionMessages` 的调用计数上，
// 不打在 listBySession 的 SQL 探针上——两条读共用同一个仓储方法，SQL 探针分不开。
// ---------------------------------------------------------------------------

describe("RT-01: gemini tool_use 查找源按 stepCompactionEmitted 复用 visible", () => {
  /** savedModelId → anthropic（内置 UUID 不匹配且无 providers ⇒ 回落 anthropic）。 */
  function anthropicSavedModelRepository(): SavedModelRepository {
    const fake = {
      id: "rt01/anthropic",
      providerId: "00000000-0000-4000-8000-000000000000",
      settings: { generation: { thinkingLevel: "off" } },
    } as unknown as SavedModel;
    return {
      listByProvider: async () => [],
      findById: async (id: string) =>
        id.trim() === "rt01/anthropic" ? fake : null,
      insert: async () => undefined,
      updateById: async () => undefined,
      deleteById: async () => false,
      deleteByProvider: async () => undefined,
    };
  }

  /**
   * 跑一个多 step 的 gemini（或 anthropic）run，收集查找源与注入点调用计数。
   *
   * @param toolRounds 前 N 次模型请求返回 tool_use（每次产生一个 step）
   * @param compactOnStep >=0 时，该 step 的压缩评估返回 true
   * @param ephemeral true 时以 persistMessages:false 跑（agent-runner 自装
   *   EphemeralOverlayAgentSession：list() = 底库可见集 ++ 本 run 的 RAM overlay）
   */
  async function runAndCollect(opts: {
    readonly toolRounds: number;
    readonly savedModelId: string;
    readonly savedModelRepo: SavedModelRepository;
    readonly compactOnStep?: number;
    readonly ephemeral?: boolean;
  }): Promise<{
    readonly lookups: Array<readonly ChatMessage[]>;
    readonly shadowRereads: Array<readonly ChatMessage[]>;
    readonly lookupReadCount: number;
    readonly hiddenCount: number;
  }> {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`pj-rt01-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const projectId = project.id;
    const sessionId = session.id;
    const vfs = ctx.sessionVfs(projectId, sessionId);
    await vfs.write("/a.md", "rt01 line one\nrt01 line two");
    await vfs.write("/b.md", "rt01 b one\nrt01 b two");

    const revisionRepo = new SqliteVfsRevisionRepository(ctx.conn);
    const scope = { kind: "session" as const, projectId, sessionId };
    const readRefCountChannel = resolveReadRefCountChannel({ revisionRepo });
    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const toolCtx: BuiltinToolContext = {
      vfs,
      projectId,
      sessionId,
      sessionKkv: ctx.sessionKkv,
      ...(readRefCountChannel != null
        ? { adjustRevisionRefCount: readRefCountChannel }
        : {}),
      workplace: createWorkplaceService(ctx.conn, scope),
    };

    const lookups: Array<readonly ChatMessage[]> = [];
    // 「同一时刻的全量重读」基线：模型请求发生在查找源定夺之后、本 step 的
    // assistant 落库之前，两者之间的可见集完全相同，可直接当 wire 等价基线。
    const shadowRereads: Array<readonly ChatMessage[]> = [];
    const paths = ["/a.md", "/b.md", "/a.md", "/b.md"];
    let modelCall = 0;
    const model: ModelRequestService = {
      request: async (_savedModelId, _userContent, options) => {
        lookups.push(options?.toolUseLookupMessages ?? []);
        shadowRereads.push(
          await ctx.messages.listBySession(sessionId, { includeHidden: false }),
        );
        const turn = modelCall;
        modelCall += 1;
        if (turn < opts.toolRounds) {
          return {
            assistantText: "",
            blocks: [
              {
                type: "tool_use",
                id: `tu-rt01-${turn}`,
                name: "read",
                input: { path: paths[turn % paths.length] },
              },
            ],
            raw: {},
          };
        }
        return {
          assistantText: "done",
          blocks: [{ type: "text", text: "done" }],
          raw: {},
        };
      },
    };

    const withCompaction = opts.compactOnStep != null;
    const agentSession = new ChatAgentSession(ctx.messages, sessionId);
    await agentSession.append("user", textBlocks("请读取 rt01 的文件"));
    // 多 seed 三条 user 消息：hide range 的锚定要求 slice 内能找到一条
    // 「严格更旧于 slice 最老消息」的真用户输入，会话里可见消息不足 4 条时
    // slice 会命中 0 条 / toSeq < minSeq，压缩形同没跑。
    if (withCompaction) {
      await agentSession.append("user", textBlocks("第一轮历史"));
      await agentSession.append("user", textBlocks("第二轮历史"));
      await agentSession.append("user", textBlocks("第三轮历史"));
    }
    let compactionEvalCall = 0;
    const base = assembleAgentRunnerDeps({
      session: agentSession,
      runtime: {
        messages: ctx.messages,
        messageTranscriptEffects:
          createMessageTranscriptEffectsService(ctx.conn),
        modelRequests: model,
        messageCheckpoint: ctx.messageCheckpoint,
        eventBus: new SimpleEventBus(),
        sessionKkv: ctx.sessionKkv,
        revisionRepo,
        workplace: (wtScope) => createWorkplaceService(ctx.conn, wtScope),
        savedModelRepo: opts.savedModelRepo,
        ...(withCompaction
          ? {
              compactionConditionEvaluator: {
                shouldRequestCompaction: async () => {
                  const hit = compactionEvalCall === opts.compactOnStep;
                  compactionEvalCall += 1;
                  return hit;
                },
                getHideStartDepth: async () => 2,
              },
            }
          : {}),
      } as Pick<
        AgentTurnRuntimePort,
        | "messages"
        | "messageTranscriptEffects"
        | "modelRequests"
        | "messageCheckpoint"
        | "eventBus"
        | "sessionKkv"
        | "revisionRepo"
      > & {
        workplace: AgentTurnRuntimePort["workplace"];
        savedModelRepo: SavedModelRepository;
        compactionConditionEvaluator?: unknown;
      },
      registry,
      toolCtx,
      includeCompactionOrchestrator: withCompaction,
    });

    // 注入点计数器（不改生产装配，只在测试里包一层）
    let lookupReadCount = 0;
    const inner = base.listVisibleSessionMessages;
    assert.ok(inner != null, "装配应注入 listVisibleSessionMessages");
    const counted = async (): Promise<readonly ChatMessage[]> => {
      lookupReadCount += 1;
      return inner();
    };

    const runner = createAgentRunner({ ...base, listVisibleSessionMessages: counted });
    const result = await runner.run({
      maxSteps: opts.toolRounds + 2,
      definition: minimalDefinition(),
      projectId,
      sessionId,
      savedModelId: opts.savedModelId,
      workspaceModelId: opts.savedModelId,
      ...(opts.ephemeral === true ? { persistMessages: false } : {}),
    });
    assert.notEqual(result.stopReason, "error");

    const persisted = await ctx.messages.listBySession(sessionId);
    return {
      lookups,
      shadowRereads,
      lookupReadCount,
      hiddenCount: persisted.filter((m) => m.hidden).length,
    };
  }

  it("RT-1A: 纯追加多 step run 不产生额外可见集读（计数为 0）", async () => {
    const { lookupReadCount, lookups } = await runAndCollect({
      toolRounds: 2,
      savedModelId: "smoke/model",
      savedModelRepo: geminiSavedModelRepository(),
    });
    assert.equal(lookups.length, 3, "前置条件：三步请求都应完成");
    assert.equal(
      lookupReadCount,
      0,
      "本 step 未触发压缩 ⇒ 复用 step 开头的 visible，注入点读取次数应为 0",
    );
  });

  it("RT-1C: 每一步的查找源均含本轮及此前各轮追加的 tool_use id", async () => {
    const { lookups } = await runAndCollect({
      toolRounds: 2,
      savedModelId: "smoke/model",
      savedModelRepo: geminiSavedModelRepository(),
    });
    assert.ok(lookups.length >= 3, "前置条件：至少三步请求");
    const idsOf = (msgs: readonly ChatMessage[]): string[] =>
      msgs.flatMap((m) =>
        m.content.blocks.filter((b) => b.type === "tool_use").map((b) => b.id),
      );
    // 第 2 步的查找源必须含第 1 轮追加的 tool_use id
    assert.ok(
      idsOf(lookups[1]!).includes("tu-rt01-0"),
      "第 2 步查找源必须含第 1 轮的 tool_use id",
    );
    // 第 3 步必须含前两轮
    const third = idsOf(lookups[2]!);
    assert.ok(
      third.includes("tu-rt01-0") && third.includes("tu-rt01-1"),
      "第 3 步查找源必须含第 1、2 轮的 tool_use id",
    );
  });

  it("RT-1B: 压缩触发后按新可见集重读（注入点计数 >= 1 且确有 hidden 行）", async () => {
    const { lookupReadCount, hiddenCount } = await runAndCollect({
      toolRounds: 1,
      savedModelId: "smoke/model",
      savedModelRepo: geminiSavedModelRepository(),
      compactOnStep: 0,
    });
    assert.ok(
      hiddenCount > 0,
      "前置条件：压缩确实隐藏了行（否则本用例的『重读』无意义）",
    );
    assert.ok(
      lookupReadCount >= 1,
      "触发压缩的 step 必须重读可见集（只有压缩会把新的可见集产物带进来）",
    );
  });

  it("RT-1D: 非 gemini 协议零读", async () => {
    const { lookupReadCount } = await runAndCollect({
      toolRounds: 1,
      savedModelId: "rt01/anthropic",
      savedModelRepo: anthropicSavedModelRepository(),
      compactOnStep: 0,
    });
    assert.equal(
      lookupReadCount,
      0,
      "openai / anthropic 适配器不消费查找源，注入点读取次数恒为 0",
    );
  });

  it("RT-1F: ephemeral 路径恒走旧读法（查找源为纯 DB 集，注入点计数 >= 1）", async () => {
    const { lookupReadCount, lookups } = await runAndCollect({
      toolRounds: 2,
      savedModelId: "smoke/model",
      savedModelRepo: geminiSavedModelRepository(),
      ephemeral: true,
    });
    assert.ok(
      lookupReadCount >= 1,
      "ephemeral 路径的 step 开头 session.list() 含本 run 的 RAM overlay，而 listVisibleSessionMessages 是纯 DB 读——两者不是同一集合，复用分支的门禁必须把它挡回旧读法（CR-F17 甲案）",
    );
    // 计数来源唯一：ephemeral 路径的压缩块被 `if (persistMessages &&
    // compactionConditions != null)` 挡在门外，stepCompactionEmitted 恒为 false，
    // 所以这里的每一次读都来自 ephemeral 门禁本身（而非压缩重读）。
    assert.equal(
      lookupReadCount,
      lookups.length,
      "ephemeral 路径每一步都应走旧读法（读次数 = 模型请求次数）",
    );
    // wire 侧：旧读法下查找源是纯 DB 集，本 run 在 overlay 里追加的 tool_use id
    // 一条都解析不到——出站 wire 与 RT-01 改动前一致（甲案刻意不引入的变化）。
    const idsOf = (msgs: readonly ChatMessage[]): string[] =>
      msgs.flatMap((m) =>
        m.content.blocks.filter((b) => b.type === "tool_use").map((b) => b.id),
      );
    for (const [i, lookup] of lookups.entries()) {
      assert.ok(
        !idsOf(lookup).some((id) => id.startsWith("tu-rt01-")),
        `第 ${i + 1} 步的查找源不得含本 run overlay 的 tool_use id（旧读法口径）`,
      );
    }
  });

  it("RT-1E: 复用分支与全量重读对 contents[] 输出逐字段全等", async () => {
    const { lookups, shadowRereads } = await runAndCollect({
      toolRounds: 2,
      savedModelId: "smoke/model",
      savedModelRepo: geminiSavedModelRepository(),
    });
    assert.ok(lookups.length >= 2, "前置条件：至少两步请求");
    for (const [i, lookup] of lookups.entries()) {
      // 非恒真前提：查找源非空（否则「逐字段全等」是空集比较）
      assert.ok(lookup.length > 0, `第 ${i + 1} 步查找源非空`);
      assert.deepEqual(
        lookup,
        shadowRereads[i],
        `第 ${i + 1} 步复用分支的产物应与同一时刻的全量重读逐字段全等`,
      );
      // wire 侧：两条查找源跑 chatMessagesToGeminiContents 输出逐字段全等
      const outbound = normalizeOrphanToolResultsForLlm(lookup);
      assert.deepEqual(
        chatMessagesToGeminiContents(outbound, { toolLookupMessages: lookup }),
        chatMessagesToGeminiContents(outbound, {
          toolLookupMessages: shadowRereads[i],
        }),
        `第 ${i + 1} 步两条路径的 gemini contents 输出应逐字段全等`,
      );
    }
  });
});

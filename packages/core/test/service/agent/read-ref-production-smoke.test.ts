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
      listSessionMessages: () => ctx.messages.listBySession(sessionId),
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

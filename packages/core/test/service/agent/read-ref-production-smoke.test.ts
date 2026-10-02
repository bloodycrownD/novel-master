/**
 * read 结果全文直出的生产装配 smoke（task-attach-unref Step 4）。
 *
 * 三端 runtime 的真实形态：只注入 `revisionRepo`（无任何 ref_count 通道）。
 * v1.5.30 起引用化退役，故本文件不再有「通道推导」这一层（`resolveReadRefCountChannel`
 * 随 Step 2 删除），链路断言改为：
 *
 * ① agent-runner 走 `assembleAgentRunnerDeps` 装配，落库的 tool_result 块
 *    **全文直出**（带 6 位行号）、`contentRef` 缺省。
 * ② read 执行前后 revision `ref_count` 不变（无 `+1`）。
 * ③ 下一轮模型请求的 history 里同一条 tool_result 携带同一份全文——不经
 *    hydrate（新块上根本没有引用键）。
 * ④ 每步 tool_use 查找源仍是可见-only（与引用化无关的既有收窄，防回归）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SimpleEventBus } from "@novel-master/core/events";
import { textBlocks } from "@novel-master/core/chat";
import { assembleAgentRunnerDeps } from "../../../src/service/agent/logic/assemble-agent-runner-deps.js";
import { createAgentRunner } from "../../../src/service/agent/create-agent-runner.js";
import { ChatAgentSession } from "../../../src/service/agent/impl/chat-agent-session.js";
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

describe("read 结果全文直出: 生产链路 smoke（runner 全链）", () => {
  it("read 全文直出落库（无 contentRef、无 +1）→ 下轮请求 history 携带同一份全文", async () => {
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

    // run-agent-turn 主装配点同款：生产 runtime 只有 revisionRepo，无 ref 通道。
    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const toolCtx: BuiltinToolContext = {
      vfs,
      projectId,
      sessionId,
      listSessionMessages: () => ctx.messages.listBySession(sessionId),
      sessionKkv: ctx.sessionKkv,
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

    // ① 落库形态：assistant 带 tool_use；user 的 tool_result 块是**全文
    // 直出**（6 位行号 wire），块上没有 contentRef。
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
    const wire = "     1|smoke line one\n     2|smoke line two";
    assert.equal(block.content, wire, "落库即全文直出（DB 里就存着 wire）");
    assert.equal(block.contentRef, undefined, "落库块不得带 contentRef");
    assert.equal(
      Object.hasOwn(block, "contentRef"),
      false,
      "contentRef 键本身都不该出现"
    );

    // ② 无 +1：read 执行前后 ref_count 恒为 live head 的 1。
    const entryRows = await ctx.conn.query<{ entry_id: number }>(
      `SELECT entry_id FROM vfs_entry WHERE scope_key = ? AND path = ?`,
      [`session:${projectId}:${sessionId}`, "/smoke.md"]
    );
    assert.equal(entryRows.length, 1);
    const revRows = await ctx.conn.query<{ ref_count: number }>(
      `SELECT ref_count FROM vfs_revision WHERE entry_id = ? AND version = 1`,
      [entryRows[0]!.entry_id]
    );
    assert.equal(revRows[0]!.ref_count, 1, "read 不再 +1（只剩 live head 持有）");

    // ③ 请求历史：第二轮拿到的 tool_result 就是同一份全文（不经 hydrate）。
    const secondHistory = histories[1]!;
    const wireBlock = secondHistory
      .flatMap((m) => m.content.blocks as readonly ToolResultBlock[])
      .find((b) => b.type === "tool_result" && b.toolUseId === "tu-rrsmoke");
    assert.ok(wireBlock != null, "第二轮请求历史必须包含 read 的 tool_result");
    assert.equal(
      wireBlock.content,
      wire,
      "历史里携带的仍是带行号全文（无引用键，hydrate 零处理）"
    );
    assert.equal(wireBlock.contentRef, undefined);

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

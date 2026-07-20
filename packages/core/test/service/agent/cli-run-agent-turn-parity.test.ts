/**
 * CLI ↔ runAgentTurn 行为 parity（T-R2 / T-R2-CLI / T-R2-cont）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decode } from "@novel-master/core";
import {
  agentDefinitionSchema,
  AgentTurnError,
  createAgentRegistryService,
  runAgentTurn,
  type AgentDefinition,
  type AgentTurnRuntimePort,
} from "@novel-master/core/agent";
import {
  createUserVfsTurnServiceBundle,
  readMessageMetadata,
  textBlocks,
} from "@novel-master/core/chat";
import {
  refreshUserVfsUnifiedToolTurnSnapshot,
  resetUserVfsUnifiedToolTurnSnapshotForTests,
} from "@/domain/feature-flags/user-vfs-unified-tool-turn.js";
import { createSessionKkvService } from "../../../src/service/session-kkv/create-session-kkv-service.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../../helpers/novel-master-fixture.js";

novelMasterTestFixture();

const TEST_SAVED_MODEL_ID = "00000000-0000-4000-8000-000000000088";
const PROJECT_MODEL_ID = "00000000-0000-4000-8000-000000000089";
const FLAG_MODEL_ID = "00000000-0000-4000-8000-000000000090";

const customDefinition: AgentDefinition = {
  name: "项目专属 Agent",
  prompts: {
    persist: [
      {
        name: "sys",
        type: "text",
        role: "user",
        content: "CUSTOM_PROJECT_PROMPT",
      },
    ],
    dynamic: [],
  },
  model: PROJECT_MODEL_ID,
};

const flagDefinition: AgentDefinition = {
  name: "CLI Flag Agent",
  prompts: {
    persist: [
      {
        name: "sys",
        type: "text",
        role: "user",
        content: "FLAG_PROMPT",
      },
    ],
    dynamic: [],
  },
  model: FLAG_MODEL_ID,
};

function writeOp(path: string, content: string, toolId = "tu_write") {
  return {
    actionXml: `<action name="write">\n${JSON.stringify({ path, content }, null, 2)}\n</action>`,
    tools: [
      {
        id: toolId,
        name: "write",
        input: { path, content },
      },
    ],
  };
}

function makeRuntime(
  ctx: ReturnType<typeof getNovelMasterTestContext>,
  registry: ReturnType<typeof createAgentRegistryService>,
): AgentTurnRuntimePort {
  const { userVfsTurn } = createUserVfsTurnServiceBundle(ctx.conn);
  return {
    state: {
      getCurrentAgentId: () => ctx.state.getCurrentAgentId(),
      getCurrentModelId: async () => TEST_SAVED_MODEL_ID,
      getCurrentRegexGroupId: async () => undefined,
    },
    agentRegistry: registry,
    projects: ctx.projects,
    messages: ctx.messages,
    savedModelRepo: {
      getById: async () => null,
    } as AgentTurnRuntimePort["savedModelRepo"],
    messageCheckpoint: ctx.messageCheckpoint,
    modelRequests: {} as AgentTurnRuntimePort["modelRequests"],
    eventBus: {} as AgentTurnRuntimePort["eventBus"],
    regexConfig: {} as AgentTurnRuntimePort["regexConfig"],
    compactionConditionEvaluator:
      undefined as unknown as AgentTurnRuntimePort["compactionConditionEvaluator"],
    eventOrchestrator: {} as AgentTurnRuntimePort["eventOrchestrator"],
    userVfsTurn,
    sessionKkv: createSessionKkvService(ctx.conn),
    sessionVfs: (projectId, sessionId) => ctx.sessionVfs(projectId, sessionId),
    worktree: (_scope) =>
      ({
        renderDisplay: async () => "",
        buildListRows: async () => [],
        materializePersistBlock: async () => ({ workplaceDisplay: "" }),
        evaluateRuleView: async () => ({
          rows: [],
          displayByPath: new Map(),
        }),
      }) as ReturnType<AgentTurnRuntimePort["worktree"]>,
  };
}

async function runUntilRunner(
  runtime: AgentTurnRuntimePort,
  scope: { projectId: string; sessionId: string },
  content: string,
  options?: Parameters<typeof runAgentTurn>[3],
): Promise<AgentDefinition | undefined> {
  let capturedDefinition: AgentDefinition | undefined;
  try {
    await runAgentTurn(runtime, scope, content, {
      ...options,
      onAfterResolveModel: async (resolveCtx) => {
        capturedDefinition = resolveCtx.definition;
        await options?.onAfterResolveModel?.(resolveCtx);
      },
    });
  } catch {
    // runner deps stubbed；definition / flush 已在 runner 之前完成
  }
  return capturedDefinition;
}

describe("cli-run-agent-turn parity", () => {
  it("T-R2：无 definitionOverride 时走 resolveAgentForProject（项目 custom）", async () => {
    const ctx = getNovelMasterTestContext();
    const registry = createAgentRegistryService(ctx.conn, ctx.state);
    await registry.upsert(
      "global-agent",
      decode(
        {
          schemaVersion: 1,
          name: "全局 Agent",
          prompts: {
            persist: {
              sys: { type: "text", role: "user", content: "GLOBAL_PROMPT" },
            },
            dynamic: {},
          },
          model: "00000000-0000-4000-8000-000000000087",
        },
        agentDefinitionSchema,
      ),
    );
    await ctx.state.setCurrentAgentId("global-agent");
    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_ID);

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    await ctx.projects.updateAgentConfig(project.id, {
      mode: "custom",
      definition: customDefinition,
    });
    const session = await ctx.sessions.create(project.id, "S1");
    const runtime = makeRuntime(ctx, registry);

    const captured = await runUntilRunner(
      runtime,
      { projectId: project.id, sessionId: session.id },
      "hello",
    );

    assert.ok(captured != null);
    assert.equal(captured.name, "项目专属 Agent");
    assert.equal(captured.prompts.persist[0]?.content, "CUSTOM_PROJECT_PROMPT");
  });

  it("T-R2：空续跑 + pending VFS 后 transcript 顺序与 flush 契约一致", async () => {
    resetUserVfsUnifiedToolTurnSnapshotForTests();
    refreshUserVfsUnifiedToolTurnSnapshot(true);

    const ctx = getNovelMasterTestContext();
    const registry = createAgentRegistryService(ctx.conn, ctx.state);
    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_ID);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const runtime = makeRuntime(ctx, registry);

    await ctx.messages.append(session.id, "assistant", textBlocks("模型回复"));
    await ctx.messages.append(session.id, "user", textBlocks("用户续跑"));
    await runtime.userVfsTurn!.executeOp(
      session.id,
      writeOp("/parity.md", "content"),
    );

    await runUntilRunner(
      runtime,
      { projectId: project.id, sessionId: session.id },
      "",
      { allowResumeWithoutInput: true },
    );

    const listed = await ctx.messages.listBySession(session.id);
    assert.equal(listed.length, 2);
    assert.equal(listed[0]!.role, "assistant");
    assert.equal(listed[1]!.role, "user");
    assert.equal(
      listed.some(
        (m) => readMessageMetadata(m.raw)?.kind === "user_vfs_action",
      ),
      false,
    );
    assert.equal(listed[1]!.attachments?.[0]?.source, "user_ops");

    resetUserVfsUnifiedToolTurnSnapshotForTests();
  });

  it("T-R2-CLI：definitionOverride 注入时跳过 resolveAgentForProject", async () => {
    const ctx = getNovelMasterTestContext();
    const registry = createAgentRegistryService(ctx.conn, ctx.state);
    await registry.upsert(
      "global-agent",
      decode(
        {
          schemaVersion: 1,
          name: "全局 Agent",
          prompts: {
            persist: {
              sys: { type: "text", role: "user", content: "GLOBAL_PROMPT" },
            },
            dynamic: {},
          },
          model: "00000000-0000-4000-8000-000000000087",
        },
        agentDefinitionSchema,
      ),
    );
    await ctx.state.setCurrentAgentId("global-agent");
    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_ID);

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    await ctx.projects.updateAgentConfig(project.id, {
      mode: "custom",
      definition: customDefinition,
    });
    const session = await ctx.sessions.create(project.id, "S1");
    const runtime = makeRuntime(ctx, registry);

    const captured = await runUntilRunner(
      runtime,
      { projectId: project.id, sessionId: session.id },
      "hello",
      { definitionOverride: flagDefinition },
    );

    assert.ok(captured != null);
    assert.equal(captured.name, "CLI Flag Agent");
    assert.equal(captured.prompts.persist[0]?.content, "FLAG_PROMPT");
  });

  it("T-R2-cont：visible 末条 user 空续跑不 append 新 user", async () => {
    const ctx = getNovelMasterTestContext();
    const registry = createAgentRegistryService(ctx.conn, ctx.state);
    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_ID);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    await ctx.messages.append(session.id, "user", textBlocks("已有 user"));
    const before = await ctx.messages.listBySession(session.id);
    assert.equal(before.length, 1);

    const runtime = makeRuntime(ctx, registry);
    await runUntilRunner(
      runtime,
      { projectId: project.id, sessionId: session.id },
      "",
      { allowResumeWithoutInput: true, maxStepsOverride: 1 },
    );

    const after = await ctx.messages.listBySession(session.id);
    assert.equal(after.length, 1);
    const tailText = after[0]!.content.blocks[0];
    assert.equal(tailText?.type === "text" ? tailText.text : "", "已有 user");
  });

  it("T-R2-cont：allowAssistantContinue + maxStepsOverride:1 空续跑不 append", async () => {
    const ctx = getNovelMasterTestContext();
    const registry = createAgentRegistryService(ctx.conn, ctx.state);
    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_ID);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    await ctx.messages.append(session.id, "assistant", textBlocks("模型回复"));
    const before = await ctx.messages.listBySession(session.id);
    assert.equal(before.length, 1);

    const runtime = makeRuntime(ctx, registry);
    await runUntilRunner(
      runtime,
      { projectId: project.id, sessionId: session.id },
      "",
      { allowAssistantContinue: true, maxStepsOverride: 1 },
    );

    const after = await ctx.messages.listBySession(session.id);
    assert.equal(after.length, 1);
    assert.equal(after[0]!.role, "assistant");
  });

  it("B-01：allowAssistantContinue + 有规则可见文件 + 空 cache → list 长度不变、无新 user", async () => {
    const ctx = getNovelMasterTestContext();
    const registry = createAgentRegistryService(ctx.conn, ctx.state);
    await ctx.state.setCurrentModelId(TEST_SAVED_MODEL_ID);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    await ctx.messages.append(session.id, "assistant", textBlocks("模型回复"));
    const before = await ctx.messages.listBySession(session.id);
    assert.equal(before.length, 1);

    const base = makeRuntime(ctx, registry);
    const runtime: AgentTurnRuntimePort = {
      ...base,
      worktree: (_scope) =>
        ({
          renderDisplay: async () => "",
          buildListRows: async () => [],
          materializePersistBlock: async () => ({ workplaceDisplay: "" }),
          evaluateRuleView: async () => ({
            rows: [
              {
                kind: "file" as const,
                path: "/visible.md",
                inclusionMode: "include" as const,
                displayState: "full" as const,
              },
            ],
            displayByPath: new Map([["/visible.md", "full" as const]]),
          }),
        }) as ReturnType<AgentTurnRuntimePort["worktree"]>,
    };

    await runUntilRunner(
      runtime,
      { projectId: project.id, sessionId: session.id },
      "",
      { allowAssistantContinue: true, maxStepsOverride: 1 },
    );

    const after = await ctx.messages.listBySession(session.id);
    assert.equal(after.length, before.length, "listBySession 长度不变");
    assert.equal(
      after.some((m) => m.role === "user"),
      false,
      "不得因 workplace 差集误 append 空 user",
    );
    assert.equal(after[0]!.role, "assistant");
  });

  it("T-R2-cont：allowAssistantContinue 无 maxStepsOverride:1 时拒绝", async () => {
    const ctx = getNovelMasterTestContext();
    const registry = createAgentRegistryService(ctx.conn, ctx.state);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    await ctx.messages.append(session.id, "assistant", textBlocks("模型回复"));

    const runtime = makeRuntime(ctx, registry);
    await assert.rejects(
      () =>
        runAgentTurn(
          runtime,
          { projectId: project.id, sessionId: session.id },
          "",
          { allowAssistantContinue: true },
        ),
      (err: unknown) => {
        assert.ok(err instanceof AgentTurnError);
        assert.match(
          (err as AgentTurnError).message,
          /allowAssistantContinue 须配合 maxStepsOverride: 1/,
        );
        return true;
      },
    );
  });

  it("T-R2-cont：allowResumeWithoutInput 与 allowAssistantContinue 互斥", async () => {
    const ctx = getNovelMasterTestContext();
    const registry = createAgentRegistryService(ctx.conn, ctx.state);
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    const runtime = makeRuntime(ctx, registry);
    await assert.rejects(
      () =>
        runAgentTurn(
          runtime,
          { projectId: project.id, sessionId: session.id },
          "",
          {
            allowResumeWithoutInput: true,
            allowAssistantContinue: true,
            maxStepsOverride: 1,
          },
        ),
      (err: unknown) => {
        assert.ok(err instanceof AgentTurnError);
        assert.match(
          (err as AgentTurnError).message,
          /互斥/,
        );
        return true;
      },
    );
  });
});

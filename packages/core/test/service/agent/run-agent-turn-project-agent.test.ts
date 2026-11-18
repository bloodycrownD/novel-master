import { Result } from "../../../src/errors/either.js";
import { unwrap } from "../../helpers/result-unwrap.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decode as decodeRaw } from "@novel-master/core";
import type { ZodType } from "zod";
import { AgentServiceFactory, agentDefinitionSchema, runAgentTurn, type AgentDefinition, type AgentTurnRuntimePort } from "@novel-master/core/agent";
import type { UserVfsTurnService } from "@/service/chat/user-vfs-turn.port.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../../helpers/novel-master-fixture.js";

/** decode 已改返回 Result（四期签名）：测试内统一解包——Ok 取 value，Err 抛 error。 */
function decode<T>(raw: unknown, schema: ZodType<T>): T {
  return unwrap(decodeRaw(raw, schema));
}

novelMasterTestFixture();

const TEST_SAVED_MODEL_ID = "00000000-0000-4000-8000-000000000088";
const PROJECT_MODEL_ID = "00000000-0000-4000-8000-000000000089";

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

function mockUserVfsTurn(): UserVfsTurnService {
  return {
    executeOp: async () => ({ ok: true }),
  };
}

function makeRuntime(
  ctx: ReturnType<typeof getNovelMasterTestContext>,
  registry: ReturnType<typeof AgentServiceFactory.createRegistry>,
  overrides?: { readonly sessions?: AgentTurnRuntimePort["sessions"] },
): AgentTurnRuntimePort {
  return {
    state: {
      getCurrentAgentId: () => ctx.state.getCurrentAgentId(),
      getCurrentModelId: async () => Result.ok(TEST_SAVED_MODEL_ID),
    },
    agentRegistry: registry,
    projects: ctx.projects,
    messages: {
      listBySession: async () => [],
      append: async () => ({ id: "m1", role: "user", content: { blocks: [] } }),
      delete: async () => undefined,
    } as AgentTurnRuntimePort["messages"],
    messageCheckpoint: {
      capture: async () => undefined,
      backfillMissingBaselines: async () => undefined,
    } as AgentTurnRuntimePort["messageCheckpoint"],
    modelRequests: {} as AgentTurnRuntimePort["modelRequests"],
    eventBus: {} as AgentTurnRuntimePort["eventBus"],
    compactionConditionEvaluator:
      undefined as unknown as AgentTurnRuntimePort["compactionConditionEvaluator"],
    eventOrchestrator: {} as AgentTurnRuntimePort["eventOrchestrator"],
    sessionVfs: () =>
      ({} as ReturnType<AgentTurnRuntimePort["sessionVfs"]>),
    workplace: () =>
      ({
        renderDisplay: async () => Result.ok(""),
        buildListRows: async () => Result.ok([]),
        materializePersistBlock: async () => Result.ok({ workplaceDisplay: "" }),
        evaluateRuleView: async () =>
          Result.ok({
            rows: [],
            displayByPath: new Map(),
          }),
      }) as ReturnType<AgentTurnRuntimePort["workplace"]>,
    sessionKkv: {
      get: async () => null,
      set: async () => undefined,
      delete: async () => undefined,
      clearDomain: async () => undefined,
      clearSession: async () => undefined,
      listKeys: async () => [],
    },
    userVfsTurn: mockUserVfsTurn(),
    sessions: overrides?.sessions ?? ctx.sessions,
  };
}

describe("runAgentTurn project agent config", () => {
  it("项目智能体已下线：custom 配置被忽略，走 session 级 agent", async () => {
    const ctx = getNovelMasterTestContext();
    const registry = AgentServiceFactory.createRegistry(ctx.conn, ctx.state);
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

    const project = unwrap(await ctx.projects.create(`P-${testIsolationSuffix()}`));
    // 旧库残留 custom 配置——runner 应忽略它，走 session 级。
    unwrap(await ctx.projects.updateAgentConfig(project.id, {
      mode: "custom",
      definition: customDefinition,
    }));
    const session = unwrap(await ctx.sessions.create(project.id, "S1"));
    unwrap(await ctx.sessions.updateSessionAgentConfig(session.id, {
      agentId: "global-agent",
    }));

    const runtime = makeRuntime(ctx, registry);
    let capturedDefinition: AgentDefinition | undefined;

    try {
      unwrap(await runAgentTurn(
        runtime,
        { projectId: project.id, sessionId: session.id },
        "hello",
        {
          onAfterResolveModel: async (resolveCtx) => {
            capturedDefinition = resolveCtx.definition;
          },
        },
      ));
    } catch {
      // runner deps stubbed; onAfterResolveModel runs before runner
    }

    assert.ok(capturedDefinition != null);
    // 走 session 级 global-agent，不是项目专属 customDefinition。
    assert.equal(capturedDefinition.name, "全局 Agent");
    assert.equal(
      capturedDefinition.prompts.persist[0]?.content,
      "GLOBAL_PROMPT",
    );
  });

  it("T-R4：scope.sessionId 透传到 resolver；session-bind 覆盖 workspace 全局", async () => {
    const ctx = getNovelMasterTestContext();
    const registry = AgentServiceFactory.createRegistry(ctx.conn, ctx.state);
    // workspace 全局 agent
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

    // 会话绑定的另一个 agent（v2：不再回退 workspace，给个 model pin）
    await registry.upsert(
      "session-bind-agent",
      decode(
        {
          schemaVersion: 1,
          name: "会话绑定 Agent",
          prompts: {
            persist: {
              sys: { type: "text", role: "user", content: "SESSION_BIND_PROMPT" },
            },
            dynamic: {},
          },
          model: TEST_SAVED_MODEL_ID,
        },
        agentDefinitionSchema,
      ),
    );

    const project = unwrap(await ctx.projects.create(`P-${testIsolationSuffix()}`));
    const session = unwrap(await ctx.sessions.create(project.id, "S1"));
    unwrap(await ctx.sessions.updateSessionAgentConfig(session.id, {
      agentId: "session-bind-agent",
    }));

    const runtime = makeRuntime(ctx, registry);
    let capturedDefinition: AgentDefinition | undefined;
    let capturedModel: string | undefined;
    try {
      unwrap(await runAgentTurn(
        runtime,
        { projectId: project.id, sessionId: session.id },
        "hello",
        {
          onAfterResolveModel: async (resolveCtx) => {
            capturedDefinition = resolveCtx.definition;
            capturedModel = resolveCtx.savedModelId;
          },
        },
      ));
    } catch {
      // runner deps stubbed; onAfterResolveModel runs before runner
    }

    // 透传 sessionId 后 resolver 走 session 分支，拿到 bind agent 的 definition。
    assert.ok(capturedDefinition != null);
    assert.equal(capturedDefinition.name, "会话绑定 Agent");
    assert.equal(
      capturedDefinition.prompts.persist[0]?.content,
      "SESSION_BIND_PROMPT",
    );
    // v2：session-bind agent 自带 model pin，不再回退 workspace。
    assert.equal(capturedModel, TEST_SAVED_MODEL_ID);
  });
});

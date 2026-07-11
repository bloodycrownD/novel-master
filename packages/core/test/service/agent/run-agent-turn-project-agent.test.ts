import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decode } from "@novel-master/core";
import {
  agentDefinitionSchema,
  createAgentRegistryService,
  runAgentTurn,
  type AgentDefinition,
  type AgentTurnRuntimePort,
} from "@novel-master/core/agent";
import type { UserVfsTurnService } from "@/service/chat/user-vfs-turn.port.js";
import { createSessionWorktreeBlockStore } from "@novel-master/core/worktree";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../../helpers/novel-master-fixture.js";

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
    flushPendingUserVfsTurns: async () => ({ flushed: false }),
    hasPendingTurns: async () => false,
  };
}

function makeRuntime(
  ctx: ReturnType<typeof getNovelMasterTestContext>,
  registry: ReturnType<typeof createAgentRegistryService>,
): AgentTurnRuntimePort {
  return {
    state: {
      getCurrentAgentId: () => ctx.state.getCurrentAgentId(),
      getCurrentModelId: async () => TEST_SAVED_MODEL_ID,
      getCurrentRegexGroupId: async () => undefined,
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
    } as AgentTurnRuntimePort["messageCheckpoint"],
    modelRequests: {} as AgentTurnRuntimePort["modelRequests"],
    worktreeBlockStore: createSessionWorktreeBlockStore(),
    eventBus: {} as AgentTurnRuntimePort["eventBus"],
    regexConfig: {} as AgentTurnRuntimePort["regexConfig"],
    compactionConditionEvaluator:
      undefined as unknown as AgentTurnRuntimePort["compactionConditionEvaluator"],
    eventOrchestrator: {} as AgentTurnRuntimePort["eventOrchestrator"],
    sessionVfs: () =>
      ({} as ReturnType<AgentTurnRuntimePort["sessionVfs"]>),
    worktree: () =>
      ({
        renderDisplay: async () => "",
        buildListRows: async () => [],
        materializePersistBlock: async () => ({ worktreeDisplay: "" }),
      }) as ReturnType<AgentTurnRuntimePort["worktree"]>,
    userVfsTurn: mockUserVfsTurn(),
  };
}

describe("runAgentTurn project agent config", () => {
  it("custom 项目使用专属 definition（非全局 Agent）", async () => {
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
    let capturedDefinition: AgentDefinition | undefined;

    try {
      await runAgentTurn(
        runtime,
        { projectId: project.id, sessionId: session.id },
        "hello",
        {
          onAfterResolveModel: async (resolveCtx) => {
            capturedDefinition = resolveCtx.definition;
          },
        },
      );
    } catch {
      // runner deps stubbed; onAfterResolveModel runs before runner
    }

    assert.ok(capturedDefinition != null);
    assert.equal(capturedDefinition.name, "项目专属 Agent");
    assert.equal(
      capturedDefinition.prompts.persist[0]?.content,
      "CUSTOM_PROJECT_PROMPT",
    );
  });
});

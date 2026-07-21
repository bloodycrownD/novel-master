/**
 * T-T4 / T-T5 / T-T5b：agent-runner 写/清 session API prompt token 缓存。
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import {
  createAgentRunner,
  InMemoryAgentSession,
  type AgentDefinition,
  type BuiltinToolContext,
  type CreateAgentRunnerDeps,
} from "@novel-master/core/agent";
import { textBlocks } from "@novel-master/core/chat";
import { SimpleEventBus } from "@novel-master/core/events";
import {
  resolveCurrentPromptTokens,
  sessionApiPromptTokenCache,
  type LlmChatResult,
  type ModelRequestService,
} from "@novel-master/core/provider";
import { registerBuiltinTools, ToolRegistry } from "@novel-master/core";
import { type VfsService } from "@novel-master/core/vfs";
import { createMemorySessionKkv } from "../helpers/prompt-layout-test-helpers.js";
import { noopSavedModelRepository } from "../helpers/noop-saved-model-repo.js";
import { registerNodeTokenizerDriverForTests } from "../helpers/register-node-tokenizer-driver-for-tests.js";
import { createDefaultTokenCounterRegistry } from "../../src/infra/tokenizer/index.js";
import { emptyRegistryDeps } from "../infra/tokenizer/registry-test-helpers.js";
import { TokenRatioConditionTrigger } from "../../src/domain/compaction-conditions/triggers/token-ratio.trigger.js";

const RUN_MODEL_ID = "anthropic/claude";
const PROJECT_ID = "p-token-cache";
const SESSION_ID = "s-token-cache";

function minimalDefinition(): AgentDefinition {
  return {
    name: "test",
    prompts: { persist: [], dynamic: [] },
  };
}

function mockVfs(): VfsService {
  return {
    async read(path: string) {
      return { path, content: "", version: 1, mtimeMs: 0 };
    },
    async write() {
      return { version: 1 };
    },
    async replace() {
      return { version: 1, replacements: 0 };
    },
    async list() {
      return [];
    },
    async glob() {
      return [];
    },
    async grep() {
      return [];
    },
    async delete() {
      return { deleted: true };
    },
  } as unknown as VfsService;
}

function mockToolCtx(vfs: VfsService): BuiltinToolContext {
  return {
    vfs,
    projectId: PROJECT_ID,
    sessionId: SESSION_ID,
    listSessionMessages: async () => [],
  };
}

function runnerDeps(
  deps: Omit<
    CreateAgentRunnerDeps,
    "eventBus" | "sessionKkv" | "workplace" | "savedModels"
  > &
    Partial<Pick<CreateAgentRunnerDeps, "savedModels">>,
): CreateAgentRunnerDeps {
  return {
    savedModels: noopSavedModelRepository(),
    ...deps,
    eventBus: new SimpleEventBus(),
    sessionKkv: createMemorySessionKkv(),
    workplace: () =>
      ({
        scope: { kind: "session", projectId: PROJECT_ID, sessionId: SESSION_ID },
        renderDisplay: async () => "",
        buildListRows: async () => [],
        materializePersistBlock: async () => ({ workplaceDisplay: "" }),
      }) as never,
  };
}

function createMockModel(
  responses: LlmChatResult[],
): ModelRequestService & { callCount: () => number } {
  let calls = 0;
  return {
    callCount: () => calls,
    request: mock.fn(async () => {
      const r = responses[calls];
      calls += 1;
      if (r == null) {
        throw new Error("Unexpected extra model request");
      }
      return r;
    }),
  };
}

const defaultRunScope = {
  sessionId: SESSION_ID,
  projectId: PROJECT_ID,
  savedModelId: RUN_MODEL_ID,
  workspaceModelId: RUN_MODEL_ID,
};

describe("AgentRunner session API prompt token cache", () => {
  beforeEach(() => {
    registerNodeTokenizerDriverForTests();
    sessionApiPromptTokenCache.clearAll();
  });

  afterEach(() => {
    sessionApiPromptTokenCache.clearAll();
  });

  it("T-T4: completed 且 pick 有值 → set 后 trigger 与 resolve 同值", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    const model = createMockModel([
      {
        assistantText: "done",
        blocks: [{ type: "text", text: "done" }],
        raw: {},
        usage: { promptTokens: 4242 },
      },
    ]);

    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const runner = createAgentRunner(
      runnerDeps({
        session,
        modelRequests: model,
        registry,
        toolCtx: mockToolCtx(mockVfs()),
      }),
    );

    const result = await runner.run({
      maxSteps: 3,
      definition: minimalDefinition(),
      ...defaultRunScope,
    });
    assert.equal(result.stopReason, "completed");
    assert.equal(sessionApiPromptTokenCache.get(SESSION_ID)?.promptTokens, 4242);

    const tokenRegistry = createDefaultTokenCounterRegistry(emptyRegistryDeps());
    const resolved = await resolveCurrentPromptTokens(SESSION_ID, {
      layout: { persist: [], dynamic: [] },
      ctx: { workplaceDisplay: "", messages: [] },
      savedModelId: RUN_MODEL_ID,
      registry: tokenRegistry,
    });
    assert.equal(resolved.source, "api");
    assert.equal(resolved.tokenCount, 4242);

    const trigger = new TokenRatioConditionTrigger(
      {
        tokenRatio: 0.01,
        resolveContextWindow: async () => 100_000,
        resolveTokenizerOverride: async () => "auto",
      },
      tokenRegistry,
    );
    // 4242 > floor(100000*0.01)=1000 → true；且与 resolve 同读 API
    assert.equal(
      await trigger.shouldTrigger(session, {
        sessionId: SESSION_ID,
        modelContext: {
          workspaceModelId: RUN_MODEL_ID,
          savedModelId: RUN_MODEL_ID,
        },
        promptInput: { messages: [] },
        layout: { persist: [], dynamic: [] },
        ctx: { workplaceDisplay: "", messages: [] },
      }),
      true,
    );
  });

  it("T-T5: cancelled → clear，resolve 回退 local（不保留旧 API）", async () => {
    sessionApiPromptTokenCache.set(SESSION_ID, {
      promptTokens: 7777,
      updatedAt: Date.now(),
    });

    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    const model = createMockModel([
      {
        assistantText: "should-not-run",
        blocks: [{ type: "text", text: "should-not-run" }],
        raw: {},
        usage: { promptTokens: 9999 },
      },
    ]);

    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const runner = createAgentRunner(
      runnerDeps({
        session,
        modelRequests: model,
        registry,
        toolCtx: mockToolCtx(mockVfs()),
      }),
    );

    const controller = new AbortController();
    controller.abort();
    const result = await runner.run({
      maxSteps: 3,
      definition: minimalDefinition(),
      ...defaultRunScope,
      signal: controller.signal,
    });
    assert.equal(result.stopReason, "cancelled");
    assert.equal(sessionApiPromptTokenCache.get(SESSION_ID), undefined);

    const tokenRegistry = createDefaultTokenCounterRegistry(emptyRegistryDeps());
    const resolved = await resolveCurrentPromptTokens(SESSION_ID, {
      layout: { persist: [], dynamic: [] },
      ctx: { workplaceDisplay: "", messages: [] },
      savedModelId: RUN_MODEL_ID,
      registry: tokenRegistry,
    });
    assert.equal(resolved.source, "local");
  });

  it("T-T5b: FAILED/throw 后必 clear，resolve 回退 local", async () => {
    sessionApiPromptTokenCache.set(SESSION_ID, {
      promptTokens: 8888,
      updatedAt: Date.now(),
    });

    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    const model: ModelRequestService = {
      request: mock.fn(async () => {
        throw new Error("upstream boom");
      }),
    };

    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const runner = createAgentRunner(
      runnerDeps({
        session,
        modelRequests: model,
        registry,
        toolCtx: mockToolCtx(mockVfs()),
      }),
    );

    await assert.rejects(
      () =>
        runner.run({
          maxSteps: 3,
          definition: minimalDefinition(),
          ...defaultRunScope,
        }),
      /upstream boom/,
    );
    assert.equal(sessionApiPromptTokenCache.get(SESSION_ID), undefined);

    const tokenRegistry = createDefaultTokenCounterRegistry(emptyRegistryDeps());
    const resolved = await resolveCurrentPromptTokens(SESSION_ID, {
      layout: { persist: [], dynamic: [] },
      ctx: { workplaceDisplay: "", messages: [] },
      savedModelId: RUN_MODEL_ID,
      registry: tokenRegistry,
    });
    assert.equal(resolved.source, "local");
  });
});

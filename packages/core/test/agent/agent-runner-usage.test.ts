/**
 * T-S2（→ Step 4-6）：agent-runner 把 LLM 响应的 usage 透传到 session.append。
 *
 * - mock LLM 返回 result.usage → agent-runner append 后 InMemoryAgentSession
 *   最后一条 assistant message 携带 usage；
 * - mock LLM 不返回 usage（undefined）→ assistant message 不挂 usage 字段（兼容）。
 */

import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  createAgentRunner,
  InMemoryAgentSession,
  type AgentDefinition,
  type CreateAgentRunnerDeps,
} from "@novel-master/core/agent";
import { textBlocks } from "@novel-master/core/chat";
import { registerBuiltinTools, ToolRegistry, type BuiltinToolContext } from "@novel-master/core";
import {
  defaultSavedModelSettings,
  type LlmChatResult,
  type ModelRequestService,
  type SavedModel,
} from "@novel-master/core/provider";
import { createMemorySessionKkv } from "../helpers/prompt-layout-test-helpers.js";
import { type VfsService } from "@novel-master/core/vfs";
import { noopSavedModelRepository } from "../helpers/noop-saved-model-repo.js";
import { SimpleEventBus } from "@novel-master/core/events";
import type { SavedModelRepository } from "../../src/domain/provider/repositories/saved-model.port.js";
import { BUILTIN_PROVIDER_UUID_OPENAI } from "../../src/domain/provider/logic/builtin-providers.js";

const RUN_MODEL_ID = "anthropic/claude";
const MOCK_PROJECT_ID = "test-project";
const MOCK_SESSION_ID = "test-session";

function minimalDefinition(): AgentDefinition {
  return {
    name: "test",
    prompts: { persist: [], dynamic: [] },
  };
}

const defaultRunScope = {
  sessionId: MOCK_SESSION_ID,
  projectId: MOCK_PROJECT_ID,
  savedModelId: RUN_MODEL_ID,
  workspaceModelId: RUN_MODEL_ID,
};

function runnerDeps(deps: RunnerDepsInput): CreateAgentRunnerDeps {
  return {
    savedModels: noopSavedModelRepository(),
    ...deps,
    eventBus: new SimpleEventBus(),
    sessionKkv: createMemorySessionKkv(),
    workplace: () =>
      ({
        scope: { kind: "session", projectId: MOCK_PROJECT_ID, sessionId: MOCK_SESSION_ID },
        renderDisplay: async () => "WT",
        buildListRows: async () => [],
        materializePersistBlock: async () => ({ workplaceDisplay: "WT" }),
      }) as never,
  };
}

// runnerDeps 的入参类型：savedModels 可覆盖（T-S3 用 stub repo 替换默认 noop）。
type RunnerDepsInput = Omit<
  CreateAgentRunnerDeps,
  "eventBus" | "sessionKkv" | "workplace" | "savedModels"
> &
  Partial<Pick<CreateAgentRunnerDeps, "savedModels">>;

function mockVfs(): VfsService {
  const files = new Map<string, string>();
  return {
    async read(path: string) {
      const content = files.get(path) ?? "";
      return { path, content, version: 1, mtimeMs: 0 };
    },
    async write(path: string, content: string) {
      files.set(path, content);
      return { version: 1 };
    },
    async replace(path: string, oldString: string, newString: string) {
      const c = files.get(path) ?? "";
      files.set(path, c.replace(oldString, newString));
      return { version: 1, replacements: 1 };
    },
    async list() {
      return [...files.keys()];
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
    projectId: MOCK_PROJECT_ID,
    sessionId: MOCK_SESSION_ID,
    listSessionMessages: async () => [],
  };
}

function createMockModel(responses: LlmChatResult[]): ModelRequestService {
  let calls = 0;
  return {
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

/** 返回固定 saved model 的 stub repo（协议推断 + modelName 落库都用它）。 */
function stubSavedModelRepository(saved: SavedModel | null): SavedModelRepository {
  const noop = noopSavedModelRepository();
  return {
    ...noop,
    findById: async () => saved,
  };
}

function savedModelFixture(overrides: Partial<SavedModel> = {}): SavedModel {
  return {
    id: RUN_MODEL_ID,
    // 内置 OpenAI 固定 UUID → 协议推断为 openai（区别于 fallback anthropic）。
    providerId: BUILTIN_PROVIDER_UUID_OPENAI,
    vendorModelId: "gpt-5.2",
    modelName: "GPT-5.2",
    settings: defaultSavedModelSettings("gpt-5.2"),
    createdAtMs: 0,
    updatedAtMs: 0,
    ...overrides,
  };
}

describe("agent-runner usage passthrough (T-S2)", () => {
  it("LLM 响应带 usage → assistant append 携带 usage", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    const usage = { promptTokens: 10, completionTokens: 20, totalTokens: 30 };
    const model = createMockModel([
      {
        assistantText: "hi",
        blocks: [{ type: "text", text: "hi" }],
        raw: {},
        usage,
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
      maxSteps: 1,
      definition: minimalDefinition(),
      ...defaultRunScope,
    });

    assert.equal(result.stopReason, "completed");
    const msgs = await session.list();
    const assistant = msgs.find((m) => m.role === "assistant");
    assert.ok(assistant, "应 append 一条 assistant message");
    assert.deepEqual(assistant!.usage, usage);
  });

  it("LLM 响应无 usage（undefined）→ assistant message 不挂 usage 字段（兼容）", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    const model = createMockModel([
      {
        assistantText: "hi",
        blocks: [{ type: "text", text: "hi" }],
        raw: {},
        // 不带 usage
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
      maxSteps: 1,
      definition: minimalDefinition(),
      ...defaultRunScope,
    });

    assert.equal(result.stopReason, "completed");
    const msgs = await session.list();
    const assistant = msgs.find((m) => m.role === "assistant");
    assert.ok(assistant);
    assert.equal(assistant!.usage, undefined);
    assert.equal("usage" in assistant!, false);
  });

  it("多 round tool-call 每条 assistant 各自带 usage", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    const firstUsage = { promptTokens: 11, completionTokens: 22, totalTokens: 33 };
    const secondUsage = { promptTokens: 44, completionTokens: 55, totalTokens: 99 };
    const model = createMockModel([
      {
        assistantText: "",
        blocks: [
          { type: "tool_use", id: "t1", name: "ls", input: { path: "/" } },
        ],
        raw: {},
        usage: firstUsage,
      },
      {
        assistantText: "done",
        blocks: [{ type: "text", text: "done" }],
        raw: {},
        usage: secondUsage,
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
    const msgs = await session.list();
    const assistants = msgs.filter((m) => m.role === "assistant");
    assert.equal(assistants.length, 2, "两轮各一条 assistant");
    assert.deepEqual(assistants[0]!.usage, firstUsage);
    assert.deepEqual(assistants[1]!.usage, secondUsage);
  });
});

describe("agent-runner provider/modelName 落库（T-S3）", () => {
  it("assistant append 携带 provider=推断协议、modelName=vendorModelId", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    const model = createMockModel([
      {
        assistantText: "hi",
        blocks: [{ type: "text", text: "hi" }],
        raw: {},
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
        // 覆盖 runnerDeps 默认的 noop repo，让协议推断命中内置 OpenAI UUID。
        savedModels: stubSavedModelRepository(savedModelFixture()),
      }),
    );

    const result = await runner.run({
      maxSteps: 1,
      definition: minimalDefinition(),
      ...defaultRunScope,
    });

    assert.equal(result.stopReason, "completed");
    const msgs = await session.list();
    const assistant = msgs.find((m) => m.role === "assistant");
    assert.ok(assistant, "应 append 一条 assistant message");
    // provider 记协议而非服务商；modelName 记厂商模型 id。
    assert.equal(assistant!.provider, "openai");
    assert.equal(assistant!.modelName, "gpt-5.2");
  });

  it("saved model 查不到 → modelName 降级不传（null），provider 仍为推断协议", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    const model = createMockModel([
      {
        assistantText: "hi",
        blocks: [{ type: "text", text: "hi" }],
        raw: {},
      },
    ]);

    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    // runnerDeps 默认即 noopSavedModelRepository（findById → null）。
    const runner = createAgentRunner(
      runnerDeps({
        session,
        modelRequests: model,
        registry,
        toolCtx: mockToolCtx(mockVfs()),
      }),
    );

    const result = await runner.run({
      maxSteps: 1,
      definition: minimalDefinition(),
      ...defaultRunScope,
    });

    assert.equal(result.stopReason, "completed");
    const msgs = await session.list();
    const assistant = msgs.find((m) => m.role === "assistant");
    assert.ok(assistant);
    // 查不到 saved → 协议推断 fallback anthropic，modelName 降级为 null。
    assert.equal(assistant!.provider, "anthropic");
    assert.equal(assistant!.modelName, null);
  });
});

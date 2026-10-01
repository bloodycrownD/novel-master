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
import { SimpleEventBus, EVENT_AGENT_STREAM_USAGE } from "@novel-master/core/events";
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
    eventBus: new SimpleEventBus(),
    ...deps,
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

// runnerDeps 的入参类型：savedModels / eventBus 可覆盖（T-S3 stub repo、T-M4 订阅 bus）。
type RunnerDepsInput = Omit<
  CreateAgentRunnerDeps,
  "eventBus" | "sessionKkv" | "workplace" | "savedModels"
> &
  Partial<Pick<CreateAgentRunnerDeps, "savedModels" | "eventBus">>;

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
    // token 字段原样透传；耗时字段自未次迭代起随 usage 一并采集（T-AR）。
    const { firstTokenMs, durationMs, ...tokenUsage } = assistant!.usage!;
    assert.ok(tokenUsage != null);
    assert.deepEqual(tokenUsage, usage);
    assert.ok(typeof firstTokenMs === "number");
    assert.ok(typeof durationMs === "number");
  });

  it("LLM 响应无 usage（undefined）→ assistant usage 仅含耗时字段（兼容）", async () => {
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
    // 无 token usage 时 usage 仅含两个耗时字段（token 统计不受影响）。
    const keys = Object.keys(assistant!.usage ?? {}).sort();
    assert.deepEqual(keys, ["durationMs", "firstTokenMs"]);
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
    for (const [i, expected] of [firstUsage, secondUsage].entries()) {
      const { firstTokenMs, durationMs, ...tokenUsage } = assistants[i]!.usage!;
      assert.deepEqual(tokenUsage, expected);
      assert.ok(typeof firstTokenMs === "number");
      assert.ok(typeof durationMs === "number");
    }
  });
});

describe("agent-runner 流中 usage 事件（T-M4）", () => {
  /** 每 step 捕获 runner 装配的 onStream，供用例在请求期间注入流中 usage 事件。 */
  function createStreamingMockModel(
    steps: Array<{
      streamUsage?: number[];
      result: LlmChatResult;
    }>,
  ): ModelRequestService {
    let calls = 0;
    return {
      request: mock.fn(async (_savedModelId: string, _userContent: string, options: { onStream?: (ev: { type: string; usage?: { completionTokens?: number } }) => void }) => {
        const step = steps[calls];
        calls += 1;
        if (step == null) {
          throw new Error("Unexpected extra model request");
        }
        for (const completionTokens of step.streamUsage ?? []) {
          options.onStream?.({
            type: "usage",
            usage: { completionTokens },
          });
        }
        return step.result;
      }),
    };
  }

  it("多 step：流中 step 口径换算 run 级累计、每 step 请求 done 后补发一条 run 级终值事件", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));
    const bus = new SimpleEventBus();
    const usagePayloads: Array<{
      sessionId: string;
      runId: string;
      completionTokens: number;
      source: string;
    }> = [];
    bus.subscribe(EVENT_AGENT_STREAM_USAGE, (p) => usagePayloads.push(p));

    // step1：流中累计 5→10（step 口径），done 终值 12（如流中最后一块后的校正）；
    // step1 带 tool_use 触发 step2：流中累计 3，done 终值 7。
    const model = createStreamingMockModel([
      {
        streamUsage: [5, 10],
        result: {
          assistantText: "",
          blocks: [{ type: "tool_use", id: "t1", name: "ls", input: { path: "/" } }],
          raw: {},
          usage: { promptTokens: 1, completionTokens: 12, totalTokens: 13 },
        },
      },
      {
        streamUsage: [3],
        result: {
          assistantText: "done",
          blocks: [{ type: "text", text: "done" }],
          raw: {},
          usage: { promptTokens: 2, completionTokens: 7, totalTokens: 9 },
        },
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
        eventBus: bus,
      }),
    );

    const result = await runner.run({
      maxSteps: 3,
      definition: minimalDefinition(),
      stream: true,
      ...defaultRunScope,
    });

    assert.equal(result.stopReason, "completed");
    // step1 流中（基线 0）：5、10 → done 补发 12；
    // step2 流中（基线 12）：12+3=15 → done 补发 12+7=19。
    assert.deepEqual(
      usagePayloads.map((p) => p.completionTokens),
      [5, 10, 12, 15, 19],
    );
    for (const p of usagePayloads) {
      assert.equal(p.sessionId, MOCK_SESSION_ID);
      assert.equal(p.source, "usage");
      assert.ok(p.runId.length > 0);
    }
  });

  it("step done 无 usage（三方网关不给）→ 不并入不补发，全程零 usage 事件", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));
    const bus = new SimpleEventBus();
    const usagePayloads: unknown[] = [];
    bus.subscribe(EVENT_AGENT_STREAM_USAGE, (p) => usagePayloads.push(p));

    const model = createStreamingMockModel([
      {
        // 流中零 usage 事件段（openai 网关不给 usage 的典型形态）
        result: {
          assistantText: "hi",
          blocks: [{ type: "text", text: "hi" }],
          raw: {},
        },
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
        eventBus: bus,
      }),
    );

    const result = await runner.run({
      maxSteps: 1,
      definition: minimalDefinition(),
      stream: true,
      ...defaultRunScope,
    });

    assert.equal(result.stopReason, "completed");
    assert.equal(usagePayloads.length, 0);
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

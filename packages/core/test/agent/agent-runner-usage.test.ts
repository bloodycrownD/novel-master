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
import { type LlmChatResult, type ModelRequestService } from "@novel-master/core/provider";
import { createMemorySessionKkv } from "../helpers/prompt-layout-test-helpers.js";
import { type VfsService } from "@novel-master/core/vfs";
import { noopSavedModelRepository } from "../helpers/noop-saved-model-repo.js";
import { SimpleEventBus } from "@novel-master/core/events";

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

function runnerDeps(
  deps: Omit<CreateAgentRunnerDeps, "eventBus" | "sessionKkv" | "workplace" | "savedModels">,
): CreateAgentRunnerDeps {
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

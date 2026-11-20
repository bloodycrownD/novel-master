/**
 * AgentRunner message checkpoint 同步 capture 行为。
 */

import assert from "node:assert/strict";
import {  describe, it, mock  } from "node:test";
import {  unwrap  } from "../helpers/result-unwrap.js";
import {  Result  } from "../../src/errors/either.js";
import {  AgentServiceFactory, type AgentDefinition, type  CreateAgentRunnerDeps  } from "@novel-master/core/agent";
import {  InMemoryAgentSession  } from "../../src/domain/agent/session/impl/in-memory-agent-session.js";
import {  TextBlocks  } from "@novel-master/core/chat";
import {  BuiltinTools, ToolRegistry  } from "@novel-master/core";
import {  type ModelRequestService  } from "@novel-master/core/provider";
import {  type LlmChatResult  } from "@novel-master/core/llm-protocol";
import {  createMemorySessionKkv  } from "../helpers/prompt-layout-test-helpers.js";
import {  type VfsService  } from "@novel-master/core/vfs";
import type { MessageCheckpointService } from "../../src/service/message-checkpoint/message-checkpoint.port.js";

function minimalDefinition(): AgentDefinition {
  return {
    name: "test",
    prompts: { persist: [], dynamic: [] },
  };
}

const RUN_MODEL_ID = "anthropic/claude";
const MOCK_PROJECT_ID = "test-project";
const MOCK_SESSION_ID = "test-session";

import {  noopSavedModelRepository  } from "../helpers/noop-saved-model-repo.js";

function runnerDeps(
  deps: Omit<CreateAgentRunnerDeps, "eventBus" | "sessionKkv" | "workplace" | "savedModels"> &
    Partial<Pick<CreateAgentRunnerDeps, "savedModels">>,
): CreateAgentRunnerDeps {
  return {
    savedModels: noopSavedModelRepository(),
    ...deps,
    eventBus: { publish: () => {}, subscribe: () => () => {} } as never,
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
  // 错误通道迁移四期：VfsService 走 Result 通道。
  return {
    async read(path: string) {
      const content = files.get(path) ?? "";
      return Result.ok({ path, content, version: 1, mtimeMs: 0 });
    },
    async write(path: string, content: string) {
      files.set(path, content);
      return Result.ok({ version: 1 });
    },
    async replace(path: string, oldString: string, newString: string) {
      const c = files.get(path) ?? "";
      files.set(path, c.replace(oldString, newString));
      return Result.ok({ version: 1, replacements: 1 });
    },
    async list() {
      return Result.ok([...files.keys()]);
    },
    async glob() {
      return Result.ok([]);
    },
    async grep() {
      return Result.ok([]);
    },
    async delete() {
      return Result.ok({ deleted: true });
    },
  } as unknown as VfsService;
}

function mutatingToolRoundModel(): ModelRequestService {
  return {
    // 错误通道迁移四期：request 走 Result 通道。
    request: mock.fn(async (): Promise<Awaited<ReturnType<ModelRequestService["request"]>>> =>
      Result.ok({
        assistantText: "",
        blocks: [
          {
            type: "tool_use",
            id: "w1",
            name: "write",
            input: { path: "/out.txt", content: "x" },
          },
        ],
        raw: {},
      }),
    ),
  };
}

describe("AgentRunner message checkpoint", () => {
  it("capture 失败时抛错且不 append tool_results", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", TextBlocks.of("go"));

    const captureError = new Error("capture failed");
    const messageCheckpoint: MessageCheckpointService = {
      capture: mock.fn(async () => {
        throw captureError;
      }),
    };

    const registry = new ToolRegistry();
    BuiltinTools.register(registry);
    const runner = AgentServiceFactory.createRunner(
      runnerDeps({
        session,
        modelRequests: mutatingToolRoundModel(),
        registry,
        toolCtx: {
          vfs: mockVfs(),
          projectId: MOCK_PROJECT_ID,
          sessionId: MOCK_SESSION_ID,
        },
        messageCheckpoint,
      }),
    );

    await assert.rejects(
      () =>
        runner.run({
          maxSteps: 2,
          definition: minimalDefinition(),
          sessionId: MOCK_SESSION_ID,
          projectId: MOCK_PROJECT_ID,
          savedModelId: RUN_MODEL_ID,
          workspaceModelId: RUN_MODEL_ID,
        }),
      (err: unknown) => err === captureError,
    );

    const msgs = await session.list();
    assert.equal(msgs.length, 2);
    assert.equal(msgs[1]!.role, "assistant");
    const hasToolResult = msgs.some((m) =>
      m.content.blocks.some((b) => b.type === "tool_result"),
    );
    assert.equal(hasToolResult, false);
  });

  it("capture 成功时正常 append tool_results", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", TextBlocks.of("go"));

    const messageCheckpoint: MessageCheckpointService = {
      capture: mock.fn(async () => {}),
    };

    const registry = new ToolRegistry();
    BuiltinTools.register(registry);
    const runner = AgentServiceFactory.createRunner(
      runnerDeps({
        session,
        modelRequests: mutatingToolRoundModel(),
        registry,
        toolCtx: {
          vfs: mockVfs(),
          projectId: MOCK_PROJECT_ID,
          sessionId: MOCK_SESSION_ID,
        },
        messageCheckpoint,
      }),
    );

    unwrap(await runner.run({
      maxSteps: 1,
      definition: minimalDefinition(),
      sessionId: MOCK_SESSION_ID,
      projectId: MOCK_PROJECT_ID,
      savedModelId: RUN_MODEL_ID,
      workspaceModelId: RUN_MODEL_ID,
    }));

    const toolResult = (await session.list())
      .flatMap((m) => m.content.blocks)
      .find((b) => b.type === "tool_result");
    assert.ok(toolResult);
    assert.equal((messageCheckpoint.capture as ReturnType<typeof mock.fn>).mock.callCount(), 1);
  });
});

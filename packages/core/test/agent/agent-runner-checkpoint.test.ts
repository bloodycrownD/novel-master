/**
 * AgentRunner message checkpoint 同步 capture 行为。
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
import { registerBuiltinTools, ToolRegistry } from "@novel-master/core";
import { type LlmChatResult, type ModelRequestService } from "@novel-master/core/provider";
import { createSessionWorktreeSnapshotStore } from "@novel-master/core/worktree";
import { type VfsService } from "@novel-master/core/vfs";
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

function runnerDeps(
  deps: Omit<CreateAgentRunnerDeps, "eventBus" | "worktreeSnapshot" | "worktree">,
): CreateAgentRunnerDeps {
  return {
    ...deps,
    eventBus: { publish: () => {}, subscribe: () => () => {} } as never,
    worktreeSnapshot: createSessionWorktreeSnapshotStore(),
    worktree: () =>
      ({
        scope: { kind: "session", projectId: MOCK_PROJECT_ID, sessionId: MOCK_SESSION_ID },
        renderDisplay: async () => "WT",
        buildListRows: async () => [],
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

function mutatingToolRoundModel(): ModelRequestService {
  return {
    request: mock.fn(async (): Promise<LlmChatResult> => ({
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
    })),
  };
}

describe("AgentRunner message checkpoint", () => {
  it("capture 失败时抛错且不 append tool_results", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    const captureError = new Error("capture failed");
    const messageCheckpoint: MessageCheckpointService = {
      capture: mock.fn(async () => {
        throw captureError;
      }),
    };

    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const runner = createAgentRunner(
      runnerDeps({
        session,
        modelRequests: mutatingToolRoundModel(),
        registry,
        toolCtx: {
          vfs: mockVfs(),
          projectId: MOCK_PROJECT_ID,
          sessionId: MOCK_SESSION_ID,
          listSessionMessages: async () => session.list(),
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
          applicationModelId: RUN_MODEL_ID,
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
    await session.append("user", textBlocks("go"));

    const messageCheckpoint: MessageCheckpointService = {
      capture: mock.fn(async () => {}),
    };

    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const runner = createAgentRunner(
      runnerDeps({
        session,
        modelRequests: mutatingToolRoundModel(),
        registry,
        toolCtx: {
          vfs: mockVfs(),
          projectId: MOCK_PROJECT_ID,
          sessionId: MOCK_SESSION_ID,
          listSessionMessages: async () => session.list(),
        },
        messageCheckpoint,
      }),
    );

    await runner.run({
      maxSteps: 1,
      definition: minimalDefinition(),
      sessionId: MOCK_SESSION_ID,
      projectId: MOCK_PROJECT_ID,
      applicationModelId: RUN_MODEL_ID,
      workspaceModelId: RUN_MODEL_ID,
    });

    const toolResult = (await session.list())
      .flatMap((m) => m.content.blocks)
      .find((b) => b.type === "tool_result");
    assert.ok(toolResult);
    assert.equal((messageCheckpoint.capture as ReturnType<typeof mock.fn>).mock.callCount(), 1);
  });
});

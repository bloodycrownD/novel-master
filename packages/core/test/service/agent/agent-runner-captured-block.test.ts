/**
 * T-WEC9：Agent run 内 VFS write 不触发 block re-capture。
 * 无 DB fixture，仅 mock worktreeBlockStore + vfs。
 */
import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  createAgentRunner,
  InMemoryAgentSession,
  type AgentDefinition,
} from "@novel-master/core/agent";
import { textBlocks } from "@novel-master/core/chat";
import { SimpleEventBus } from "@novel-master/core/events";
import {
  registerBuiltinTools,
  ToolRegistry,
  type BuiltinToolContext,
} from "@novel-master/core";
import {
  type LlmChatResult,
  type ModelRequestService,
} from "@novel-master/core/provider";
import { createSessionWorktreeBlockStore } from "@novel-master/core/worktree";
import { type VfsService } from "@novel-master/core/vfs";
import { noopSavedModelRepository } from "../../helpers/noop-saved-model-repo.js";

const MOCK_PROJECT_ID = "test-project";
const MOCK_SESSION_ID = "test-session";
const RUN_MODEL_ID = "anthropic/claude";

function minimalDefinition(): AgentDefinition {
  return {
    name: "test",
    prompts: { persist: [], dynamic: [] },
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

describe("AgentRunner captured block (T-WEC9)", () => {
  it("T-WEC9: Agent run 内 VFS write 后 getCapturedBlock 不变", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("write file"));

    const blockStore = createSessionWorktreeBlockStore();
    blockStore.capture(MOCK_PROJECT_ID, MOCK_SESSION_ID, {
      worktreeDisplay: "run-start-block",
    });
    const beforeBlock = blockStore.getCapturedBlock(
      MOCK_PROJECT_ID,
      MOCK_SESSION_ID,
    )!;
    let captureCalls = 0;
    const originalCapture = blockStore.capture.bind(blockStore);
    blockStore.capture = (...args) => {
      captureCalls += 1;
      return originalCapture(...args);
    };

    const vfs = mockVfs();
    const materializePersistBlock = mock.fn(async () => ({
      worktreeDisplay: "would-change-if-recaptured",
    }));

    const model = createMockModel([
      {
        assistantText: "",
        blocks: [
          {
            type: "tool_use",
            id: "w1",
            name: "write",
            input: { path: "/out.txt", content: "mutated" },
          },
        ],
        raw: {},
      },
      {
        assistantText: "done",
        blocks: [{ type: "text", text: "done" }],
        raw: {},
      },
    ]);

    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const runner = createAgentRunner({
      session,
      modelRequests: model,
      registry,
      toolCtx: mockToolCtx(vfs),
      eventBus: new SimpleEventBus(),
      worktreeBlockStore: blockStore,
      savedModels: noopSavedModelRepository(),
      worktree: () =>
        ({
          scope: {
            kind: "session",
            projectId: MOCK_PROJECT_ID,
            sessionId: MOCK_SESSION_ID,
          },
          renderDisplay: async () => "WT",
          buildListRows: async () => [],
          materializePersistBlock,
        }) as never,
    });

    await runner.run({
      maxSteps: 3,
      definition: minimalDefinition(),
      sessionId: MOCK_SESSION_ID,
      projectId: MOCK_PROJECT_ID,
      savedModelId: RUN_MODEL_ID,
      workspaceModelId: RUN_MODEL_ID,
    });

    const afterBlock = blockStore.getCapturedBlock(
      MOCK_PROJECT_ID,
      MOCK_SESSION_ID,
    );
    assert.equal(afterBlock?.worktreeDisplay, beforeBlock.worktreeDisplay);
    assert.equal(afterBlock?.capturedAtMs, beforeBlock.capturedAtMs);
    assert.equal(captureCalls, 0);
    assert.equal(materializePersistBlock.mock.callCount(), 0);
    assert.equal((await vfs.read("/out.txt")).content, "mutated");
  });
});

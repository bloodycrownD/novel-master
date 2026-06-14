import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  createAgentRunner,
  createSessionWorktreeSnapshotStore,
  registerBuiltinTools,
  InMemoryAgentSession,
  messageBodyText,
  textBlocks,
  SimpleEventBus,
  ToolRegistry,
  type AgentDefinition,
  type CreateAgentRunnerDeps,
  type LlmChatResult,
  type ModelRequestOptions,
  type ModelRequestService,
  type BuiltinToolContext,
  type VfsService,
} from "@novel-master/core";

const RUN_MODEL_ID = "anthropic/claude";
const PROJECT_ID = "p1";
const SESSION_ID = "s1";

function mockVfs(): VfsService {
  const files = new Map<string, string>();
  return {
    async read(path: string) {
      return { path, content: files.get(path) ?? "", version: 1, mtimeMs: 0 };
    },
    async write(path: string, content: string) {
      files.set(path, content);
      return { version: 1 };
    },
    async replace(path: string, oldString: string, newString: string) {
      const content = files.get(path) ?? "";
      files.set(path, content.replace(oldString, newString));
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
    projectId: PROJECT_ID,
    sessionId: SESSION_ID,
    listSessionMessages: async () => [],
  };
}

function runnerDeps(
  deps: Omit<CreateAgentRunnerDeps, "eventBus" | "worktreeSnapshot" | "worktree">,
  worktreeDisplay: string,
): CreateAgentRunnerDeps {
  const store = createSessionWorktreeSnapshotStore();
  return {
    ...deps,
    eventBus: new SimpleEventBus(),
    worktreeSnapshot: store,
    worktree: () =>
      ({
        scope: { kind: "session", projectId: PROJECT_ID, sessionId: SESSION_ID },
        renderDisplay: async () => worktreeDisplay,
        buildListRows: async () => [],
      }) as never,
  };
}

describe("AgentRunner template blocks", () => {
  it("T5: history includes synthetic worktree message from persist block", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    const definition: AgentDefinition = {
      name: "ctx-agent",
      prompts: {
        persistEnabled: true,
        persist: [{ name: "canon", type: "worktree" }],
        dynamic: [],
      },
    };

    const captured: { options?: ModelRequestOptions } = {};
    const model: ModelRequestService = {
      request: mock.fn(async (_modelId, _content, options) => {
        captured.options = options;
        return {
          assistantText: "ok",
          blocks: [{ type: "text", text: "ok" }],
          raw: {},
        } satisfies LlmChatResult;
      }),
    };

    const runner = createAgentRunner(
      runnerDeps(
        {
          session,
          modelRequests: model,
          registry: new ToolRegistry(),
          toolCtx: mockToolCtx(mockVfs()),
        },
        "WORKTREE_SNAPSHOT",
      ),
    );

    await runner.run({
      maxSteps: 1,
      definition,
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      applicationModelId: RUN_MODEL_ID,
      workspaceModelId: RUN_MODEL_ID,
    });

    const history = captured.options?.history ?? [];
    assert.equal(history.length, 2);
    assert.equal(history[0]!.id, "prompt:worktree:canon");
    assert.equal(messageBodyText(history[0]!), "WORKTREE_SNAPSHOT");
    assert.equal(history[1]!.role, "user");
  });

  it("R3: persist worktree block on step 0 and step 1", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    const definition: AgentDefinition = {
      name: "ctx-agent",
      prompts: {
        persistEnabled: true,
        persist: [{ name: "canon", type: "worktree" }],
        dynamic: [],
      },
    };

    const histories: ModelRequestOptions[] = [];
    const model: ModelRequestService = {
      request: mock.fn(async (_modelId, _content, options) => {
        histories.push(options);
        if (histories.length < 2) {
          return {
            assistantText: "",
            blocks: [
              {
                type: "tool_use",
                id: "tu1",
                name: "write",
                input: { path: "/out.txt", content: "x" },
              },
            ],
            raw: {},
          } satisfies LlmChatResult;
        }
        return {
          assistantText: "ok",
          blocks: [{ type: "text", text: "ok" }],
          raw: {},
        } satisfies LlmChatResult;
      }),
    };

    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const vfs = mockVfs();
    const runner = createAgentRunner(
      runnerDeps(
        {
          session,
          modelRequests: model,
          registry,
          toolCtx: mockToolCtx(vfs),
        },
        "WORKTREE_SNAPSHOT",
      ),
    );

    await runner.run({
      maxSteps: 3,
      definition,
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      applicationModelId: RUN_MODEL_ID,
      workspaceModelId: RUN_MODEL_ID,
    });

    assert.equal(histories.length, 2);
    for (const opts of histories) {
      assert.equal(
        opts.history?.some((m) => m.id === "prompt:worktree:canon"),
        true,
      );
      const ctxMsg = opts.history?.find((m) => m.id === "prompt:worktree:canon");
      assert.equal(
        ctxMsg != null ? messageBodyText(ctxMsg) : "",
        "WORKTREE_SNAPSHOT",
      );
    }
  });
});

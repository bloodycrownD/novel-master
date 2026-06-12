import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  createAgentRunner,
  InMemoryAgentSession,
  messageBodyText,
  registerBuiltinTools,
  SimpleEventBus,
  textBlocks,
  ToolRegistry,
  type AgentDefinition,
  type BuiltinToolContext,
  type CreateAgentRunnerDeps,
  type LlmChatResult,
  type ModelRequestOptions,
  type ModelRequestService,
  type SessionMacroCache,
  type VfsService,
} from "@novel-master/core";

const RUN_MODEL_ID = "anthropic/claude";
const PROJECT_ID = "p1";
const SESSION_ID = "s1";

function mockMacroCache(): SessionMacroCache {
  const snapshot = {
    worktreeDisplay: "",
    filetreeDisplay: "",
    listRows: [],
    refreshedAtMs: 0,
  };
  return {
    get: (projectId, sessionId) =>
      projectId === PROJECT_ID && sessionId === SESSION_ID ? snapshot : undefined,
    refresh: async () => snapshot,
    clear: () => undefined,
  };
}

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
    projectId: PROJECT_ID,
    sessionId: SESSION_ID,
    listSessionMessages: async () => [],
  };
}

function runnerDeps(
  deps: Omit<CreateAgentRunnerDeps, "eventBus" | "macroCache">,
): CreateAgentRunnerDeps {
  return {
    ...deps,
    eventBus: new SimpleEventBus(),
    macroCache: mockMacroCache(),
  };
}

describe("AgentRunner prompt block lifecycle", () => {
  it("R1: once kick block only on step 0 history", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    const definition: AgentDefinition = {
      name: "kick-agent",
      prompts: [
        { name: "kick", type: "text", role: "user", content: "缁х画", lifecycle: "once" },
        { name: "c", type: "chat" },
      ],
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
          assistantText: "done",
          blocks: [{ type: "text", text: "done" }],
          raw: {},
        } satisfies LlmChatResult;
      }),
    };

    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const vfs = mockVfs();
    const runner = createAgentRunner(
      runnerDeps({
        session,
        modelRequests: model,
        registry,
        toolCtx: mockToolCtx(vfs),
      }),
    );

    const result = await runner.run({
      maxSteps: 3,
      definition,
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      applicationModelId: RUN_MODEL_ID,
      workspaceModelId: RUN_MODEL_ID,
    });

    assert.equal(histories.length, 2);
    assert.equal(histories[0]!.history?.some((m) => m.id === "prompt:kick"), true);
    assert.equal(histories[1]!.history?.some((m) => m.id === "prompt:kick"), false);
    assert.equal(result.stopReason, "completed");
  });

  it("R2: kick 缁х画 with once completes after tool loop", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    const definition: AgentDefinition = {
      name: "once-complete",
      prompts: [
        { name: "kick", type: "text", role: "user", content: "缁х画", lifecycle: "once" },
        { name: "c", type: "chat" },
      ],
    };

    const historiesR2: ModelRequestOptions[] = [];
    const model: ModelRequestService = {
      request: mock.fn(async (_modelId, _content, options) => {
        historiesR2.push(options);
        if (historiesR2.length < 2) {
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
          assistantText: "done",
          blocks: [{ type: "text", text: "done" }],
          raw: {},
        } satisfies LlmChatResult;
      }),
    };

    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const vfs = mockVfs();
    const runner = createAgentRunner(
      runnerDeps({
        session,
        modelRequests: model,
        registry,
        toolCtx: mockToolCtx(vfs),
      }),
    );

    const result = await runner.run({
      maxSteps: 3,
      definition,
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      applicationModelId: RUN_MODEL_ID,
      workspaceModelId: RUN_MODEL_ID,
    });

    assert.equal(result.stopReason, "completed");
    const lastAssistant = await session.list();
    const tail = lastAssistant.at(-1);
    assert.equal(tail?.role, "assistant");
  });

  it("R3-always: kick block present on every step", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    const definition: AgentDefinition = {
      name: "always-kick",
      prompts: [
        { name: "kick", type: "text", role: "user", content: "缁х画" },
        { name: "c", type: "chat" },
      ],
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
          assistantText: "done",
          blocks: [{ type: "text", text: "done" }],
          raw: {},
        } satisfies LlmChatResult;
      }),
    };

    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const vfs = mockVfs();
    const runner = createAgentRunner(
      runnerDeps({
        session,
        modelRequests: model,
        registry,
        toolCtx: mockToolCtx(vfs),
      }),
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
      assert.equal(opts.history?.some((m) => m.id === "prompt:kick"), true);
      const kick = opts.history?.find((m) => m.id === "prompt:kick");
      assert.equal(kick != null ? messageBodyText(kick) : "", "缁х画");
    }
  });

  it("R4: once block reappears on step 0 of second runner.run", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    const definition: AgentDefinition = {
      name: "kick-agent",
      prompts: [
        { name: "kick", type: "text", role: "user", content: "缁х画", lifecycle: "once" },
        { name: "c", type: "chat" },
      ],
    };

    const histories: ModelRequestOptions[] = [];
    const model: ModelRequestService = {
      request: mock.fn(async (_modelId, _content, options) => {
        histories.push(options);
        return {
          assistantText: "ok",
          blocks: [{ type: "text", text: "ok" }],
          raw: {},
        } satisfies LlmChatResult;
      }),
    };

    const runner = createAgentRunner(
      runnerDeps({
        session,
        modelRequests: model,
        registry: new ToolRegistry(),
        toolCtx: mockToolCtx(mockVfs()),
      }),
    );

    await runner.run({
      maxSteps: 1,
      definition,
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      applicationModelId: RUN_MODEL_ID,
      workspaceModelId: RUN_MODEL_ID,
    });
    await session.append("user", textBlocks("again"));
    histories.length = 0;

    await runner.run({
      maxSteps: 1,
      definition,
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      applicationModelId: RUN_MODEL_ID,
      workspaceModelId: RUN_MODEL_ID,
    });

    assert.equal(histories.length, 1);
    assert.equal(histories[0]!.history?.some((m) => m.id === "prompt:kick"), true);
  });

});

import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  createAgentRunner,
  createSessionMacroCache,
  EVENT_AGENT_STEP_COMMITTED,
  EVENT_SESSION_MESSAGE_RECEIVED,
  InMemoryAgentSession,
  registerVfsTools,
  SimpleEventBus,
  textBlocks,
  ToolRegistry,
  type AgentDefinition,
  type AgentStepCommittedPayload,
  type CreateAgentRunnerDeps,
  type LlmChatResult,
  type ModelRequestService,
} from "@novel-master/core";
import { AgentError } from "../../src/errors/agent-runtime-errors.js";
import type { VfsService, VfsToolContext } from "@novel-master/core";
import type { SessionFsService } from "../../src/service/session-fs/session-fs.port.js";

function minimalDefinition(): AgentDefinition {
  return {
    name: "test",
    prompts: [{ name: "c", type: "chat" }],
  };
}

const RUN_MODEL_ID = "anthropic/claude";
const MOCK_PROJECT_ID = "test-project";
const MOCK_SESSION_ID = "test-session";

function runnerDeps(
  deps: Omit<CreateAgentRunnerDeps, "eventBus" | "macroCache">,
): CreateAgentRunnerDeps {
  return {
    ...deps,
    eventBus: new SimpleEventBus(),
    macroCache: createSessionMacroCache(),
  };
}

const defaultRunScope = {
  sessionId: MOCK_SESSION_ID,
  projectId: MOCK_PROJECT_ID,
  applicationModelId: RUN_MODEL_ID,
  workspaceModelId: RUN_MODEL_ID,
};

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

function mockSessionFs(vfs: VfsService): SessionFsService {
  return {
    async execute(_sessionId, _projectId, actions, _actor, options) {
      const results: Array<
        | { function: "read"; path: string; content: string }
        | { function: "write"; path: string; version: number }
        | { function: "delete"; path: string }
      > = [];
      for (const action of actions) {
        if (action.function === "write") {
          const r = await vfs.write(action.path, action.content, {
            versionCheck: options?.versionCheck ?? true,
          });
          results.push({ function: "write", path: action.path, version: r.version });
        }
      }
      return { batchId: "mock-batch", results };
    },
    async listBatches() {
      return [];
    },
    async rollbackBatch() {},
    async listSnapshots() {
      return [];
    },
    async rollbackSnapshot() {},
  };
}

function mockToolCtx(vfs: VfsService): VfsToolContext {
  return {
    vfs,
    sessionFs: mockSessionFs(vfs),
    projectId: MOCK_PROJECT_ID,
    sessionId: MOCK_SESSION_ID,
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

describe("AgentRunner", () => {
  it("returns stopReason=cancelled when aborted before run", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    const model = createMockModel([
      {
        assistantText: "should-not-run",
        blocks: [{ type: "text", text: "should-not-run" }],
        raw: {},
      },
    ]);

    const registry = new ToolRegistry();
    registerVfsTools(registry);
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
    assert.equal(model.callCount(), 0);
    assert.equal(result.stepsExecuted, 0);
  });

  it("aborting prevents further modelRequests.request calls (no subsequent rounds)", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    const controller = new AbortController();
    let calls = 0;
    const model: ModelRequestService & { callCount: () => number } = {
      callCount: () => calls,
      request: mock.fn(async () => {
        calls += 1;
        controller.abort();
        return {
          assistantText: "",
          blocks: [
            {
              type: "tool_use",
              id: "tu1",
              name: "vfs.list",
              input: { dir: "/" },
            },
          ],
          raw: {},
        };
      }),
    };

    const registry = new ToolRegistry();
    registerVfsTools(registry);
    const runner = createAgentRunner(
      runnerDeps({
        session,
        modelRequests: model,
        registry,
        toolCtx: mockToolCtx(mockVfs()),
      }),
    );

    const result = await runner.run({
      maxSteps: 6,
      definition: minimalDefinition(),
      ...defaultRunScope,
      signal: controller.signal,
    });

    assert.equal(result.stopReason, "cancelled");
    assert.equal(model.callCount(), 1);
    assert.equal(result.stepsExecuted, 1);
    const msgs = await session.list();
    assert.equal(msgs.length, 2);
    assert.equal(msgs[1]!.role, "assistant");
  });

  it("maxSteps=1: runs tool once, no second model call", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    const model = createMockModel([
      {
        assistantText: "",
        blocks: [
          {
            type: "tool_use",
            id: "tu1",
            name: "vfs.write",
            input: { path: "/out.txt", content: "done" },
          },
        ],
        raw: {},
      },
    ]);

    const registry = new ToolRegistry();
    registerVfsTools(registry);
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

    assert.equal(model.callCount(), 1);
    assert.equal(result.stepsExecuted, 1);
    assert.equal(result.stopReason, "max_steps");

    const messages = session.allMessages();
    const toolResult = messages
      .flatMap((m) => m.content.blocks)
      .find((b) => b.type === "tool_result");
    assert.ok(toolResult);
  });

  it("maxSteps=3: two tool rounds then text completion", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("multi"));

    const model = createMockModel([
      {
        assistantText: "",
        blocks: [
          {
            type: "tool_use",
            id: "t1",
            name: "vfs.list",
            input: { dir: "/" },
          },
        ],
        raw: {},
      },
      {
        assistantText: "",
        blocks: [
          {
            type: "tool_use",
            id: "t2",
            name: "vfs.list",
            input: { dir: "/" },
          },
        ],
        raw: {},
      },
      {
        assistantText: "finished",
        blocks: [{ type: "text", text: "finished" }],
        raw: {},
      },
    ]);

    const registry = new ToolRegistry();
    registerVfsTools(registry);
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

    assert.equal(model.callCount(), 3);
    assert.equal(result.finished, true);
    assert.equal(result.stopReason, "completed");
  });

  it("emits session.message.received after successful assistant append", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("hi"));
    const bus = new SimpleEventBus();
    let received = false;
    bus.subscribe(EVENT_SESSION_MESSAGE_RECEIVED, () => {
      received = true;
    });
    const model = createMockModel([
      {
        assistantText: "ok",
        blocks: [{ type: "text", text: "ok" }],
        raw: {},
      },
    ]);
    const registry = new ToolRegistry();
    const runner = createAgentRunner({
      session,
      modelRequests: model,
      registry,
      toolCtx: mockToolCtx(mockVfs()),
      eventBus: bus,
      macroCache: createSessionMacroCache(),
    });
    await runner.run({
      maxSteps: 1,
      definition: minimalDefinition(),
      ...defaultRunScope,
    });
    assert.equal(received, true);
  });

  it("emits agent.step.committed after each assistant and tool_results append", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));
    const bus = new SimpleEventBus();
    const phases: AgentStepCommittedPayload["phase"][] = [];
    bus.subscribe(EVENT_AGENT_STEP_COMMITTED, (p: AgentStepCommittedPayload) => {
      phases.push(p.phase);
    });
    const model = createMockModel([
      {
        assistantText: "",
        blocks: [
          { type: "thinking", text: "plan" },
          {
            type: "tool_use",
            id: "tu1",
            name: "vfs.list",
            input: { dir: "/" },
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
    registerVfsTools(registry);
    const runner = createAgentRunner({
      session,
      modelRequests: model,
      registry,
      toolCtx: mockToolCtx(mockVfs()),
      eventBus: bus,
      macroCache: createSessionMacroCache(),
    });
    await runner.run({
      maxSteps: 5,
      definition: minimalDefinition(),
      ...defaultRunScope,
    });
    assert.deepEqual(phases, ["assistant", "tool_results", "assistant"]);
  });

  it("propagates doom_loop from identical tool_use blocks", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("loop"));

    const sameInput = { path: "/x" };
    const model = createMockModel([
      {
        assistantText: "",
        blocks: [
          { type: "tool_use", id: "a", name: "vfs.read", input: sameInput },
          { type: "tool_use", id: "b", name: "vfs.read", input: sameInput },
          { type: "tool_use", id: "c", name: "vfs.read", input: sameInput },
        ],
        raw: {},
      },
    ]);

    const registry = new ToolRegistry();
    registerVfsTools(registry);
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
          definition: { ...minimalDefinition(), prompts: [] },
          ...defaultRunScope,
        }),
      (e: unknown) =>
        e instanceof Error && e.name === "AgentError" && (e as AgentError).code === "DOOM_LOOP",
    );
  });

  it("propagates doom_loop from cross-round A-B-A-B pattern", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("loop"));
    const model = createMockModel([
      {
        assistantText: "",
        blocks: [{ type: "tool_use", id: "a1", name: "vfs.read", input: { path: "/x" } }],
        raw: {},
      },
      {
        assistantText: "",
        blocks: [{ type: "tool_use", id: "b1", name: "vfs.list", input: { dir: "/" } }],
        raw: {},
      },
      {
        assistantText: "",
        blocks: [{ type: "tool_use", id: "a2", name: "vfs.read", input: { path: "/x" } }],
        raw: {},
      },
      {
        assistantText: "",
        blocks: [{ type: "tool_use", id: "b2", name: "vfs.list", input: { dir: "/" } }],
        raw: {},
      },
    ]);
    const registry = new ToolRegistry();
    registerVfsTools(registry);
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
          maxSteps: 6,
          definition: minimalDefinition(),
          ...defaultRunScope,
        }),
      (e: unknown) =>
        e instanceof Error && e.name === "AgentError" && (e as AgentError).code === "DOOM_LOOP",
    );
  });

});

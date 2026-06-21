import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  ChatAgentSession,
  createAgentRunner,
  InMemoryAgentSession,
  AgentError,
  type AgentDefinition,
  type CreateAgentRunnerDeps,
} from "@novel-master/core/agent";
import { textBlocks } from "@novel-master/core/chat";
import { EVENT_AGENT_STEP_COMMITTED, EVENT_AGENT_RUN_FINISHED, EVENT_SESSION_MESSAGE_RECEIVED, SimpleEventBus, type AgentStepCommittedPayload, type AgentRunFinishedPayload } from "@novel-master/core/events";
import { registerBuiltinTools, ToolRegistry, type BuiltinToolContext } from "@novel-master/core";
import { type LlmChatResult, type ModelRequestService } from "@novel-master/core/provider";
import { createSessionWorktreeSnapshotStore } from "@novel-master/core/worktree";
import { type VfsService } from "@novel-master/core/vfs";
import { SqliteMessageCheckpointRepository } from "../../src/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";

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
    eventBus: new SimpleEventBus(),
    worktreeSnapshot: createSessionWorktreeSnapshotStore(),
    worktree: () =>
      ({
        scope: { kind: "session", projectId: MOCK_PROJECT_ID, sessionId: MOCK_SESSION_ID },
        renderDisplay: async () => "WT",
        buildListRows: async () => [],
        materializePersistBlock: async () => ({ worktreeDisplay: "WT" }),
      }) as never,
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


novelMasterTestFixture();

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
              name: "fs",
              input: { command: "ls /" },
            },
          ],
          raw: {},
        };
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
            name: "write",
            input: { path: "/out.txt", content: "done" },
          },
        ],
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
    if (toolResult.type === "tool_result") {
      assert.equal(toolResult.ok, true);
    }
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
            name: "fs",
            input: { command: "ls /" },
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
            name: "fs",
            input: { command: "ls /" },
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
      worktreeSnapshot: createSessionWorktreeSnapshotStore(),
      worktree: () =>
        ({
          scope: { kind: "session", projectId: MOCK_PROJECT_ID, sessionId: MOCK_SESSION_ID },
          renderDisplay: async () => "WT",
          buildListRows: async () => [],
          materializePersistBlock: async () => ({ worktreeDisplay: "WT" }),
        }) as never,
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
            name: "fs",
            input: { command: "ls /" },
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
      toolCtx: mockToolCtx(mockVfs()),
      eventBus: bus,
      worktreeSnapshot: createSessionWorktreeSnapshotStore(),
      worktree: () =>
        ({
          scope: { kind: "session", projectId: MOCK_PROJECT_ID, sessionId: MOCK_SESSION_ID },
          renderDisplay: async () => "WT",
          buildListRows: async () => [],
          materializePersistBlock: async () => ({ worktreeDisplay: "WT" }),
        }) as never,
    });
    await runner.run({
      maxSteps: 5,
      definition: minimalDefinition(),
      ...defaultRunScope,
    });
    assert.deepEqual(phases, ["assistant", "tool_results", "assistant"]);
  });

  it("tool_results 与 run_finished 携带 vfsMutated", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));
    const bus = new SimpleEventBus();
    const toolResultSteps: AgentStepCommittedPayload[] = [];
    let runFinished: AgentRunFinishedPayload | undefined;

    bus.subscribe(EVENT_AGENT_STEP_COMMITTED, (p: AgentStepCommittedPayload) => {
      if (p.phase === "tool_results") {
        toolResultSteps.push(p);
      }
    });
    bus.subscribe(EVENT_AGENT_RUN_FINISHED, (p: AgentRunFinishedPayload) => {
      runFinished = p;
    });

    const model = createMockModel([
      {
        assistantText: "",
        blocks: [
          {
            type: "tool_use",
            id: "tu-read",
            name: "read",
            input: { path: "/a.txt" },
          },
        ],
        raw: {},
      },
      {
        assistantText: "",
        blocks: [
          {
            type: "tool_use",
            id: "tu-write",
            name: "write",
            input: { path: "/b.txt", content: "hi" },
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
      toolCtx: mockToolCtx(mockVfs()),
      eventBus: bus,
      worktreeSnapshot: createSessionWorktreeSnapshotStore(),
      worktree: () =>
        ({
          scope: { kind: "session", projectId: MOCK_PROJECT_ID, sessionId: MOCK_SESSION_ID },
          renderDisplay: async () => "WT",
          buildListRows: async () => [],
          materializePersistBlock: async () => ({ worktreeDisplay: "WT" }),
        }) as never,
    });
    await runner.run({
      maxSteps: 5,
      definition: minimalDefinition(),
      ...defaultRunScope,
    });

    assert.equal(toolResultSteps.length, 2);
    assert.equal(toolResultSteps[0]!.vfsMutated, false);
    assert.equal(toolResultSteps[1]!.vfsMutated, true);
    assert.equal(runFinished?.vfsMutated, true);
  });

  it("propagates doom_loop from identical tool_use blocks", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("loop"));

    const sameInput = { path: "/x" };
    const model = createMockModel([
      {
        assistantText: "",
        blocks: [
          { type: "tool_use", id: "a", name: "read", input: sameInput },
          { type: "tool_use", id: "b", name: "read", input: sameInput },
          { type: "tool_use", id: "c", name: "read", input: sameInput },
        ],
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
      }),
    );

    await assert.rejects(
      () =>
        runner.run({
          maxSteps: 3,
          definition: { ...minimalDefinition(), prompts: { persist: [], dynamic: [] } },
          ...defaultRunScope,
        }),
      (e: unknown) =>
        e instanceof Error && e.name === "AgentError" && (e as AgentError).code === "DOOM_LOOP",
    );
  });

  it("captures checkpoint once after parallel mutating tools", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const chatSession = new ChatAgentSession(ctx.messages, session.id);
    await chatSession.append("user", textBlocks("go"));

    const model = createMockModel([
      {
        assistantText: "",
        blocks: [
          {
            type: "tool_use",
            id: "w1",
            name: "write",
            input: { path: "/a.md", content: "A" },
          },
          {
            type: "tool_use",
            id: "w2",
            name: "write",
            input: { path: "/b.md", content: "B" },
          },
          {
            type: "tool_use",
            id: "r1",
            name: "read",
            input: { path: "/a.md" },
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
    const runner = createAgentRunner(
      runnerDeps({
        session: chatSession,
        modelRequests: model,
        registry,
        toolCtx: {
          vfs,
          projectId: project.id,
          sessionId: session.id,
          listSessionMessages: () => ctx.messages.listBySession(session.id),
        },
        messageCheckpoint: ctx.messageCheckpoint,
      }),
    );

    await runner.run({
      maxSteps: 2,
      definition: minimalDefinition(),
      sessionId: session.id,
      projectId: project.id,
      applicationModelId: RUN_MODEL_ID,
      workspaceModelId: RUN_MODEL_ID,
    });

    const assistantMsgs = (await ctx.messages.listBySession(session.id)).filter(
      (m) => m.role === "assistant",
    );
    assert.equal(assistantMsgs.length, 2);
    const firstAssistant = assistantMsgs[0]!;

    const repo = new SqliteMessageCheckpointRepository(ctx.conn);
    assert.equal(
      await repo.hasCheckpoint(session.id, firstAssistant.id),
      true,
    );
    const tree = await repo.loadFileTree(session.id, firstAssistant.id);
    assert.ok(tree);
    assert.equal(tree.size, 2);
    assert.equal(
      (await repo.listFilePointersForMessages(session.id, [firstAssistant.id]))
        .length,
      2,
    );
  });

  it("does not capture checkpoint after read-only tool round", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/seed.md", "seed");
    const chatSession = new ChatAgentSession(ctx.messages, session.id);
    await chatSession.append("user", textBlocks("list"));

    const model = createMockModel([
      {
        assistantText: "",
        blocks: [
          {
            type: "tool_use",
            id: "l1",
            name: "fs",
            input: { command: "ls /" },
          },
        ],
        raw: {},
      },
      {
        assistantText: "ok",
        blocks: [{ type: "text", text: "ok" }],
        raw: {},
      },
    ]);

    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const runner = createAgentRunner(
      runnerDeps({
        session: chatSession,
        modelRequests: model,
        registry,
        toolCtx: {
          vfs,
          projectId: project.id,
          sessionId: session.id,
          listSessionMessages: () => ctx.messages.listBySession(session.id),
        },
        messageCheckpoint: ctx.messageCheckpoint,
      }),
    );

    await runner.run({
      maxSteps: 2,
      definition: minimalDefinition(),
      sessionId: session.id,
      projectId: project.id,
      applicationModelId: RUN_MODEL_ID,
      workspaceModelId: RUN_MODEL_ID,
    });

    const assistantMsgs = (await ctx.messages.listBySession(session.id)).filter(
      (m) => m.role === "assistant",
    );
    const firstAssistant = assistantMsgs[0]!;

    const repo = new SqliteMessageCheckpointRepository(ctx.conn);
    assert.equal(
      await repo.hasCheckpoint(session.id, firstAssistant.id),
      false,
    );
  });

  it("tool_result content includes VfsError path from formatToolErrorForLlm", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const chatSession = new ChatAgentSession(ctx.messages, session.id);
    await chatSession.append("user", textBlocks("read"));

    const model = createMockModel([
      {
        assistantText: "",
        blocks: [
          {
            type: "tool_use",
            id: "r1",
            name: "read",
            input: { path: "/missing.txt" },
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
    const vfs = ctx.sessionVfs(project.id, session.id);
    const runner = createAgentRunner(
      runnerDeps({
        session: chatSession,
        modelRequests: model,
        registry,
        toolCtx: {
          vfs,
          projectId: project.id,
          sessionId: session.id,
          listSessionMessages: () => ctx.messages.listBySession(session.id),
        },
      }),
    );

    await runner.run({
      maxSteps: 2,
      definition: minimalDefinition(),
      sessionId: session.id,
      projectId: project.id,
      applicationModelId: RUN_MODEL_ID,
      workspaceModelId: RUN_MODEL_ID,
    });

    const messages = await ctx.messages.listBySession(session.id);
    const toolResultMsg = messages.find(
      (m) =>
        m.role === "user" &&
        m.content.blocks?.some((b) => b.type === "tool_result"),
    );
    assert.ok(toolResultMsg);
    const resultBlock = toolResultMsg.content.blocks?.find(
      (b) => b.type === "tool_result",
    );
    assert.ok(resultBlock && resultBlock.type === "tool_result");
    assert.equal(resultBlock.ok, false);
    assert.ok(resultBlock.content.includes("Error:"));
    assert.ok(resultBlock.content.includes("/missing.txt"));
    assert.notEqual(resultBlock.content, "Error: Tool failed: read");
  });

  it("propagates doom_loop from cross-round A-B-A-B pattern", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("loop"));
    const model = createMockModel([
      {
        assistantText: "",
        blocks: [{ type: "tool_use", id: "a1", name: "read", input: { path: "/x" } }],
        raw: {},
      },
      {
        assistantText: "",
        blocks: [{ type: "tool_use", id: "b1", name: "fs", input: { command: "ls /" } }],
        raw: {},
      },
      {
        assistantText: "",
        blocks: [{ type: "tool_use", id: "a2", name: "read", input: { path: "/x" } }],
        raw: {},
      },
      {
        assistantText: "",
        blocks: [{ type: "tool_use", id: "b2", name: "fs", input: { command: "ls /" } }],
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

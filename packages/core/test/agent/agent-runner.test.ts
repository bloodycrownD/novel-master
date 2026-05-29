import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  AgentError,
  createAgentRunner,
  createNoOpCompactionPipeline,
  InMemoryAgentSession,
  registerVfsTools,
  textBlocks,
  ToolRegistry,
  type AgentDefinition,
  type LlmChatResult,
  type ModelRequestService,
} from "@novel-master/core";
import type { VfsService } from "@novel-master/core";

function minimalDefinition(modelId = "anthropic/claude"): AgentDefinition {
  return {
    schemaVersion: 1,
    name: "test",
    prompts: [{ name: "c", type: "chat" }],
    model: { applicationModelId: modelId },
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
    const runner = createAgentRunner({
      session,
      modelRequests: model,
      registry,
      toolCtx: { vfs: mockVfs() },
      compaction: createNoOpCompactionPipeline(),
    });

    const result = await runner.run({
      maxSteps: 1,
      definition: minimalDefinition(),
      promptContext: { worktreeDisplay: "" },
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
    const runner = createAgentRunner({
      session,
      modelRequests: model,
      registry,
      toolCtx: { vfs: mockVfs() },
      compaction: createNoOpCompactionPipeline(),
    });

    const result = await runner.run({
      maxSteps: 3,
      definition: minimalDefinition(),
      promptContext: { worktreeDisplay: "" },
    });

    assert.equal(model.callCount(), 3);
    assert.equal(result.finished, true);
    assert.equal(result.stopReason, "completed");
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
    const runner = createAgentRunner({
      session,
      modelRequests: model,
      registry,
      toolCtx: { vfs: mockVfs() },
      compaction: createNoOpCompactionPipeline(),
    });

    await assert.rejects(
      () =>
        runner.run({
          maxSteps: 3,
          definition: { ...minimalDefinition(), prompts: [] },
          promptContext: { worktreeDisplay: "" },
        }),
      (e: unknown) => e instanceof AgentError && e.code === "DOOM_LOOP",
    );
  });
});

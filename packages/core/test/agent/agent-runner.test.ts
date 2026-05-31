import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  compactionPolicySchema,
  decode,
  type CompactionPolicy,
  createAgentRunner,
  createCompactionPipeline,
  createNoOpCompactionPipeline,
  InMemoryAgentSession,
  registerVfsTools,
  textBlocks,
  ToolRegistry,
  type AgentDefinition,
  type CompactionAgentResolver,
  type CompactionPolicyStore,
  type LlmChatResult,
  type ModelRequestService,
} from "@novel-master/core";
import { AgentError } from "../../src/errors/agent-runtime-errors.js";
import type { VfsService } from "@novel-master/core";

function minimalDefinition(): AgentDefinition {
  return {
    name: "test",
    prompts: [{ name: "c", type: "chat" }],
  };
}

const RUN_MODEL_ID = "anthropic/claude";

/** Dialogue agent for runner compaction integration (no compact on definition). */
function compactRunnerDefinition(): AgentDefinition {
  return {
    name: "runner-compact",
    prompts: [
      { name: "base", type: "text", role: "system", content: "base" },
      {
        name: "abs",
        type: "abstract",
        content: "CTX={{.abstract}}",
      },
      { name: "c", type: "chat" },
    ],
  };
}

class InMemoryCompactionPolicyStore implements CompactionPolicyStore {
  constructor(private readonly policy: CompactionPolicy) {}

  async getPolicy() {
    return this.policy;
  }

  async setPolicy(): Promise<void> {
    throw new Error("not implemented");
  }

  async clearPolicy(): Promise<void> {
    throw new Error("not implemented");
  }
}

const noopResolver: CompactionAgentResolver = {
  async resolve(agentId: string) {
    throw new Error(`unexpected resolve: ${agentId}`);
  },
};

/** Legacy guard: agent runner must not read agent.compaction.* from any config bucket. */
function assertLegacyCompactionKeyForbidden(key: string): void {
  if (key.startsWith("agent.compaction.")) {
    throw new Error(`T11: must not read ${key}`);
  }
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
      applicationModelId: RUN_MODEL_ID,
      workspaceModelId: RUN_MODEL_ID,
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
      applicationModelId: RUN_MODEL_ID,
      workspaceModelId: RUN_MODEL_ID,
      promptContext: { worktreeDisplay: "" },
    });

    assert.equal(model.callCount(), 3);
    assert.equal(result.finished, true);
    assert.equal(result.stopReason, "completed");
  });

  it("T11: compacts from global policy without legacy agent.compaction.* config", async () => {
    assert.throws(
      () => assertLegacyCompactionKeyForbidden("agent.compaction.thresholdTokens"),
      /must not read/,
    );

    const session = new InMemoryAgentSession();
    for (let i = 0; i < 10; i++) {
      await session.append("user", textBlocks(`message ${i} `.repeat(50)));
    }

    let mainSystem: string | undefined;
    const model: ModelRequestService = {
      request: mock.fn(async (_id, _content, opts) => {
        mainSystem = opts?.system;
        return {
          assistantText: "done",
          blocks: [{ type: "text", text: "done" }],
          raw: {},
        };
      }),
    };

    const policyStore = new InMemoryCompactionPolicyStore(
      decode(
        {
          schemaVersion: 1,
          enabled: true,
          trigger: { tokenThreshold: 10 },
          action: {
            keepLastN: 2,
            abstract: { type: "text", content: "compact-abstract" },
          },
        },
        compactionPolicySchema,
      ),
    );

    const registry = new ToolRegistry();
    const runner = createAgentRunner({
      session,
      modelRequests: model,
      registry,
      toolCtx: { vfs: mockVfs() },
      compaction: createCompactionPipeline({
        modelRequests: model,
        policyStore,
        resolveAgent: noopResolver,
      }),
    });

    await runner.run({
      maxSteps: 1,
      definition: compactRunnerDefinition(),
      applicationModelId: RUN_MODEL_ID,
      workspaceModelId: RUN_MODEL_ID,
      promptContext: { worktreeDisplay: "" },
    });

    const hidden = session.allMessages().filter((m) => m.hidden);
    assert.ok(hidden.length >= 8);
    assert.match(mainSystem ?? "", /CTX=compact-abstract/);
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
          applicationModelId: RUN_MODEL_ID,
          workspaceModelId: RUN_MODEL_ID,
          promptContext: { worktreeDisplay: "" },
        }),
      (e: unknown) =>
        e instanceof Error && e.name === "AgentError" && (e as AgentError).code === "DOOM_LOOP",
    );
  });
});

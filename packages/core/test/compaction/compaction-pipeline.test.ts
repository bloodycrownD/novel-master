import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  compactionPolicySchema,
  decode,
  createCompactionPipeline,
  createDefaultTokenCounterRegistry,
  InMemoryAgentSession,
  textBlocks,
  type AgentDefinition,
  type CompactionAgentResolver,
  type CompactionPolicy,
  type CompactionPolicyStore,
  type ModelRequestService,
} from "@novel-master/core";
import { CompactionPolicyError } from "../../src/errors/compaction-policy-errors.js";
import { emptyRegistryDeps } from "../infra/tokenizer/registry-test-helpers.js";

class InMemoryCompactionPolicyStore implements CompactionPolicyStore {
  private policy: CompactionPolicy | null = null;

  async getPolicy(): Promise<CompactionPolicy | null> {
    return this.policy;
  }

  async setPolicy(policy: CompactionPolicy): Promise<void> {
    this.policy = policy;
  }

  async clearPolicy(): Promise<void> {
    this.policy = null;
  }
}

function policyDefinition(
  overrides?: Partial<CompactionPolicy> & {
    trigger?: Partial<CompactionPolicy["trigger"]>;
    action?: Partial<CompactionPolicy["action"]>;
  },
): CompactionPolicy {
  const { trigger, action, enabled, ...rest } = overrides ?? {};
  return decode(
    {
      schemaVersion: 1,
      enabled: enabled ?? true,
      trigger: { tokenThreshold: 10, ...trigger },
      action: {
        keepLastN: 2,
        abstract: { type: "agent", agentId: "summarizer" },
        ...action,
      },
      ...rest,
    },
    compactionPolicySchema,
  );
}

function compactionModelContext(
  workspaceModelId = "openai/gpt-workspace",
  cliModelId?: string,
) {
  return { workspaceModelId, cliModelId };
}

function heuristicTokenCounters() {
  return createDefaultTokenCounterRegistry(emptyRegistryDeps());
}

function createPipeline(
  modelRequests: ModelRequestService,
  options: {
    policy?: CompactionPolicy | null;
    resolveAgent?: CompactionAgentResolver;
  } = {},
) {
  const store = new InMemoryCompactionPolicyStore();
  if (options.policy !== null) {
    void store.setPolicy(options.policy ?? policyDefinition());
  }
  const summaryAgent: AgentDefinition = {
    name: "summarizer",
    prompts: [],
    model: "anthropic/claude",
  };
  const resolveAgent: CompactionAgentResolver =
    options.resolveAgent ??
    {
      async resolve(agentId: string) {
        if (agentId !== "summarizer") {
          throw new CompactionPolicyError("AGENT_NOT_FOUND", `agent not found: ${agentId}`, {
            agentId,
          });
        }
        return summaryAgent;
      },
    };
  return createCompactionPipeline({
    modelRequests,
    policyStore: store,
    resolveAgent,
    tokenCounters: heuristicTokenCounters(),
  });
}

describe("CompactionPipeline", () => {
  it("P2: enabled false does not hide", async () => {
    const session = new InMemoryAgentSession();
    for (let i = 0; i < 10; i++) {
      await session.append("user", textBlocks(`message ${i} `.repeat(50)));
    }

    const modelRequests: ModelRequestService = {
      request: mock.fn(async () => ({
        assistantText: "summary",
        blocks: [{ type: "text", text: "summary" }],
        raw: {},
      })),
    };

    const pipeline = createPipeline(modelRequests, {
      policy: policyDefinition({ enabled: false }),
    });

    const abstract = await pipeline.maybeCompact(session, { worktreeDisplay: "", filetreeDisplay: "" }, compactionModelContext());
    assert.equal(abstract, undefined);
    assert.equal(session.allMessages().filter((m) => m.hidden).length, 0);
  });

  it("T1: below token threshold does not hide or append summary", async () => {
    const session = new InMemoryAgentSession();
    for (let i = 0; i < 3; i++) {
      await session.append("user", textBlocks("short"));
    }

    const modelRequests: ModelRequestService = {
      request: mock.fn(async () => ({
        assistantText: "summary",
        blocks: [{ type: "text", text: "summary" }],
        raw: {},
      })),
    };

    const pipeline = createPipeline(modelRequests, {
      policy: policyDefinition({ trigger: { tokenThreshold: 99999 } }),
    });

    const abstract = await pipeline.maybeCompact(session, { worktreeDisplay: "", filetreeDisplay: "" }, compactionModelContext());
    assert.equal(abstract, undefined);
    assert.equal((await session.list()).length, 3);
    assert.equal(session.allMessages().filter((m) => m.hidden).length, 0);
  });

  it("T2: over token threshold hides, summary message, returns abstract", async () => {
    const session = new InMemoryAgentSession();
    for (let i = 0; i < 10; i++) {
      await session.append("user", textBlocks(`message ${i} `.repeat(50)));
    }

    const modelRequests: ModelRequestService = {
      request: mock.fn(async (_id, _content, opts) => {
        assert.equal(opts?.tools, undefined);
        return {
          assistantText: "summary text",
          blocks: [{ type: "text", text: "summary text" }],
          raw: {},
        };
      }),
    };

    const pipeline = createPipeline(modelRequests);

    const abstract = await pipeline.maybeCompact(session, { worktreeDisplay: "", filetreeDisplay: "" }, compactionModelContext());
    assert.equal(abstract, "summary text");

    const hidden = session.allMessages().filter((m) => m.hidden);
    assert.ok(hidden.length >= 8);

    const visible = await session.list();
    const summary = visible.find((m) =>
      m.content.blocks.some(
        (b) => b.type === "text" && b.text.startsWith("[Compaction summary]\n"),
      ),
    );
    assert.ok(summary);
    assert.equal(summary!.role, "user");
  });

  it("T3: floorThreshold triggers compaction", async () => {
    const session = new InMemoryAgentSession();
    for (let i = 0; i < 5; i++) {
      await session.append("user", textBlocks(`m${i}`));
    }

    let called = false;
    const modelRequests: ModelRequestService = {
      request: mock.fn(async () => {
        called = true;
        return {
          assistantText: "floor summary",
          blocks: [{ type: "text", text: "floor summary" }],
          raw: {},
        };
      }),
    };

    const pipeline = createPipeline(modelRequests, {
      policy: policyDefinition({
        trigger: { floorThreshold: 3 },
        action: { keepLastN: 2, abstract: { type: "agent", agentId: "summarizer" } },
      }),
    });

    const abstract = await pipeline.maybeCompact(session, { worktreeDisplay: "", filetreeDisplay: "" }, compactionModelContext());
    assert.equal(abstract, "floor summary");
    assert.equal(called, true);
  });

  it("T4: hidden messages do not count toward floor", async () => {
    const session = new InMemoryAgentSession();
    for (let i = 0; i < 4; i++) {
      await session.append("user", textBlocks(`m${i}`));
    }
    const all = session.allMessages();
    await session.hideRange(all[0]!.seq, all[1]!.seq);

    const modelRequests: ModelRequestService = {
      request: mock.fn(async () => ({
        assistantText: "x",
        blocks: [{ type: "text", text: "x" }],
        raw: {},
      })),
    };

    const pipeline = createPipeline(modelRequests, {
      policy: policyDefinition({ trigger: { floorThreshold: 10 } }),
    });

    const abstract = await pipeline.maybeCompact(session, { worktreeDisplay: "", filetreeDisplay: "" }, compactionModelContext());
    assert.equal(abstract, undefined);
  });

  it("C1: summary agent without model pin uses workspaceModelId", async () => {
    const session = new InMemoryAgentSession();
    for (let i = 0; i < 10; i++) {
      await session.append("user", textBlocks(`message ${i} `.repeat(50)));
    }

    const workspaceModelId = "openai/gpt-workspace";

    const modelRequests: ModelRequestService = {
      request: mock.fn(async (applicationModelId) => {
        assert.equal(applicationModelId, workspaceModelId);
        return {
          assistantText: "summary from workspace model",
          blocks: [{ type: "text", text: "summary from workspace model" }],
          raw: {},
        };
      }),
    };

    const resolveAgent: CompactionAgentResolver = {
      async resolve(agentId: string) {
        assert.equal(agentId, "summarizer");
        return {
          name: "summarizer",
          prompts: [],
        };
      },
    };

    const pipeline = createPipeline(modelRequests, { resolveAgent });
    const abstract = await pipeline.maybeCompact(
      session,
      { worktreeDisplay: "", filetreeDisplay: "" },
      compactionModelContext(workspaceModelId),
    );

    assert.equal(abstract, "summary from workspace model");
    assert.equal(
      (modelRequests.request as ReturnType<typeof mock.fn>).mock.callCount(),
      1,
    );
  });

  it("CLI3: summary LLM uses resolved agent B model, not dialogue model A", async () => {
    const session = new InMemoryAgentSession();
    for (let i = 0; i < 10; i++) {
      await session.append("user", textBlocks(`message ${i} `.repeat(50)));
    }

    const workspaceModelId = "openai/gpt-workspace";
    const summaryModelId = "anthropic/claude-summary";

    const modelRequests: ModelRequestService = {
      request: mock.fn(async (applicationModelId) => {
        assert.equal(applicationModelId, summaryModelId);
        return {
          assistantText: "summary from B",
          blocks: [{ type: "text", text: "summary from B" }],
          raw: {},
        };
      }),
    };

    const resolveAgent: CompactionAgentResolver = {
      async resolve(agentId: string) {
        assert.equal(agentId, "summarizer");
        return {
          name: "summarizer",
          prompts: [],
          model: summaryModelId,
        };
      },
    };

    const pipeline = createPipeline(modelRequests, { resolveAgent });
    const abstract = await pipeline.maybeCompact(
      session,
      { worktreeDisplay: "", filetreeDisplay: "" },
      compactionModelContext(workspaceModelId),
    );

    assert.equal(abstract, "summary from B");
    assert.notEqual(workspaceModelId, summaryModelId);
    assert.equal(
      (modelRequests.request as ReturnType<typeof mock.fn>).mock.callCount(),
      1,
    );
  });

  it("T12: agent abstract calls modelRequests without tools", async () => {
    const session = new InMemoryAgentSession();
    for (let i = 0; i < 10; i++) {
      await session.append("user", textBlocks(`message ${i} `.repeat(50)));
    }

    const modelRequests: ModelRequestService = {
      request: mock.fn(async (_id, _content, opts) => {
        assert.equal(opts?.tools, undefined);
        return {
          assistantText: "agent-only summary",
          blocks: [{ type: "text", text: "agent-only summary" }],
          raw: {},
        };
      }),
    };

    const pipeline = createPipeline(modelRequests, {
      policy: policyDefinition({
        action: { keepLastN: 2, abstract: { type: "agent", agentId: "summarizer" } },
      }),
    });

    const abstract = await pipeline.maybeCompact(session, { worktreeDisplay: "", filetreeDisplay: "" }, compactionModelContext());
    assert.equal(abstract, "agent-only summary");
    assert.equal(
      (modelRequests.request as ReturnType<typeof mock.fn>).mock.callCount(),
      1,
    );
  });

  it("C6: agentId resolution failure throws", async () => {
    const session = new InMemoryAgentSession();
    for (let i = 0; i < 10; i++) {
      await session.append("user", textBlocks(`message ${i} `.repeat(50)));
    }

    const modelRequests: ModelRequestService = {
      request: mock.fn(async () => ({
        assistantText: "x",
        blocks: [{ type: "text", text: "x" }],
        raw: {},
      })),
    };

    const pipeline = createPipeline(modelRequests, {
      policy: policyDefinition({
        action: { keepLastN: 2, abstract: { type: "agent", agentId: "missing" } },
      }),
    });

    await assert.rejects(
      () => pipeline.maybeCompact(session, { worktreeDisplay: "", filetreeDisplay: "" }, compactionModelContext()),
      (e: unknown) =>
        e instanceof Error &&
        e.name === "CompactionPolicyError" &&
        (e as CompactionPolicyError).code === "AGENT_NOT_FOUND",
    );
  });

  it("T5: abstract.type text sets dot without LLM", async () => {
    const session = new InMemoryAgentSession();
    for (let i = 0; i < 10; i++) {
      await session.append("user", textBlocks(`message ${i} `.repeat(50)));
    }

    const modelRequests: ModelRequestService = {
      request: mock.fn(async () => {
        throw new Error("should not call model for text abstract");
      }),
    };

    const pipeline = createPipeline(modelRequests, {
      policy: policyDefinition({
        action: {
          keepLastN: 2,
          abstract: { type: "text", content: "static abstract" },
        },
      }),
    });

    const abstract = await pipeline.maybeCompact(session, { worktreeDisplay: "WT", filetreeDisplay: "" }, compactionModelContext());
    assert.equal(abstract, "static abstract");
  });

  it("no policy record behaves like disabled", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("hello"));

    const modelRequests: ModelRequestService = {
      request: mock.fn(async () => ({
        assistantText: "x",
        blocks: [{ type: "text", text: "x" }],
        raw: {},
      })),
    };

    const pipeline = createPipeline(modelRequests, { policy: null });
    const abstract = await pipeline.maybeCompact(session, { worktreeDisplay: "", filetreeDisplay: "" }, compactionModelContext());
    assert.equal(abstract, undefined);
  });
});

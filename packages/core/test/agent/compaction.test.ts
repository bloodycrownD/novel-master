import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  createCompactionPipeline,
  InMemoryAgentSession,
  textBlocks,
  type AgentDefinition,
  type ModelRequestService,
} from "@novel-master/core";

function compactDefinition(
  compact?: Partial<NonNullable<AgentDefinition["compact"]>>,
): AgentDefinition {
  return {
    schemaVersion: 1,
    name: "compact-test",
    prompts: [],
    model: { applicationModelId: "anthropic/claude" },
    compact: {
      trigger: { tokenThreshold: 10, ...compact?.trigger },
      action: {
        keepLastN: 2,
        abstract: { type: "agent" },
        ...compact?.action,
      },
    },
  };
}

describe("CompactionPipeline", () => {
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

    const pipeline = createCompactionPipeline({ modelRequests });
    const def = compactDefinition({ trigger: { tokenThreshold: 99999 } });

    const abstract = await pipeline.maybeCompact(session, def, "");
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

    const pipeline = createCompactionPipeline({ modelRequests });
    const def = compactDefinition();

    const abstract = await pipeline.maybeCompact(session, def, "");
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

    const pipeline = createCompactionPipeline({ modelRequests });
    const def = compactDefinition({
      trigger: { floorThreshold: 3 },
      action: { keepLastN: 2, abstract: { type: "agent" } },
    });

    const abstract = await pipeline.maybeCompact(session, def, "");
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

    const pipeline = createCompactionPipeline({ modelRequests });
    const def = compactDefinition({ trigger: { floorThreshold: 10 } });

    const abstract = await pipeline.maybeCompact(session, def, "");
    assert.equal(abstract, undefined);
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

    const pipeline = createCompactionPipeline({ modelRequests });
    const def = compactDefinition({
      action: {
        keepLastN: 2,
        abstract: { type: "text", content: "static abstract" },
      },
    });

    const abstract = await pipeline.maybeCompact(session, def, "WT");
    assert.equal(abstract, "static abstract");
  });
});

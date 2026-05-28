import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  DefaultCompactionService,
  InMemoryAgentSession,
  textBlocks,
} from "@novel-master/core";
import type { ModelRequestService } from "../../src/service/provider/model-request.port.js";
import type { ConfigService } from "../../src/service/config/config.port.js";

function memoryConfig(overrides: Record<string, string> = {}): ConfigService {
  const map = new Map(Object.entries(overrides));
  return {
    async get(key) {
      return map.get(key);
    },
    async set(key, value) {
      map.set(key, value);
    },
    async getBoolean(key, defaultValue) {
      const v = map.get(key);
      if (v == null) return defaultValue ?? false;
      return v === "true";
    },
    async setBoolean(key, value) {
      map.set(key, value ? "true" : "false");
    },
    async getNumber(key, defaultValue) {
      const v = map.get(key);
      if (v == null) return defaultValue ?? 0;
      return Number(v);
    },
    async setNumber(key, value) {
      map.set(key, String(value));
    },
    async list() {
      return [...map.entries()].map(([key, value]) => ({ key, value }));
    },
    async reset(key) {
      map.delete(key);
    },
  };
}

describe("DefaultCompactionService", () => {
  it("hides old messages and appends compaction summary", async () => {
    const session = new InMemoryAgentSession();
    for (let i = 0; i < 10; i++) {
      await session.append("user", textBlocks(`message ${i} `.repeat(50)));
    }

    const modelRequests: ModelRequestService = {
      request: mock.fn(async () => ({
        assistantText: "summary text",
        blocks: [{ type: "text", text: "summary text" }],
        raw: {},
      })),
    };

    const compaction = new DefaultCompactionService({
      config: memoryConfig({
        "agent.compaction.thresholdTokens": "10",
        "agent.compaction.keepLastN": "2",
      }),
      modelRequests,
    });

    await compaction.maybeCompact(session, "anthropic/claude");

    const all = session.allMessages();
    const hidden = all.filter((m) => m.hidden);
    assert.ok(hidden.length >= 8, `expected old messages hidden, got ${hidden.length}`);
    for (const m of hidden) {
      assert.equal(m.hidden, true);
    }

    const visible = await session.list();
    assert.ok(visible.length <= 4);
    const summary = visible.find((m) =>
      m.content.blocks.some(
        (b) => b.type === "text" && b.text.startsWith("[Compaction summary]\n"),
      ),
    );
    assert.ok(summary);
    assert.equal(summary!.role, "user");
  });
});

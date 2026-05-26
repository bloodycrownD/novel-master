import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { textBlocks } from "@novel-master/core";
import { createProviderServices } from "../../src/service/provider/create-provider-services.js";
import type { SecretStore } from "@/infra/sksp/secret-store.port.js";
import {
  clearProtocolAdapters,
  getProtocolAdapter,
} from "../../src/infra/llm-protocol/registry.js";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";

function memorySecretStore(): SecretStore {
  const map = new Map<string, string>();
  return {
    async get(ref) {
      return map.get(ref) ?? null;
    },
    async has(ref) {
      return map.has(ref);
    },
    async set(ref, plain) {
      map.set(ref, plain);
    },
    async delete(ref) {
      return map.delete(ref);
    },
  };
}

describe("ModelRequestService tool_use session round-trip", () => {
  it("persists tool_use block after request with history", async () => {
    clearProtocolAdapters();
    const fetchFn = mock.fn(async () => {
      return new Response(
        JSON.stringify({
          content: [
            {
              type: "tool_use",
              id: "tu_1",
              name: "grep",
              input: { pattern: "foo" },
            },
            { type: "text", text: "" },
            { type: "text", text: "done" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    getProtocolAdapter("anthropic", fetchFn as typeof fetch);

    const ctx = await openNovelMasterTestConnection();
    const secrets = memorySecretStore();
    const bundle = createProviderServices(ctx.conn, secrets);
    await secrets.set("provider/anthropic/apiKey", "sk-ant-test");
    await bundle.providerModels.create("anthropic", "claude-3-5-sonnet");

    const project = await ctx.projects.create("P");
    const session = await ctx.sessions.create(project.id);
    await ctx.messages.append(session.id, "user", textBlocks("find foo"));

    const history = (await ctx.messages.listBySession(session.id)).filter(
      (m) => !m.hidden,
    );
    const result = await bundle.modelRequests.request(
      "anthropic/claude-3-5-sonnet",
      "find foo",
      { history },
    );

    const saved = await ctx.messages.append(session.id, "assistant", {
      blocks: result.blocks,
    });
    const reloaded = await ctx.messages.get(saved.id);
    const toolUse = reloaded.content.blocks.find((b) => b.type === "tool_use");
    assert.ok(toolUse);
    assert.equal(toolUse.type === "tool_use" && toolUse.id, "tu_1");
    assert.equal(toolUse.type === "tool_use" && toolUse.name, "grep");
    assert.ok(
      !reloaded.content.blocks.some(
        (b) => b.type === "text" && b.text === "",
      ),
    );

    await ctx.conn.close();
    clearProtocolAdapters();
  });
});

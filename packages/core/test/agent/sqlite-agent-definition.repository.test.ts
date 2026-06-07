import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decode, encode, agentDefinitionSchema } from "@novel-master/core";
import { SqliteAgentDefinitionRepository } from "../../src/domain/agent/repositories/impl/sqlite-agent-definition.repository.js";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";

describe("SqliteAgentDefinitionRepository", () => {
  it("AG1: round-trips AgentDefinition", async () => {
    const ctx = await openNovelMasterTestConnection();
    const repo = new SqliteAgentDefinitionRepository(ctx.conn);
    const def = decode(
      {
        schemaVersion: 1,
        name: "writer",
        prompts: {
          blocks: {
            s: { type: "text", role: "system", content: "hi" },
          },
        },
        model: "mock/test",
        runtime: { maxSteps: 5 },
      },
      agentDefinitionSchema,
    );
    await repo.upsert("writer", def);
    const loaded = await repo.get("writer");
    assert.ok(loaded);
    assert.equal(loaded.name, "writer");
    assert.equal(loaded.model, "mock/test");
    assert.deepEqual(encode(loaded, agentDefinitionSchema), encode(def, agentDefinitionSchema));
    const legacy = await ctx.conn.query(
      "SELECT model, runtime_json FROM agent_definition WHERE agent_id = 'writer'",
    );
    assert.equal(legacy[0]?.model, null);
    assert.equal(legacy[0]?.runtime_json, null);
    const ids = await repo.listIds();
    assert.deepEqual(ids, ["writer"]);
    await ctx.conn.close();
  });
});

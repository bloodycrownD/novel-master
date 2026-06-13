import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decode, encode, agentDefinitionSchema } from "@novel-master/core";
import { SqliteAgentDefinitionRepository } from "../../src/domain/agent/repositories/impl/sqlite-agent-definition.repository.js";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";


novelMasterTestFixture();

describe("SqliteAgentDefinitionRepository", () => {
  it("AG1: round-trips AgentDefinition", async () => {
    const ctx = getNovelMasterTestContext();
    const repo = new SqliteAgentDefinitionRepository(ctx.conn);
    const def = decode(
      {
        schemaVersion: 1,
        name: "writer",
        prompts: {
          system: "hi",
          persist: {},
          dynamic: {},
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
    const cols = await ctx.conn.query<{ name: string }>(
      "SELECT name FROM pragma_table_info('agent_definition')",
    );
    const colNames = cols.map((c) => c.name);
    assert.ok(!colNames.includes("model"));
    assert.ok(!colNames.includes("runtime_json"));
    const ids = await repo.listIds();
    assert.deepEqual(ids, ["writer"]);
  });
});

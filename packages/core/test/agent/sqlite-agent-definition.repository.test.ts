import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decode, encode } from "@novel-master/core";

import { agentDefinitionSchema } from "@novel-master/core/agent";
import { SqliteAgentDefinitionRepository } from "../../src/domain/agent/repositories/impl/sqlite-agent-definition.repository.js";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";

const TEST_SAVED_MODEL = "11111111-1111-4111-8111-111111111111";

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
        model: TEST_SAVED_MODEL,
        runtime: { maxSteps: 5 },
      },
      agentDefinitionSchema,
    );
    await repo.upsert("writer", def);
    const loaded = await repo.get("writer");
    assert.ok(loaded);
    assert.equal(loaded.name, "writer");
    assert.equal(loaded.model, TEST_SAVED_MODEL);
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

import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  SerializationDecode, SerializationEncode  } from "@novel-master/core";
import type { ZodType } from "zod";

import {  agentDefinitionSchema  } from "@novel-master/core/agent";
import {  SqliteAgentDefinitionRepository  } from "../../src/domain/agent/repositories/impl/sqlite-agent-definition.repository.js";
import {  getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix  } from "../helpers/novel-master-fixture.js";
import {  unwrap  } from "../helpers/result-unwrap.js";

/** decode 已改返回 Result（四期签名）：测试内统一解包——Ok 取 value，Err 抛 error。 */
function decode<T>(raw: unknown, schema: ZodType<T>): T {
  return unwrap(SerializationDecode.decode(raw, schema));
}

/** encode 已改返回 Result（五期门⑦ toWire 门禁）：测试内统一解包，同 decode 模式。 */
function encode(value: unknown, schema: Parameters<typeof SerializationEncode.encode>[1]): unknown {
  return unwrap(SerializationEncode.encode(value, schema));
}

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
    // get / list 已改返回 Result（五期门⑦）：unwrap 后断言，同 decode 模式。
    const loaded = unwrap(await repo.get("writer"));
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
    // helper 已种子化 test-default-agent，这里只能断言 writer 存在。
    assert.ok(ids.includes("writer"));
  });
});

import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  SerializationDecode  } from "@novel-master/core";

import {  agentDefinitionSchema  } from "@novel-master/core/agent";
import {  unwrap  } from "../helpers/result-unwrap.js";

/** 与 handleAgentRegistryList 中单条 get 失败分支一致。 */
function buildBrokenListItem(
  agentId: string,
  err: unknown,
): { agentId: string; name: string; decodeError: string } {
  const decodeError = err instanceof Error ? err.message : String(err);
  return { agentId, name: agentId, decodeError };
}

describe("Agent 列表 decode 容错", () => {
  it("prompts.blocks 解码失败时生成 decodeError 行", () => {
    // decode 已 Result 化（四期签名）：毒行不再 throw，失败沿 Result.err 回传。
    const r = SerializationDecode.decode(
      {
        schemaVersion: 1,
        name: "broken",
        prompts: { blocks: {} },
      },
      agentDefinitionSchema,
    );
    assert.ok(!r.ok);
    const caught = r.ok ? undefined : r.error;
    assert.ok(caught);

    const row = buildBrokenListItem("broken-agent", caught);
    assert.equal(row.agentId, "broken-agent");
    assert.equal(row.name, "broken-agent");
    assert.match(row.decodeError, /prompts\.blocks/);
  });

  it("正常解码行不含 decodeError", () => {
    const def = unwrap(SerializationDecode.decode(
      {
        schemaVersion: 1,
        name: "writer",
        prompts: { system: "hi", persist: {}, dynamic: {} },
      },
      agentDefinitionSchema,
    ));
    assert.equal(def.name, "writer");
  });
});

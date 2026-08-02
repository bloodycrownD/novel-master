import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decode } from "../../src/infra/serialization/decode.js";
import { ConfigDecodeError } from "../../src/errors/config-decode-errors.js";
import { sessionAgentConfigSchema } from "../../src/domain/chat/model/session-agent-config.schema.js";

describe("sessionAgentConfigSchema（v2 单形态）", () => {
  it("缺 agentId 报错", () => {
    assert.throws(
      () => decode({}, sessionAgentConfigSchema),
      ConfigDecodeError,
    );
  });

  it("空 agentId 报错", () => {
    assert.throws(
      () => decode({ agentId: "" }, sessionAgentConfigSchema),
      ConfigDecodeError,
    );
  });

  it("agentId 合法", () => {
    const config = decode({ agentId: "agent-a" }, sessionAgentConfigSchema);
    assert.equal(config.agentId, "agent-a");
    assert.equal(config.modelId, undefined);
  });

  it("agentId + modelId 合法", () => {
    const config = decode(
      { agentId: "agent-a", modelId: "gpt-4" },
      sessionAgentConfigSchema,
    );
    assert.equal(config.agentId, "agent-a");
    assert.equal(config.modelId, "gpt-4");
  });

  it("多余字段报错（.strict()）", () => {
    assert.throws(
      () =>
        decode(
          { agentId: "a", extra: 1 } as Record<string, unknown>,
          sessionAgentConfigSchema,
        ),
      ConfigDecodeError,
    );
    // 老 mode 字段现在被 .strict() 拒绝
    assert.throws(
      () =>
        decode(
          { mode: "bind", agentId: "a" } as Record<string, unknown>,
          sessionAgentConfigSchema,
        ),
      ConfigDecodeError,
    );
  });

  it("空 modelId 报错", () => {
    assert.throws(
      () =>
        decode(
          { agentId: "a", modelId: "" },
          sessionAgentConfigSchema,
        ),
      ConfigDecodeError,
    );
  });

  it("toWire：不带 modelId 时只输出 agentId", () => {
    const wire = sessionAgentConfigSchema.toWire({ agentId: "agent-b" });
    assert.deepEqual(wire, { agentId: "agent-b" });
  });

  it("toWire：带 modelId 时输出两个字段", () => {
    const wire = sessionAgentConfigSchema.toWire({
      agentId: "agent-b",
      modelId: "m1",
    });
    assert.deepEqual(wire, { agentId: "agent-b", modelId: "m1" });
  });
});

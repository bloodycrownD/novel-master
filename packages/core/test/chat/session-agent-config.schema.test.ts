import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decode } from "../../src/infra/serialization/decode.js";
import { ConfigDecodeError } from "../../src/errors/config-decode-errors.js";
import {
  sessionAgentConfigSchema,
  sessionAgentModeSchema,
} from "../../src/domain/chat/model/session-agent-config.schema.js";

describe("sessionAgentConfigSchema", () => {
  it("follow 合法", () => {
    const config = decode({ mode: "follow" }, sessionAgentConfigSchema);
    assert.equal(config.mode, "follow");
  });

  it("bind 缺 agentId 报错", () => {
    assert.throws(
      () => decode({ mode: "bind" }, sessionAgentConfigSchema),
      ConfigDecodeError,
    );
  });

  it("bind 带 agentId 合法", () => {
    const config = decode(
      { mode: "bind", agentId: "agent-a" },
      sessionAgentConfigSchema,
    );
    assert.equal(config.mode, "bind");
    assert.equal((config as { agentId: string }).agentId, "agent-a");
    assert.equal(
      (config as { modelId?: string }).modelId,
      undefined,
    );
  });

  it("bind 带 agentId + modelId 合法", () => {
    const config = decode(
      { mode: "bind", agentId: "agent-a", modelId: "gpt-4" },
      sessionAgentConfigSchema,
    );
    assert.equal(config.mode, "bind");
    assert.equal((config as { agentId: string }).agentId, "agent-a");
    assert.equal(
      (config as { modelId?: string }).modelId,
      "gpt-4",
    );
  });

  it("未知 mode 报错（.strict()）", () => {
    assert.throws(
      () => decode({ mode: "registry" }, sessionAgentModeSchema),
      ConfigDecodeError,
    );
    assert.throws(
      () =>
        decode(
          { mode: "follow", extra: 1 } as Record<string, unknown>,
          sessionAgentConfigSchema,
        ),
      ConfigDecodeError,
    );
  });

  it("bind 空 agentId 报错", () => {
    assert.throws(
      () =>
        decode(
          { mode: "bind", agentId: "" },
          sessionAgentConfigSchema,
        ),
      ConfigDecodeError,
    );
  });

  it("toWire round-trip：bind 不带 modelId 时不输出 modelId 字段", () => {
    const wire = sessionAgentConfigSchema.toWire({
      mode: "bind",
      agentId: "agent-b",
    });
    assert.deepEqual(wire, { mode: "bind", agentId: "agent-b" });
  });

  it("toWire：follow 仅输出 mode", () => {
    const wire = sessionAgentConfigSchema.toWire({ mode: "follow" });
    assert.deepEqual(wire, { mode: "follow" });
  });
});

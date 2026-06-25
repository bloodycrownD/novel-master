import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decode } from "@novel-master/core";
import {
  projectAgentConfigSchema,
  projectAgentModeSchema,
} from "@novel-master/core/chat";
import { ConfigDecodeError } from "../../src/errors/config-decode-errors.js";

function minimalDefinitionWire() {
  return {
    schemaVersion: 1 as const,
    name: "项目专属",
    prompts: { persist: {}, dynamic: {} },
  };
}

describe("projectAgentConfigSchema", () => {
  it("follow 无 definition 合法", () => {
    const config = decode({ mode: "follow" }, projectAgentConfigSchema);
    assert.equal(config.mode, "follow");
    assert.equal(config.definition, undefined);
  });

  it("follow 可保留 definition 草稿", () => {
    const config = decode(
      { mode: "follow", definition: minimalDefinitionWire() },
      projectAgentConfigSchema,
    );
    assert.equal(config.mode, "follow");
    assert.equal(config.definition?.name, "项目专属");
  });

  it("custom 含 definition 合法", () => {
    const config = decode(
      { mode: "custom", definition: minimalDefinitionWire() },
      projectAgentConfigSchema,
    );
    assert.equal(config.mode, "custom");
    assert.equal(config.definition?.name, "项目专属");
  });

  it("custom 缺 definition 拒绝", () => {
    assert.throws(
      () => decode({ mode: "custom" }, projectAgentConfigSchema),
      ConfigDecodeError,
    );
  });

  it("非法 mode 拒绝", () => {
    assert.throws(
      () => decode({ mode: "registry" }, projectAgentModeSchema),
      ConfigDecodeError,
    );
  });
});

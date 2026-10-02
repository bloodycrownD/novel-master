import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decode } from "@novel-master/core";
import {
  projectAgentConfigSchema,
  projectAgentModeSchema,
} from "@novel-master/core/chat";
import { agentDefinitionSchema } from "@novel-master/core/agent";
import { PromptError } from "@novel-master/core/prompt";
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

  it("configToWire 对重名块 definition 抛错（第二份同款循环已被收敛点覆盖）", () => {
    // configToWire 转调 agentDefinitionSchema.toWire，两条塌缩循环的收敛点
    // 就是 definitionToDocument；这条钉住「即便绕过 validateAgentDefinition
    // 直接走 projectAgentConfigSchema.toWire，收敛点仍能兜住」。
    const base = decode(
      minimalDefinitionWire(),
      agentDefinitionSchema,
    );
    const dup = {
      ...base,
      prompts: {
        ...base.prompts,
        persist: [
          {
            name: "persona",
            type: "text" as const,
            role: "user" as const,
            content: "人设甲",
          },
          {
            name: "persona",
            type: "text" as const,
            role: "user" as const,
            content: "人设乙",
          },
        ],
      },
    };
    assert.throws(
      () =>
        projectAgentConfigSchema.toWire({
          mode: "custom",
          definition: dup,
        }),
      (e: unknown) =>
        e instanceof PromptError &&
        e.code === "INVALID_BLOCK" &&
        /重复的块名/.test(e.message),
    );
  });
});

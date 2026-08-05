import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { registerBuiltinTools, ToolRegistry } from "@novel-master/core";

import {
  AgentConfigError,
  validateAgentToolPolicy,
} from "@novel-master/core/agent";
import type { BuiltinToolContext } from "../../src/domain/tool/builtin/builtin-tool-context.js";

function vfsRegistryNames(): Set<string> {
  const registry = new ToolRegistry<BuiltinToolContext>();
  registerBuiltinTools(registry);
  return new Set(registry.list());
}

describe("validateAgentToolPolicy task 白名单（T-C4 / P1-9）", () => {
  const registryNames = vfsRegistryNames();

  it("tools.allow 含 task 不报错（task 在内置白名单，不依赖 probe 注册）", () => {
    // probe 不含 task（仅 vfs 6 件），但允许配置 task。
    assert.equal(
      validateAgentToolPolicy({ allow: ["task"] }, registryNames),
      undefined,
    );
  });

  it("tools.deny 含 task 不报错", () => {
    assert.equal(
      validateAgentToolPolicy({ deny: ["task"] }, registryNames),
      undefined,
    );
  });

  it("tools.allow 含 unknown_tool 仍报 INVALID_TOOL_POLICY", () => {
    assert.throws(
      () => validateAgentToolPolicy({ allow: ["unknown_tool"] }, registryNames),
      (e: unknown) =>
        e instanceof AgentConfigError && e.code === "INVALID_TOOL_POLICY",
    );
  });

  it("tools.allow 同时含 task 和 vfs 工具正常", () => {
    assert.equal(
      validateAgentToolPolicy(
        { allow: ["task", "read", "grep"] },
        registryNames,
      ),
      undefined,
    );
  });
});

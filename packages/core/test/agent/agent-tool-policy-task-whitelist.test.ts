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

describe("validateAgentToolPolicy task 不再特殊白名单（T-C4 修订）", () => {
  const registryNames = vfsRegistryNames();

  it("tools.allow 含 task 报 INVALID_TOOL_POLICY（task 不再是用户可配工具）", () => {
    assert.throws(
      () => validateAgentToolPolicy({ allow: ["task"] }, registryNames),
      (e: unknown) =>
        e instanceof AgentConfigError && e.code === "INVALID_TOOL_POLICY",
    );
  });

  it("tools.deny 含 task 报 INVALID_TOOL_POLICY", () => {
    assert.throws(
      () => validateAgentToolPolicy({ deny: ["task"] }, registryNames),
      (e: unknown) =>
        e instanceof AgentConfigError && e.code === "INVALID_TOOL_POLICY",
    );
  });

  it("tools.allow 含 unknown_tool 仍报 INVALID_TOOL_POLICY", () => {
    assert.throws(
      () => validateAgentToolPolicy({ allow: ["unknown_tool"] }, registryNames),
      (e: unknown) =>
        e instanceof AgentConfigError && e.code === "INVALID_TOOL_POLICY",
    );
  });

  it("tools.allow 只含 vfs 工具正常", () => {
    assert.equal(
      validateAgentToolPolicy({ allow: ["read", "grep"] }, registryNames),
      undefined,
    );
  });
});

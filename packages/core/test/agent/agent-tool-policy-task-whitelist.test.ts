import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  BuiltinTools, ToolRegistry  } from "@novel-master/core";

import {  AgentToolPolicyValidator  } from "@novel-master/core/agent";
import type { BuiltinToolContext } from "../../src/domain/tool/builtin/builtin-tool-context.js";

function vfsRegistryNames(): Set<string> {
    const registry = new ToolRegistry<BuiltinToolContext>();
    BuiltinTools.register(registry);
    return new Set(registry.list());
}

describe("AgentToolPolicyValidator.validate task 是合法工具（T-C4）", () => {
    const registryNames = vfsRegistryNames();

    it("registryNames 含 task（task 进 BuiltinTools.register）", () => {
        assert.ok(registryNames.has("task"));
    });

    it("tools.allow 含 task 正常通过（task 是合法工具名）", () => {
        assert.equal(AgentToolPolicyValidator.validate({ allow: ["task"] }, registryNames).ok, true);
    });

    it("tools.deny 含 task 正常通过", () => {
        assert.equal(AgentToolPolicyValidator.validate({ deny: ["task"] }, registryNames).ok, true);
    });

    it("tools.allow 含 unknown_tool 仍报 INVALID_TOOL_POLICY", () => {
        const result = AgentToolPolicyValidator.validate({ allow: ["unknown_tool"] }, registryNames);
        assert.equal(result.ok, false);
        if (result.ok) {
            return;
        }
        assert.equal(result.error.key, "AGENT_INVALID_TOOL_POLICY");
    });

    it("tools.allow 只含 vfs 工具正常", () => {
        assert.equal(AgentToolPolicyValidator.validate({ allow: ["read", "grep"] }, registryNames).ok, true);
    });
});

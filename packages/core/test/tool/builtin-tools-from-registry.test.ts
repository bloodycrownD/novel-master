import assert from "node:assert/strict";
import fs from "node:fs";
import {  describe, it  } from "node:test";
import { BuiltinTools } from "../../src/domain/tool/builtin/register-builtin-tools.js";
import type { BuiltinToolContext } from "../../src/domain/tool/builtin/builtin-tool-context.js";
import { ToolRegistry } from "../../src/domain/tool/logic/tool-registry.js";
import { ToolDefinitions } from "../../src/infra/llm-protocol/logic/tool-definitions.js";

/**
 * T-T8：自带工具的 `fromRegistry` 输出与工具类型拆分（Tool / ExternalTool）前的
 * 基线夹具逐字节一致——拆分对自带工具的模型侧定义零漂移。夹具由改动前的实现
 * 生成（见夹具 note）；有意修改自带工具定义时需重新生成夹具并确认 diff。
 *
 * @module test/tool/builtin-tools-from-registry.test
 */

const FIXTURE_URL = new URL("./builtin-tools-from-registry.fixture.json", import.meta.url);

/** fromRegistry 只调 description(ctx)，求值只读 subagent 名单（同 tool-schema-descriptions.test 的最小 ctx）。 */
const CTX = { subagent: { callableAgents: [{ name: "general" }] } } as never;

describe("T-T8: 自带工具 fromRegistry 输出与拆分前夹具逐字节一致", () => {
    it("11 个自带工具与基线夹具完全一致；外加 1 条 mcp 占位（共 12）", () => {
        const fixture = JSON.parse(fs.readFileSync(FIXTURE_URL, "utf8")) as { readonly tools: unknown };
        const registry = new ToolRegistry<BuiltinToolContext>();
        BuiltinTools.register(registry);
        const defs = ToolDefinitions.fromRegistry(registry, CTX);
        // mcp 占位（spec §D）不在拆分前的夹具内：锁总数 12，自带 11 条单独对夹具。
        assert.equal(defs.length, 12);
        const builtins = defs.filter((def) => def.name !== "mcp");
        assert.deepEqual(builtins, fixture.tools);
        // 逐字节：序列化串也一致（键序与内容不漂移）。
        assert.equal(JSON.stringify(builtins), JSON.stringify(fixture.tools));
        // 占位排在插入序末尾：无参数 JSON Schema、description 写死中文（到不了模型）。
        assert.deepEqual(defs.at(-1), {name: "mcp", description: "MCP 服务器提供的工具", inputSchema: {type: "object", properties: {}}});
    });
});

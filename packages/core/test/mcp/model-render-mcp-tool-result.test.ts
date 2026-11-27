import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { McpToolResultRenderer } from "../../src/domain/mcp/logic/render-mcp-tool-result.js";
import { McpToolAdapter } from "../../src/domain/mcp/logic/to-nm-tool.js";
import type { BuiltinToolContext } from "../../src/domain/tool/builtin/builtin-tool-context.js";
import { TOOL_OUTPUT_MAX_BYTES } from "../../src/domain/tool/logic/tool-output-limits.js";
import { ToolRegistry } from "../../src/domain/tool/logic/tool-registry.js";
import { ToolRunner } from "../../src/domain/tool/logic/tool-runner.js";
import { ToolDefinitions } from "../../src/infra/llm-protocol/logic/tool-definitions.js";
import { Result } from "../../src/errors/either.js";
import type { McpFailure } from "../../src/domain/mcp/model/mcp-failure.js";
import type { McpToolSnapshot } from "../../src/domain/mcp/model/mcp-tool-snapshot.js";
import { unwrap, unwrapErr } from "../helpers/result-unwrap.js";

const SNAPSHOT: McpToolSnapshot = {serverId: "db", toolName: "query", toolDescription: "执行 SQL 查询"};

/** 内存 mock ctx：记录 vfs write（overflow-sink 落盘用例），可注入写失败。 */
function makeRecordingCtx(): { readonly ctx: BuiltinToolContext; readonly files: Map<string, string>; readonly setFail: (on: boolean) => void } {
    const files = new Map<string, string>();
    let fail = false;
    const ctx = {
        projectId: "p",
        sessionId: "s",
        vfs: {
            write: async (path: string, content: string) => {
                if (fail) throw new Error("vfs down");
                files.set(path, content);
                return {version: 1};
            },
        },
    } as never;
    return {ctx, files, setFail: (on: boolean) => { fail = on; }};
}

describe("render-mcp-tool-result", () => {
    it("T-M10: text 拼接、image / link / embedded 降级为占位文本，条目间换行", () => {
        const rendered = McpToolResultRenderer.render([
            {type: "text", text: "第一段"},
            {type: "image", data: "base64==", mimeType: "image/png"},
            {type: "resource_link", uri: "file:///tmp/x.txt", name: "x"},
            {type: "resource", resource: {uri: "file:///tmp/y.json", text: '{"a":1}'}},
            {type: "resource", resource: {uri: "file:///tmp/z.bin", blob: "AA=="}},
            {type: "mystery"},
            "非对象条目",
        ]);
        assert.ok(rendered.includes("第一段"));
        assert.ok(rendered.includes("[image content omitted: image/png]"));
        assert.ok(rendered.includes("[resource link: file:///tmp/x.txt]"));
        assert.ok(rendered.includes('{"a":1}'), "embedded resource 自带 text 时透出原文");
        assert.ok(rendered.includes("[resource content omitted: file:///tmp/z.bin]"));
        assert.ok(rendered.includes("[unknown content: mystery]"));
        // 7 条目中非对象条目过滤，余 6 段换行拼接
        assert.equal(rendered.split("\n").length, 6);
        assert.equal(McpToolResultRenderer.render([]), "");
    });
});

describe("to-nm-tool", () => {
    it("T-T2: name 走 slug、description 同步可得；外部工具入参不本地校验——任意对象甚至裸字符串原样传到 run", async () => {
        let received: { toolName?: string; args?: unknown } = {};
        const tool = McpToolAdapter.toNmTool(SNAPSHOT, {call: async (toolName, args) => {
            received = {toolName, args};
            return Result.ok({});
        }});
        assert.equal(tool.name, "mcp__db__query");
        const ctx = makeRecordingCtx().ctx;
        assert.equal(tool.description(ctx), "[MCP:db] 执行 SQL 查询");
        // 经 ToolRunner 走完整调用链：入参不做 zod 校验，原始值（含裸字符串）直达 run。
        const registry = new ToolRegistry<BuiltinToolContext>();
        registry.register(tool);
        const runner = new ToolRunner(registry);
        const weird = {sql: "SELECT 1", weird: [1, {x: null}]};
        unwrap(await runner.call("mcp__db__query", weird, ctx));
        assert.equal(received.args, weird);
        unwrap(await runner.call("mcp__db__query", "裸字符串也放行", ctx));
        assert.equal(received.args, "裸字符串也放行");
        assert.equal(received.toolName, "query");
    });

    it("T-T5: fromRegistry 对外部工具直接取 inputJsonSchema——模型侧与声明逐字段相等，不经 zod", () => {
        const inputSchema = {type: "object", properties: {sql: {type: "string", description: "要执行的 SQL"}, limit: {type: "integer", minimum: 1}}, required: ["sql"]};
        const registry = new ToolRegistry<BuiltinToolContext>();
        registry.register(McpToolAdapter.toNmTool({...SNAPSHOT, inputSchema}, {call: async () => Result.ok({})}));
        const def = ToolDefinitions.fromRegistry(registry, makeRecordingCtx().ctx)[0]?.inputSchema;
        assert.equal(def?.type, "object");
        assert.deepEqual(def?.required, ["sql"]);
        const limit = (def?.properties as Record<string, {type?: string; minimum?: number}>).limit;
        assert.equal(limit.type, "integer");
        assert.equal(limit.minimum, 1);
        // 与声明整对象深相等：不经 zod（转一遍会添 $schema、动键序），任何转换层都不许夹带私货。
        assert.deepEqual(def, inputSchema);
    });

    it("T-T6: server 未声明参数定义 → 模型侧为 {type:\"object\", properties:{}}", () => {
        const registry = new ToolRegistry<BuiltinToolContext>();
        registry.register(McpToolAdapter.toNmTool(SNAPSHOT, {call: async () => Result.ok({})}));
        assert.deepEqual(ToolDefinitions.fromRegistry(registry, makeRecordingCtx().ctx)[0]?.inputSchema, {type: "object", properties: {}});
    });

    it("T-T7: 声明含 not / if-then-else → 模型侧原样可见，不再回退为空", () => {
        for (const inputSchema of [{type: "object", properties: {a: {not: {type: "string"}}}}, {type: "object", properties: {a: {type: "string"}}, if: {properties: {a: {const: "x"}}}, then: {required: ["b"]}}]) {
            const registry = new ToolRegistry<BuiltinToolContext>();
            registry.register(McpToolAdapter.toNmTool({...SNAPSHOT, inputSchema}, {call: async () => Result.ok({})}));
            assert.deepEqual(ToolDefinitions.fromRegistry(registry, makeRecordingCtx().ctx)[0]?.inputSchema, inputSchema);
        }
    });

    it("T-M11: 成功 → render 全文 Result.ok；ctx.signal 原样透传给 call", async () => {
        const controller = new AbortController();
        let received: { toolName?: string; args?: unknown; signal?: AbortSignal } = {};
        const tool = McpToolAdapter.toNmTool(SNAPSHOT, {call: async (toolName, args, signal) => {
            received = {toolName, args, signal};
            return Result.ok({content: [{type: "text", text: "查询结果"}]});
        }});
        const output = unwrap(await tool.run({sql: "SELECT 1"}, {...makeRecordingCtx().ctx, signal: controller.signal} as never));
        assert.equal(output, "查询结果");
        assert.deepEqual(received, {toolName: "query", args: {sql: "SELECT 1"}, signal: controller.signal});
    });

    it("T-M11: isError: true → Result.err(TOOL_FAILED) 且 detail 含原文，不抛异常", async () => {
        const tool = McpToolAdapter.toNmTool(SNAPSHOT, {call: async () => Result.ok({isError: true, content: [{type: "text", text: "boom 原文"}]})});
        const error = unwrapErr(await tool.run({}, makeRecordingCtx().ctx));
        assert.equal(error.key, "TOOL_FAILED");
        assert.ok(error.message.startsWith("[MCP:db]"));
        assert.ok(error.message.includes("boom 原文"));
    });

    it("T-M11: 连接 / 协议失败 → TOOL_FAILED，detail 带前缀原文、cause 带 McpFailure", async () => {
        const failure: McpFailure = {kind: "server", action: "retry", detail: "gateway down"};
        const tool = McpToolAdapter.toNmTool(SNAPSHOT, {call: async () => Result.err(failure)});
        const error = unwrapErr(await tool.run({}, makeRecordingCtx().ctx));
        assert.equal(error.key, "TOOL_FAILED");
        assert.ok(error.message.startsWith("[MCP:db]"));
        assert.ok(error.message.includes("gateway down"));
        assert.equal(error.details?.cause, failure);
    });

    it("T-M11: 取消（callTool 以 Interrupt.cancelled 返回）→ TOOL_CANCELLED，不包成 TOOL_FAILED", async () => {
        const tool = McpToolAdapter.toNmTool(SNAPSHOT, {call: async () => ({kind: "cancelled", reason: "user-stop"})});
        const error = unwrapErr(await tool.run({}, makeRecordingCtx().ctx));
        assert.equal(error.key, "TOOL_CANCELLED");
    });

    it("call 通道的未知 reject 不再收编：契约违约沿 run reject 上行（由 ToolRunner.call 的 normalizeToolFailure 兜底）", async () => {
        const tool = McpToolAdapter.toNmTool(SNAPSHOT, {call: async () => { throw new Error("boom infra"); }});
        await assert.rejects(tool.run({}, makeRecordingCtx().ctx), /boom infra/);
    });

    it("T-M10/T-M11: 超 50KB 经 OverflowSink 落盘返回 savedPath；落盘失败回落字节截断", async () => {
        const big = "x".repeat(TOOL_OUTPUT_MAX_BYTES + 100);
        const tool = McpToolAdapter.toNmTool(SNAPSHOT, {call: async () => Result.ok({content: [{type: "text", text: big}]})});
        const recording = makeRecordingCtx();
        // ExternalTool.run 的成功值契约是 unknown；适配器实际产出渲染文本（本用例即断言其内容）。
        const output = unwrap(await tool.run({}, recording.ctx)) as string;
        assert.ok(output.includes("保存路径：/tmp/mcp__db__query-"), output);
        assert.equal(recording.files.size, 1);
        const [savedPath, savedContent] = [...recording.files.entries()][0]!;
        assert.ok(savedPath.startsWith("/tmp/mcp__db__query-"));
        assert.ok(savedPath.endsWith(".txt"));
        // 落盘的是截断前全文（sink 会按 300 字符折行排版，剥掉换行后应与原文逐字一致）
        assert.equal(savedContent.replace(/\n/g, ""), big, "落盘的是截断前全文");
        // 落盘失败（vfs.write throw）→ 字节截断降级，异常不冒出 run
        const failing = makeRecordingCtx();
        failing.setFail(true);
        const truncated = unwrap(await tool.run({}, failing.ctx)) as string;
        assert.ok(truncated.includes(`Output truncated (original ${TOOL_OUTPUT_MAX_BYTES + 100} bytes).`));
        assert.ok(truncated.length < big.length);
    });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { McpToolResultRenderer } from "../../src/domain/mcp/logic/render-mcp-tool-result.js";
import { McpToolAdapter } from "../../src/domain/mcp/logic/to-nm-tool.js";
import { AbortError } from "../../src/domain/abort/logic/create-abort-error.js";
import type { BuiltinToolContext } from "../../src/domain/tool/builtin/builtin-tool-context.js";
import { TOOL_OUTPUT_MAX_BYTES } from "../../src/domain/tool/logic/tool-output-limits.js";
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
    it("T-M11: name 走 slug、description 同步可得、inputSchema 接受任意对象", () => {
        const tool = McpToolAdapter.toNmTool(SNAPSHOT, {call: async () => Result.ok({})});
        assert.equal(tool.name, "mcp__db__query");
        const ctx = makeRecordingCtx().ctx;
        assert.equal(tool.description(ctx), "[MCP:db] 执行 SQL 查询");
        assert.ok(tool.inputSchema.safeParse({sql: "SELECT 1", weird: [1, {x: null}]}).success);
        assert.ok(tool.inputSchema.safeParse("裸字符串也放行").success);
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

    it("T-M11: 取消（AbortError reject）→ TOOL_CANCELLED，不包成 TOOL_FAILED", async () => {
        const tool = McpToolAdapter.toNmTool(SNAPSHOT, {call: async () => { throw AbortError.create(); }});
        const error = unwrapErr(await tool.run({}, makeRecordingCtx().ctx));
        assert.equal(error.key, "TOOL_CANCELLED");
    });

    it("未知异常收进 Err 且 cause 保留原文（runner 统一收口）", async () => {
        const tool = McpToolAdapter.toNmTool(SNAPSHOT, {call: async () => { throw new Error("boom infra"); }});
        const result = await tool.run({}, makeRecordingCtx().ctx);
        assert.ok(!result.ok, "未知异常应收进 Err");
        assert.equal(result.error.key, "TOOL_FAILED");
        assert.match((result.error.cause as Error).message, /boom infra/);
    });

    it("T-M10/T-M11: 超 50KB 经 OverflowSink 落盘返回 savedPath；落盘失败回落字节截断", async () => {
        const big = "x".repeat(TOOL_OUTPUT_MAX_BYTES + 100);
        const tool = McpToolAdapter.toNmTool(SNAPSHOT, {call: async () => Result.ok({content: [{type: "text", text: big}]})});
        const recording = makeRecordingCtx();
        const output = unwrap(await tool.run({}, recording.ctx));
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
        const truncated = unwrap(await tool.run({}, failing.ctx));
        assert.ok(truncated.includes(`Output truncated (original ${TOOL_OUTPUT_MAX_BYTES + 100} bytes).`));
        assert.ok(truncated.length < big.length);
    });
});

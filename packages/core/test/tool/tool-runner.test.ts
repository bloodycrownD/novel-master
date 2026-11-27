import {  AppErrorOps  } from "../../src/errors/app-error.js";
import {  Result  } from "../../src/errors/either.js";
import {  unwrap, rejectsErr  } from "../helpers/result-unwrap.js";
import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  z  } from "zod";
import {  ToolRegistry  } from "../../src/domain/tool/logic/tool-registry.js";
import {  ToolRunner  } from "../../src/domain/tool/logic/tool-runner.js";

describe("ToolRunner", () => {
    it("throws NOT_FOUND for missing tool", async () => {
        const registry = new ToolRegistry();
        const runner = new ToolRunner(registry);
        await rejectsErr(
            () => runner.call("no.such.tool", {}, {}),
            (e) => AppErrorOps.is(e, "TOOL_NOT_FOUND"),
        );
    });

    it("T-T1: 自带工具入参不合法 → TOOL_INVALID_ARGUMENT，带 issues（原有行为，防回归）", async () => {
        const registry = new ToolRegistry();
        registry.register({
            name: "test.sum",
            description: () => "sum",
            inputSchema: z.object({ a: z.number(), b: z.number() }),
            outputSchema: z.object({ sum: z.number() }),
            async run(input: { a: number; b: number }) {
                return { sum: input.a + input.b };
            },
        });
        const runner = new ToolRunner(registry);
        await rejectsErr(
            () => runner.call("test.sum", { a: 1 }, {}),
            (e) =>
                AppErrorOps.is(e) && e.key.startsWith("TOOL_") &&
                e.key === "TOOL_INVALID_ARGUMENT" &&
                e.details?.toolName === "test.sum" &&
                Array.isArray(e.details?.issues) && (e.details.issues as unknown[]).length > 0,
        );
    });

    it("T-T3: 外部工具没有 outputSchema → run 的成功值原样返回（不做 schema 校验）", async () => {
        const registry = new ToolRegistry();
        registry.register({
            name: "ext.weird",
            description: () => "external tool",
            inputJsonSchema: { type: "object", properties: {} },
            async run() {
                return Result.ok({ anything: [1, "two", { three: null }] });
            },
        });
        const runner = new ToolRunner(registry);
        const out = unwrap(await runner.call("ext.weird", { q: 1 }, {}));
        assert.deepEqual(out, { anything: [1, "two", { three: null }] });
    });

    it("wraps thrown errors as FAILED and preserves cause", async () => {
        const registry = new ToolRegistry();
        registry.register({
            name: "test.fail",
            description: () => "fail",
            inputSchema: z.object({}),
            async run() {
                throw new Error("boom");
            },
        });
        const runner = new ToolRunner(registry);
        // 工具闭包 throw（未知异常）经 normalizeToolFailure 收进 Err（与工具闭包 Err 同一出口）。
        const result = await runner.call("test.fail", {}, {});
        assert.ok(!result.ok, "工具闭包 throw 应收进 Err");
        const e = result.error;
        assert.ok(
            AppErrorOps.is(e) && e.key.startsWith("TOOL_") &&
            e.key === "TOOL_FAILED" &&
            e.details?.toolName === "test.fail" &&
            (e.cause as Error | undefined)?.message === "boom",
        );
    });

    it("fails when output violates schema", async () => {
        const registry = new ToolRegistry();
        registry.register({
            name: "test.badOutput",
            description: () => "bad output",
            inputSchema: z.object({}),
            outputSchema: z.object({ ok: z.literal(true) }),
            async run() {
                return { ok: false } as any;
            },
        });
        const runner = new ToolRunner(registry);
        await rejectsErr(
            () => runner.call("test.badOutput", {}, {}),
            (e) => AppErrorOps.is(e, "TOOL_FAILED"),
        );
    });
});


import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { ToolRegistry } from "../../src/domain/tool/tool-registry.js";
import { ToolRunner } from "../../src/domain/tool/tool-runner.js";
import { ToolError } from "../../src/domain/tool/tool-errors.js";

describe("ToolRunner", () => {
  it("throws NOT_FOUND for missing tool", async () => {
    const registry = new ToolRegistry();
    const runner = new ToolRunner(registry);
    await assert.rejects(
      () => runner.call("no.such.tool", {}, {}),
      (e) => e instanceof ToolError && e.code === "NOT_FOUND",
    );
  });

  it("validates input and throws INVALID_ARGUMENT", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "test.sum",
      description: "sum",
      inputSchema: z.object({ a: z.number(), b: z.number() }),
      outputSchema: z.object({ sum: z.number() }),
      async run(input) {
        return { sum: input.a + input.b };
      },
    });
    const runner = new ToolRunner(registry);
    await assert.rejects(
      () => runner.call("test.sum", { a: 1 }, {}),
      (e) =>
        e instanceof ToolError &&
        e.code === "INVALID_ARGUMENT" &&
        e.toolName === "test.sum" &&
        typeof e.details === "object",
    );
  });

  it("wraps thrown errors as FAILED and preserves cause", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "test.fail",
      description: "fail",
      inputSchema: z.object({}),
      async run() {
        throw new Error("boom");
      },
    });
    const runner = new ToolRunner(registry);
    await assert.rejects(
      () => runner.call("test.fail", {}, {}),
      (e) =>
        e instanceof ToolError &&
        e.code === "FAILED" &&
        e.toolName === "test.fail" &&
        (e.cause as Error | undefined)?.message === "boom",
    );
  });

  it("fails when output violates schema", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "test.badOutput",
      description: "bad output",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.literal(true) }),
      async run() {
        return { ok: false } as any;
      },
    });
    const runner = new ToolRunner(registry);
    await assert.rejects(
      () => runner.call("test.badOutput", {}, {}),
      (e) => e instanceof ToolError && e.code === "FAILED",
    );
  });
});


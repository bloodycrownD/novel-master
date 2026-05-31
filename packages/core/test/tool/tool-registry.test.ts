import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ToolRegistry } from "../../src/domain/tool/tool-registry.js";
import { ToolError } from "../../src/errors/tool-errors.js";
import { z } from "zod";

describe("ToolRegistry", () => {
  it("registers and resolves tools", () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "test.echo",
      description: "echo",
      inputSchema: z.object({ x: z.number() }),
      outputSchema: z.object({ x: z.number() }),
      async run(input) {
        return input;
      },
    });

    assert.deepEqual(registry.list(), ["test.echo"]);
    assert.ok(registry.get("test.echo"));
  });

  it("rejects duplicate registration", () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "dup",
      description: "dup",
      inputSchema: z.object({}),
      async run() {
        return null;
      },
    });
    assert.throws(
      () =>
        registry.register({
          name: "dup",
          description: "dup2",
          inputSchema: z.object({}),
          async run() {
            return null;
          },
        }),
      (e) => e instanceof ToolError && e.code === "CONFLICT" && e.toolName === "dup",
    );
  });

  it("unregisters tools", () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "x",
      description: "x",
      inputSchema: z.object({}),
      async run() {
        return null;
      },
    });
    assert.equal(registry.unregister("x"), true);
    assert.equal(registry.get("x"), undefined);
  });
});


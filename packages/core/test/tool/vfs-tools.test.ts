import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openVfsTestConnection } from "../vfs/helpers.js";
import { ToolRegistry } from "../../src/domain/tool/logic/tool-registry.js";
import { ToolRunner } from "../../src/domain/tool/logic/tool-runner.js";
import {
  registerVfsTools,
  type VfsToolContext,
} from "../../src/domain/tool/builtin/vfs-tools.js";
import { ToolError } from "../../src/errors/tool-errors.js";
import { VfsError } from "@novel-master/core";

describe("Builtin vfs.* tools (integration)", () => {
  it("write/replace/read flow", async () => {
    const { conn, vfs } = await openVfsTestConnection();
    const registry = new ToolRegistry<VfsToolContext>();
    registerVfsTools(registry);
    const runner = new ToolRunner(registry);

    const written = await runner.call<{ version: number }>(
      "vfs.write",
      { path: "/t.txt", content: "hello world" },
      { vfs },
    );
    assert.equal(written.version, 1);

    const replaced = await runner.call<{ version: number; replacements: number }>(
      "vfs.replace",
      { path: "/t.txt", oldString: "world", newString: "there" },
      { vfs },
    );
    assert.equal(replaced.replacements, 1);

    const read = await runner.call<{ content: string; version: number }>(
      "vfs.read",
      { path: "/t.txt" },
      { vfs },
    );
    assert.equal(read.content, "hello there");
    assert.equal(read.version, 2);
    await conn.close();
  });

  it("list/glob/grep flow", async () => {
    const { conn, vfs } = await openVfsTestConnection();
    await vfs.write("/docs/a.md", "# A");
    await vfs.write("/docs/b.txt", "plain");

    const registry = new ToolRegistry<VfsToolContext>();
    registerVfsTools(registry);
    const runner = new ToolRunner(registry);

    const listed = await runner.call<string[]>("vfs.list", { dir: "/docs" }, { vfs });
    assert.deepEqual(listed.sort(), ["/docs/a.md", "/docs/b.txt"].sort());

    const md = await runner.call<string[]>("vfs.glob", { pattern: "**/*.md" }, { vfs });
    assert.deepEqual(md, ["/docs/a.md"]);

    const hits = await runner.call<any[]>("vfs.grep", { pattern: "#" }, { vfs });
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.path, "/docs/a.md");
    assert.equal(hits[0]!.line, 1);
    await conn.close();
  });

  it("wraps VfsError as FAILED and preserves cause", async () => {
    const { conn, vfs } = await openVfsTestConnection();
    const registry = new ToolRegistry<VfsToolContext>();
    registerVfsTools(registry);
    const runner = new ToolRunner(registry);

    await assert.rejects(
      () => runner.call("vfs.read", { path: "/missing.txt" }, { vfs }),
      (e: unknown) => {
        assert.ok(e instanceof ToolError);
        assert.equal(e.code, "FAILED");
        assert.equal(e.toolName, "vfs.read");
        assert.ok(e.cause instanceof VfsError);
        assert.equal((e.cause as VfsError).code, "NOT_FOUND");
        return true;
      },
    );
    await conn.close();
  });
});


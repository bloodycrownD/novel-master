import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ToolError } from "../../src/errors/tool-errors.js";
import { VfsError } from "../../src/errors/vfs-errors.js";
import {
  buildToolResultBlock,
  resolveToolResultOk,
} from "../../src/domain/tool/logic/build-tool-result-block.js";

describe("buildToolResultBlock", () => {
  it("R1: success outcome sets ok true and formats content", () => {
    const block = buildToolResultBlock(
      "tu1",
      { ok: true, output: { version: 1 } },
      { toolName: "write" },
    );
    assert.equal(block.type, "tool_result");
    assert.equal(block.toolUseId, "tu1");
    assert.equal(block.ok, true);
    assert.equal(block.content, "ok");
    assert.equal(block.summary, "ok");
  });

  it("R1: error outcome sets ok false and Error: content", () => {
    const block = buildToolResultBlock("tu2", {
      ok: false,
      error: new ToolError("NOT_FOUND", "Path not found"),
    });
    assert.equal(block.ok, false);
    assert.ok(block.content.startsWith("Error:"));
    assert.ok(block.summary?.includes("Path not found"));
  });

  it("T-BTRB-01: error with vfsScope summary uses classified message", () => {
    // entry_id 化后 vfsError.path 已是逻辑路径（无物理前缀）
    const cause = new VfsError("NOT_FOUND", "Path not found: /f.txt", {
      path: "/f.txt",
    });
    const block = buildToolResultBlock(
      "tu4",
      {
        ok: false,
        error: new ToolError("FAILED", "Tool failed: read", { cause }),
      },
      {
        toolName: "read",
        vfsScope: { kind: "session", projectId: "p", sessionId: "s" },
      },
    );
    assert.ok(block.summary?.includes("[NOT_FOUND]"));
    assert.ok(block.summary?.includes("/f.txt"));
    assert.ok(!block.summary?.includes("/projects/"));
  });

  it("R2: read output with terrors in body stays ok true", () => {
    const ravenSnippet =
      "Thrilled me—filled me with fantastic terrors never felt before;";
    const block = buildToolResultBlock(
      "tu3",
      {
        ok: true,
        output: {
          path: "/poem.txt",
          content: ravenSnippet,
          returnedLines: 30,
          totalLines: 30,
          truncated: false,
        },
      },
      { toolName: "read" },
    );
    assert.equal(block.ok, true);
    assert.ok(block.content.includes("terrors"));
    assert.equal(block.summary, "30 lines");
    assert.equal(resolveToolResultOk(block), true);
  });

  it("BTRB-FMT-01: read/grep/glob content uses readable formatters", () => {
    const readBlock = buildToolResultBlock(
      "tu-read",
      {
        ok: true,
        output: {
          path: "/a.md",
          content: "hello",
          offset: 1,
          limit: 2000,
          totalLines: 1,
          returnedLines: 1,
          truncated: false,
        },
      },
      { toolName: "read" },
    );
    assert.equal(readBlock.content, "     1|hello");

    const grepBlock = buildToolResultBlock(
      "tu-grep",
      {
        ok: true,
        output: {
          matches: [
            { path: "/x.ts", line: 2, column: 4, excerpt: "needle" },
          ],
          total: 1,
          truncated: false,
        },
      },
      { toolName: "grep" },
    );
    assert.equal(grepBlock.content, "/x.ts:2:4: needle");

    const globBlock = buildToolResultBlock(
      "tu-glob",
      {
        ok: true,
        output: {
          paths: ["/a.ts", "/b.ts"],
          total: 2,
          truncated: false,
        },
      },
      { toolName: "glob" },
    );
    assert.equal(globBlock.content, "/a.ts\n/b.ts");
  });

  it("T-SK8: skill read 成功输出自动检测透传 meta.skillRef（含 skillProjectId）", () => {
    const block = buildToolResultBlock(
      "tu-skill",
      {
        ok: true,
        output: {
          action: "read",
          domain: "project",
          name: "demo",
          path: "SKILL.md",
          content: "---\nname: demo\n---",
          version: 1,
          offset: 1,
          limit: 2000,
          totalLines: 3,
          returnedLines: 3,
          truncated: false,
        },
      },
      { toolName: "skill", skillProjectId: "proj-1" },
    );
    assert.equal(block.ok, true);
    assert.deepEqual(block.meta?.skillRef, {
      domain: "project",
      projectId: "proj-1",
      name: "demo",
    });
  });

  it("T-SK8: skill load 成功输出也透传 meta.skillRef，摘要含文件数", () => {
    const block = buildToolResultBlock(
      "tu-skill-load",
      {
        ok: true,
        output: {
          action: "load",
          domain: "project",
          name: "demo",
          path: "SKILL.md",
          content: "# 演示",
          version: 1,
          files: ["references/x.md", "assets/tpl.txt"],
          truncated: false,
        },
      },
      { toolName: "skill", skillProjectId: "proj-1" },
    );
    assert.equal(block.ok, true);
    assert.deepEqual(block.meta?.skillRef, {
      domain: "project",
      projectId: "proj-1",
      name: "demo",
    });
    assert.equal(block.summary, "project:demo · 2 files");
  });

  it("T-SK8: skill write 输出也透传（global 域不带 projectId）", () => {
    const block = buildToolResultBlock(
      "tu-skill-w",
      {
        ok: true,
        output: { action: "write", domain: "global", name: "demo", path: "SKILL.md", version: 2 },
      },
      { toolName: "skill", skillProjectId: "proj-1" },
    );
    assert.deepEqual(block.meta?.skillRef, { domain: "global", name: "demo" });
  });

  it("T-SK8: 非 skill 工具同形态输出不透传 skillRef", () => {
    // domain/name 字段撞名的输出（如未来工具）不应误命中：工具名门控兜底
    const block = buildToolResultBlock(
      "tu-other",
      {
        ok: true,
        output: { action: "read", domain: "project", name: "demo" },
      },
      { toolName: "read", skillProjectId: "proj-1" },
    );
    assert.equal(block.meta?.skillRef, undefined);
  });

  it("T-SK8: skill 失败 outcome 不透传 skillRef", () => {
    const block = buildToolResultBlock("tu-skill-e", {
      ok: false,
      error: new ToolError("NOT_FOUND", "Skill not found"),
    });
    assert.equal(block.meta?.skillRef, undefined);
  });
});

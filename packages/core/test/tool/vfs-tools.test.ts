import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ToolRegistry } from "../../src/domain/tool/logic/tool-registry.js";
import { ToolRunner } from "../../src/domain/tool/logic/tool-runner.js";
import {
  isMutatingFileToolName,
  MUTATING_FILE_TOOL_NAMES,
} from "../../src/domain/tool/builtin/vfs-tools.js";
import { registerBuiltinTools } from "../../src/domain/tool/builtin/register-builtin-tools.js";
import type { BuiltinToolContext } from "../../src/domain/tool/builtin/builtin-tool-context.js";
import { createWorkplaceService } from "../../src/service/workplace/create-workplace-service.js";
import { ToolError } from "../../src/errors/tool-errors.js";
import { isVfsError } from "@novel-master/core/vfs";
import { TOOL_OUTPUT_MAX_LINES, TOOL_OUTPUT_MAX_MATCHES } from "../../src/domain/tool/logic/tool-output-limits.js";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";

function toolCtx(
  vfs: BuiltinToolContext["vfs"],
  projectId: string,
  sessionId: string,
): BuiltinToolContext {
  return {
    vfs,
    projectId,
    sessionId,
    listSessionMessages: async () => [],
  };
}

describe("Builtin file tools V2 (unit)", () => {
  it("legacy replace tool name is NOT_FOUND", async () => {
    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const runner = new ToolRunner(registry);
    await assert.rejects(
      () => runner.call("replace", { path: "/t.txt", oldString: "a", newString: "b" }, {} as BuiltinToolContext),
      (e: unknown) => e instanceof ToolError && e.code === "NOT_FOUND",
    );
  });

  it("registers exactly 8 builtin tools via registerBuiltinTools", () => {
    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    assert.equal(registry.list().length, 8);
    assert.ok(registry.list().includes("task"));
    assert.ok(registry.list().includes("skill"));
  });

  it("mutating tool names include write/edit/fs only", () => {
    assert.deepEqual([...MUTATING_FILE_TOOL_NAMES].sort(), [
      "edit",
      "fs",
      "write",
    ]);
    assert.equal(isMutatingFileToolName("read"), false);
    assert.equal(isMutatingFileToolName("glob"), false);
    assert.equal(isMutatingFileToolName("grep"), false);
    assert.equal(isMutatingFileToolName("fs"), true);
  });

  it("write 相对路径规范化后统一写入与 file_cache，不报 INVALID_PATH", async () => {
    const writes: Array<{ path: string; content: string }> = [];
    const kkvSets: Array<{ key: string; value: string }> = [];
    const vfs = {
      write: async (path: string, content: string) => {
        writes.push({ path, content });
        return { version: 1 };
      },
    } as unknown as BuiltinToolContext["vfs"];
    const sessionKkv = {
      set: async (_sid: string, _domain: string, key: string, value: string) => {
        kkvSets.push({ key, value });
      },
    } as unknown as BuiltinToolContext["sessionKkv"];
    const ctx: BuiltinToolContext = {
      ...toolCtx(vfs, "p", "s"),
      sessionKkv,
    };
    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const runner = new ToolRunner(registry);

    const result = await runner.call<{ version: number }>(
      "write",
      { path: "drafts/a.md", content: "hi" },
      ctx,
    );
    assert.equal(result.version, 1);
    // vfs.write 收到规范化后的绝对路径
    assert.equal(writes[0].path, "/drafts/a.md");
    // file_cache key 用同一规范路径，不再抛 INVALID_PATH
    assert.equal(kkvSets[0].key, "full:/drafts/a.md");
  });

  it("write 嵌套新路径各层祖先目录补默认规则，已有 rule_off 行不覆盖", async () => {
    const vfs = {
      write: async () => ({ version: 1 }),
    } as unknown as BuiltinToolContext["vfs"];
    const setCalls: Array<{ logicalPath: string }> = [];
    const workplace = {
      // "/off" 预置一条 rule_off 行：已有行不应被覆盖
      getDirRule: async (logicalPath: string) =>
        logicalPath === "/off"
          ? { scopeKey: "session:s", logicalPath, ruleEnabled: false }
          : undefined,
      setDirRule: async (input: { logicalPath: string }) => {
        setCalls.push({ logicalPath: input.logicalPath });
      },
    };
    const ctx: BuiltinToolContext = {
      ...toolCtx(vfs, "p", "s"),
      workplace,
    };
    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const runner = new ToolRunner(registry);

    // 全新嵌套路径：各层祖先（跳过根、不含文件自身）都补上默认规则
    await runner.call("write", { path: "x/y/z/n.md", content: "hi" }, ctx);
    assert.deepEqual(setCalls, [
      { logicalPath: "/x" },
      { logicalPath: "/x/y" },
      { logicalPath: "/x/y/z" },
    ]);

    // 已有 rule_off 行的层级不覆盖，只补后面的新层级
    setCalls.length = 0;
    await runner.call("write", { path: "off/deeper/a.md", content: "hi" }, ctx);
    assert.deepEqual(setCalls, [{ logicalPath: "/off/deeper" }]);
  });

  it("fs mkdir 为新目录及其祖先补默认规则", async () => {
    const vfs = {
      mkdir: async () => {},
    } as unknown as BuiltinToolContext["vfs"];
    const setCalls: Array<{ logicalPath: string }> = [];
    const workplace = {
      getDirRule: async () => undefined,
      setDirRule: async (input: { logicalPath: string }) => {
        setCalls.push({ logicalPath: input.logicalPath });
      },
    };
    const ctx: BuiltinToolContext = {
      ...toolCtx(vfs, "p", "s"),
      workplace,
    };
    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const runner = new ToolRunner(registry);

    await runner.call("fs", { action: "mkdir", path: "m/n" }, ctx);
    // mkdir 自身也是新目录：连同祖先一起补
    assert.deepEqual(setCalls, [
      { logicalPath: "/m" },
      { logicalPath: "/m/n" },
    ]);
  });
});

novelMasterTestFixture();

describe("Builtin file tools V2 (integration)", () => {
  it("write/edit/read flow via revision-aware vfs", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    const written = await runner.call<{ version: number }>(
      "write",
      { path: "/t.txt", content: "hello world" },
      baseCtx,
    );
    assert.equal(written.version, 1);

    const edited = await runner.call<{ version: number; replacements: number }>(
      "edit",
      { path: "/t.txt", oldString: "world", newString: "there" },
      baseCtx,
    );
    assert.equal(edited.replacements, 1);

    const read = await runner.call<{ content: string; version: number }>(
      "read",
      { path: "/t.txt" },
      baseCtx,
    );
    assert.equal(read.content, "hello there");
    assert.equal(read.version, 2);
  });

  it("write without options overwrites an existing file", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    await runner.call("write", { path: "/t.txt", content: "v1" }, baseCtx);
    await runner.call("write", { path: "/t.txt", content: "v2" }, baseCtx);
    const read = await runner.call<{ content: string }>(
      "read",
      { path: "/t.txt" },
      baseCtx,
    );
    assert.equal(read.content, "v2");
  });

  it("vfs.write respects versionCheck and expectedVersion options", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    await runner.call("write", { path: "/t.txt", content: "v1" }, baseCtx);
    const second = await runner.call<{ version: number }>(
      "write",
      {
        path: "/t.txt",
        content: "v2",
        options: { expectedVersion: 1, versionCheck: true },
      },
      baseCtx,
    );
    assert.equal(second.version, 2);

    await assert.rejects(
      () =>
        runner.call(
          "write",
          {
            path: "/t.txt",
            content: "stale",
            options: { expectedVersion: 1, versionCheck: true },
          },
          baseCtx,
        ),
      (e: unknown) => e instanceof ToolError && e.code === "FAILED",
    );
  });

  it("fs ls/glob/grep flow", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/docs/a.md", "# A");
    await vfs.write("/docs/b.txt", "plain");

    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    const listed = await runner.call<{
      entries: Array<{ path: string; kind: string }>;
      total: number;
      truncated: boolean;
    }>("fs", { action: "ls", path: "/docs" }, baseCtx);
    const paths = listed.entries.map((e) => e.path).sort();
    assert.deepEqual(paths, ["/docs/a.md", "/docs/b.txt"].sort());

    const md = await runner.call<{ paths: string[] }>(
      "glob",
      { pattern: "**/*.md" },
      baseCtx,
    );
    assert.deepEqual(md.paths, ["/docs/a.md"]);

    const hits = await runner.call<{ matches: any[] }>(
      "grep",
      { pattern: "#" },
      baseCtx,
    );
    assert.equal(hits.matches.length, 1);
    assert.equal(hits.matches[0]!.path, "/docs/a.md");
  });

  it("fs mkdir creates directory visible in ls", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    await runner.call("fs", { action: "mkdir", path: "/agent-dir" }, baseCtx);
    const listed = await runner.call<{
      entries: Array<{ path: string; kind: string }>;
    }>("fs", { action: "ls", path: "/" }, baseCtx);
    assert.ok(
      listed.entries.some((e) => e.path === "/agent-dir" && e.kind === "directory"),
    );
  });

  it("fs rm without -r recursively deletes non-empty directory", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.mkdir("/dir");
    await vfs.write("/dir/a.txt", "gone");

    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    await runner.call("fs", { action: "rm", path: "/dir" }, baseCtx);
    await assert.rejects(
      () => vfs.read("/dir/a.txt"),
      (e: unknown) => isVfsError(e, "NOT_FOUND"),
    );
  });

  it("fs rm -r removes directory tree", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.mkdir("/dir");
    await vfs.write("/dir/a.txt", "gone");

    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    await runner.call("fs", { action: "rm", path: "/dir", recursive: true }, baseCtx);
    await assert.rejects(
      () => vfs.read("/dir/a.txt"),
      (e: unknown) => isVfsError(e, "NOT_FOUND"),
    );
  });

  it("fs mv migrates file content", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/old.md", "body");

    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    await runner.call("fs", { action: "mv", from: "/old.md", to: "/new.md" }, baseCtx);
    assert.equal((await vfs.read("/new.md")).content, "body");
    await assert.rejects(
      () => vfs.read("/old.md"),
      (e: unknown) => isVfsError(e, "NOT_FOUND"),
    );
  });

  it("fs cp duplicates file and keeps source", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/src/x.md", "x");

    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    await runner.call("fs", { action: "cp", from: "/src/x.md", to: "/dst/x.md" }, baseCtx);
    assert.equal((await vfs.read("/src/x.md")).content, "x");
    assert.equal((await vfs.read("/dst/x.md")).content, "x");
  });

  it("fs cp -r duplicates directory tree", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.mkdir("/src");
    await vfs.write("/src/x.md", "x");

    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    await runner.call("fs", { action: "cp", from: "/src", to: "/dst", recursive: true }, baseCtx);
    assert.equal((await vfs.read("/src/x.md")).content, "x");
    assert.equal((await vfs.read("/dst/x.md")).content, "x");
  });

  it("T4: read 5000 lines defaults to 2000 with truncated and nextOffset", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const content = Array.from({ length: 5000 }, (_, i) => `line-${i + 1}`).join("\n");
    await vfs.write("/big.txt", content);

    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    const read = await runner.call<{
      truncated: boolean;
      returnedLines: number;
      nextOffset?: number;
      totalLines: number;
    }>("read", { path: "/big.txt" }, baseCtx);

    assert.equal(read.totalLines, 5000);
    assert.equal(read.returnedLines, TOOL_OUTPUT_MAX_LINES);
    assert.equal(read.truncated, true);
    assert.equal(read.nextOffset, TOOL_OUTPUT_MAX_LINES + 1);
  });

  it("fs rm removes a file", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/a.txt", "gone");

    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    await runner.call("fs", { action: "rm", path: "/a.txt" }, baseCtx);
    await assert.rejects(
      () => runner.call("read", { path: "/a.txt" }, baseCtx),
      (e: unknown) => e instanceof ToolError && e.code === "FAILED",
    );
  });

  it("T5: read offset out of bounds returns error", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/small.txt", "one\n two");

    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    await assert.rejects(
      () => runner.call("read", { path: "/small.txt", offset: 100 }, baseCtx),
      (e: unknown) => e instanceof ToolError && e.code === "INVALID_ARGUMENT",
    );
  });

  it("T5: read truncates long lines", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/long.txt", "a".repeat(3000));

    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    const read = await runner.call<{ content: string }>(
      "read",
      { path: "/long.txt" },
      baseCtx,
    );
    assert.ok(read.content.includes("line truncated"));
  });

  it("T6: grep and glob truncate beyond 100 matches", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    for (let i = 0; i < 120; i++) {
      await vfs.write(`/m-${i}.txt`, "needle here");
    }

    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    const grep = await runner.call<{ total: number; truncated: boolean; matches: unknown[] }>(
      "grep",
      { pattern: "needle" },
      baseCtx,
    );
    assert.equal(grep.total, 120);
    assert.equal(grep.truncated, true);
    assert.equal(grep.matches.length, TOOL_OUTPUT_MAX_MATCHES);

    const glob = await runner.call<{ total: number; truncated: boolean; paths: string[] }>(
      "glob",
      { pattern: "**/m-*.txt" },
      baseCtx,
    );
    assert.equal(glob.total, 120);
    assert.equal(glob.truncated, true);
    assert.equal(glob.paths.length, TOOL_OUTPUT_MAX_MATCHES);
  });

  it("wraps VfsError as FAILED and preserves cause", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    await assert.rejects(
      () => runner.call("read", { path: "/missing.txt" }, baseCtx),
      (e: unknown) => {
        assert.ok(e instanceof ToolError);
        assert.equal(e.code, "FAILED");
        assert.equal(e.toolName, "read");
        assert.ok(isVfsError(e.cause, "NOT_FOUND"));
        return true;
      },
    );
  });

  it("write/mkdir 对接真实 workplace 服务：新层级规则 on、rule_off 不覆盖", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const workplace = createWorkplaceService(ctx.conn, {
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });

    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx: BuiltinToolContext = {
      ...toolCtx(vfs, project.id, session.id),
      workplace,
    };

    // 预置一条 rule_off：write 补规则时不应覆盖
    await workplace.setDirRule({ logicalPath: "/w", ruleEnabled: false });

    await runner.call("write", { path: "/w/x/y/a.md", content: "hi" }, baseCtx);
    assert.equal((await workplace.getDirRule("/w"))?.ruleEnabled, false);
    assert.equal((await workplace.getDirRule("/w/x"))?.ruleEnabled, true);
    assert.equal((await workplace.getDirRule("/w/x/y"))?.ruleEnabled, true);

    // 真实 VFS 的 mkdir 不递归：逐层创建，每层都应补上默认规则
    await runner.call("fs", { action: "mkdir", path: "/m" }, baseCtx);
    await runner.call("fs", { action: "mkdir", path: "/m/n" }, baseCtx);
    assert.equal((await workplace.getDirRule("/m"))?.ruleEnabled, true);
    assert.equal((await workplace.getDirRule("/m/n"))?.ruleEnabled, true);
  });
});

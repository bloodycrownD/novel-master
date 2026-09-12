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
import { createSessionKkvService } from "../../src/service/session-kkv/create-session-kkv-service.js";
import { vfsNotFound } from "../../src/errors/vfs-errors.js";
import { ToolError } from "../../src/errors/tool-errors.js";
import { isVfsError } from "@novel-master/core/vfs";
import {
  TOOL_OUTPUT_MAX_BYTES,
  TOOL_OUTPUT_MAX_LINES,
  TOOL_OUTPUT_MAX_MATCHES,
} from "../../src/domain/tool/logic/tool-output-limits.js";
import { formatToolOutputForLlm } from "../../src/domain/tool/logic/format-tool-output.js";
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

  it("registers exactly 11 builtin tools via registerBuiltinTools", () => {
    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    assert.equal(registry.list().length, 11);
    assert.ok(registry.list().includes("task"));
    assert.ok(registry.list().includes("skill"));
    assert.ok(registry.list().includes("agent"));
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
      // B-1：write 前用 vfs.read 探测存在性——NOT_FOUND 即新建
      read: async (path: string) => {
        throw vfsNotFound(path);
      },
      write: async () => ({ version: 1 }),
    } as unknown as BuiltinToolContext["vfs"];
    const setCalls: Array<{ logicalPath: string }> = [];
    const workplace = {
      getDirRule: async () => undefined,
      // 预置 "/off" 一条 rule_off 行：已有行不应被覆盖
      listDirRules: async () => [
        { scopeKey: "session:s", logicalPath: "/off", ruleEnabled: false },
      ],
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
      listDirRules: async () => [],
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

  it("write 编辑已有文件不补父链规则（B-1：仅新建补）", async () => {
    const writes: Array<{ path: string; content: string }> = [];
    const vfs = {
      // read 探测到内容 → 已存在 → 走纯编辑路径，不补规则
      read: async (path: string) => ({
        path,
        content: "old",
        version: 1,
        mtimeMs: 0,
      }),
      write: async (path: string, content: string) => {
        writes.push({ path, content });
        return { version: 2 };
      },
    } as unknown as BuiltinToolContext["vfs"];
    const setCalls: Array<{ logicalPath: string }> = [];
    const workplace = {
      getDirRule: async () => undefined,
      listDirRules: async () => [],
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

    const result = await runner.call<{ version: number }>(
      "write",
      { path: "/e/f/g/a.md", content: "new" },
      ctx,
    );
    assert.equal(result.version, 2);
    assert.deepEqual(writes, [{ path: "/e/f/g/a.md", content: "new" }]);
    // 编辑已有文件：祖先目录一条规则都不补
    assert.deepEqual(setCalls, []);
  });

  it("write 前探测失败时保守跳过补规则（B-1：宁可少补、不可误翻存量）", async () => {
    const vfs = {
      // 探测原语自身抛错（非 NOT_FOUND）→ 保守视作已存在
      read: async () => {
        throw new Error("probe boom");
      },
      write: async () => ({ version: 1 }),
    } as unknown as BuiltinToolContext["vfs"];
    const setCalls: Array<{ logicalPath: string }> = [];
    const workplace = {
      getDirRule: async () => undefined,
      listDirRules: async () => [],
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

    // write 主流程不受探测失败影响，但补规则被保守跳过
    const result = await runner.call<{ version: number }>(
      "write",
      { path: "/p/q/a.md", content: "hi" },
      ctx,
    );
    assert.equal(result.version, 1);
    assert.deepEqual(setCalls, []);
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

  it("vfs.write 不再暴露版本参数：传入 options 被忽略，重复写 last-write-wins", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    await runner.call("write", { path: "/t.txt", content: "v1" }, baseCtx);
    // 旧调用方（或 LLM 顺手）多传的 options 字段被 schema 剥离，不报错、不启校验。
    const second = await runner.call<{ version: number }>(
      "write",
      {
        path: "/t.txt",
        content: "v2",
        options: { expectedVersion: 1, versionCheck: true },
      } as never,
      baseCtx,
    );
    assert.equal(second.version, 2);

    const third = await runner.call<{ version: number }>(
      "write",
      { path: "/t.txt", content: "stale" },
      baseCtx,
    );
    assert.equal(third.version, 3);
    assert.equal((await vfs.read("/t.txt")).content, "stale");
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

  it("T5: read 中等单行（3000 字符 < 50KB）完整返回，不再按 2000 字符截行", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/long.txt", "a".repeat(3000));

    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    const read = await runner.call<{ content: string; truncated: boolean }>(
      "read",
      { path: "/long.txt" },
      baseCtx,
    );
    // 旧行为（truncateLine 2000 字符 + 后缀）已废：3000 字符单行在 50KB
    // 预算内完整返回，无截断标记。
    assert.equal(read.content, "a".repeat(3000));
    assert.equal(read.truncated, false);
    assert.ok(!read.content.includes("line truncated"));
  });

  it("T-R1: read 单行 300KB 文件返回 50KB 预算内前缀（不再是 2000 字符），末行截断不可续读", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    // 单行 300KB：旧行为（truncateLine 2000 字符）只回 2000 字符，
    // 新行为按 50KB 单一预算尽量填满、末行截到预算点。
    await vfs.write("/long-oneline.txt", "a".repeat(300 * 1024));

    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    const read = await runner.call<{
      content: string;
      truncated: boolean;
      lastLineTruncated?: boolean;
      nextOffset?: number;
      returnedLines: number;
      totalLines: number;
    }>("read", { path: "/long-oneline.txt" }, baseCtx);

    assert.equal(read.totalLines, 1);
    assert.equal(read.returnedLines, 1);
    // 预算内前缀：远超旧行为的 2000 字符（'a' 1 字节/字符，51200 字符
    // 即 50KB 预算填满），且 ≤ 50KB（UTF-8 字节口径）。
    assert.ok(read.content.length > 50_000, `前缀应尽量填满预算: ${read.content.length}`);
    assert.ok(
      new TextEncoder().encode(read.content).byteLength <= TOOL_OUTPUT_MAX_BYTES
    );
    assert.ok(read.content.startsWith("aaaa"));
    assert.equal(read.truncated, true);
    assert.equal(read.lastLineTruncated, true);
    // 被截行是文件末行：跳过后无剩余内容，不给 nextOffset（避免续读超界）。
    assert.equal(read.nextOffset, undefined);
    // formatter 提示注明末行截断、尾部不可续读。
    const formatted = formatToolOutputForLlm(read);
    assert.match(formatted, /tail is not resumable/);
  });

  it("T-R1: 多行超预算文件跨行填满预算，nextOffset 跳过被截的末行", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    // 9 行 × 10KB('b') + 1 行 100KB('c') + 1 行 'd'。每行 10240B：
    // 行 1-4 累计 40963B，行 5（40963+1+10240=51204）超 51200 预算 →
    // 截断为 10236B 前缀（仍以 'b' 开头）。
    const lines: string[] = [];
    for (let i = 0; i < 9; i++) lines.push("b".repeat(10 * 1024));
    lines.push("c".repeat(100 * 1024));
    lines.push("d-line");
    await vfs.write("/multi-big.txt", lines.join("\n"));

    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    const read = await runner.call<{
      content: string;
      truncated: boolean;
      lastLineTruncated?: boolean;
      nextOffset?: number;
      returnedLines: number;
      totalLines: number;
    }>("read", { path: "/multi-big.txt" }, baseCtx);

    assert.equal(read.totalLines, 11);
    assert.equal(read.truncated, true);
    assert.equal(read.lastLineTruncated, true);
    // 4 行完整 10KB + 第 5 行截断前缀（仍以 'b' 开头，末尾无换行）。
    assert.equal(read.returnedLines, 5);
    assert.ok(read.content.endsWith("b"));
    assert.ok(
      new TextEncoder().encode(read.content).byteLength <= TOOL_OUTPUT_MAX_BYTES
    );
    // nextOffset 跳过被截的末行（offset + returnedLines = 6，从第 6 行续读，
    // 不是同一行——重读被截行会因预算不变再次截断，死循环）。
    assert.equal(read.nextOffset, 6);
    // 续读一：第 6-9 行完整 + 第 10 行('c' 100KB 单行)截断前缀。
    const next = await runner.call<{ content: string; nextOffset?: number }>(
      "read",
      { path: "/multi-big.txt", offset: 6 },
      baseCtx,
    );
    assert.ok(next.content.startsWith("bbbb"));
    assert.ok(next.content.endsWith("c"));
    // 续读二：跳过被截的 'c' 行，从第 11 行 'd' 起（预算重置可整行读出）。
    const final = await runner.call<{ content: string }>(
      "read",
      { path: "/multi-big.txt", offset: 11 },
      baseCtx,
    );
    assert.equal(final.content, "d-line");
  });

  it("T-R1: 多行正常文件（<50KB，行 ≤2000 字符）输出与旧行为一致（快照对照）", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const content = Array.from({ length: 100 }, (_, i) => `第${i + 1}行内容`.padEnd(20, "字")).join("\n");
    await vfs.write("/normal.txt", content);

    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    const read = await runner.call<{
      content: string;
      truncated: boolean;
      returnedLines: number;
      totalLines: number;
      lastLineTruncated?: boolean;
    }>("read", { path: "/normal.txt" }, baseCtx);

    // 全量返回：content 与原文一致、无任何截断标记（与旧行为快照一致）。
    assert.equal(read.content, content);
    assert.equal(read.truncated, false);
    assert.equal(read.lastLineTruncated, undefined);
    assert.equal(read.returnedLines, 100);
    assert.equal(read.totalLines, 100);
  });

  it("T-R2: 普通文件不变——5000 行大文件仍按行数帽分页（旧行为快照）", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const content = Array.from({ length: 5000 }, (_, i) => `line-${i + 1}`).join("\n");
    await vfs.write("/big-t-r2.txt", content);

    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx = toolCtx(vfs, project.id, session.id);

    const read = await runner.call<{
      truncated: boolean;
      returnedLines: number;
      nextOffset?: number;
      lastLineTruncated?: boolean;
    }>("read", { path: "/big-t-r2.txt" }, baseCtx);

    assert.equal(read.returnedLines, TOOL_OUTPUT_MAX_LINES);
    assert.equal(read.truncated, true);
    assert.equal(read.nextOffset, TOOL_OUTPUT_MAX_LINES + 1);
    // 行数帽路径不产生末行截断标记。
    assert.equal(read.lastLineTruncated, undefined);
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

  it("T-G3: 超 50KB 响应经 curl 落盘真实 VFS：/tmp 首建目录 + file_cache + 目录规则 + read 分页读回全文", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const workplace = createWorkplaceService(ctx.conn, {
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });
    const sessionKkv = createSessionKkvService(ctx.conn);

    // 行长 1023B：页 1 的 50 行 + 分隔符恰好耗尽 50KB 预算
    //（50×1023+50=51200，末行 remaining=0 整行丢弃而非部分截断），
    // 续读 nextOffset 指回被丢弃行、预算重置整行读出——分页拼回全文
    // 无丢失，不碰「被截行尾部不可续读」路径。
    const line = "x".repeat(1023);
    const body = Array.from({ length: 62 }, () => line).join("\n");
    // 62×1023+61 = 63487B > 50KB，触发 curl 落盘保险丝。
    const fetchFn = (async () =>
      new Response(body, {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as typeof globalThis.fetch;

    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx: BuiltinToolContext = {
      ...toolCtx(vfs, project.id, session.id),
      workplace,
      sessionKkv,
      fetchFn,
    };

    const out = await runner.call(
      "curl",
      { url: "https://example.com/big" },
      baseCtx,
    );
    const rec = out as {
      body: string;
      truncated: boolean;
      originalBytes: number;
      savedPath?: string;
    };
    // 落盘形态：body 置空占位、savedPath 指向 /tmp 下真实 VFS 文件。
    assert.equal(rec.truncated, true);
    assert.equal(rec.body, "");
    assert.equal(rec.originalBytes, 63487);
    assert.ok(
      rec.savedPath != null &&
        /^\/tmp\/curl-\d{8}-[0-9a-f]{4}\.html$/.test(rec.savedPath),
      `savedPath 形状不对: ${rec.savedPath}`
    );

    // /tmp 首次建目录：文件在真实 VFS 存在且全文一致。
    const saved = await vfs.read(rec.savedPath!);
    assert.equal(saved.content, body);

    // 配套动作一：file_cache upsert（同会话后续 read 免重读盘）。
    assert.ok(
      (await sessionKkv.listKeys(session.id, "file_cache")).includes(
        `full:${rec.savedPath}`
      )
    );
    // 配套动作二：/tmp 目录链补默认规则（rule_on）。
    assert.equal((await workplace.getDirRule("/tmp"))?.ruleEnabled, true);

    // read 工具分页读回：页 1（行 1-50）+ 页 2（行 51-62）拼回全文。
    const page1 = await runner.call<{
      content: string;
      truncated: boolean;
      lastLineTruncated?: boolean;
      nextOffset?: number;
    }>("read", { path: rec.savedPath! }, baseCtx);
    assert.equal(page1.truncated, true);
    // 预算恰耗尽 → 末行整行丢弃，不是部分截断。
    assert.equal(page1.lastLineTruncated, undefined);
    assert.equal(page1.nextOffset, 51);
    const page2 = await runner.call<{ content: string; truncated: boolean }>(
      "read",
      { path: rec.savedPath!, offset: 51 },
      baseCtx,
    );
    assert.equal(page2.truncated, false);
    assert.equal(`${page1.content}\n${page2.content}`, body);
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

  it("write 编辑已有文件祖先目录仍无规则行；同树新建才补父链（B-1）", async () => {
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

    // 预置：直写 vfs（不经工具）造已有文件，祖先目录均无 dir_rule 行
    await vfs.write("/e/f/g/a.md", "v1");
    assert.equal(await workplace.getDirRule("/e"), undefined);
    assert.equal(await workplace.getDirRule("/e/f"), undefined);
    assert.equal(await workplace.getDirRule("/e/f/g"), undefined);

    // 编辑：经工具 write 同一路径，内容更新但祖先目录仍无规则行
    const edited = await runner.call<{ version: number }>(
      "write",
      { path: "/e/f/g/a.md", content: "v2" },
      baseCtx,
    );
    assert.ok(edited.version >= 2);
    assert.equal((await vfs.read("/e/f/g/a.md")).content, "v2");
    assert.equal(await workplace.getDirRule("/e"), undefined);
    assert.equal(await workplace.getDirRule("/e/f"), undefined);
    assert.equal(await workplace.getDirRule("/e/f/g"), undefined);

    // 同树新建：父链各层补上 rule_on（现有行为回归保护）
    await runner.call(
      "write",
      { path: "/e/f/h/b.md", content: "hi" },
      baseCtx,
    );
    assert.equal((await workplace.getDirRule("/e"))?.ruleEnabled, true);
    assert.equal((await workplace.getDirRule("/e/f"))?.ruleEnabled, true);
    assert.equal((await workplace.getDirRule("/e/f/h"))?.ruleEnabled, true);
  });

  it("补目录规则失败不阻断 write/mkdir 主流程（吞错契约，G-1）", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`p-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const realWorkplace = createWorkplaceService(ctx.conn, {
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });
    // 规则存储整体抛错：write/mkdir 仍应成功且文件/目录落盘
    const brokenWorkplace: BuiltinToolContext["workplace"] = {
      getDirRule: async () => {
        throw new Error("rule store down");
      },
      listDirRules: async () => {
        throw new Error("rule store down");
      },
      setDirRule: async () => {
        throw new Error("rule store down");
      },
    };

    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const runner = new ToolRunner(registry);
    const baseCtx: BuiltinToolContext = {
      ...toolCtx(vfs, project.id, session.id),
      workplace: brokenWorkplace,
    };

    const written = await runner.call<{ version: number }>(
      "write",
      { path: "/boom/x/a.md", content: "hi" },
      baseCtx,
    );
    assert.ok(written.version >= 1);
    assert.equal((await vfs.read("/boom/x/a.md")).content, "hi");

    await runner.call("fs", { action: "mkdir", path: "/boom/d" }, baseCtx);
    const listed = await vfs.list("/boom");
    assert.ok(
      listed.some((e) => e.path === "/boom/d" && e.kind === "directory"),
    );

    // 规则存储全程不可用：不应有残留规则行写入
    assert.deepEqual(await realWorkplace.listDirRules(), []);
  });
});

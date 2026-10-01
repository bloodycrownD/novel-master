/**
 * read-tool-result-ref Step 1+2 定向测试：
 *
 * - T-RR1：contentRef 块 round-trip（全字段经 parse 后逐字段保留——
 *   parse 只回构显式列出的字段，白名单漏一项就静默丢字段，failureReason
 *   已有丢失先例）。
 * - T-RR12：legacy 兼容（无 contentRef 的存量块 parse/序列化行为不变）。
 * - T-RR3：read 工具执行同步 +1（工具返回前、先于任何消息落库，
 *   ref_count 已 +1；「输出带 entryId ⟺ +1 已发生」）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMessageContent } from "../../src/domain/chat/content/parse-message-content.js";
import type {
  ContentBlock,
  ReadResultRef,
} from "../../src/domain/chat/model/content-block.js";
import { buildToolResultBlock } from "../../src/domain/tool/logic/build-tool-result-block.js";
import { ToolRegistry } from "../../src/domain/tool/logic/tool-registry.js";
import { ToolRunner } from "../../src/domain/tool/logic/tool-runner.js";
import { registerBuiltinTools } from "../../src/domain/tool/builtin/register-builtin-tools.js";
import type { BuiltinToolContext } from "../../src/domain/tool/builtin/builtin-tool-context.js";
import type { ReadToolOutput } from "../../src/domain/tool/builtin/vfs-tools.js";
import { SqliteVfsRevisionRepository } from "../../src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

/** T-RR1 用：全字段形态的 contentRef（含全部可选字段）。 */
function fullRef(): ReadResultRef {
  return {
    path: "/docs/a.md",
    entryId: 42,
    version: 3,
    contentHash: "sha256:abcdef0123456789",
    totalBytes: 10240,
    offset: 5,
    limit: 200,
    returnedLines: 200,
    totalLines: 1024,
    truncated: true,
    lastLineTruncated: true,
    nextOffset: 205,
  };
}

describe("read-tool-result-ref: T-RR1 contentRef 块 round-trip", () => {
  it("全字段形态经 parse 后逐字段保留（含可选字段）", () => {
    const block = {
      type: "tool_result",
      toolUseId: "tu-rr1",
      content: "",
      ok: true,
      summary: "truncated · 200/1024 lines",
      contentRef: fullRef(),
    };
    const parsed = parseMessageContent(JSON.stringify({ blocks: [block] }));
    const out = parsed.blocks[0]!;
    assert.equal(out.type, "tool_result");
    if (out.type !== "tool_result") return;
    // 逐字段断言（不用 deepEqual 整块——多一层 contentRef 形状的显式守护）
    const ref = out.contentRef;
    assert.ok(ref != null, "contentRef 必须在 parse 后保留");
    assert.equal(ref.path, "/docs/a.md");
    assert.equal(ref.entryId, 42);
    assert.equal(ref.version, 3);
    assert.equal(ref.contentHash, "sha256:abcdef0123456789");
    assert.equal(ref.totalBytes, 10240);
    assert.equal(ref.offset, 5);
    assert.equal(ref.limit, 200);
    assert.equal(ref.returnedLines, 200);
    assert.equal(ref.totalLines, 1024);
    assert.equal(ref.truncated, true);
    assert.equal(ref.lastLineTruncated, true);
    assert.equal(ref.nextOffset, 205);
  });

  it("最小形态（可选字段缺省）round-trip 后仍缺省、必填字段保留", () => {
    const block = {
      type: "tool_result",
      toolUseId: "tu-rr1b",
      content: "",
      ok: true,
      contentRef: {
        path: "/b.txt",
        entryId: 7,
        version: 1,
        contentHash: "sha256:vvvv",
        totalBytes: 12,
        offset: 1,
        returnedLines: 3,
        totalLines: 3,
        truncated: false,
      },
    };
    const parsed = parseMessageContent(JSON.stringify({ blocks: [block] }));
    const out = parsed.blocks[0]!;
    if (out.type !== "tool_result") {
      assert.fail("expected tool_result block");
    }
    const ref = out.contentRef;
    assert.ok(ref != null);
    assert.equal(ref.entryId, 7);
    assert.equal(ref.version, 1);
    assert.equal(ref.truncated, false);
    assert.equal(ref.limit, undefined);
    assert.equal(ref.lastLineTruncated, undefined);
    assert.equal(ref.nextOffset, undefined);
  });

  it("二次 round-trip（parse → 序列化 → 再 parse）逐字节稳定", () => {
    const block = {
      type: "tool_result",
      toolUseId: "tu-rr1c",
      content: "",
      ok: true,
      summary: "3 lines",
      contentRef: fullRef(),
    };
    const once = parseMessageContent(JSON.stringify({ blocks: [block] }));
    const twice = parseMessageContent(
      JSON.stringify({ blocks: once.blocks as ContentBlock[] })
    );
    assert.deepEqual(twice.blocks, once.blocks);
  });

  it("contentRef 字段类型非法时 fail-fast 抛错（不静默丢引用）", () => {
    const bad = {
      type: "tool_result",
      toolUseId: "tu-rr1d",
      content: "",
      contentRef: { ...fullRef(), entryId: "not-a-number" },
    };
    assert.throws(
      () => parseMessageContent(JSON.stringify({ blocks: [bad] })),
      /entryId must be a non-negative integer/
    );
  });
});

describe("read-tool-result-ref: T-RR12 legacy 兼容", () => {
  it("无 contentRef 的存量块 parse/序列化行为逐字节不变", () => {
    const legacy = {
      type: "tool_result",
      toolUseId: "tu-rr12",
      content: "     1|hello\n     2|world",
      ok: true,
      summary: "2 lines",
      meta: { subagentSessionId: "sess-1" },
    };
    const json = JSON.stringify({ blocks: [legacy] });
    const parsed = parseMessageContent(json);
    const out = parsed.blocks[0]!;
    if (out.type !== "tool_result") {
      assert.fail("expected tool_result block");
    }
    assert.equal(out.contentRef, undefined);
    assert.equal(out.content, "     1|hello\n     2|world");
    assert.equal(out.ok, true);
    assert.equal(out.summary, "2 lines");
    assert.deepEqual(out.meta, { subagentSessionId: "sess-1" });
    // 序列化 round-trip 后再 parse，字段稳定
    const again = parseMessageContent(
      JSON.stringify({ blocks: parsed.blocks as ContentBlock[] })
    );
    assert.deepEqual(again.blocks[0], out);
  });

  it("legacy 纯文本 read 块（无 ok/summary/meta）round-trip 不变", () => {
    const legacyRead = {
      type: "tool_result",
      toolUseId: "tu-rr12b",
      content: "     1|旧存量 read 全文",
    };
    const parsed = parseMessageContent(
      JSON.stringify({ blocks: [legacyRead] })
    );
    const out = parsed.blocks[0]!;
    if (out.type !== "tool_result") {
      assert.fail("expected tool_result block");
    }
    assert.equal(out.contentRef, undefined);
    assert.equal(out.content, "     1|旧存量 read 全文");
    assert.equal(out.ok, undefined);
    assert.equal(out.summary, undefined);
  });

  it("buildToolResultBlock 对无 entryId 的旧形态 read 输出走 legacy 全文", () => {
    // ctx 未注入 adjustRevisionRefCount（或 vfs 未透出 entryId）时 read 输出
    // 不带定位三件套——块不得产 contentRef，content 照旧 formatReadOutput 全文。
    const legacyOutput = {
      path: "/a.txt",
      content: "l1\nl2\nl3",
      version: 2,
      mtimeMs: 1,
      offset: 1,
      limit: 2000,
      totalLines: 3,
      returnedLines: 3,
      truncated: false,
    };
    const block = buildToolResultBlock(
      "tu-rr12c",
      { ok: true, output: legacyOutput },
      { toolName: "read" }
    );
    assert.equal(block.contentRef, undefined);
    assert.equal(block.ok, true);
    assert.equal(block.summary, "3 lines");
    assert.ok(block.content.includes("1|l1"));
  });
});

describe("read-tool-result-ref: T-RR3 read 执行同步 +1", () => {
  novelMasterTestFixture();

  it("工具返回前 ref_count 已 +1，输出带定位三件套，contentRef 块随之产出", async () => {
    const { conn, sessionVfs } = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const projectId = `pj-rr3-${suffix}`;
    const sessionId = `ss-rr3-${suffix}`;
    const vfs = sessionVfs(projectId, sessionId);
    // 真链路写入：Scoped(RevisionAware(Default))，v1 revision 落库且 live head
    // 持有 ref_count=1。
    await vfs.write("/rr3.txt", "line-1\nline-2\nline-3");

    const revisionRepo = new SqliteVfsRevisionRepository(conn);
    const readRefCount = async (
      entryId: number,
      version: number
    ): Promise<number> => {
      const rows = await conn.query<{ ref_count: number }>(
        `SELECT ref_count FROM vfs_revision WHERE entry_id = ? AND version = ?`,
        [entryId, version]
      );
      assert.equal(rows.length, 1, "revision 行必须存在");
      return rows[0]!.ref_count;
    };

    // +1 闭包执行时点即 read 工具 run() 内部（结构上先于工具返回、先于
    // agent-runner 的消息 append——工具执行与落库分离）。闭包内记录前后
    // ref_count，验证「+1 发生在返回前」。
    const plus1Calls: Array<{
      entryId: number;
      version: number;
      before: number;
      after: number;
    }> = [];
    const ctx: BuiltinToolContext = {
      vfs,
      projectId,
      sessionId,
      adjustRevisionRefCount: async (pointers, delta) => {
        assert.equal(delta, +1);
        assert.equal(pointers.length, 1);
        const { entryId, version } = pointers[0]!;
        const before = await readRefCount(entryId, version);
        await revisionRepo.batchAdjustRefCountWithDelta(pointers, delta);
        const after = await readRefCount(entryId, version);
        plus1Calls.push({ entryId, version, before, after });
      },
    };

    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const runner = new ToolRunner(registry);
    const result = await runner.call<ReadToolOutput>(
      "read",
      { path: "/rr3.txt" },
      ctx
    );

    // 同步 +1 恰好发生一次，且在工具返回前把 ref_count 从 1（live head）抬到 2。
    assert.equal(plus1Calls.length, 1);
    const call = plus1Calls[0]!;
    assert.equal(call.before, 1);
    assert.equal(call.after, 2);
    assert.equal(call.version, result.version);

    // 「输出带 entryId ⟺ +1 已发生」：定位三件套齐全。
    assert.equal(result.entryId, call.entryId);
    assert.ok(typeof result.contentHash === "string" && result.contentHash !== "");
    assert.equal(result.totalBytes, 20); // "line-1\nline-2\nline-3" 的 UTF-8 字节数（6+1+6+1+6）

    // 工具已返回：+1 的效果仍在（此后任何 sweep 都不会误删 v1）。
    assert.equal(await readRefCount(call.entryId, call.version), 2);

    // read 输出喂 buildToolResultBlock：产 contentRef 块（content 空串、
    // ok/summary 照旧、ref 与输出逐字段一致——重放 formatReadOutput 的
    // 输入自包含）。
    const block = buildToolResultBlock(
      "tu-rr3",
      { ok: true, output: result },
      { toolName: "read" }
    );
    assert.equal(block.ok, true);
    assert.equal(block.content, "");
    assert.equal(block.summary, "3 lines");
    const ref = block.contentRef;
    assert.ok(ref != null);
    assert.equal(ref.path, "/rr3.txt");
    assert.equal(ref.entryId, result.entryId);
    assert.equal(ref.version, result.version);
    assert.equal(ref.contentHash, result.contentHash);
    assert.equal(ref.totalBytes, 20);
    assert.equal(ref.offset, 1);
    assert.equal(ref.limit, result.limit);
    assert.equal(ref.returnedLines, 3);
    assert.equal(ref.totalLines, 3);
    assert.equal(ref.truncated, false);
    assert.equal(ref.lastLineTruncated, undefined);
    assert.equal(ref.nextOffset, undefined);

    // contentRef 块过 parse round-trip 不丢字段（与 T-RR1 串起：真链路产物
    // 落库读回一致）。
    const parsed = parseMessageContent(
      JSON.stringify({ blocks: [block as ContentBlock] })
    );
    const roundTrip = parsed.blocks[0]!;
    if (roundTrip.type !== "tool_result") {
      assert.fail("expected tool_result block");
    }
    assert.deepEqual(roundTrip.contentRef, ref);
  });

  it("ctx 未注入 adjustRevisionRefCount 时不 +1、输出不带 entryId（legacy 回落）", async () => {
    const { conn, sessionVfs } = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const projectId = `pj-rr3b-${suffix}`;
    const sessionId = `ss-rr3b-${suffix}`;
    const vfs = sessionVfs(projectId, sessionId);
    await vfs.write("/rr3b.txt", "x\ny");

    const entryRows = await conn.query<{ entry_id: number }>(
      `SELECT entry_id FROM vfs_entry WHERE path = ?`,
      ["/rr3b.txt"]
    );
    const entryId = entryRows[0]!.entry_id;

    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const runner = new ToolRunner(registry);
    const result = await runner.call<ReadToolOutput>(
      "read",
      { path: "/rr3b.txt" },
      {
        vfs,
        projectId,
        sessionId,
        // 故意不注入 adjustRevisionRefCount
      }
    );

    assert.equal(result.entryId, undefined);
    assert.equal(result.contentHash, undefined);
    assert.equal(result.totalBytes, undefined);
    // ref_count 维持 live head 的 1，未被 read 干扰。
    const rows = await conn.query<{ ref_count: number }>(
      `SELECT ref_count FROM vfs_revision WHERE entry_id = ? AND version = ?`,
      [entryId, result.version]
    );
    assert.equal(rows[0]!.ref_count, 1);
  });
});

/**
 * read 结果「全文直出」定向测试（task-attach-unref Step 4）。
 *
 * v1.5.30 起 read / skill 的引用化整体退役：写侧恒产全文
 * （`buildToolResultBlock` 成功分支直出 `formatToolOutputForLlm`），
 * 不再产 `contentRef`、不再 `+1` revision ref_count。本文件覆盖：
 *
 * - T-UA1（原 T-RR1 改写）：read 新结果 = 带 6 位行号全文；落库
 *   `content_json` 无 `contentRef` 键；该块过 parse round-trip 全文
 *   逐字保留、contentRef 仍缺省。**牙齿**：实现改回产引用块即红
 *   （content 变空串 + contentRef 非空）。
 * - T-UA2（原 T-RR3 改写）：read 执行**前后** revision `ref_count`
 *   不变（只余 live head 的 1）；输出不含 `entryId` / `contentHash` /
 *   `totalBytes` 三件套；即便 ctx 上仍挂着会抛的 `adjustRevisionRefCount`
 *   残桩也绝不被调用。**牙齿**：实现改回 +1 即红（ref_count 变 2）。
 * - T-RR12（同步口径）：存量行的 `contentRef` 解析白名单本版按纪律保留
 *   （兜底 hydrate 依赖它），故逐字段 round-trip 断言原样保留；legacy
 *   无 contentRef 块的 parse / 序列化行为逐字节不变。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMessageContent } from "../../src/domain/chat/content/parse-message-content.js";
import type {
  ContentBlock,
  ReadResultRef,
  ToolResultBlock,
} from "../../src/domain/chat/model/content-block.js";
import { buildToolResultBlock } from "../../src/domain/tool/logic/build-tool-result-block.js";
import { ToolRegistry } from "../../src/domain/tool/logic/tool-registry.js";
import { ToolRunner } from "../../src/domain/tool/logic/tool-runner.js";
import { registerBuiltinTools } from "../../src/domain/tool/builtin/register-builtin-tools.js";
import type { BuiltinToolContext } from "../../src/domain/tool/builtin/builtin-tool-context.js";
import type { ReadToolOutput } from "../../src/domain/tool/builtin/vfs-tools.js";
import { collectReadRefs } from "../../src/domain/vfs/logic/revision-ref-count.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

/** T-RR12 用：全字段形态的存量 contentRef（含全部可选字段）。 */
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

novelMasterTestFixture();

/** 真链路 read：sessionVfs 写文件 → ToolRunner 跑 read。 */
async function readViaTool(
  toolCtx: BuiltinToolContext,
  input: { path: string; offset?: number; limit?: number }
): Promise<ReadToolOutput> {
  const registry = new ToolRegistry<BuiltinToolContext>();
  registerBuiltinTools(registry);
  const runner = new ToolRunner(registry);
  return await runner.call<ReadToolOutput>("read", input, toolCtx);
}

describe("read-tool-result-ref: T-UA1 read 新结果全文直出（原 T-RR1 改写）", () => {
  it("真链路 read 落块 content = 带行号全文、contentRef 缺省；落库 content_json 无 contentRef 键", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`pj-ua1-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/ua1.md", "alpha 首行\nbeta 第二行\ngamma");

    const output = await readViaTool(
      {
        vfs,
        projectId: project.id,
        sessionId: session.id,
        listSessionMessages: async () => [],
      },
      { path: "/ua1.md" }
    );

    const block = buildToolResultBlock(
      "tu-ua1",
      { ok: true, output },
      { toolName: "read" }
    );
    assert.equal(block.ok, true);
    assert.equal(block.summary, "3 lines");
    // 全文直出：6 位行号形态（与 v1.5.29 之前同款 wire）。
    assert.equal(
      block.content,
      "     1|alpha 首行\n     2|beta 第二行\n     3|gamma"
    );
    // 引用化已退役：块上不得有 contentRef（content 也不再是占位空串）。
    assert.equal(block.contentRef, undefined);
    assert.equal(Object.hasOwn(block, "contentRef"), false);

    // 落库形态：content_json 里没有 `contentRef` 键（回迁任务的谓词亦以此为准）。
    const msg = await ctx.messages.append(session.id, "assistant", {
      blocks: [block as ContentBlock],
    });
    const rows = await ctx.conn.query<{ content_json: string }>(
      `SELECT content_json FROM chat_message WHERE id = ?`,
      [msg.id]
    );
    assert.equal(rows.length, 1);
    assert.equal(
      rows[0]!.content_json.includes("contentRef"),
      false,
      "新写入的行不得含 contentRef 键"
    );
    // 新块不产生任何消息侧引用指针（删除路径因而零 ref 调整）。
    assert.deepEqual(collectReadRefs({ blocks: [block] }), []);
  });

  it("全文块过 parse round-trip：content 逐字保留、contentRef 仍缺省，二次 round-trip 稳定", () => {
    const block = {
      type: "tool_result",
      toolUseId: "tu-ua1b",
      content: "     1|hello\n     2|world",
      ok: true,
      summary: "2 lines",
    };
    const once = parseMessageContent(JSON.stringify({ blocks: [block] }));
    const out = once.blocks[0]!;
    if (out.type !== "tool_result") {
      assert.fail("expected tool_result block");
    }
    assert.equal(out.contentRef, undefined);
    assert.equal(out.content, "     1|hello\n     2|world");
    const twice = parseMessageContent(
      JSON.stringify({ blocks: once.blocks as ContentBlock[] })
    );
    assert.deepEqual(twice.blocks, once.blocks);
  });
});

describe("read-tool-result-ref: T-UA2 read 执行前后 ref_count 不变（原 T-RR3 改写）", () => {
  it("read 前后 ref_count 恒为 live head 的 1；输出不含定位三件套；ctx 上的 +1 残桩不被调用", async () => {
    const { conn, sessionVfs } = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const projectId = `pj-ua2-${suffix}`;
    const sessionId = `ss-ua2-${suffix}`;
    const vfs = sessionVfs(projectId, sessionId);
    await vfs.write("/ua2.txt", "line-1\nline-2\nline-3");

    const entryRows = await conn.query<{ entry_id: number }>(
      `SELECT entry_id FROM vfs_entry WHERE path = ?`,
      ["/ua2.txt"]
    );
    const entryId = entryRows[0]!.entry_id;
    const readRefCount = async (version: number): Promise<number | null> => {
      const rows = await conn.query<{ ref_count: number }>(
        `SELECT ref_count FROM vfs_revision WHERE entry_id = ? AND version = ?`,
        [entryId, version]
      );
      return rows.length === 0 ? null : Number(rows[0]!.ref_count);
    };
    assert.equal(await readRefCount(1), 1, "写盘后 live head 持有 1 份");

    // 牙齿：即使 ctx 上仍挂着旧版的 +1 通道残桩（运行时兼容形态），read 也
    // 绝不能调它——一旦实现改回引用化，这里会因抛错而红。
    let channelCalls = 0;
    const toolCtx = {
      vfs,
      projectId,
      sessionId,
      listSessionMessages: async () => [],
      adjustRevisionRefCount: async () => {
        channelCalls += 1;
        throw new Error("read 不应再触发 revision +1（unref 已回迁）");
      },
    } as unknown as BuiltinToolContext;

    const output = await readViaTool(toolCtx, { path: "/ua2.txt" });

    assert.equal(channelCalls, 0, "+1 通道残桩不得被调用");
    assert.equal(output.version, 1);
    assert.equal(await readRefCount(output.version), 1, "read 前后 ref_count 不变");

    // 定位三件套已随引用化一并摘除（D1）。
    assert.equal(
      Object.hasOwn(output as unknown as Record<string, unknown>, "entryId"),
      false,
      "输出不再携带 entryId"
    );
    assert.equal(
      Object.hasOwn(
        output as unknown as Record<string, unknown>,
        "contentHash"
      ),
      false,
      "输出不再携带 contentHash"
    );
    assert.equal(
      Object.hasOwn(
        output as unknown as Record<string, unknown>,
        "totalBytes"
      ),
      false,
      "输出不再携带 totalBytes"
    );
  });

  it("多段 read（分页 / 字节帽截断）同样零 ref 调整", async () => {
    const { conn, sessionVfs } = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const projectId = `pj-ua2b-${suffix}`;
    const sessionId = `ss-ua2b-${suffix}`;
    const vfs = sessionVfs(projectId, sessionId);
    const big = Array.from(
      { length: 1000 },
      (_, i) => `line-${String(i).padStart(5, "0")}-${"x".repeat(48)}`
    ).join("\n");
    await vfs.write("/ua2b.txt", big);

    const entryRows = await conn.query<{ entry_id: number }>(
      `SELECT entry_id FROM vfs_entry WHERE path = ?`,
      ["/ua2b.txt"]
    );
    const entryId = entryRows[0]!.entry_id;
    const refCount = async (): Promise<number | null> => {
      const rows = await conn.query<{ ref_count: number }>(
        `SELECT ref_count FROM vfs_revision WHERE entry_id = ? AND version = ?`,
        [entryId, 1]
      );
      return rows.length === 0 ? null : Number(rows[0]!.ref_count);
    };

    const toolCtx: BuiltinToolContext = {
      vfs,
      projectId,
      sessionId,
      listSessionMessages: async () => [],
    };
    const first = await readViaTool(toolCtx, { path: "/ua2b.txt" });
    assert.equal(first.truncated, true, "60KB 内容必命中字节帽");
    const second = await readViaTool(toolCtx, {
      path: "/ua2b.txt",
      offset: 10,
      limit: 20,
    });
    assert.equal(second.version, 1);

    assert.equal(await refCount(), 1, "多段 read 后 ref_count 仍为 live head 的 1");
  });
});

describe("read-tool-result-ref: T-RR12 存量行解析与 legacy 兼容", () => {
  it("存量 contentRef 全字段经 parse 后逐字段保留（兜底 hydrate 依赖白名单）", () => {
    const block = {
      type: "tool_result",
      toolUseId: "tu-rr12",
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

  it("存量 contentRef 最小形态（可选字段缺省）round-trip 后仍缺省、必填字段保留", () => {
    const block = {
      type: "tool_result",
      toolUseId: "tu-rr12b",
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

  it("存量 contentRef 二次 round-trip（parse → 序列化 → 再 parse）逐字节稳定", () => {
    const block = {
      type: "tool_result",
      toolUseId: "tu-rr12c",
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

  it("存量 contentRef 字段类型非法时 fail-fast 抛错（不静默丢引用）", () => {
    const bad = {
      type: "tool_result",
      toolUseId: "tu-rr12d",
      content: "",
      contentRef: { ...fullRef(), entryId: "not-a-number" },
    };
    assert.throws(
      () => parseMessageContent(JSON.stringify({ blocks: [bad] })),
      /entryId must be a non-negative integer/
    );
  });

  it("无 contentRef 的存量块 parse/序列化行为逐字节不变", () => {
    const legacy = {
      type: "tool_result",
      toolUseId: "tu-rr12e",
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
    const legacyRead: ToolResultBlock = {
      type: "tool_result",
      toolUseId: "tu-rr12f",
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

  it("buildToolResultBlock 对无 entryId 的旧形态 read 输出恒走全文直出", () => {
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
      "tu-rr12g",
      { ok: true, output: legacyOutput },
      { toolName: "read" }
    );
    assert.equal(block.contentRef, undefined);
    assert.equal(block.ok, true);
    assert.equal(block.summary, "3 lines");
    assert.ok(block.content.includes("1|l1"));
  });
});
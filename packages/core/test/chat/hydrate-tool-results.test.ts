/**
 * read-tool-result-ref Step 4 定向测试：hydrate（wire 字节还原）。
 *
 * - T-RR2：hydrate 重放结果与 read 执行时的 `formatReadOutput` 输出
 *   **逐字节全等**（基准取真链路 read 输出过 `formatToolOutputForLlm`，
 *   即 buildToolResultBlock 落块时走的同一条格式化路径），四形态：
 *   整读 / offset 分页 / 字节帽截断（50KB 帽）/ lastLineTruncated。
 * - T-RR11：contentHash 校验 fail-fast——篡改 revision 内容（或换成错
 *   hash）后 hydrate 抛 `ReadResultHydrateError`（类型化错误，非泛 Error）。
 * - prepare 接线：透传分支后 hydrate 生效；孤儿拍平
 *   （normalizeOrphanToolResultsForLlm）拿到的是 hydrate 之后的全文——
 *   顺序错了拍平只会得到 `[tool_result id=…]` 占位（对照组证明）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatMessage } from "../../src/domain/chat/model/message.js";
import type { ToolResultBlock } from "../../src/domain/chat/model/content-block.js";
import {
  hydrateToolResultsForPrompt,
  ReadResultHydrateError,
} from "../../src/domain/chat/logic/hydrate-tool-results-for-prompt.js";
import { prepareUserMessagesForPrompt } from "../../src/domain/chat/logic/prepare-user-messages-for-prompt.js";
import { messageBodyTextFromBlocks } from "../../src/domain/chat/content/message-body-text.js";
import { buildToolResultBlock } from "../../src/domain/tool/logic/build-tool-result-block.js";
import { formatToolOutputForLlm } from "../../src/domain/tool/logic/format-tool-output.js";
import { ToolRegistry } from "../../src/domain/tool/logic/tool-registry.js";
import { ToolRunner } from "../../src/domain/tool/logic/tool-runner.js";
import { registerBuiltinTools } from "../../src/domain/tool/builtin/register-builtin-tools.js";
import type { BuiltinToolContext } from "../../src/domain/tool/builtin/builtin-tool-context.js";
import type { ReadToolOutput } from "../../src/domain/tool/builtin/vfs-tools.js";
import { SqliteVfsRevisionRepository } from "../../src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { createSessionKkvService } from "../../src/service/session-kkv/create-session-kkv-service.js";
import { normalizeOrphanToolResultsForLlm } from "../../src/service/prompt/normalize-orphan-tool-results-for-llm.js";
import type { TdbcConnection } from "../../src/infra/tdbc/ports/connection.port.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

/** role=user 的 tool_result 回传消息（prepare 透传分支的受众形态）。 */
function toolResultMessage(block: ToolResultBlock, id = "tr-msg"): ChatMessage {
  return {
    id,
    sessionId: "ss-hydrate",
    seq: 2,
    role: "user",
    content: { blocks: [block] },
    provider: null,
    raw: null,
    createdAtMs: 0,
    hidden: false,
  };
}

/**
 * 真链路 read：sessionVfs 写文件 → ToolRunner 跑 read（ctx 注入
 * adjustRevisionRefCount，输出带定位三件套）→ buildToolResultBlock 产
 * contentRef 块；基准 wire 取 `formatToolOutputForLlm(output)`——与 read
 * 执行时落块走的是同一条格式化路径。
 */
async function readViaTool(
  ctx: BuiltinToolContext,
  conn: TdbcConnection,
  input: { path: string; offset?: number; limit?: number },
  toolUseId: string
): Promise<{
  output: ReadToolOutput;
  block: ToolResultBlock;
  baseline: string;
  revisionRepo: SqliteVfsRevisionRepository;
}> {
  const revisionRepo = new SqliteVfsRevisionRepository(conn);
  const toolCtx: BuiltinToolContext = {
    ...ctx,
    adjustRevisionRefCount: async (pointers, delta) => {
      await revisionRepo.batchAdjustRefCountWithDelta(pointers, delta);
    },
  };
  const registry = new ToolRegistry<BuiltinToolContext>();
  registerBuiltinTools(registry);
  const runner = new ToolRunner(registry);
  const output = await runner.call<ReadToolOutput>("read", input, toolCtx);
  assert.ok(output.entryId != null, "真链路 read 输出必须带 entryId（锚定）");
  const block = buildToolResultBlock(
    toolUseId,
    { ok: true, output },
    { toolName: "read" }
  );
  assert.ok(block.contentRef != null, "真链路 read 必产 contentRef 块");
  assert.equal(block.content, "", "引用态块 content 必须是占位空串");
  const baseline = formatToolOutputForLlm(output);
  return { output, block, baseline, revisionRepo };
}

describe("read-tool-result-ref Step 4: T-RR2 wire 逐字节等值", () => {
  it("整读形态：hydrate 重放与 read 执行输出逐字节全等（含中文行）", async () => {
    const { conn, sessionVfs } = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const projectId = `pj-rr2a-${suffix}`;
    const sessionId = `ss-rr2a-${suffix}`;
    const vfs = sessionVfs(projectId, sessionId);
    await vfs.write("/rr2a.md", "alpha 首行\nbeta 第二行\ngamma");

    const { block, baseline, revisionRepo } = await readViaTool(
      { vfs, projectId, sessionId, listSessionMessages: async () => [] },
      conn,
      { path: "/rr2a.md" },
      "tu-rr2a"
    );
    // sanity：基准确实是带 6 位行号的 formatReadOutput 形态
    assert.match(baseline, /     1\|alpha 首行/);

    const message = toolResultMessage(block);
    const hydrated = await hydrateToolResultsForPrompt(
      [message],
      revisionRepo
    );
    const outBlock = hydrated[0]!.content.blocks[0]!;
    assert.equal(outBlock.type, "tool_result");
    if (outBlock.type !== "tool_result") return;
    assert.equal(outBlock.content, baseline);
    // view-time 纪律：入参原消息不被变异（content 仍是空串，不写回）
    assert.equal(
      (message.content.blocks[0] as ToolResultBlock).content,
      ""
    );
    // contentRef 原样保留（块身份不变），hydrate 幂等（重放两遍等值）
    assert.deepEqual(outBlock.contentRef, block.contentRef);
    const twice = await hydrateToolResultsForPrompt(
      [toolResultMessage(outBlock)],
      revisionRepo
    );
    assert.equal(
      (twice[0]!.content.blocks[0] as ToolResultBlock).content,
      baseline
    );
  });

  it("offset 分页形态：offset=2 limit=2 的重放逐字节全等（truncated + nextOffset）", async () => {
    const { conn, sessionVfs } = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const projectId = `pj-rr2b-${suffix}`;
    const sessionId = `ss-rr2b-${suffix}`;
    const vfs = sessionVfs(projectId, sessionId);
    await vfs.write("/rr2b.md", "l1\nl2\nl3\nl4\nl5");

    const { output, block, baseline, revisionRepo } = await readViaTool(
      { vfs, projectId, sessionId, listSessionMessages: async () => [] },
      conn,
      { path: "/rr2b.md", offset: 2, limit: 2 },
      "tu-rr2b"
    );
    assert.equal(output.truncated, true);
    assert.equal(output.nextOffset, 4);

    const hydrated = await hydrateToolResultsForPrompt(
      [toolResultMessage(block)],
      revisionRepo
    );
    const outBlock = hydrated[0]!.content.blocks[0] as ToolResultBlock;
    assert.equal(outBlock.content, baseline);
    // 分页语义钉死：行号从 2 起、提示行给 nextOffset=4
    assert.match(outBlock.content, /     2\|l2/);
    assert.match(outBlock.content, /Continue with offset=4/);
  });

  it("字节帽截断形态（50KB 帽）：多行大文件重放逐字节全等", async () => {
    const { conn, sessionVfs } = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const projectId = `pj-rr2c-${suffix}`;
    const sessionId = `ss-rr2c-${suffix}`;
    const vfs = sessionVfs(projectId, sessionId);
    // 1000 行 × 60B ≈ 60KB > 50KB 预算 → 字节帽截断（truncated=true）
    const big = Array.from(
      { length: 1000 },
      (_, i) => `line-${String(i).padStart(5, "0")}-${"x".repeat(48)}`
    ).join("\n");
    await vfs.write("/rr2c.txt", big);

    const { output, block, baseline, revisionRepo } = await readViaTool(
      { vfs, projectId, sessionId, listSessionMessages: async () => [] },
      conn,
      { path: "/rr2c.txt" },
      "tu-rr2c"
    );
    assert.equal(output.truncated, true, "60KB 内容必命中字节帽");

    const hydrated = await hydrateToolResultsForPrompt(
      [toolResultMessage(block)],
      revisionRepo
    );
    const outBlock = hydrated[0]!.content.blocks[0] as ToolResultBlock;
    assert.equal(outBlock.content, baseline);
    assert.ok(outBlock.content.length > 40 * 1024, "wire 保留预算内全文");
  });

  it("lastLineTruncated 形态：单行超 50KB，末行截到预算点的重放逐字节全等", async () => {
    const { conn, sessionVfs } = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const projectId = `pj-rr2d-${suffix}`;
    const sessionId = `ss-rr2d-${suffix}`;
    const vfs = sessionVfs(projectId, sessionId);
    // 单行 60KB（minified 形态）：capUtf8BytesFill 截前 50KB → lastLineTruncated
    await vfs.write("/rr2d.json", "z".repeat(60 * 1024));

    const { output, block, baseline, revisionRepo } = await readViaTool(
      { vfs, projectId, sessionId, listSessionMessages: async () => [] },
      conn,
      { path: "/rr2d.json" },
      "tu-rr2d"
    );
    assert.equal(output.lastLineTruncated, true);
    assert.equal(output.nextOffset, undefined, "唯一行被截后无续读点");

    const hydrated = await hydrateToolResultsForPrompt(
      [toolResultMessage(block)],
      revisionRepo
    );
    const outBlock = hydrated[0]!.content.blocks[0] as ToolResultBlock;
    assert.equal(outBlock.content, baseline);
    assert.match(
      outBlock.content,
      /Last line was cut at the 50KB byte budget/
    );
  });

  it("legacy 块（无 contentRef）零处理：content 原样、消息原引用返回", async () => {
    const legacy: ToolResultBlock = {
      type: "tool_result",
      toolUseId: "tu-legacy",
      content: "     1|hello\n     2|world",
      ok: true,
      summary: "2 lines",
    };
    const message = toolResultMessage(legacy);
    const hydrated = await hydrateToolResultsForPrompt([message]);
    assert.equal(hydrated[0], message, "无引用块的消息原引用返回");
    assert.equal(
      (hydrated[0]!.content.blocks[0] as ToolResultBlock).content,
      "     1|hello\n     2|world"
    );
  });
});

describe("read-tool-result-ref Step 4: T-RR11 contentHash 校验 fail-fast", () => {
  it("换成错 hash（指向另一 blob 的真实 hash）→ 类型化错误 READ_REF_HASH_MISMATCH", async () => {
    const { conn, sessionVfs } = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const projectId = `pj-rr11a-${suffix}`;
    const sessionId = `ss-rr11a-${suffix}`;
    const vfs = sessionVfs(projectId, sessionId);
    await vfs.write("/rr11a-a.md", "content-of-A");
    await vfs.write("/rr11a-b.md", "content-of-B-different");

    const { block, revisionRepo } = await readViaTool(
      { vfs, projectId, sessionId, listSessionMessages: async () => [] },
      conn,
      { path: "/rr11a-a.md" },
      "tu-rr11a"
    );
    // 拿 B 的真实 blob hash 当「错 hash」（模拟版本错位：记录了别的文件的指纹）
    const bRows = await conn.query<{ content_hash: string }>(
      `SELECT r.content_hash FROM vfs_revision r
       JOIN vfs_entry e ON e.entry_id = r.entry_id
       WHERE e.path = ? AND r.version = 1`,
      ["/rr11a-b.md"]
    );
    assert.equal(bRows.length, 1);
    const tampered: ToolResultBlock = {
      ...block,
      contentRef: {
        ...block.contentRef!,
        contentHash: bRows[0]!.content_hash,
      },
    };

    await assert.rejects(
      hydrateToolResultsForPrompt([toolResultMessage(tampered)], revisionRepo),
      (error: unknown) => {
        assert.ok(
          error instanceof ReadResultHydrateError,
          `必须是 ReadResultHydrateError，实际 ${String(error)}`
        );
        assert.equal(error.name, "ReadResultHydrateError");
        assert.equal(error.code, "READ_REF_HASH_MISMATCH");
        assert.match(error.message, /内容漂移/);
        assert.match(error.message, /rr11a-a\.md/);
        return true;
      }
    );
  });

  it("人为篡改 revision 行（content_hash 换指 B 的 blob）→ 同样 fail-fast", async () => {
    const { conn, sessionVfs } = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const projectId = `pj-rr11b-${suffix}`;
    const sessionId = `ss-rr11b-${suffix}`;
    const vfs = sessionVfs(projectId, sessionId);
    await vfs.write("/rr11b-a.md", "AAA-original-content");
    await vfs.write("/rr11b-b.md", "BBB-other-content");

    const { block, revisionRepo } = await readViaTool(
      { vfs, projectId, sessionId, listSessionMessages: async () => [] },
      conn,
      { path: "/rr11b-a.md" },
      "tu-rr11b"
    );
    const ref = block.contentRef!;
    // 直接篡改 DB：A 的 revision 行 content_hash 指到 B 的 blob——
    // findByEntryAndVersion 解出 B 明文，与 ref 记录的 A 指纹比对失败。
    const bRows = await conn.query<{ content_hash: string }>(
      `SELECT r.content_hash FROM vfs_revision r
       JOIN vfs_entry e ON e.entry_id = r.entry_id
       WHERE e.path = ? AND r.version = 1`,
      ["/rr11b-b.md"]
    );
    await conn.execute(
      `UPDATE vfs_revision SET content_hash = ? WHERE entry_id = ? AND version = ?`,
      [bRows[0]!.content_hash, ref.entryId, ref.version]
    );

    await assert.rejects(
      hydrateToolResultsForPrompt([toolResultMessage(block)], revisionRepo),
      (error: unknown) => {
        assert.ok(error instanceof ReadResultHydrateError);
        assert.equal(error.code, "READ_REF_HASH_MISMATCH");
        return true;
      }
    );
  });

  it("引用悬空（revision 行不存在）→ READ_REF_REVISION_MISSING", async () => {
    const { conn, sessionVfs } = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const projectId = `pj-rr11c-${suffix}`;
    const sessionId = `ss-rr11c-${suffix}`;
    const vfs = sessionVfs(projectId, sessionId);
    await vfs.write("/rr11c.md", "x\ny");

    const { block, revisionRepo } = await readViaTool(
      { vfs, projectId, sessionId, listSessionMessages: async () => [] },
      conn,
      { path: "/rr11c.md" },
      "tu-rr11c"
    );
    const dangling: ToolResultBlock = {
      ...block,
      contentRef: {
        ...block.contentRef!,
        entryId: block.contentRef!.entryId + 999,
      },
    };

    await assert.rejects(
      hydrateToolResultsForPrompt([toolResultMessage(dangling)], revisionRepo),
      (error: unknown) => {
        assert.ok(error instanceof ReadResultHydrateError);
        assert.equal(error.code, "READ_REF_REVISION_MISSING");
        assert.match(error.message, /引用悬空/);
        return true;
      }
    );
  });

  it("存在引用块但 revisionRepo 未注入（装配缺口）→ READ_REF_REPO_MISSING，不静默放行", async () => {
    const { conn, sessionVfs } = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const projectId = `pj-rr11d-${suffix}`;
    const sessionId = `ss-rr11d-${suffix}`;
    const vfs = sessionVfs(projectId, sessionId);
    await vfs.write("/rr11d.md", "a\nb\nc");

    const { block } = await readViaTool(
      { vfs, projectId, sessionId, listSessionMessages: async () => [] },
      conn,
      { path: "/rr11d.md" },
      "tu-rr11d"
    );

    await assert.rejects(
      hydrateToolResultsForPrompt([toolResultMessage(block)], undefined),
      (error: unknown) => {
        assert.ok(error instanceof ReadResultHydrateError);
        assert.equal(error.code, "READ_REF_REPO_MISSING");
        return true;
      }
    );
  });
});

describe("read-tool-result-ref Step 4: prepare 接线与孤儿拍平顺序", () => {
  it("prepareUserMessagesForPrompt 对透传的 tool_result 消息 hydrate（content 还原 wire 全文）", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`pj-hywire-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/hywire.md", "第一行\n第二行\n第三行");

    const { block, baseline, revisionRepo } = await readViaTool(
      { vfs, projectId: project.id, sessionId: session.id, listSessionMessages: async () => [] },
      ctx.conn,
      { path: "/hywire.md" },
      "tu-hywire"
    );
    const sk = createSessionKkvService(ctx.conn);
    const message = toolResultMessage(block);
    const prepared = await prepareUserMessagesForPrompt([message], {
      sessionId: session.id,
      sessionKkv: sk,
      vfs,
      revisionRepo,
    });
    const outBlock = prepared[0]!.content.blocks[0] as ToolResultBlock;
    assert.equal(outBlock.content, baseline);
    // token / 压缩 parity 口径（messageBodyTextFromBlocks）同受益于 hydrate
    const bodyText = messageBodyTextFromBlocks(prepared[0]!.content.blocks);
    assert.match(bodyText, /     1\|第一行/);
    // view-time：prepare 前的内存原消息仍是空 content（不写回纪律）
    assert.equal(
      (message.content.blocks[0] as ToolResultBlock).content,
      ""
    );
  });

  it("孤儿拍平发生在 hydrate 之后：拍平文本含 wire 全文，未 hydrate 的对照只剩占位", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`pj-orphan-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/orphan.md", "o1\no2\no3");

    const { block, baseline, revisionRepo } = await readViaTool(
      { vfs, projectId: project.id, sessionId: session.id, listSessionMessages: async () => [] },
      ctx.conn,
      { path: "/orphan.md" },
      "tu-orphan"
    );
    const sk = createSessionKkvService(ctx.conn);
    // 消息数组里没有配对的 assistant tool_use → tool_result 是「孤儿」，
    // 发送前会被 normalizeOrphanToolResultsForLlm 拍平成 text。
    const message = toolResultMessage(block);
    const prepared = await prepareUserMessagesForPrompt([message], {
      sessionId: session.id,
      sessionKkv: sk,
      vfs,
      revisionRepo,
    });
    const flattened = normalizeOrphanToolResultsForLlm(prepared);
    const flatBlock = flattened[0]!.content.blocks[0]!;
    assert.equal(flatBlock.type, "text");
    // 拍平文本携带 hydrate 还原的 wire 全文（messageBodyText 的
    // tool_result 形态 = id 头 + 空行 + 正文，而非空占位）
    assert.equal(
      (flatBlock as { text: string }).text,
      `[tool_result id=tu-orphan]\n\n${baseline}`
    );

    // 对照组：跳过 prepare/hydrate 直接拍平原始引用块 → 只剩占位文本，
    // wire 全文丢失——证明「hydrate 必须先于孤儿拍平」（删掉 hydrate 接线
    // 上面的断言即红）。
    const flatRaw = normalizeOrphanToolResultsForLlm([message]);
    const rawBlock = flatRaw[0]!.content.blocks[0]!;
    assert.equal(rawBlock.type, "text");
    assert.equal(
      (rawBlock as { text: string }).text,
      "[tool_result id=tu-orphan]"
    );
  });

  it("prepare 对无 revisionRepo 的 legacy 消息（无引用块）行为不变", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`pj-legacy-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const legacy: ToolResultBlock = {
      type: "tool_result",
      toolUseId: "tu-legacy-prep",
      content: "     1|legacy 全文",
      ok: true,
      summary: "1 lines",
    };
    const message = toolResultMessage(legacy);
    // 故意不传 revisionRepo：无引用块时不应触发任何 hydrate 依赖
    const prepared = await prepareUserMessagesForPrompt([message], {
      sessionId: session.id,
      sessionKkv: createSessionKkvService(ctx.conn),
      vfs,
    });
    const outBlock = prepared[0]!.content.blocks[0] as ToolResultBlock;
    assert.equal(outBlock.content, "     1|legacy 全文");
    assert.equal(outBlock.contentRef, undefined);
  });
});

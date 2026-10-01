/**
 * 提示词链路的**极简兜底 hydrate** 定向测试（task-attach-unref Step 4）。
 *
 * v1.5.29 写入的存量引用行（`content === ""` + `contentRef`）仍在库里，
 * 写侧已回退为全文直出，故提示词链路上只剩兜底一件事：按
 * `(entryId, version)` 取 revision 明文填一份 `{path, content}` 的 JSON
 * 字符串回**内存态**，取不到就落错误占位 JSON 并 `console.warn`。
 *
 * 覆盖矩阵：
 * - T-UA3（原 T-RR2 / T-RR11 改写）：存量 read ref 行 → JSON 包含 revision
 *   明文；`kind: "skill"` 同款（`files` 等派生字段弃置）；入参消息不被变异、
 *   `contentRef` 原样保留、落库 `content_json` 不写回。legacy 块零处理。
 * - T-UA4（原 T-RR11 fail-fast 改写）：revision 行缺失 / `status=deleted` /
 *   明文不可取 / 仓库未注入（装配缺口）/ 仓库抛错 → 一律错误占位 JSON +
 *   warn，**永不抛错**；hash 不匹配**不算坏行**（照常回填 + warn）。
 * - T-UA6：prepare 接线与「孤儿拍平顺序」红线——hydrate 必须早于
 *   `normalizeOrphanToolResultsForLlm`，否则空 content 被拍成
 *   `[tool_result id=…]` 占位，正文永久丢失（对照组证明）。
 *
 * 废除的旧口径：wire 逐字节等值重放、hash fail-fast、wire 重放侧调用内 memo
 * （wireByReplayKey）；明文侧去重（plainByRefKey）本版保留。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatMessage } from "../../src/domain/chat/model/message.js";
import type {
  ReadResultRef,
  SkillResultRef,
  ToolResultBlock,
} from "../../src/domain/chat/model/content-block.js";
import { hydrateToolResultsForPrompt } from "../../src/domain/chat/logic/hydrate-tool-results-for-prompt.js";
import { prepareUserMessagesForPrompt } from "../../src/domain/chat/logic/prepare-user-messages-for-prompt.js";
import { messageBodyTextFromBlocks } from "../../src/domain/chat/content/message-body-text.js";
import { SqliteVfsRevisionRepository } from "../../src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import type { VfsRevisionRepository } from "../../src/domain/vfs/repositories/vfs-revision.port.js";
import { clearDecodedContentCaches } from "../../src/infra/content-cache/logic/decoded-content-cache.js";
import { createSessionKkvService } from "../../src/service/session-kkv/create-session-kkv-service.js";
import { normalizeOrphanToolResultsForLlm } from "../../src/service/prompt/normalize-orphan-tool-results-for-llm.js";
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
 * 造一条 v1.5.29 存量引用块：`content === ""` + contentRef 全字段。
 *
 * entryId 从库里点查（write 后 `vfs_entry` 行），contentHash 取 revision
 * 行的真实指纹——这正是存量行的形态（引用记的是当时那一版的指纹）。
 */
async function legacyReadRefBlock(
  projectId: string,
  sessionId: string,
  path: string,
  toolUseId: string,
  overrides: Partial<ReadResultRef> = {}
): Promise<ToolResultBlock> {
  const { conn, sessionVfs } = getNovelMasterTestContext();
  const vfs = sessionVfs(projectId, sessionId);
  await vfs.write(path, "line-1\nline-2\nline-3");
  const entryRows = await conn.query<{ entry_id: number }>(
    `SELECT entry_id FROM vfs_entry WHERE path = ?`,
    [path]
  );
  assert.equal(entryRows.length, 1, "写入后应有唯一 entry 行");
  const entryId = entryRows[0]!.entry_id;
  const revRows = await conn.query<{ content_hash: string }>(
    `SELECT content_hash FROM vfs_revision WHERE entry_id = ? AND version = 1`,
    [entryId]
  );
  assert.equal(revRows.length, 1, "写入后应有 v1 revision 行");
  const ref: ReadResultRef = {
    path,
    entryId,
    version: 1,
    contentHash: revRows[0]!.content_hash,
    totalBytes: 20,
    offset: 1,
    limit: 2000,
    returnedLines: 3,
    totalLines: 3,
    truncated: false,
    ...overrides,
  };
  return {
    type: "tool_result",
    toolUseId,
    content: "",
    ok: true,
    summary: "3 lines",
    contentRef: ref,
  };
}

/** skill 域的存量引用块（`kind: "skill"`，`files` 为派生字段）。 */
function legacySkillRefBlock(
  ref: SkillResultRef,
  toolUseId: string
): ToolResultBlock {
  return {
    type: "tool_result",
    toolUseId,
    content: "",
    ok: true,
    summary: "3 lines",
    contentRef: ref,
  };
}

/** 捕获 console.warn（兜底路径唯一的可观测面），返回文本数组。 */
async function captureWarnings(
  run: () => Promise<void>
): Promise<string[]> {
  const original = console.warn;
  const warns: string[] = [];
  console.warn = (...args: unknown[]) => {
    warns.push(args.map((a) => String(a)).join(" "));
  };
  try {
    await run();
  } finally {
    console.warn = original;
  }
  return warns;
}

/** 把落库行读回内存态（走 parse 白名单），hydrate 后再查库验「不写回」。 */
async function hydrateAndCheckNoWriteback(
  messageId: string,
  block: ToolResultBlock,
  revisionRepo: SqliteVfsRevisionRepository
): Promise<string> {
  const { conn } = getNovelMasterTestContext();
  const hydrated = await hydrateToolResultsForPrompt(
    [toolResultMessage(block)],
    revisionRepo
  );
  const out = hydrated[0]!.content.blocks[0]!;
  if (out.type !== "tool_result") throw new Error("expected tool_result");
  const rows = await conn.query<{ content_json: string }>(
    `SELECT content_json FROM chat_message WHERE id = ?`,
    [messageId]
  );
  assert.equal(rows.length, 1);
  assert.equal(
    rows[0]!.content_json.includes("contentRef"),
    true,
    "content_json 必须仍保有存量 contentRef（hydrate 只改内存态）"
  );
  assert.ok(
    !rows[0]!.content_json.includes("PLAIN"),
    "回填的 JSON 包不得被写回 content_json"
  );
  return out.content;
}

describe("hydrate-tool-results: T-UA3 兜底 hydrate 形态", () => {
  it("存量 read ref 行 → {path, content} JSON 包（含 revision 明文）；入参不变、contentRef 保留", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`pj-ua3-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const block = await legacyReadRefBlock(
      project.id,
      session.id,
      "/ua3.md",
      "tu-ua3"
    );
    const message = toolResultMessage(block);
    const revisionRepo = new SqliteVfsRevisionRepository(ctx.conn);

    const hydrated = await hydrateToolResultsForPrompt([message], revisionRepo);
    const out = hydrated[0]!.content.blocks[0]!;
    if (out.type !== "tool_result") throw new Error("expected tool_result");

    // 形态 = JSON.stringify({ path, content })——path 取 ref 上的展示路径，
    // content 取 revision 明文（原样，无行号前缀、无分页切片）。
    assert.deepEqual(JSON.parse(out.content), {
      path: "/ua3.md",
      content: "line-1\nline-2\nline-3",
    });
    assert.equal(
      out.content,
      JSON.stringify({ path: "/ua3.md", content: "line-1\nline-2\nline-3" }),
      "落块文本就是确定性 JSON 包（形态断言，不与 legacy wire 比字节）"
    );
    // view-time 纪律：入参消息与块不被变异；contentRef 原样保留。
    assert.equal((message.content.blocks[0] as ToolResultBlock).content, "");
    assert.deepEqual(out.contentRef, block.contentRef);
    // 幂等：对已回填的块再 hydrate 一次，结果同形（内容已是明文，非引用态）。
    const twice = await hydrateToolResultsForPrompt(
      [toolResultMessage(out)],
      revisionRepo
    );
    assert.equal((twice[0]!.content.blocks[0] as ToolResultBlock).content, out.content);
  });

  it("落库存量行 hydrate 后 content_json 不被写回", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`pj-ua3b-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const block = await legacyReadRefBlock(
      project.id,
      session.id,
      "/ua3b.md",
      "tu-ua3b"
    );
    const msg = await ctx.messages.append(session.id, "assistant", {
      blocks: [block],
    });
    const revisionRepo = new SqliteVfsRevisionRepository(ctx.conn);
    const hydrated = await hydrateAndCheckNoWriteback(msg.id, block, revisionRepo);
    assert.deepEqual(JSON.parse(hydrated), {
      path: "/ua3b.md",
      content: "line-1\nline-2\nline-3",
    });
  });

  it("kind:\"skill\" 存量行同款 JSON 包（files 等派生字段弃置）", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`pj-ua3c-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const readBlock = await legacyReadRefBlock(
      project.id,
      session.id,
      "/ua3c.md",
      "tu-ua3c-src"
    );
    const base = readBlock.contentRef as ReadResultRef;
    const ref: SkillResultRef = {
      kind: "skill",
      action: "load",
      domain: "project",
      name: "ua3c-skill",
      path: "SKILL.md",
      entryId: base.entryId,
      version: base.version,
      contentHash: base.contentHash,
      totalBytes: base.totalBytes,
      offset: 1,
      returnedLines: 0,
      totalLines: 0,
      truncated: false,
      files: ["refs/helper.md"],
    };
    const block = legacySkillRefBlock(ref, "tu-ua3c");
    const revisionRepo = new SqliteVfsRevisionRepository(ctx.conn);

    const warns = await captureWarnings(async () => {
      const hydrated = await hydrateToolResultsForPrompt(
        [toolResultMessage(block)],
        revisionRepo
      );
      const out = hydrated[0]!.content.blocks[0] as ToolResultBlock;
      assert.deepEqual(JSON.parse(out.content), {
        path: "SKILL.md",
        content: "line-1\nline-2\nline-3",
      });
      assert.deepEqual(out.contentRef, ref);
      // files 不进 JSON 包（兜底无消费方）。
      assert.equal(out.content.includes("helper.md"), false);
    });
    assert.deepEqual(warns, [], "取得到明文不该 warn");
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

describe("hydrate-tool-results: T-UA4 取不到明文 → 错误占位 + warn（永不抛错）", () => {
  it("revision 行缺失（裸删绕过保活链）→ 占位 JSON + warn", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`pj-ua4a-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const block = await legacyReadRefBlock(
      project.id,
      session.id,
      "/ua4a.md",
      "tu-ua4a"
    );
    const ref = block.contentRef as ReadResultRef;
    await ctx.conn.execute(
      `DELETE FROM vfs_revision WHERE entry_id = ? AND version = ?`,
      [ref.entryId, ref.version]
    );
    const revisionRepo = new SqliteVfsRevisionRepository(ctx.conn);

    let content = "";
    const warns = await captureWarnings(async () => {
      const hydrated = await hydrateToolResultsForPrompt(
        [toolResultMessage(block)],
        revisionRepo
      );
      content = (hydrated[0]!.content.blocks[0] as ToolResultBlock).content;
    });
    const parsed = JSON.parse(content) as { path: string; error: string };
    assert.equal(parsed.path, "/ua4a.md", "占位仍带 path 定位线索");
    assert.match(parsed.error, /取不回/, "占位说明「本该有正文但取不到」");
    assert.ok(
      warns.some((w) => /hydrate-tool-results-for-prompt/.test(w)),
      "缺 revision 必须有 warn 可观测"
    );
    assert.ok(
      warns.some((w) => /revision 行缺失/.test(w)),
      `warn 应点明原因，实际：${warns.join(" | ")}`
    );
  });

  it("revision status=deleted → 占位 JSON + warn（明文不可再生）", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`pj-ua4b-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const block = await legacyReadRefBlock(
      project.id,
      session.id,
      "/ua4b.md",
      "tu-ua4b"
    );
    const ref = block.contentRef as ReadResultRef;
    const revisionRepo = new SqliteVfsRevisionRepository(ctx.conn);

    // 牙齿：置 deleted 前同一块 hydrate 正常（不是恒真的失败路径）。
    const okContent = (
      await hydrateToolResultsForPrompt(
        [toolResultMessage(block)],
        revisionRepo
      )
    )[0]!.content.blocks[0] as ToolResultBlock;
    assert.match(okContent.content, /line-1/);

    await ctx.conn.execute(
      `UPDATE vfs_revision SET status = 'deleted' WHERE entry_id = ? AND version = ?`,
      [ref.entryId, ref.version]
    );
    let content = "";
    const warns = await captureWarnings(async () => {
      const hydrated = await hydrateToolResultsForPrompt(
        [toolResultMessage(block)],
        revisionRepo
      );
      content = (hydrated[0]!.content.blocks[0] as ToolResultBlock).content;
    });
    const parsed = JSON.parse(content) as { path: string; error: string };
    assert.match(parsed.error, /取不回/);
    assert.ok(
      warns.some((w) => /已删除|deleted/.test(w)),
      `warn 应点明 deleted，实际：${warns.join(" | ")}`
    );
  });

  it("元数据命中但行已不在（并发删/GC 兜底；防御分支，生产仓储下不可达）→ 占位 JSON + warn", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`pj-ua4c-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const block = await legacyReadRefBlock(
      project.id,
      session.id,
      "/ua4c.md",
      "tu-ua4c"
    );
    // 命中的是「meta 有行、findByEntryAndVersion 返 null」这一档（实现里是
    // 元数据查询之后行被并发删除或 GC 的兜底），不是「blob 缺失」——真实
    // blob 被清理走 contentStore.get 抛错，见下一条用例。
    const emptyRepo = {
      findMetaByEntryAndVersion: async () => ({
        status: "active",
        contentHash: "whatever",
      }),
      findByEntryAndVersion: async () => null,
    } as unknown as VfsRevisionRepository;

    let content = "";
    const warns = await captureWarnings(async () => {
      const hydrated = await hydrateToolResultsForPrompt(
        [toolResultMessage(block)],
        emptyRepo
      );
      content = (hydrated[0]!.content.blocks[0] as ToolResultBlock).content;
    });
    assert.match((JSON.parse(content) as { error: string }).error, /取不回/);
    assert.ok(
      warns.some((w) => /revision 行缺失/.test(w)),
      `warn 应点明行缺失，实际：${warns.join(" | ")}`
    );
  });

  it("blob 被清理（真路径：contentStore.get 抛错）→ 占位 + warn 留痕（读取 revision 失败），不抛错", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`pj-ua4c2-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const block = await legacyReadRefBlock(
      project.id,
      session.id,
      "/ua4c2.md",
      "tu-ua4c2"
    );
    const ref = block.contentRef as ReadResultRef;
    const revisionRepo = new SqliteVfsRevisionRepository(ctx.conn);

    // 牙齿：删 blob 之前同一块 hydrate 正常（不是恒真的失败路径）。
    const okContent = (
      await hydrateToolResultsForPrompt(
        [toolResultMessage(block)],
        revisionRepo
      )
    )[0]!.content.blocks[0] as ToolResultBlock;
    assert.match(okContent.content, /line-1/);

    // 真实坏行形态：revision 行仍在（meta 命中、status=active），但它的
    // content_hash 指向的 blob 已被清理 → contentStore.get 抛错 →
    // hydrate 的 catch 分支降级为占位 + warn，永不抛错。
    await ctx.conn.execute(
      `DELETE FROM vfs_content_blob WHERE content_hash = ?`,
      [ref.contentHash]
    );
    // 必须清掉进程内解压产物层：否则 blob 行已删也还能从内存命中
    // （口径前提，见 infra/content-cache 模块头）。
    clearDecodedContentCaches();

    let content = "";
    const warns = await captureWarnings(async () => {
      const hydrated = await hydrateToolResultsForPrompt(
        [toolResultMessage(block)],
        revisionRepo
      );
      content = (hydrated[0]!.content.blocks[0] as ToolResultBlock).content;
    });
    const parsed = JSON.parse(content) as { path: string; error: string };
    assert.equal(parsed.path, "/ua4c2.md", "占位仍带 path 定位线索");
    // 占位文案是自包含的通用说明（e-tests/G-4 定的口径：成因只走 warn，
    // 不塞进占位——memo 命中 null 的第二个块根本拿不到本块的成因）。
    assert.match(parsed.error, /取不回/);
    assert.match(
      parsed.error,
      /本次装配中不可用/,
      "占位文案自包含，不引用「上方 warn」"
    );
    // 成因（读取 revision 失败 / vfs_content_blob 缺失）走 warn 留痕。
    assert.ok(
      warns.some((w) => /读取 revision 失败/.test(w)),
      `真路径必须留 warn 线索，实际：${warns.join(" | ")}`
    );
    assert.ok(
      warns.some((w) => /vfs_content_blob/.test(w)),
      `warn 应带出底层成因，实际：${warns.join(" | ")}`
    );
  });

  it("revisionRepo 未注入（装配缺口）→ 占位 JSON + warn 点名「装配缺口」", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`pj-ua4d-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const block = await legacyReadRefBlock(
      project.id,
      session.id,
      "/ua4d.md",
      "tu-ua4d"
    );

    let content = "";
    const warns = await captureWarnings(async () => {
      const hydrated = await hydrateToolResultsForPrompt(
        [toolResultMessage(block)],
        undefined
      );
      content = (hydrated[0]!.content.blocks[0] as ToolResultBlock).content;
    });
    const parsed = JSON.parse(content) as { path: string; error: string };
    assert.equal(parsed.path, "/ua4d.md");
    assert.match(parsed.error, /装配缺口/, "占位文案点明装配缺口");
    assert.ok(
      warns.some((w) => /装配缺口/.test(w)),
      `REPO_MISSING 信号保留在 warn，实际：${warns.join(" | ")}`
    );
  });

  it("仓库读取抛错（DB 故障）→ 降级为占位 + warn，不中断装配", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`pj-ua4e-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const block = await legacyReadRefBlock(
      project.id,
      session.id,
      "/ua4e.md",
      "tu-ua4e"
    );
    const brokenRepo = {
      findMetaByEntryAndVersion: async () => {
        throw new Error("模拟 DB 故障");
      },
      findByEntryAndVersion: async () => null,
    } as unknown as VfsRevisionRepository;

    let content = "";
    const warns = await captureWarnings(async () => {
      const hydrated = await hydrateToolResultsForPrompt(
        [toolResultMessage(block)],
        brokenRepo
      );
      content = (hydrated[0]!.content.blocks[0] as ToolResultBlock).content;
    });
    assert.match((JSON.parse(content) as { error: string }).error, /取不回/);
    assert.ok(
      warns.some((w) => /读取 revision 失败/.test(w)),
      `warn 应点明读取失败，实际：${warns.join(" | ")}`
    );
  });

  it("contentHash 与 revision 行不一致 → 照常回填明文 + warn（不算坏行、不占位）", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`pj-ua4f-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const block = await legacyReadRefBlock(
      project.id,
      session.id,
      "/ua4f.md",
      "tu-ua4f"
    );
    const tampered: ToolResultBlock = {
      ...block,
      contentRef: {
        ...(block.contentRef as ReadResultRef),
        contentHash: "0".repeat(64),
      },
    };
    const revisionRepo = new SqliteVfsRevisionRepository(ctx.conn);

    let content = "";
    const warns = await captureWarnings(async () => {
      const hydrated = await hydrateToolResultsForPrompt(
        [toolResultMessage(tampered)],
        revisionRepo
      );
      content = (hydrated[0]!.content.blocks[0] as ToolResultBlock).content;
    });
    assert.deepEqual(JSON.parse(content), {
      path: "/ua4f.md",
      content: "line-1\nline-2\nline-3",
    });
    assert.ok(
      warns.some((w) => /contentHash/.test(w)),
      `指纹漂移留 warn 线索但不阻断，实际：${warns.join(" | ")}`
    );
  });

  it("同 (entryId,version) 的两个引用块 → 明文只取一次（调用内 memo 去重）", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`pj-ua4g-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const block = await legacyReadRefBlock(
      project.id,
      session.id,
      "/ua4g.md",
      "tu-ua4g"
    );
    // 同一 (entryId, version) 的两块（长文件分段 read 是常态）。
    const twin: ToolResultBlock = { ...block, toolUseId: "tu-ua4g-2" };
    const message: ChatMessage = {
      ...toolResultMessage(block),
      content: { blocks: [block, twin] },
    };

    // 计数仓储：只在真仓储外面套一层计数器，不改行为。
    const inner = new SqliteVfsRevisionRepository(ctx.conn);
    let metaCalls = 0;
    let plainCalls = 0;
    const countingRepo = {
      findMetaByEntryAndVersion: (entryId: number, version: number) => {
        metaCalls += 1;
        return inner.findMetaByEntryAndVersion(entryId, version);
      },
      findByEntryAndVersion: (entryId: number, version: number) => {
        plainCalls += 1;
        return inner.findByEntryAndVersion(entryId, version);
      },
    } as unknown as VfsRevisionRepository;

    const warns = await captureWarnings(async () => {
      const hydrated = await hydrateToolResultsForPrompt(
        [message],
        countingRepo
      );
      const blocks = hydrated[0]!.content.blocks as ToolResultBlock[];
      assert.equal(blocks.length, 2);
      assert.deepEqual(JSON.parse(blocks[0]!.content), {
        path: "/ua4g.md",
        content: "line-1\nline-2\nline-3",
      });
      assert.equal(
        blocks[1]!.content,
        blocks[0]!.content,
        "memo 命中的第二块拿到同一份回填正文"
      );
    });
    assert.deepEqual(warns, [], "取得到明文不该 warn");
    assert.equal(metaCalls, 1, `元数据只应查一次，实际 ${metaCalls} 次`);
    assert.equal(plainCalls, 1, `明文只应取一次，实际 ${plainCalls} 次`);

    // 对照：缓存范围严格限定在「一次装配内」——另起一次调用会重新取。
    await hydrateToolResultsForPrompt([message], countingRepo);
    assert.equal(metaCalls, 2, "跨调用不得复用缓存（不跨调用持久化）");
    assert.equal(plainCalls, 2, "跨调用不得复用缓存（不跨调用持久化）");
  });
});

describe("hydrate-tool-results: T-UA6 prepare 接线与孤儿拍平顺序", () => {
  it("prepareUserMessagesForPrompt 对存量 ref 行 hydrate（token / 压缩口径同受益）", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`pj-ua6-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const block = await legacyReadRefBlock(
      project.id,
      session.id,
      "/ua6.md",
      "tu-ua6"
    );
    const revisionRepo = new SqliteVfsRevisionRepository(ctx.conn);
    const message = toolResultMessage(block);
    const prepared = await prepareUserMessagesForPrompt([message], {
      sessionId: session.id,
      sessionKkv: createSessionKkvService(ctx.conn),
      vfs,
      revisionRepo,
    });
    const outBlock = prepared[0]!.content.blocks[0] as ToolResultBlock;
    assert.deepEqual(JSON.parse(outBlock.content), {
      path: "/ua6.md",
      content: "line-1\nline-2\nline-3",
    });
    const bodyText = messageBodyTextFromBlocks(prepared[0]!.content.blocks);
    assert.match(bodyText, /line-1/, "字符口径携带全文（阈值判定不失真）");
    // view-time：prepare 前的内存原消息仍是空 content（不写回纪律）
    assert.equal((message.content.blocks[0] as ToolResultBlock).content, "");
  });

  it("孤儿拍平发生在 hydrate 之后：拍平文本含 JSON 包全文；未 hydrate 的对照只剩占位", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`pj-ua6b-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const block = await legacyReadRefBlock(
      project.id,
      session.id,
      "/ua6b.md",
      "tu-ua6b"
    );
    const revisionRepo = new SqliteVfsRevisionRepository(ctx.conn);
    const message = toolResultMessage(block);
    // 消息数组里没有配对的 assistant tool_use → tool_result 是「孤儿」，
    // 发送前会被 normalizeOrphanToolResultsForLlm 拍平成 text。
    const prepared = await prepareUserMessagesForPrompt([message], {
      sessionId: session.id,
      sessionKkv: createSessionKkvService(ctx.conn),
      vfs,
      revisionRepo,
    });
    const flattened = normalizeOrphanToolResultsForLlm(prepared);
    const flatBlock = flattened[0]!.content.blocks[0]!;
    assert.equal(flatBlock.type, "text");
    const flatText = (flatBlock as { text: string }).text;
    assert.match(flatText, /^\[tool_result id=tu-ua6b\]\n\n/);
    // 拍平链路会把 tool_result 的 JSON 正文重新美化打印，故按内容而非逐字节断言：
    assert.match(flatText, /"path": "\/ua6b\.md"/);
    assert.match(flatText, /line-1\\nline-2\\nline-3/);

    // 对照组：跳过 prepare/hydrate 直接拍平原始引用块 → 只剩占位文本，
    // 正文丢失——证明「hydrate 必须先于孤儿拍平」（删掉 prepare 的 hydrate
    // 接线，上面的断言即红）。
    const flatRaw = normalizeOrphanToolResultsForLlm([message]);
    const rawBlock = flatRaw[0]!.content.blocks[0]!;
    assert.equal(rawBlock.type, "text");
    assert.equal(
      (rawBlock as { text: string }).text,
      "[tool_result id=tu-ua6b]"
    );
  });

  it("prepare 对无 revisionRepo 的 legacy 消息（无引用块）行为不变", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`pj-ua6c-${suffix}`);
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
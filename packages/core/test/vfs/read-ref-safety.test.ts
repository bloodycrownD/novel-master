/**
 * read / skill 消息侧引用的保活链安全性（task-attach-unref Step 4）。
 *
 * v1.5.30 起引用化退役，写侧恒全文直出、read 不再 `+1`。五个场景逐条
 * 定去留（口径见每段 describe 的注释）：
 *
 * - T-RR5 **改写**：read 不再保活中间版本——read v1 → edit v2 → 触发
 *   sweep 后 v1 revision 被回收；工具结果正文仍在消息里（全文直出是
 *   自包含的），保活链不再承担「read 过的内容不许丢」的责任。牙齿：实现
 *   改回 `+1` 即红（v1 会存活）。
 * - T-RR6 **改写 + 保留**：fork 的 `+1` 挂点本版保留，故存量引用行在
 *   fork 后仍按持有消息数抬 ref、且 fork 会话按**源** `(entryId, version)`
 *   hydrate 出源明文；另加新写全文行 fork 零 ref 调整。
 * - T-RR7 / T-RR8 / T-RR9 **保留**：删源会话、pull 重置工作区、导入重开
 *   entry 三条路径对存量引用行的保活 / 定位语义未变——它们守的是
 *   `−1` 挂点与兜底 hydrate 的全局键定位，回迁完成前仍必需。
 *
 * 每个场景都走真实 service 层入口（messages.delete 内嵌 sweep / messages.fork /
 * sessions.delete 的 deleteSessionTree / sessions.pullTemplate 的
 * initializeSessionWorkspace / 角色卡与 ZIP 导入），断言不只看「没报错」：
 * 直查 `vfs_revision` 行存在性与 ref_count、直查 `vfs_content_blob` 行，
 * 外加兜底 hydrate 的回填内容（存量行 → `{path, content}` JSON 包）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createCharacterCardImportService,
  createVfsZipIoService,
} from "@novel-master/core/vfs";
import type { ChatMessage } from "../../src/domain/chat/model/message.js";
import type {
  ContentBlock,
  ReadResultRef,
  ToolResultBlock,
} from "../../src/domain/chat/model/content-block.js";
import { hydrateToolResultsForPrompt } from "../../src/domain/chat/logic/hydrate-tool-results-for-prompt.js";
import { buildToolResultBlock } from "../../src/domain/tool/logic/build-tool-result-block.js";
import { ToolRegistry } from "../../src/domain/tool/logic/tool-registry.js";
import { ToolRunner } from "../../src/domain/tool/logic/tool-runner.js";
import { registerBuiltinTools } from "../../src/domain/tool/builtin/register-builtin-tools.js";
import type { BuiltinToolContext } from "../../src/domain/tool/builtin/builtin-tool-context.js";
import type { ReadToolOutput } from "../../src/domain/tool/builtin/vfs-tools.js";
import { SqliteVfsRevisionRepository } from "../../src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { buildVfsZip } from "../../src/domain/vfs/logic/vfs-zip-build.js";
import { runVfsContentPacking } from "../../src/infra/db-maintenance/impl/vfs-content-packing.js";
import { clearDecodedContentCaches } from "../../src/infra/content-cache/logic/decoded-content-cache.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

/** 一条存量引用行 / 一条新写全文行。 */
type RefSeed = {
  readonly block: ToolResultBlock;
  readonly entryId: number;
  readonly version: number;
  readonly contentHash: string;
};

/**
 * 造一条 v1.5.29 存量引用行（`content === ""` + `contentRef`）并补上当初
 * read 发生的那次 `+1`——写侧已无引用化，不手工补就模拟不出「被引用持有」
 * 这一状态。`legacy` 为 false 时改产新写全文块（零 ref 调整）。
 */
async function seedRead(
  projectId: string,
  sessionId: string,
  path: string,
  toolUseId: string,
  options: { content?: string; legacy?: boolean } = {}
): Promise<RefSeed> {
  const { conn, sessionVfs } = getNovelMasterTestContext();
  const legacy = options.legacy ?? true;
  const content = options.content ?? "第一章\n主角登场\n伏笔一枚";
  await sessionVfs(projectId, sessionId).write(path, content);
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
  const contentHash = revRows[0]!.content_hash;

  if (!legacy) {
    const ctx: BuiltinToolContext = {
      vfs: sessionVfs(projectId, sessionId),
      projectId,
      sessionId,
      listSessionMessages: async () => [],
    };
    const registry = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(registry);
    const runner = new ToolRunner(registry);
    const output = await runner.call<ReadToolOutput>("read", { path }, ctx);
    const block = buildToolResultBlock(
      toolUseId,
      { ok: true, output },
      { toolName: "read" }
    );
    assert.equal(block.contentRef, undefined);
    return { block, entryId, version: output.version, contentHash };
  }

  const ref: ReadResultRef = {
    path,
    entryId,
    version: 1,
    contentHash,
    totalBytes: content.length,
    offset: 1,
    limit: 2000,
    returnedLines: content.split("\n").length,
    totalLines: content.split("\n").length,
    truncated: false,
  };
  await conn.execute(
    `UPDATE vfs_revision SET ref_count = ref_count + 1 WHERE entry_id = ? AND version = ?`,
    [entryId, 1]
  );
  return {
    block: {
      type: "tool_result",
      toolUseId,
      content: "",
      ok: true,
      summary: `${ref.returnedLines} lines`,
      contentRef: ref,
    },
    entryId,
    version: 1,
    contentHash,
  };
}

/** 跑一次 edit 工具（真实 mutation 链路：vfs.replace 产生新版本）。 */
async function runEdit(
  projectId: string,
  sessionId: string,
  input: { path: string; oldString: string; newString: string }
): Promise<{ version: number; replacements: number }> {
  const { sessionVfs } = getNovelMasterTestContext();
  const ctx: BuiltinToolContext = {
    vfs: sessionVfs(projectId, sessionId),
    projectId,
    sessionId,
    listSessionMessages: async () => [],
  };
  const registry = new ToolRegistry<BuiltinToolContext>();
  registerBuiltinTools(registry);
  const runner = new ToolRunner(registry);
  return runner.call<{ version: number; replacements: number }>(
    "edit",
    input,
    ctx
  );
}

/** 追加一条消息（blocks 由调用方给定）。 */
async function appendMessage(
  sessionId: string,
  blocks: readonly ContentBlock[]
): Promise<ChatMessage> {
  const { messages } = getNovelMasterTestContext();
  return messages.append(sessionId, "assistant", { blocks });
}

/** vfs_revision 点查；行不存在（已被 GC）返回 null。 */
async function revisionRowOf(
  entryId: number,
  version: number
): Promise<{ refCount: number; contentHash: string } | null> {
  const { conn } = getNovelMasterTestContext();
  const rows = await conn.query<{
    ref_count: number;
    content_hash: string;
  }>(
    `SELECT ref_count, content_hash FROM vfs_revision WHERE entry_id = ? AND version = ?`,
    [entryId, version]
  );
  return rows.length === 0
    ? null
    : {
        refCount: Number(rows[0]!.ref_count),
        contentHash: String(rows[0]!.content_hash),
      };
}

/** vfs_content_blob 点查；行不存在（触发器已回收）返回 null。 */
async function blobRefCountOf(contentHash: string): Promise<number | null> {
  const { conn } = getNovelMasterTestContext();
  const rows = await conn.query<{ ref_count: number }>(
    `SELECT ref_count FROM vfs_content_blob WHERE content_hash = ?`,
    [contentHash]
  );
  return rows.length === 0 ? null : Number(rows[0]!.ref_count);
}

/**
 * 对落库消息做 view-time 兜底 hydrate，取首个 tool_result 块的回填内容。
 *
 * 新语义下返回的是 `{path, content}` 的 JSON 包（存量行）或原样全文
 * （新写行 / legacy 行），故调用方一律按内容断言而非与 legacy wire 比字节。
 */
async function hydrateFirstToolResultContent(
  messages: readonly ChatMessage[]
): Promise<string> {
  const { conn } = getNovelMasterTestContext();
  const hydrated = await hydrateToolResultsForPrompt(
    messages,
    new SqliteVfsRevisionRepository(conn)
  );
  const target = hydrated.find((m) =>
    m.content.blocks.some(
      (b) => b.type === "tool_result" && b.contentRef != null
    )
  );
  if (target != null) {
    const block = target.content.blocks.find(
      (b) => b.type === "tool_result"
    ) as ToolResultBlock;
    return block.content;
  }
  // 无引用块：新写全文行零处理，取首个 tool_result 块。
  const anyTarget = hydrated.find((m) =>
    m.content.blocks.some((b) => b.type === "tool_result")
  );
  assert.ok(anyTarget != null, "必须存在含 tool_result 的消息");
  const block = anyTarget.content.blocks.find(
    (b) => b.type === "tool_result"
  ) as ToolResultBlock;
  return block.content;
}

describe("read-ref-safety: T-RR5 read 不再保活中间版本（改写）", () => {
  it("read v1 → edit v2 → 删另一条消息触发 sweep：v1 revision/blob 被回收，正文仍在消息里（全文自包含）", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-rr5-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    // 新写全文行：read 不 +1。turn 内 read 后 edit，v1 既无 checkpoint 指针
    // 也无消息侧引用 → 会被 sweep 回收——这正是 unref 的预期（正文在消息里）。
    await vfs.write("/novel.md", "第一章\n主角登场\n伏笔一枚");
    const seed = await seedRead(
      project.id,
      session.id,
      "/novel.md",
      "tu-rr5",
      { legacy: false }
    );
    const msg = await appendMessage(session.id, [seed.block as ContentBlock]);
    const editResult = await runEdit(project.id, session.id, {
      path: "/novel.md",
      oldString: "伏笔一枚",
      newString: "伏笔两枚\n第二章",
    });
    assert.equal(editResult.replacements, 1);
    // v1：live head 已转 v2，且 read 未 +1 → ref = 0。
    assert.equal((await revisionRowOf(seed.entryId, 1))!.refCount, 0);

    // 对照：ctrl.txt 的 v1 无任何持有者（write 直接覆盖）。
    await vfs.write("/ctrl.txt", "ctrl-old");
    const ctrlEntryRows = await ctx.conn.query<{ entry_id: number }>(
      `SELECT entry_id FROM vfs_entry WHERE path = ?`,
      ["/ctrl.txt"]
    );
    const ctrlEntryId = ctrlEntryRows[0]!.entry_id;
    const ctrlV1 = await revisionRowOf(ctrlEntryId, 1);
    assert.ok(ctrlV1 != null);
    await vfs.write("/ctrl.txt", "ctrl-new");

    // 删一条无关消息：messages.delete 事务内 sweepSessionRevisions 真实触发。
    const other = await appendMessage(session.id, [
      { type: "text", text: "无关消息，删除用于触发 sweep" },
    ]);
    await ctx.messages.delete(other.id);

    // 对照先断言：ctrl v1（ref=0）被 sweep 回收、其 blob 触发器连带归零删除
    // ——证明 sweep 真的扫到了本会话。
    assert.equal(
      await revisionRowOf(ctrlEntryId, 1),
      null,
      "无引用的历史 revision 应被 sweep 回收（对照组）"
    );
    assert.equal(
      await blobRefCountOf(ctrlV1.contentHash),
      null,
      "对照 revision 的 blob 应被触发器连带回收"
    );

    // 主角断言：read 不再是持有者，v1 与其 blob 同样被回收。
    assert.equal(
      await revisionRowOf(seed.entryId, 1),
      null,
      "read 不再 +1，中间版本不被保活（实现改回引用化即红）"
    );
    assert.equal(
      await blobRefCountOf(seed.contentHash),
      null,
      "v1 的 blob 随 sweep 回收"
    );

    // 但工具结果正文自包含在消息里：版本被回收不影响已发出去的 read 全文。
    const msgs = await ctx.messages.listBySession(session.id);
    const kept = msgs.find((m) => m.id === msg.id)!;
    const block = kept.content.blocks[0] as ToolResultBlock;
    assert.equal(block.contentRef, undefined);
    assert.match(block.content, /主角登场/, "全文直出：正文不依赖 revision 存活");
    assert.equal(
      await hydrateFirstToolResultContent(msgs),
      block.content,
      "无引用块的消息零处理（原文透传）"
    );

    // sanity：edit 确实生效（当前 head 是 v2 内容）。
    assert.equal(
      (await vfs.read("/novel.md")).content,
      "第一章\n主角登场\n伏笔两枚\n第二章"
    );
  });

  it("存量引用行仍保活中间版本（−1/hold 语义未随 unref 摘除）", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-rr5b-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    const seed = await seedRead(project.id, session.id, "/kept.md", "tu-rr5b");
    await appendMessage(session.id, [seed.block as ContentBlock]);
    await runEdit(project.id, session.id, {
      path: "/kept.md",
      oldString: "第一章",
      newString: "第一章改",
    });
    // live head 转 v2 后只剩存量引用 1 份。
    assert.equal((await revisionRowOf(seed.entryId, 1))!.refCount, 1);

    const other = await appendMessage(session.id, [
      { type: "text", text: "触发 sweep 的无关消息" },
    ]);
    await ctx.messages.delete(other.id);

    const row = await revisionRowOf(seed.entryId, 1);
    assert.ok(row != null, "被存量引用持有的 v1 必须存活");
    assert.equal(row.refCount, 1);
    assert.ok((await blobRefCountOf(row.contentHash)) != null, "v1 的 blob 必须存活");

    // 兜底 hydrate 仍能取回明文（JSON 包形态）。
    const msgs = await ctx.messages.listBySession(session.id);
    const content = await hydrateFirstToolResultContent(msgs);
    assert.deepEqual(JSON.parse(content), {
      path: "/kept.md",
      content: "第一章\n主角登场\n伏笔一枚",
    });
  });
});

describe("read-ref-safety: T-RR6 fork 与存量引用行的定位", () => {
  it("存量引用行：fork 后按持有消息数 +1；fork 会话按源 (entryId, version) 回填源明文", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-rr6-${suffix}`);
    const session = await ctx.sessions.create(project.id);

    const seed1 = await seedRead(project.id, session.id, "/fork.md", "tu-rr6a", {
      content: "fork 基线一\nfork 基线二",
    });
    await appendMessage(session.id, [seed1.block as ContentBlock]);
    const seed2 = await seedRead(project.id, session.id, "/fork.md", "tu-rr6b", {
      content: "fork 基线一\nfork 基线二",
    });
    await appendMessage(session.id, [seed2.block as ContentBlock]);
    assert.equal(seed1.entryId, seed2.entryId);
    // live(1) + 存量引用 ×2（两条消息各 1 份）= 3。
    assert.equal((await revisionRowOf(seed1.entryId, 1))!.refCount, 3);

    // fork（service 层入口）：toCopy = [msg1, msg2]，对源 revision 聚合 +2。
    const msgs = await ctx.messages.listBySession(session.id);
    const forked = await ctx.messages.fork(session.id, msgs[1]!.id);
    assert.notEqual(forked.id, session.id);
    assert.equal(
      (await revisionRowOf(seed1.entryId, 1))!.refCount,
      5,
      "fork 后源 revision ref_count 应为 3 + 2（两条持有消息各 +1）"
    );

    // fork 消息浅拷贝保留原引用键：contentRef 与源块逐字段一致。
    const forkMsgs = await ctx.messages.listBySession(forked.id);
    assert.equal(forkMsgs.length, 2);
    assert.deepEqual(
      (forkMsgs[0]!.content.blocks[0] as ToolResultBlock).contentRef,
      seed1.block.contentRef
    );

    // fork 会话 hydrate 定位的是**源** revision（全局键），不是 fork scope 的
    // 新 entry：fork scope 的 /fork.md 是 copyVfsTree 开的新 entryId。
    const forkEntryRows = await ctx.conn.query<{ entry_id: number }>(
      `SELECT entry_id FROM vfs_entry WHERE scope_key = ? AND path = ?`,
      [`session:${project.id}:${forked.id}`, "/fork.md"]
    );
    assert.equal(forkEntryRows.length, 1, "fork scope 应有 /fork.md");
    assert.notEqual(
      forkEntryRows[0]!.entry_id,
      seed1.entryId,
      "fork scope 的 entry 必须是新 entryId（引用只能指向源 revision）"
    );

    // fork 会话里文件继续演进后 hydrate 仍输出源内容（按全局键锚定）。
    await ctx.sessionVfs(project.id, forked.id).write(
      "/fork.md",
      "fork 会话改写后的完全不同内容"
    );
    const content = await hydrateFirstToolResultContent(forkMsgs);
    assert.deepEqual(JSON.parse(content), {
      path: "/fork.md",
      content: "fork 基线一\nfork 基线二",
    });
  });

  it("新写全文行：fork 不做任何 ref 调整（fork 挂点只对存量 contentRef 生效）", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-rr6b-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const seed = await seedRead(
      project.id,
      session.id,
      "/forkfull.md",
      "tu-rr6b",
      { legacy: false }
    );
    const msg = await appendMessage(session.id, [seed.block as ContentBlock]);
    assert.equal((await revisionRowOf(seed.entryId, seed.version))!.refCount, 1);

    await ctx.messages.fork(session.id, msg.id);
    assert.equal(
      (await revisionRowOf(seed.entryId, seed.version))!.refCount,
      1,
      "全文行不产生引用指针，fork 不抬 ref"
    );
  });
});

describe("read-ref-safety: T-RR7 源会话删除后 fork 会话引用仍活（保留）", () => {
  it("deleteSessionTree 删源会话后：被 fork 引用的 revision/blob 留存，fork 会话兜底 hydrate 正常", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-rr7-${suffix}`);
    const session = await ctx.sessions.create(project.id);

    const seed = await seedRead(
      project.id,
      session.id,
      "/origin.md",
      "tu-rr7",
      { content: "origin-唯一正文" }
    );
    const msg = await appendMessage(session.id, [seed.block as ContentBlock]);
    // live(1) + 存量引用(1) = 2；fork +1 → 3。
    assert.equal((await revisionRowOf(seed.entryId, 1))!.refCount, 2);
    const forked = await ctx.messages.fork(session.id, msg.id);
    assert.equal((await revisionRowOf(seed.entryId, 1))!.refCount, 3);

    // 删源会话（deleteSessionTree：read −1 + live −1 + entry 整树删除）。
    await ctx.sessions.delete(session.id);

    // 源 revision/blob 留存：ref 恰为 fork 持有的 1 份。
    const row = await revisionRowOf(seed.entryId, 1);
    assert.ok(row != null, "源会话删除后被 fork 引用的 revision 必须留存");
    assert.equal(row.refCount, 1, "ref 应恰为 fork 会话的 1 份持有");
    assert.ok(
      (await blobRefCountOf(row.contentHash)) != null,
      "被 fork 引用的 blob 必须留存"
    );

    // fork 会话还在、兜底 hydrate 回填源明文。
    const remaining = await ctx.sessions.listByProject(project.id);
    assert.ok(remaining.some((s) => s.id === forked.id), "fork 会话应存活");
    const forkMsgs = await ctx.messages.listBySession(forked.id);
    assert.deepEqual(JSON.parse(await hydrateFirstToolResultContent(forkMsgs)), {
      path: "/origin.md",
      content: "origin-唯一正文",
    });
  });
});

describe("read-ref-safety: T-RR8 pull 不释放（模板重置工作区，保留）", () => {
  it("pullTemplate 后被存量引用的旧 revision 留存、兜底 hydrate 正常；pull 前的无人引用 head 被回收（对照组）", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-rr8-${suffix}`);
    // project template 先有内容，session create 时会镜像进 session scope。
    await ctx.projectVfs(project.id).write("/tpl.md", "tpl-fixed");
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    // session 自建文件（不在 template 里）：存量引用 v1 后再写 v2——pull 会清掉
    // 整个 session 工作区重置为 template，v1 只剩存量引用。
    const seed = await seedRead(
      project.id,
      session.id,
      "/scratch.md",
      "tu-rr8",
      { content: "scratch-one" }
    );
    await appendMessage(session.id, [seed.block as ContentBlock]);
    await svfs.write("/scratch.md", "scratch-two");
    // v1：存量引用(1)；v2：live head(1)。
    assert.equal((await revisionRowOf(seed.entryId, 1))!.refCount, 1);
    assert.ok((await revisionRowOf(seed.entryId, 2)) != null);

    // pull（service 层入口）：clearCheckpoints + initializeSessionWorkspace
    // 重置工作区（decrementLiveRefs + deleteVfsPrefix + sweep）+ blob gc。
    await ctx.sessions.pullTemplate(session.id);

    // 对照：v2（pull 前的 head，无引用）应被 pull 的 sweep 回收——证明
    // 「不释放」是 ref_count>0 的定向保活，而不是 sweep 没跑。
    assert.equal(
      await revisionRowOf(seed.entryId, 2),
      null,
      "pull 前无人引用的 head revision 应被回收（对照组）"
    );
    // 主角：v1（被存量引用）留存、blob 留存、兜底 hydrate 正常。
    const v1Row = await revisionRowOf(seed.entryId, 1);
    assert.ok(v1Row != null, "被存量引用持有的 revision 在 pull 后必须留存");
    assert.equal(v1Row.refCount, 1, "存量引用不被 pull 释放");
    assert.ok((await blobRefCountOf(v1Row.contentHash)) != null);
    const msgs = await ctx.messages.listBySession(session.id);
    assert.deepEqual(JSON.parse(await hydrateFirstToolResultContent(msgs)), {
      path: "/scratch.md",
      content: "scratch-one",
    });

    // sanity：pull 确实重置了工作区（自建文件消失、template 内容在）。
    await assert.rejects(() => svfs.read("/scratch.md"));
    assert.equal((await svfs.read("/tpl.md")).content, "tpl-fixed");
  });
});

describe("read-ref-safety: T-RR9 导入错位免疫（重开 entry 后旧引用仍定位，保留）", () => {
  it("角色卡导入重开 entry：旧 entryId 的存量引用仍定位（revision/blob 保活链），回填旧内容", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-rr9a-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };

    const seed = await seedRead(
      project.id,
      session.id,
      "/角色/世界书/设定.md",
      "tu-rr9a",
      { content: "旧设定正文——导入前" }
    );
    await appendMessage(session.id, [seed.block as ContentBlock]);
    // live(1) + 存量引用(1) = 2。
    assert.equal((await revisionRowOf(seed.entryId, 1))!.refCount, 2);

    // 导入（service 层入口）：deleteVfsPrefix 重开 /角色 前缀 + 新 entryId。
    const svc = createCharacterCardImportService(ctx.conn);
    await svc.import(
      scope,
      new Map([["世界书/设定.md", "新设定正文——导入后"]]),
      { confirmed: true, directoryPath: "/角色" }
    );

    // 重开成功：同 path 绑定到新 entryId（导入错位源）。
    const reread = await vfs.read("/角色/世界书/设定.md");
    assert.equal(reread.content, "新设定正文——导入后");

    // 旧 entryId 的 revision/blob 保活：live −1 后恰剩存量引用 1 份。
    const row = await revisionRowOf(seed.entryId, 1);
    assert.ok(row != null, "旧 entryId 的 revision 必须留存（保活链）");
    assert.equal(row.refCount, 1);
    assert.ok((await blobRefCountOf(row.contentHash)) != null);

    // 旧引用仍定位：兜底 hydrate 按 (entryId, version) 全局键回填旧明文。
    const msgs = await ctx.messages.listBySession(session.id);
    assert.deepEqual(JSON.parse(await hydrateFirstToolResultContent(msgs)), {
      path: "/角色/世界书/设定.md",
      content: "旧设定正文——导入前",
    });
  });

  it("ZIP 导入重开 entry：旧 entryId 的存量引用仍定位（revision/blob 保活链）", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-rr9b-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };

    const seed = await seedRead(project.id, session.id, "/zipzone/a.md", "tu-rr9b", {
      content: "zip-old-content",
    });
    await appendMessage(session.id, [seed.block as ContentBlock]);
    assert.equal((await revisionRowOf(seed.entryId, 1))!.refCount, 2);

    // ZIP 导入（service 层入口）：buildVfsZip 构造真实 zip 字节流。
    const zipSvc = createVfsZipIoService(ctx.conn);
    await zipSvc.import(
      scope,
      buildVfsZip(new Map([["a.md", "zip-new-content"]])),
      { confirmed: true, directoryPath: "/zipzone" }
    );

    const reread = await vfs.read("/zipzone/a.md");
    assert.equal(reread.content, "zip-new-content");

    const row = await revisionRowOf(seed.entryId, 1);
    assert.ok(row != null, "旧 entryId 的 revision 必须留存（保活链）");
    assert.equal(row.refCount, 1);
    assert.ok((await blobRefCountOf(row.contentHash)) != null);

    const msgs = await ctx.messages.listBySession(session.id);
    assert.deepEqual(JSON.parse(await hydrateFirstToolResultContent(msgs)), {
      path: "/zipzone/a.md",
      content: "zip-old-content",
    });
  });
});

describe("read-ref-safety: read 引用 × VFS 内容打包（pbm-9 合并轮定向用例）", () => {
  it("read v1 → edit v2 → 打包任务收走 v1 blob → 冷态 hydrate 经 member 读路径逐字节还原（wire 不变）", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-rrpk-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    // 主角形态：read 引用 v1，两次 edit 落 v2/v3——分组闸要求 entry 内有
    // ≥2 个非 head hash 才成组（单条旧版本是「孤立候选」不成组，e2e 实测
    // 口径），故做到 v3 为 head、v1/v2 双双成为打包候选。正文带唯一标记：
    // 本文件 fixture 库跨 describe 共享、内容又是按 hash 寻址——正文与
    // T-RR5 撞 hash 时，v2 会被「hash 被任何 entry 引用即排除」的谓词当作
    // 别家 entry 的 head 顶掉，entry 退化为孤立候选不成组（首轮红灯实证）。
    const marker = `rrpk-${suffix}`;
    await vfs.write(`/pack.md`, `第一章 ${marker}\n伏笔一枚`);
    const seed = await seedRead(project.id, session.id, "/pack.md", "tu-rrpk");
    await appendMessage(session.id, [seed.block]);
    const editResult = await runEdit(project.id, session.id, {
      path: "/pack.md",
      oldString: "伏笔一枚",
      newString: `伏笔两枚 ${marker}\n第二章`,
    });
    assert.equal(editResult.replacements, 1);
    const editResult2 = await runEdit(project.id, session.id, {
      path: "/pack.md",
      oldString: "第二章",
      newString: `第二章改 ${marker}\n第三章`,
    });
    assert.equal(editResult2.replacements, 1);

    // 打包前基准：hydrate 走 blob 行。
    const beforePack = await hydrateFirstToolResultContent(
      await ctx.messages.listBySession(session.id)
    );
    assert.equal(beforePack, seed.baseline);

    // 打包任务收走 v1：hash 落 member 行、原 blob 行删除（这正是省空间的
    // 动作），revision 行与 read 引用计数不动。
    await runVfsContentPacking(ctx.conn);
    const memberRows = await ctx.conn.query<{ pack_id: number }>(
      `SELECT pack_id FROM vfs_content_pack_member WHERE content_hash = ?`,
      [seed.contentHash]
    );
    assert.equal(memberRows.length, 1, "v1 的 hash 应已被收进 pack member");
    assert.equal(
      await blobRefCountOf(seed.contentHash),
      null,
      "打包后原 blob 行应被删除（内容由 pack 承载）"
    );
    const row = await revisionRowOf(seed.entryId, 1);
    assert.ok(row != null, "read 引用的 revision 行不受打包影响");
    assert.equal(row.refCount, 1, "read 引用计数不受打包影响");

    // 打包后再 hydrate：先清解压缓存冷态化（T-VP13 教训——热缓存命中会让
    // member 读路径假绿），逼 hydrate 从 pack member 解出明文，wire 逐字节
    // 与基准一致。
    clearDecodedContentCaches();
    const afterPack = await hydrateFirstToolResultContent(
      await ctx.messages.listBySession(session.id)
    );
    assert.equal(
      afterPack,
      seed.baseline,
      "member 读路径 hydrate 须与基准逐字节一致"
    );
  });
});

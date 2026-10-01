/**
 * revision ref_count 的消息侧引用对账（task-attach-unref Step 4）。
 *
 * v1.5.30 起 read / skill 引用化退役：写侧恒全文直出、新消息不再产
 * `contentRef`、不再 `+1`。但 v1.5.29 装机窗口写入的**存量引用行**还在
 * 库里，回迁任务完成前，删除路径的 `−1` 挂点与 repair 三类期望值都仍是
 * 它们正确性的唯一保障（本版按纪律保留）。故本文件覆盖两态：
 *
 * - **存量态**（T-RR4 / T-RR13 主干）：手工构造 `content === ""` +
 *   `contentRef` 的存量块并模拟其当初的 `+1`，逐条验证五条删除路径 /
 *   fork / copy / updateContent / truncateAfter 的 `−1` 与期望值口径未回归。
 * - **新写态**（T-UA5）：真链路 read 落的是全文块，删除该消息时**零 ref
 *   调整**，也不计入 repair 期望值。
 *
 * 链路说明：abort 本身保留已落库 partial 不删消息（agent-runner 统一
 * abort 处理只置 stopReason）；删已落库消息的截断链（rollbackToMessage /
 * truncateMessagesAfter）全部经 truncateTailInTransaction，挂点覆盖即全覆盖。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatMessage } from "../../src/domain/chat/model/message.js";
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
import { SqliteVfsRevisionRepository } from "../../src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { SqliteVfsEntryRepository } from "../../src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteMessageCheckpointRepository } from "../../src/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import {
  aggregateReadRefsFromAllMessages,
  repairRefCounts,
} from "../../src/domain/vfs/logic/revision-ref-count.js";
import { DefaultMessageTranscriptEffectsService } from "../../src/service/chat/impl/message-transcript-effects.service.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

/** 一条存量引用行：块 + 全局键。 */
type LegacyRefSeed = {
  readonly block: ToolResultBlock;
  readonly entryId: number;
  readonly version: number;
};

/**
 * 造一条 v1.5.29 存量引用行：写入文件 → 构造 `content === ""` +
 * `contentRef` 的块 → **显式补上当初 read 发生的那次 `+1`**。
 *
 * `+1` 必须手工补：写侧已无引用化，工具不再抬 ref_count；不补就模拟不出
 * 「存量行真的持有 1 份引用」这一状态。
 */
async function seedLegacyRef(
  projectId: string,
  sessionId: string,
  path: string,
  toolUseId: string,
  content: string
): Promise<LegacyRefSeed> {
  const { conn, sessionVfs } = getNovelMasterTestContext();
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
  assert.equal(revRows.length, 1, "写入后应有 v1 revision 行");
  const ref: ReadResultRef = {
    path,
    entryId,
    version: 1,
    contentHash: revRows[0]!.content_hash,
    totalBytes: content.length,
    offset: 1,
    limit: 2000,
    returnedLines: content.split("\n").length,
    totalLines: content.split("\n").length,
    truncated: false,
  };
  const block: ToolResultBlock = {
    type: "tool_result",
    toolUseId,
    content: "",
    ok: true,
    summary: `${ref.returnedLines} lines`,
    contentRef: ref,
  };
  // 模拟存量行当初的那次 +1（工具侧已无此动作）。
  await conn.execute(
    `UPDATE vfs_revision SET ref_count = ref_count + 1 WHERE entry_id = ? AND version = ?`,
    [entryId, 1]
  );
  return { block, entryId, version: 1 };
}

/** 真链路 read：新写全文块（无 contentRef）。 */
async function runReadFullText(
  projectId: string,
  sessionId: string,
  path: string,
  toolUseId: string
): Promise<{ block: ToolResultBlock; entryId: number; version: number }> {
  const { conn, sessionVfs } = getNovelMasterTestContext();
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
  assert.equal(block.contentRef, undefined, "新写 read 结果不得产 contentRef");
  const entryRows = await conn.query<{ entry_id: number }>(
    `SELECT entry_id FROM vfs_entry WHERE path = ?`,
    [path]
  );
  return {
    block,
    entryId: entryRows[0]!.entry_id,
    version: output.version,
  };
}

/** 追加一条 assistant 消息（blocks 由调用方给定）。 */
async function appendMessage(
  sessionId: string,
  blocks: readonly ContentBlock[]
): Promise<ChatMessage> {
  const { messages } = getNovelMasterTestContext();
  return messages.append(sessionId, "assistant", { blocks });
}

/** ref_count 点查；行不存在（已被 GC）返回 null。 */
async function refCountOf(
  entryId: number,
  version: number
): Promise<number | null> {
  const { conn } = getNovelMasterTestContext();
  const rows = await conn.query<{ ref_count: number }>(
    `SELECT ref_count FROM vfs_revision WHERE entry_id = ? AND version = ?`,
    [entryId, version]
  );
  return rows.length === 0 ? null : Number(rows[0]!.ref_count);
}

describe("read-ref-count: T-UA5 新写全文行删除时零 ref 调整", () => {
  it("真链路 read 的全文块：落库无引用指针，删消息零 ref 调整", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-ua5-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    await ctx.sessionVfs(project.id, session.id).write("/full.txt", "a\nb\nc");

    const seed = await runReadFullText(
      project.id,
      session.id,
      "/full.txt",
      "tu-ua5"
    );
    assert.equal(seed.block.contentRef, undefined);
    assert.match(seed.block.content, /1\|a/);
    assert.equal(await refCountOf(seed.entryId, seed.version), 1);

    const msg = await appendMessage(session.id, [seed.block as ContentBlock]);
    // 全文块不产生任何消息侧引用指针。
    assert.deepEqual(
      await aggregateReadRefsFromAllMessages(ctx.conn).then((refs) =>
        refs.filter((r) => r.entryId === seed.entryId)
      ),
      [],
      "新写行不计入消息侧引用"
    );

    await ctx.messages.delete(msg.id);
    assert.equal(
      await refCountOf(seed.entryId, seed.version),
      1,
      "删全文行不做任何 ref 调整（live head 的 1 份原样留下）"
    );
  });

  it("新写全文行不被 repair 误报（期望值口径只看存量 contentRef）", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-ua5b-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/full2.txt", "one");
    const seed = await runReadFullText(
      project.id,
      session.id,
      "/full2.txt",
      "tu-ua5b"
    );
    await appendMessage(session.id, [seed.block as ContentBlock]);
    // 再写一版：v1 失去 live head 持有 → ref 归 0（read 没 +1，全文自带正文）。
    await vfs.write("/full2.txt", "two");
    assert.equal(
      await refCountOf(seed.entryId, seed.version),
      0,
      "无引用者保活的 v1 应归零"
    );

    const report = await repairRefCounts(
      new SqliteVfsRevisionRepository(ctx.conn),
      new SqliteVfsEntryRepository(ctx.conn),
      new SqliteMessageCheckpointRepository(ctx.conn),
      `session:${project.id}:${session.id}`,
      "/",
      session.id,
      await aggregateReadRefsFromAllMessages(ctx.conn)
    );
    const row = report.overExpected.find(
      (r) => r.entryId === seed.entryId && r.version === seed.version
    );
    assert.equal(row, undefined, "归零是正确状态，不得被报成偏高泄漏");
  });
});

describe("read-ref-count: T-RR4 存量引用行删除对账五路径", () => {
  it("单删：−1 与消息内去重 refs 严格相等（同消息重复引用只 −1）", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-rr4-del-${suffix}`);
    const session = await ctx.sessions.create(project.id);

    // 同一文件被「存量 read」两次 → 两条块各自持有 1 份（+1 ×2）；
    // 删除侧按消息内 (entryId, version) 去重只 −1。
    const first = await seedLegacyRef(
      project.id,
      session.id,
      "/dup.txt",
      "tu-d1",
      "a\nb\nc"
    );
    const second = await seedLegacyRef(
      project.id,
      session.id,
      "/dup.txt",
      "tu-d2",
      "a\nb\nc"
    );
    assert.equal(first.entryId, second.entryId);
    assert.equal(first.version, second.version);
    // live head(1) + 存量引用 ×2 = 3
    assert.equal(await refCountOf(first.entryId, first.version), 3);

    const msg = await appendMessage(session.id, [
      first.block as ContentBlock,
      second.block as ContentBlock,
    ]);
    await ctx.messages.delete(msg.id);
    // 去重 −1：3 − 1 = 2（而非 −2）
    assert.equal(await refCountOf(first.entryId, first.version), 2);
  });

  it("回滚删尾/abort 截断（truncate-tail 共用挂点）：−1 先于 sweep——只被 tail 引用的 revision 被回收、存活消息引用的保活", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-rr4-tail-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    // a.txt：msg1（存活）引用其 v1；再写 → v1 成为历史版本。
    const readA = await seedLegacyRef(
      project.id,
      session.id,
      "/a.txt",
      "tu-t1",
      "a-one"
    );
    await appendMessage(session.id, [readA.block as ContentBlock]);
    await vfs.write("/a.txt", "a-two");
    assert.equal(await refCountOf(readA.entryId, readA.version), 1);

    // b.txt：msg2（tail）引用其 v1；同样只剩引用。
    const readB = await seedLegacyRef(
      project.id,
      session.id,
      "/b.txt",
      "tu-t2",
      "b-one"
    );
    await appendMessage(session.id, [readB.block as ContentBlock]);
    await vfs.write("/b.txt", "b-two");
    assert.equal(await refCountOf(readB.entryId, readB.version), 1);

    // 截断 tail（seq > 1）并 sweep（rollbackToMessage / truncateMessagesAfter
    // 共用的 truncate-tail 挂点；abort 后的截断操作同链）。
    const effects = new DefaultMessageTranscriptEffectsService({
      conn: ctx.conn,
      messages: ctx.messages,
      sessionKkv: ctx.sessionKkv,
    });
    await effects.truncateMessagesAfter(project.id, session.id, 1, {
      sweepRevisions: true,
    });

    // b.txt v1 只被 tail 引用：−1 先于 sweep → ref 归 0 → 被 scoped sweep 回收。
    assert.equal(
      await refCountOf(readB.entryId, readB.version),
      null,
      "只被 tail 消息引用的 revision 应被回收（−1 先于 sweep）"
    );
    assert.equal(
      await refCountOf(readA.entryId, readA.version),
      1,
      "仍被存活消息引用的 revision 必须存活"
    );
  });

  it("会话删除（deleteSessionTree）：本会话 refs 聚合 −1；fork 出的会话引用保活", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-rr4-sdel-${suffix}`);
    const session = await ctx.sessions.create(project.id);

    const readS = await seedLegacyRef(
      project.id,
      session.id,
      "/s.txt",
      "tu-s1",
      "s-one"
    );
    const msg1 = await appendMessage(session.id, [readS.block as ContentBlock]);
    // 第二条消息引用同一 pair（各持 1 份）：live(1) + 存量引用 ×2 = 3。
    const readS2 = await seedLegacyRef(
      project.id,
      session.id,
      "/s.txt",
      "tu-s2",
      "s-one"
    );
    await appendMessage(session.id, [readS2.block as ContentBlock]);
    assert.equal(await refCountOf(readS.entryId, readS.version), 3);

    // fork：fork 消息浅拷贝保留源 (entryId, version)，对源 revision +1 → 4。
    await ctx.messages.fork(session.id, msg1.id);
    assert.equal(await refCountOf(readS.entryId, readS.version), 4);

    // 删源会话：read −2（本会话两条消息）+ live −1（deleteSessionFsData）
    // → 剩 fork 会话的 1 份引用，revision/blob 留存。
    await ctx.sessions.delete(session.id);
    assert.equal(
      await refCountOf(readS.entryId, readS.version),
      1,
      "源会话删除后 fork 侧引用保活（ref 恰为 fork 持有数）"
    );

    // 无任何持有者路径（对账下界）：删 fork 会话后 read −1 → 0 → sweep 回收。
    const forked = (await ctx.sessions.listByProject(project.id)).find(
      (s) => s.id !== session.id
    );
    assert.ok(forked != null, "fork 会话应存在");
    await ctx.sessions.delete(forked.id);
    assert.equal(await refCountOf(readS.entryId, readS.version), null);
  });

  it("项目删除（BFS 独立挂点）：全部会话的消息 refs 聚合 −1，revision 全回收", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-rr4-pdel-${suffix}`);
    const s1 = await ctx.sessions.create(project.id);
    await ctx.sessionVfs(project.id, s1.id).write("/pd.txt", "pd-one");
    const readP = await seedLegacyRef(
      project.id,
      s1.id,
      "/pd.txt",
      "tu-p1",
      "pd-one"
    );
    await appendMessage(s1.id, [readP.block as ContentBlock]);

    // copy 出第二个会话（copy +1，消息引用同一源 pair）：
    // live(1) + 存量引用 S1(1) + copy S2(1) = 3。
    await ctx.sessions.copy(s1.id);
    assert.equal(await refCountOf(readP.entryId, readP.version), 3);

    // 项目删除走 BFS 循环自有事务（不经 deleteSessionTree）：S1、S2 各
    // read −1 + live −1 → ref 归 0 → deleteSessionFsData 内 sweep 回收。
    await ctx.projects.delete(project.id);
    assert.equal(
      await refCountOf(readP.entryId, readP.version),
      null,
      "项目删除后无持有者的 revision 应被回收（BFS 挂点 −1 生效）"
    );
  });
});

describe("read-ref-count: 挂点附带对账（fork/copy +1、updateContent、truncateAfter）", () => {
  it("copy +1：复制消息对源 revision +1", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-rr4-copy-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const readC = await seedLegacyRef(
      project.id,
      session.id,
      "/cp.txt",
      "tu-c1",
      "c-one"
    );
    await appendMessage(session.id, [readC.block as ContentBlock]);
    assert.equal(await refCountOf(readC.entryId, readC.version), 2);

    await ctx.sessions.copy(session.id);
    assert.equal(
      await refCountOf(readC.entryId, readC.version),
      3,
      "copy 后源 revision +1"
    );
  });

  it("updateContent 换算：旧 blocks −1、新 blocks +1", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-rr4-edit-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const readE = await seedLegacyRef(
      project.id,
      session.id,
      "/ed.txt",
      "tu-e1",
      "e-one"
    );
    const msg = await appendMessage(session.id, [readE.block as ContentBlock]);
    assert.equal(await refCountOf(readE.entryId, readE.version), 2);

    // 用户编辑覆写成纯 text：旧 ref −1。
    await ctx.messages.updateContent(msg.id, {
      blocks: [{ type: "text", text: "编辑后的正文" }],
    });
    assert.equal(await refCountOf(readE.entryId, readE.version), 1);

    // 编辑回引用形态：+1（引用的 revision 存在，NOT_FOUND 守护通过）。
    await ctx.messages.updateContent(msg.id, {
      blocks: [readE.block as ContentBlock],
    });
    assert.equal(await refCountOf(readE.entryId, readE.version), 2);
  });

  it("truncateAfter 公开 API：tail 分支与清空分支都 −1（不留无挂点删除面）", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-rr4-trunc-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const readA = await seedLegacyRef(
      project.id,
      session.id,
      "/tr-a.txt",
      "tu-ta",
      "ta"
    );
    const readB = await seedLegacyRef(
      project.id,
      session.id,
      "/tr-b.txt",
      "tu-tb",
      "tb"
    );
    const msg1 = await appendMessage(session.id, [readA.block as ContentBlock]);
    await appendMessage(session.id, [readB.block as ContentBlock]);
    assert.equal(await refCountOf(readA.entryId, readA.version), 2);
    assert.equal(await refCountOf(readB.entryId, readB.version), 2);

    // tail 截断（anchor = msg1）：只删 msg2 → tr-b −1。
    await ctx.messages.truncateAfter(session.id, msg1.id);
    assert.equal(await refCountOf(readB.entryId, readB.version), 1);
    assert.equal(await refCountOf(readA.entryId, readA.version), 2);

    // 清空（anchor = null）：msg1 也删 → tr-a −1。
    await ctx.messages.truncateAfter(session.id, null);
    assert.equal(await refCountOf(readA.entryId, readA.version), 1);
  });
});

describe("read-ref-count: T-RR13 repair 期望值三类化", () => {
  it("存量引用计入期望值：正常持有不误报泄漏，ref_count 不被扰动", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-rr13-ok-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const readOk = await seedLegacyRef(
      project.id,
      session.id,
      "/ok.txt",
      "tu-ok",
      "ok-one"
    );
    await appendMessage(session.id, [readOk.block as ContentBlock]);
    // 存量行之后：v1 只剩引用（live head 转到 v2）。
    await vfs.write("/ok.txt", "ok-two");
    assert.equal(await refCountOf(readOk.entryId, readOk.version), 1);

    const revisionRepo = new SqliteVfsRevisionRepository(ctx.conn);
    const entryRepo = new SqliteVfsEntryRepository(ctx.conn);
    const checkpointRepo = new SqliteMessageCheckpointRepository(ctx.conn);
    const readRefs = await aggregateReadRefsFromAllMessages(ctx.conn);

    // 两类口径（不传 readRefs）：v1 的存量持有会被误报为泄漏——三类化的动机。
    const twoClass = await repairRefCounts(
      revisionRepo,
      entryRepo,
      checkpointRepo,
      `session:${project.id}:${session.id}`,
      "/",
      session.id
    );
    assert.ok(
      twoClass.overExpected.some(
        (row) =>
          row.entryId === readOk.entryId && row.version === readOk.version
      ),
      "两类口径下正常存量持有会被误报（对照组）"
    );

    // 三类口径：存量引用计入期望值 → v1（expected=1, current=1）不误报。
    const report = await repairRefCounts(
      revisionRepo,
      entryRepo,
      checkpointRepo,
      `session:${project.id}:${session.id}`,
      "/",
      session.id,
      readRefs
    );
    assert.ok(
      !report.overExpected.some(
        (row) =>
          row.entryId === readOk.entryId && row.version === readOk.version
      ),
      "存量引用计入期望值后，正常持有不是泄漏"
    );
    assert.equal(await refCountOf(readOk.entryId, readOk.version), 1);
  });

  it("偏高泄漏（+1 无消息对应）被检出报告，且不自动修", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-rr13-leak-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const readL = await seedLegacyRef(
      project.id,
      session.id,
      "/leak.txt",
      "tu-lk",
      "leak-one"
    );
    await appendMessage(session.id, [readL.block as ContentBlock]);
    await vfs.write("/leak.txt", "leak-two");
    // v1 = 存量引用(1)；模拟「+1 后消息未落库即崩溃」的无主 +1 → 2。
    await ctx.conn.execute(
      `UPDATE vfs_revision SET ref_count = ref_count + 1 WHERE entry_id = ? AND version = ?`,
      [readL.entryId, readL.version]
    );
    assert.equal(await refCountOf(readL.entryId, readL.version), 2);

    const report = await repairRefCounts(
      new SqliteVfsRevisionRepository(ctx.conn),
      new SqliteVfsEntryRepository(ctx.conn),
      new SqliteMessageCheckpointRepository(ctx.conn),
      `session:${project.id}:${session.id}`,
      "/",
      session.id,
      await aggregateReadRefsFromAllMessages(ctx.conn)
    );

    const leaked = report.overExpected.find(
      (row) => row.entryId === readL.entryId && row.version === readL.version
    );
    assert.ok(leaked != null, "偏高泄漏必须被检出");
    assert.equal(leaked.current, 2);
    assert.equal(leaked.expected, 1);
    // 只增不减：偏高不自动下调（泄漏方向可接受，误删不可恢复）。
    assert.equal(await refCountOf(readL.entryId, readL.version), 2);
  });
});
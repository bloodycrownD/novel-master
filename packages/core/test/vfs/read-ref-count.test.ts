/**
 * read-tool-result-ref Step 3 定向测试：
 *
 * - T-RR4：删除对账五路径——单删 / 回滚删尾 + abort 截断（共用
 *   truncate-tail 挂点）/ 会话删除 / 项目删除——每条路径的 −1 与消息内
 *   refs 严格相等（同消息重复引用去重）；删尾路径重点断言 −1 先于 sweep
 *   （只被 tail 引用的 revision 被回收、仍被存活消息引用的 revision 存活）。
 * - T-RR13：repair 期望值三类化——read 引用计入期望值后正常持有不误报，
 *   偏高泄漏（无消息对应的 +1）可被检出报告且不自动修。
 * - 附带对账：fork / copy +1、updateContent 换算、truncateAfter 公开 API
 *   两个删除分支的 −1。
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

/** 真链路 read 产物：contentRef 块 + (entryId, version)（+1 已在工具内同步发生）。 */
type ReadSeed = {
  readonly block: ToolResultBlock;
  readonly entryId: number;
  readonly version: number;
};

/** 跑一次 read 工具（同步 +1 已发生），返回 contentRef 块。 */
async function runRead(
  projectId: string,
  sessionId: string,
  path: string,
  toolUseId: string
): Promise<ReadSeed> {
  const { conn, sessionVfs } = getNovelMasterTestContext();
  const revisionRepo = new SqliteVfsRevisionRepository(conn);
  const ctx: BuiltinToolContext = {
    vfs: sessionVfs(projectId, sessionId),
    projectId,
    sessionId,
    adjustRevisionRefCount: (pointers, delta) =>
      revisionRepo.batchAdjustRefCountWithDelta(pointers, delta),
  };
  const registry = new ToolRegistry<BuiltinToolContext>();
  registerBuiltinTools(registry);
  const runner = new ToolRunner(registry);
  const output = await runner.call<ReadToolOutput>("read", { path }, ctx);
  assert.ok(output.entryId != null, "read 输出必须带 entryId（⟺ +1 已发生）");
  const block = buildToolResultBlock(
    toolUseId,
    { ok: true, output },
    { toolName: "read" }
  );
  assert.ok(block.contentRef != null, "read 成功路径必须产 contentRef 块");
  return {
    block,
    entryId: output.entryId!,
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

describe("read-ref-count: T-RR4 删除对账五路径", () => {
  it("单删：−1 与消息内去重 refs 严格相等（同消息重复引用只 −1）", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-rr4-del-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    await ctx.sessionVfs(project.id, session.id).write("/dup.txt", "a\nb\nc");

    // 同一消息里两个块引用同一 (entryId, version)：read 执行两次 → +2；
    // 删除侧按 T-RR4 口径去重只 −1（残留 1 是方向安全的泄漏，repair 可检）。
    const first = await runRead(project.id, session.id, "/dup.txt", "tu-d1");
    const second = await runRead(project.id, session.id, "/dup.txt", "tu-d2");
    assert.equal(first.entryId, second.entryId);
    assert.equal(first.version, second.version);
    // live head(1) + read ×2 = 3
    assert.equal(await refCountOf(first.entryId, first.version), 3);

    const msg = await appendMessage(session.id, [first.block, second.block]);
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

    // a.txt：msg1（存活）引用其 v1；read 后再写 → v1 成为历史版本。
    await vfs.write("/a.txt", "a-one");
    const readA = await runRead(project.id, session.id, "/a.txt", "tu-t1");
    await appendMessage(session.id, [readA.block]);
    await vfs.write("/a.txt", "a-two");
    // a.txt v1：live head 已转 v2，只剩 read 引用 → ref = 1
    assert.equal(await refCountOf(readA.entryId, readA.version), 1);

    // b.txt：msg2（tail）引用其 v1；read 后再写 → v1 同样只剩 read 引用。
    await vfs.write("/b.txt", "b-one");
    const readB = await runRead(project.id, session.id, "/b.txt", "tu-t2");
    await appendMessage(session.id, [readB.block]);
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

    // b.txt v1 只被 tail 引用：−1 先于 sweep → ref 归 0 → 被 scoped sweep
    // 回收。若 −1 晚于 sweep（或缺失），ref 虚高，行会残留 → 断言失败。
    assert.equal(
      await refCountOf(readB.entryId, readB.version),
      null,
      "只被 tail 消息引用的 revision 应被回收（−1 先于 sweep）"
    );
    // a.txt v1 仍被存活的 msg1 引用：sweep 不得误删（保活即第三类持有者语义）。
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
    await ctx.sessionVfs(project.id, session.id).write("/s.txt", "s-one");

    const readS = await runRead(project.id, session.id, "/s.txt", "tu-s1");
    const msg1 = await appendMessage(session.id, [readS.block]);
    // 两条消息引用同一 pair（各 read 一次各 +1）：live(1) + read ×2 = 3
    const readS2 = await runRead(project.id, session.id, "/s.txt", "tu-s2");
    await appendMessage(session.id, [readS2.block]);
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
    const readP = await runRead(project.id, s1.id, "/pd.txt", "tu-p1");
    await appendMessage(s1.id, [readP.block]);

    // copy 出第二个会话（copy +1，消息引用同一源 pair）：
    // live(1) + read S1(1) + read S2(1) = 3。
    await ctx.sessions.copy(s1.id);
    assert.equal(await refCountOf(readP.entryId, readP.version), 3);

    // 项目删除走 BFS 循环自有事务（不经 deleteSessionTree）：S1、S2 各
    // read −1 + live −1 → ref 归 0 → deleteSessionFsData 内 sweep 回收。
    // 漏挂这条独立路径会让 ref 虚高、revision 永久泄漏（无自愈）。
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
    await ctx.sessionVfs(project.id, session.id).write("/cp.txt", "c-one");
    const readC = await runRead(project.id, session.id, "/cp.txt", "tu-c1");
    await appendMessage(session.id, [readC.block]);
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
    await ctx.sessionVfs(project.id, session.id).write("/ed.txt", "e-one");
    const readE = await runRead(project.id, session.id, "/ed.txt", "tu-e1");
    const msg = await appendMessage(session.id, [readE.block]);
    assert.equal(await refCountOf(readE.entryId, readE.version), 2);

    // 用户编辑覆写成纯 text：旧 ref −1。
    await ctx.messages.updateContent(msg.id, {
      blocks: [{ type: "text", text: "编辑后的正文" }],
    });
    assert.equal(await refCountOf(readE.entryId, readE.version), 1);

    // 编辑回引用形态：+1（引用的 revision 存在，NOT_FOUND 守护通过）。
    await ctx.messages.updateContent(msg.id, { blocks: [readE.block] });
    assert.equal(await refCountOf(readE.entryId, readE.version), 2);
  });

  it("truncateAfter 公开 API：tail 分支与清空分支都 −1（不留无挂点删除面）", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-rr4-trunc-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    await ctx.sessionVfs(project.id, session.id).write("/tr-a.txt", "ta");
    await ctx.sessionVfs(project.id, session.id).write("/tr-b.txt", "tb");
    const readA = await runRead(project.id, session.id, "/tr-a.txt", "tu-ta");
    const readB = await runRead(project.id, session.id, "/tr-b.txt", "tu-tb");
    const msg1 = await appendMessage(session.id, [readA.block]);
    await appendMessage(session.id, [readB.block]);
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
  it("read 引用计入期望值：正常持有不误报泄漏，ref_count 不被扰动", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-rr13-ok-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/ok.txt", "ok-one");
    const readOk = await runRead(project.id, session.id, "/ok.txt", "tu-ok");
    await appendMessage(session.id, [readOk.block]);
    // read 后再写：v1 只剩 read 引用（live head 转到 v2）。
    await vfs.write("/ok.txt", "ok-two");
    assert.equal(await refCountOf(readOk.entryId, readOk.version), 1);

    const revisionRepo = new SqliteVfsRevisionRepository(ctx.conn);
    const entryRepo = new SqliteVfsEntryRepository(ctx.conn);
    const checkpointRepo = new SqliteMessageCheckpointRepository(ctx.conn);
    const readRefs = await aggregateReadRefsFromAllMessages(ctx.conn);

    // 两类口径（不传 readRefs）：v1 的 read 持有会被误报为泄漏——三类化的动机。
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
        (row) => row.entryId === readOk.entryId && row.version === readOk.version
      ),
      "两类口径下正常 read 持有会被误报（对照组）"
    );

    // 三类口径：read 引用计入期望值 → v1（expected=1, current=1）不误报。
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
        (row) => row.entryId === readOk.entryId && row.version === readOk.version
      ),
      "read 引用计入期望值后，正常持有不是泄漏"
    );
    assert.equal(await refCountOf(readOk.entryId, readOk.version), 1);
  });

  it("偏高泄漏（+1 无消息对应）被检出报告，且不自动修", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-rr13-leak-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/leak.txt", "leak-one");
    const readL = await runRead(project.id, session.id, "/leak.txt", "tu-lk");
    await appendMessage(session.id, [readL.block]);
    await vfs.write("/leak.txt", "leak-two");
    // v1 = read(1)；模拟「read +1 后消息未落库即崩溃」的无主 +1 → 2。
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

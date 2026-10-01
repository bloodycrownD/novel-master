/**
 * read-tool-result-ref Step 5 定向测试：phase-read-ref-safety——五大场景
 * 下 read 引用保活链的安全性（T-RR5~T-RR9）。
 *
 * 每个场景都走真实 service 层入口（messages.delete 内嵌 sweep / messages.fork /
 * sessions.delete 的 deleteSessionTree / sessions.pullTemplate 的
 * initializeSessionWorkspace / 角色卡与 ZIP 导入），断言不只看「没报错」：
 * 直查 `vfs_revision` 行存在性与 ref_count、直查 `vfs_content_blob` 行，
 * 外加 hydrate 输出与基准 wire（`formatToolOutputForLlm`，与 read 落块同一条
 * 格式化路径）逐字节全等。
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
  ToolResultBlock,
} from "../../src/domain/chat/model/content-block.js";
import { hydrateToolResultsForPrompt } from "../../src/domain/chat/logic/hydrate-tool-results-for-prompt.js";
import { buildToolResultBlock } from "../../src/domain/tool/logic/build-tool-result-block.js";
import { formatToolOutputForLlm } from "../../src/domain/tool/logic/format-tool-output.js";
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

/** 真链路 read 产物：contentRef 块 + 全局键 + 基准 wire（+1 已在工具内发生）。 */
type ReadSeed = {
  readonly block: ToolResultBlock;
  readonly baseline: string;
  readonly entryId: number;
  readonly version: number;
  readonly contentHash: string;
};

/** 跑一次 read 工具（同步 +1 已发生），返回块与基准 wire。 */
async function seedRead(
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
    listSessionMessages: async () => [],
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
    baseline: formatToolOutputForLlm(output),
    entryId: output.entryId!,
    version: output.version,
    contentHash: output.contentHash!,
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

/** 对落库消息做 view-time hydrate，取首个 tool_result 块的还原 content。 */
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
  assert.ok(target != null, "必须存在含 contentRef 的消息");
  const block = target.content.blocks.find(
    (b) => b.type === "tool_result"
  ) as ToolResultBlock;
  return block.content;
}

describe("read-ref-safety: T-RR5 sweep 保活（read 后 edit 的中间版本）", () => {
  it("read v1 → edit v2 → 删另一条消息触发 sweep：v1 revision/blob 存活且 hydrate 可读；无引用的对照版本被回收", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-rr5-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    // 主角：novel.md 的 v1 被 read 引用，edit 产生 v2——turn 内 read 后 edit，
    // v1 无 checkpoint 指针，若没有 read 引用计数就会被 sweep 删（根因场景）。
    await vfs.write("/novel.md", "第一章\n主角登场\n伏笔一枚");
    const seed = await seedRead(project.id, session.id, "/novel.md", "tu-rr5");
    await appendMessage(session.id, [seed.block]);
    const editResult = await runEdit(project.id, session.id, {
      path: "/novel.md",
      oldString: "伏笔一枚",
      newString: "伏笔两枚\n第二章",
    });
    assert.equal(editResult.replacements, 1);
    // v1：live head 已转 v2，只剩 read 引用 → ref = 1。
    assert.equal((await revisionRowOf(seed.entryId, 1))!.refCount, 1);

    // 对照：ctrl.txt 的 v1 无任何持有者（write 直接覆盖、没有 read/checkpoint）。
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
    // ——证明 sweep 真的扫到了本会话，主角的「存活」不是空转。
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

    // 主角断言：v1 revision 行存活（ref=1）、blob 行存活。
    const novelV1 = await revisionRowOf(seed.entryId, 1);
    assert.ok(novelV1 != null, "被 read 引用的 v1 revision 必须存活");
    assert.equal(novelV1.refCount, 1, "v1 只剩 read 引用一份持有");
    assert.ok(
      (await blobRefCountOf(novelV1.contentHash)) != null,
      "v1 的 blob 必须存活"
    );

    // hydrate 可读：落库消息还原的 wire 与 read 执行时基准逐字节全等。
    const msgs = await ctx.messages.listBySession(session.id);
    assert.equal(await hydrateFirstToolResultContent(msgs), seed.baseline);

    // sanity：edit 确实生效（当前 head 是 v2 内容）。
    assert.equal(
      (await vfs.read("/novel.md")).content,
      "第一章\n主角登场\n伏笔两枚\n第二章"
    );
  });
});

describe("read-ref-safety: T-RR6 fork +1 与 fork 会话 hydrate", () => {
  it("fork 后源 revision ref_count 按持有消息数 +1；fork 会话按源 (entryId,version) hydrate 成功（fork 会话文件演进也不受影响）", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-rr6-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    await vfs.write("/fork.md", "fork 基线一\nfork 基线二");
    const seed1 = await seedRead(project.id, session.id, "/fork.md", "tu-rr6a");
    await appendMessage(session.id, [seed1.block]);
    const seed2 = await seedRead(project.id, session.id, "/fork.md", "tu-rr6b");
    await appendMessage(session.id, [seed2.block]);
    assert.equal(seed1.entryId, seed2.entryId);
    // live(1) + read ×2（两条消息各 +1）= 3。
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
    const forkBlock1 = forkMsgs[0]!.content.blocks[0] as ToolResultBlock;
    const forkBlock2 = forkMsgs[1]!.content.blocks[0] as ToolResultBlock;
    assert.deepEqual(forkBlock1.contentRef, seed1.block.contentRef);
    assert.deepEqual(forkBlock2.contentRef, seed2.block.contentRef);

    // fork 会话 hydrate 定位的是**源** revision（全局键），不是 fork scope 的
    // 新 entry：fork scope 的 /fork.md 是 copyVfsTree 开的新 entryId。
    const forkEntryRows = await ctx.conn.query<{ entry_id: number }>(
      `SELECT entry_id FROM vfs_entry WHERE scope_key = ? AND path = ?`,
      [`session:${project.id}:${forked.id}`, "/fork.md"]
    );
    assert.ok(forkEntryRows.length === 1, "fork scope 应有 /fork.md");
    assert.notEqual(
      forkEntryRows[0]!.entry_id,
      seed1.entryId,
      "fork scope 的 entry 必须是新 entryId（引用只能指向源 revision）"
    );

    // fork 会话里文件继续演进（write 全新内容）后 hydrate 仍输出源内容——
    // 引用按 (entryId, version) 锚定，不追 fork 会话的 head。
    await ctx.sessionVfs(project.id, forked.id).write(
      "/fork.md",
      "fork 会话改写后的完全不同内容"
    );
    assert.equal(
      await hydrateFirstToolResultContent(forkMsgs),
      seed1.baseline,
      "fork 会话 hydrate 应还原源 revision 的 wire（与 read 执行时全等）"
    );
  });
});

describe("read-ref-safety: T-RR7 源会话删除后 fork 会话引用仍活", () => {
  it("deleteSessionTree 删源会话后：被 fork 引用的 revision/blob 留存，fork 会话 hydrate 正常", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-rr7-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);

    await vfs.write("/origin.md", "origin-唯一正文");
    const seed = await seedRead(project.id, session.id, "/origin.md", "tu-rr7");
    const msg = await appendMessage(session.id, [seed.block]);
    // live(1) + read(1) = 2；fork +1 → 3。
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

    // fork 会话还在、hydrate 输出与基准 wire 全等。
    const remaining = await ctx.sessions.listByProject(project.id);
    assert.ok(remaining.some((s) => s.id === forked.id), "fork 会话应存活");
    const forkMsgs = await ctx.messages.listBySession(forked.id);
    assert.equal(await hydrateFirstToolResultContent(forkMsgs), seed.baseline);
  });
});

describe("read-ref-safety: T-RR8 pull 不释放（模板重置工作区）", () => {
  it("pullTemplate 后被引用的旧 revision 留存、消息 hydrate 正常；pull 前的无人引用 head 被回收（对照组）", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-rr8-${suffix}`);
    // project template 先有内容，session create 时会镜像进 session scope。
    await ctx.projectVfs(project.id).write("/tpl.md", "tpl-fixed");
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    // session 自建文件（不在 template 里）：read v1 后再写 v2——pull 会清掉
    // 整个 session 工作区重置为 template，v1 只剩 read 引用。
    await svfs.write("/scratch.md", "scratch-one");
    const seed = await seedRead(project.id, session.id, "/scratch.md", "tu-rr8");
    await appendMessage(session.id, [seed.block]);
    await svfs.write("/scratch.md", "scratch-two");
    // v1：read(1)；v2：live head(1)。
    assert.equal((await revisionRowOf(seed.entryId, 1))!.refCount, 1);
    const v2Row = await revisionRowOf(seed.entryId, 2);
    assert.ok(v2Row != null);

    // pull（service 层入口）：clearCheckpoints + initializeSessionWorkspace
    // 重置工作区（decrementLiveRefs + deleteVfsPrefix + sweep）+ blob gc。
    await ctx.sessions.pullTemplate(session.id);

    // 对照：v2（pull 前的 head，无 read 引用）应被 pull 的 sweep 回收——
    // 证明「不释放」是 ref_count>0 的定向保活，而不是 sweep 没跑。
    assert.equal(
      await revisionRowOf(seed.entryId, 2),
      null,
      "pull 前无人引用的 head revision 应被回收（对照组）"
    );
    // 主角：v1（被引用）留存、blob 留存、hydrate 正常。
    const v1Row = await revisionRowOf(seed.entryId, 1);
    assert.ok(v1Row != null, "被 read 引用的 revision 在 pull 后必须留存");
    assert.equal(v1Row.refCount, 1, "read 引用不被 pull 释放");
    assert.ok((await blobRefCountOf(v1Row.contentHash)) != null);
    const msgs = await ctx.messages.listBySession(session.id);
    assert.equal(await hydrateFirstToolResultContent(msgs), seed.baseline);

    // sanity：pull 确实重置了工作区（自建文件消失、template 内容在）。
    await assert.rejects(() => svfs.read("/scratch.md"));
    assert.equal((await svfs.read("/tpl.md")).content, "tpl-fixed");
  });
});

describe("read-ref-safety: T-RR9 导入错位免疫（重开 entry 后旧引用仍定位）", () => {
  it("角色卡导入重开 entry：旧 entryId 的 read 引用仍定位（revision/blob 保活链），hydrate 输出旧内容基准", async () => {
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

    await vfs.write("/角色/世界书/设定.md", "旧设定正文——导入前");
    const seed = await seedRead(
      project.id,
      session.id,
      "/角色/世界书/设定.md",
      "tu-rr9a"
    );
    await appendMessage(session.id, [seed.block]);
    // live(1) + read(1) = 2（引用的是当时的 head）。
    assert.equal((await revisionRowOf(seed.entryId, 1))!.refCount, 2);

    // 导入（service 层入口）：deleteVfsPrefix 重开 /角色 前缀 + 新 entryId。
    const svc = createCharacterCardImportService(ctx.conn);
    await svc.import(
      scope,
      new Map([["世界书/设定.md", "新设定正文——导入后"]]),
      { confirmed: true, directoryPath: "/角色" }
    );

    // 重开成功：同 path 绑定到新 entryId（导入错位源——path 不再指向旧 entry）。
    const reread = await vfs.read("/角色/世界书/设定.md");
    assert.equal(reread.content, "新设定正文——导入后");
    assert.notEqual(reread.entryId, seed.entryId);

    // 旧 entryId 的 revision/blob 保活：live −1 后恰剩 read 引用 1 份。
    const row = await revisionRowOf(seed.entryId, 1);
    assert.ok(row != null, "旧 entryId 的 revision 必须留存（保活链）");
    assert.equal(row.refCount, 1);
    assert.ok((await blobRefCountOf(row.contentHash)) != null);

    // 旧引用仍定位：hydrate 按 (entryId, version) 全局键还原旧内容 wire。
    const msgs = await ctx.messages.listBySession(session.id);
    assert.equal(await hydrateFirstToolResultContent(msgs), seed.baseline);
  });

  it("ZIP 导入重开 entry：旧 entryId 的 read 引用仍定位（revision/blob 保活链）", async () => {
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

    await vfs.write("/zipzone/a.md", "zip-old-content");
    const seed = await seedRead(project.id, session.id, "/zipzone/a.md", "tu-rr9b");
    await appendMessage(session.id, [seed.block]);
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
    assert.notEqual(reread.entryId, seed.entryId);

    const row = await revisionRowOf(seed.entryId, 1);
    assert.ok(row != null, "旧 entryId 的 revision 必须留存（保活链）");
    assert.equal(row.refCount, 1);
    assert.ok((await blobRefCountOf(row.contentHash)) != null);

    const msgs = await ctx.messages.listBySession(session.id);
    assert.equal(await hydrateFirstToolResultContent(msgs), seed.baseline);
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

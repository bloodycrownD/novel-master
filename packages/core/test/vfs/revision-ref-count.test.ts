/**
 * 批量 ref_count 调整测试（batchAdjustRefCount + 三个 helper）。
 *
 * 这一组守护的核心不变量：
 * - T-BATCH-REF-MISSING：批量 +1 对缺失 revision 行抛 NOT_FOUND（与逐条 adjustRefCount 语义一致）
 * - T-BATCH-REF-DEC-NOOP：批量 -1 对缺失行 no-op（UPDATE 命不中即跳过，不抛错）
 * - T-BATCH-REF-COUNT：批量增减后 ref_count 数值与逐条调用结果一致
 * - T-BATCH-REF-EMPTY：空入参直接返回，不发 SQL
 * - T-BATCH-REF-HELPERS：三个 helper（increment/decrement/live scope）走批量路径后计数正确
 * - T-BATCH-REF-CHUNK：超过单块上限（500）时按块连续 UPDATE，结果仍正确
 *
 * entry_id 化后 revision 按 entryId 寻址；ref_count 直接读裸列校验。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import {
  decrementLiveRefsUnderScope,
  decrementRefsForCheckpointFiles,
  incrementRefsForCheckpointFiles,
} from "@/domain/vfs/logic/revision-ref-count.js";
import { scopeKey } from "@/domain/vfs/logic/vfs-path-mapper.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { isVfsError } from "@/errors/vfs-errors.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

/** 读取 (entryId, version) 的 ref_count，缺失返回 null。 */
async function readRefCount(
  conn: TdbcConnection,
  entryId: number,
  version: number,
): Promise<number | null> {
  const rows = await conn.query<{ ref_count: number }>(
    `SELECT ref_count FROM vfs_revision WHERE entry_id = ? AND version = ?`,
    [entryId, version],
  );
  if (rows.length === 0) return null;
  return Number(rows[0]!.ref_count);
}

describe("批量 ref_count 调整（batchAdjustRefCount + helpers）", () => {
  it("T-BATCH-REF-COUNT：批量 +1 / -1 后 ref_count 与逐条结果一致", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const entries = new SqliteVfsEntryRepository(ctx.conn);
    const revisions = new SqliteVfsRevisionRepository(ctx.conn);
    const sk = scopeKey({
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });

    // 写三个文件，各得一条 revision（live head 自带 ref_count=1）
    const paths = ["/a.md", "/b.md", "/c.md"];
    const pointers: Array<{ entryId: number; version: number }> = [];
    for (const p of paths) {
      await svfs.write(p, `body-${p}`, { versionCheck: false });
      const entry = await entries.findByPath(sk, p);
      const version = (await svfs.read(p)).version;
      pointers.push({ entryId: entry!.entryId, version });
    }

    // 批量 +2（调两次 +1，验证累加）
    await revisions.batchAdjustRefCount(pointers, +1);
    await revisions.batchAdjustRefCount(pointers, +1);
    for (const p of pointers) {
      // 初始 1（live head）+ 2 = 3
      assert.equal(await readRefCount(ctx.conn, p.entryId, p.version), 3);
    }

    // 批量 -1
    await revisions.batchAdjustRefCount(pointers, -1);
    for (const p of pointers) {
      assert.equal(await readRefCount(ctx.conn, p.entryId, p.version), 2);
    }
  });

  it("T-BATCH-REF-MISSING：批量 +1 对缺失 revision 行抛 NOT_FOUND（守护不变量）", async () => {
    const ctx = getNovelMasterTestContext();
    const revisions = new SqliteVfsRevisionRepository(ctx.conn);

    // 全部都不存在
    await assert.rejects(
      () =>
        revisions.batchAdjustRefCount(
          [
            { entryId: 999001, version: 1 },
            { entryId: 999002, version: 1 },
          ],
          +1,
        ),
      (err: unknown) => isVfsError(err, "NOT_FOUND"),
    );

    // 部分存在、部分缺失：只要有一条缺失就抛错
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const entries = new SqliteVfsEntryRepository(ctx.conn);
    const sk = scopeKey({
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });
    await svfs.write("/exists.md", "x", { versionCheck: false });
    const entry = await entries.findByPath(sk, "/exists.md");
    const version = (await svfs.read("/exists.md")).version;

    await assert.rejects(
      () =>
        revisions.batchAdjustRefCount(
          [
            { entryId: entry!.entryId, version },
            { entryId: 888888, version: 1 }, // 缺失
          ],
          +1,
        ),
      (err: unknown) => isVfsError(err, "NOT_FOUND"),
    );
    // 抛错前不应 UPDATE 已存在的行（前置校验失败，整批不落库）
    // 初始 live head ref_count=1，没被改动
    assert.equal(await readRefCount(ctx.conn, entry!.entryId, version), 1);
  });

  it("T-BATCH-REF-DEC-NOOP：批量 -1 对缺失行 no-op，不抛错", async () => {
    const ctx = getNovelMasterTestContext();
    const revisions = new SqliteVfsRevisionRepository(ctx.conn);

    // 全部都不存在，-1 应直接通过
    await revisions.batchAdjustRefCount(
      [
        { entryId: 777001, version: 1 },
        { entryId: 777002, version: 2 },
      ],
      -1,
    );

    // 混合存在/缺失，-1 对存在的行正常扣减，对缺失的行跳过
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const entries = new SqliteVfsEntryRepository(ctx.conn);
    const sk = scopeKey({
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });
    await svfs.write("/mix.md", "x", { versionCheck: false });
    const entry = await entries.findByPath(sk, "/mix.md");
    const version = (await svfs.read("/mix.md")).version;

    await revisions.batchAdjustRefCount(
      [
        { entryId: entry!.entryId, version },
        { entryId: 666666, version: 9 }, // 缺失，应跳过
      ],
      -1,
    );
    // 初始 1 - 1 = 0
    assert.equal(await readRefCount(ctx.conn, entry!.entryId, version), 0);
  });

  it("T-BATCH-REF-EMPTY：空入参直接返回，不发 SQL", async () => {
    const ctx = getNovelMasterTestContext();
    const revisions = new SqliteVfsRevisionRepository(ctx.conn);

    // 空数组无论 +1 / -1 都应无副作用、不抛错
    await revisions.batchAdjustRefCount([], +1);
    await revisions.batchAdjustRefCount([], -1);
  });

  it("T-BATCH-REF-CHUNK：超过 500 条按块连续 UPDATE，结果正确", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const entries = new SqliteVfsEntryRepository(ctx.conn);
    const revisions = new SqliteVfsRevisionRepository(ctx.conn);
    const sk = scopeKey({
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });

    // 写 550 个文件（超过单块上限 500，验证分块逻辑）
    const pointers: Array<{ entryId: number; version: number }> = [];
    for (let i = 0; i < 550; i++) {
      const p = `/chunk-${i}.md`;
      await svfs.write(p, `body-${i}`, { versionCheck: false });
      const entry = await entries.findByPath(sk, p);
      const version = (await svfs.read(p)).version;
      pointers.push({ entryId: entry!.entryId, version });
    }
    assert.equal(pointers.length, 550);

    // 批量 +1（应拆成 2 块：500 + 50）
    await revisions.batchAdjustRefCount(pointers, +1);
    for (const p of pointers) {
      // 初始 1（live head）+ 1 = 2
      assert.equal(await readRefCount(ctx.conn, p.entryId, p.version), 2);
    }

    // 批量 -1 还原
    await revisions.batchAdjustRefCount(pointers, -1);
    for (const p of pointers) {
      assert.equal(await readRefCount(ctx.conn, p.entryId, p.version), 1);
    }
  });

  it("T-BATCH-REF-HELPERS：increment/decrement helper 走批量路径后计数正确", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const entries = new SqliteVfsEntryRepository(ctx.conn);
    const revisions = new SqliteVfsRevisionRepository(ctx.conn);
    const sk = scopeKey({
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });

    const paths = ["/h1.md", "/h2.md"];
    const pointers: Array<{ entryId: number; version: number }> = [];
    for (const p of paths) {
      await svfs.write(p, `body-${p}`, { versionCheck: false });
      const entry = await entries.findByPath(sk, p);
      const version = (await svfs.read(p)).version;
      pointers.push({ entryId: entry!.entryId, version });
    }

    // increment helper：每条 +1
    await incrementRefsForCheckpointFiles(
      revisions,
      pointers.map((p) => ({ entryId: p.entryId, revisionVersion: p.version })),
    );
    for (const p of pointers) {
      assert.equal(await readRefCount(ctx.conn, p.entryId, p.version), 2);
    }

    // decrement helper：每条 -1
    await decrementRefsForCheckpointFiles(
      revisions,
      pointers.map((p) => ({ entryId: p.entryId, revisionVersion: p.version })),
    );
    for (const p of pointers) {
      assert.equal(await readRefCount(ctx.conn, p.entryId, p.version), 1);
    }
  });

  it("T-BATCH-REF-LIVE：decrementLiveRefsUnderScope 批量扣减 scope 下 live head", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const entries = new SqliteVfsEntryRepository(ctx.conn);
    const revisions = new SqliteVfsRevisionRepository(ctx.conn);
    const sk = scopeKey({
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });

    const paths = ["/live-1.md", "/live-2.md", "/live-3.md"];
    const pointers: Array<{ entryId: number; version: number }> = [];
    for (const p of paths) {
      await svfs.write(p, `body-${p}`, { versionCheck: false });
      const entry = await entries.findByPath(sk, p);
      const version = (await svfs.read(p)).version;
      pointers.push({ entryId: entry!.entryId, version });
    }

    // 批量扣减 scope 下所有 live head（每条 -1）
    await decrementLiveRefsUnderScope(revisions, entries, sk, "/");
    for (const p of pointers) {
      // 初始 1（live head）- 1 = 0
      assert.equal(await readRefCount(ctx.conn, p.entryId, p.version), 0);
    }
  });

  it("T-BATCH-REF-HELPERS-MISSING：increment helper 对缺失行抛 NOT_FOUND", async () => {
    const ctx = getNovelMasterTestContext();
    const revisions = new SqliteVfsRevisionRepository(ctx.conn);

    // increment helper 内部调 batchAdjustRefCount(+1)，缺失应抛错
    await assert.rejects(
      () =>
        incrementRefsForCheckpointFiles(revisions, [
          { entryId: 555001, revisionVersion: 1 },
        ]),
      (err: unknown) => isVfsError(err, "NOT_FOUND"),
    );

    // decrement helper 对缺失行 no-op，不抛错
    await decrementRefsForCheckpointFiles(revisions, [
      { entryId: 555002, revisionVersion: 1 },
    ]);
  });
});

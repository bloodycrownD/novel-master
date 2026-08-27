import { createVfsService } from "@novel-master/core/vfs";
import type { TdbcConnection } from "@novel-master/core";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { createVfsEntrySequenceRepairOperation } from "@/domain/vfs/logic/entry-sequence-repair.js";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";


novelMasterTestFixture();

describe("RevisionAwareVfsService (integration)", () => {
  const GLOBAL_SCOPE = "global";

  async function entryIdForPath(
    conn: TdbcConnection,
    logicalPath: string,
  ): Promise<number> {
    const rows = await conn.query<{ entry_id: number }>(
      `SELECT entry_id FROM vfs_entry WHERE scope_key = ? AND path = ?`,
      [GLOBAL_SCOPE, logicalPath],
    );
    return rows[0]!.entry_id;
  }

  async function refCountFor(
    conn: TdbcConnection,
    entryId: number,
    version: number,
  ): Promise<number> {
    const rows = await conn.query<{ ref_count: number }>(
      `SELECT ref_count FROM vfs_revision WHERE entry_id = ? AND version = ?`,
      [entryId, version],
    );
    return Number(rows[0]?.ref_count ?? -1);
  }

  /** 把文件写到 head=to，然后直接 SQL 拨回 to（模拟 resetHead 回拨后高版本被 checkpoint 钉住）。 */
  async function windHeadBackTo(
    conn: TdbcConnection,
    logicalPath: string,
    fromVersion: number,
    toVersion: number,
    pinnedVersions: number[],
  ): Promise<void> {
    const entryId = await entryIdForPath(conn, logicalPath);
    // 钉住高版本（模拟 checkpoint 引用：ref_count +1）
    if (pinnedVersions.length > 0) {
      await conn.execute(
        `UPDATE vfs_revision SET ref_count = ref_count + 1
         WHERE entry_id = ? AND version IN (${pinnedVersions.map(() => "?").join(",")})`,
        [entryId, ...pinnedVersions],
      );
    }
    // 模拟 resetHeadToVersion：旧 head 释放 live ref、新 head 补 live ref、head 指针拨回
    await conn.execute(
      `UPDATE vfs_revision SET ref_count = ref_count - 1 WHERE entry_id = ? AND version = ?`,
      [entryId, fromVersion],
    );
    await conn.execute(
      `UPDATE vfs_revision SET ref_count = ref_count + 1 WHERE entry_id = ? AND version = ?`,
      [entryId, toVersion],
    );
    await conn.execute(
      `UPDATE vfs_entry SET head_version = ? WHERE scope_key = ? AND path = ?`,
      [toVersion, GLOBAL_SCOPE, logicalPath],
    );
  }

  it("write produces v1 then v2 revisions", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const vfs = createVfsService(conn);
    const revisions = new SqliteVfsRevisionRepository(conn);

    const first = await vfs.write(GLOBAL_SCOPE, "/rev.txt", "one");
    assert.equal(first.version, 1);

    const eid1 = await entryIdForPath(conn, "/rev.txt");
    const rev1 = await revisions.findByEntryAndVersion(eid1, 1);
    assert.ok(rev1);
    assert.equal(rev1.content, "one");
    assert.equal(rev1.status, "active");

    const second = await vfs.write(GLOBAL_SCOPE, "/rev.txt", "two", { expectedVersion: 1 });
    assert.equal(second.version, 2);

    const rev2 = await revisions.findByEntryAndVersion(eid1, 2);
    assert.ok(rev2);
    assert.equal(rev2.content, "two");
    assert.equal(rev2.status, "active");
  });

  it("read returns live head content", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const vfs = createVfsService(conn);

    await vfs.write(GLOBAL_SCOPE, "/head.txt", "first");
    await vfs.write(GLOBAL_SCOPE, "/head.txt", "second", { expectedVersion: 1 });

    const read = await vfs.read(GLOBAL_SCOPE, "/head.txt");
    assert.equal(read.content, "second");
    assert.equal(read.version, 2);
  });

  it("old revision remains readable after head advances", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const vfs = createVfsService(conn);
    const revisions = new SqliteVfsRevisionRepository(conn);

    await vfs.write(GLOBAL_SCOPE, "/history.txt", "v1");
    await vfs.write(GLOBAL_SCOPE, "/history.txt", "v2", { expectedVersion: 1 });

    const eid = await entryIdForPath(conn, "/history.txt");
    const old = await revisions.findByEntryAndVersion(eid, 1);
    assert.ok(old);
    assert.equal(old.content, "v1");
    assert.equal(old.status, "active");

    const head = await vfs.read(GLOBAL_SCOPE, "/history.txt");
    assert.equal(head.content, "v2");
  });

  it("delete appends deleted revision at head+1 and removes entry", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const vfs = createVfsService(conn);

    const written = await vfs.write(GLOBAL_SCOPE, "/del.txt", "content");
    const eidBeforeDelete = await entryIdForPath(conn, "/del.txt");
    await vfs.delete(GLOBAL_SCOPE, "/del.txt");

    // entry 已被删，直接查 revision 表确认墓碑
    const deletedRows = await conn.query<{ status: string; content_hash: string | null }>(
      `SELECT status, content_hash FROM vfs_revision WHERE entry_id = ? AND version = ?`,
      [eidBeforeDelete, written.version + 1],
    );
    assert.ok(deletedRows.length > 0);
    assert.equal(deletedRows[0]!.status, "deleted");
    assert.equal(deletedRows[0]!.content_hash, null);
    await assert.rejects(() => vfs.read(GLOBAL_SCOPE, "/del.txt"));
  });

  it("re-create after delete allocates version 1 (entry 重建后从 1 开始)", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const vfs = createVfsService(conn);
    const revisions = new SqliteVfsRevisionRepository(conn);

    await vfs.write(GLOBAL_SCOPE, "/again.txt", "v1");
    await vfs.write(GLOBAL_SCOPE, "/again.txt", "v2", { expectedVersion: 1 });
    await vfs.delete(GLOBAL_SCOPE, "/again.txt");

    const restored = await vfs.write(GLOBAL_SCOPE, "/again.txt", "restored", {
      versionCheck: false,
    });
    // entry 重建后新 entry_id 没有历史，version 从 1 开始
    assert.equal(restored.version, 1);

    const eid = await entryIdForPath(conn, "/again.txt");
    const rev = await revisions.findByEntryAndVersion(eid, 1);
    assert.ok(rev);
    assert.equal(rev.content, "restored");
    assert.equal(rev.status, "active");
    assert.equal((await vfs.read(GLOBAL_SCOPE, "/again.txt")).content, "restored");
  });

  it("recursive delete succeeds when directory row is missing but children exist", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const vfs = createVfsService(conn);
    const root = `/${testIsolationSuffix()}`;
    await vfs.mkdir(GLOBAL_SCOPE, root);
    const dir = `${root}/55`;
    await vfs.write(GLOBAL_SCOPE, `${dir}/诗歌.txt`, "poem", { versionCheck: false });
    await conn.execute(
      `DELETE FROM vfs_entry WHERE scope_key = ? AND path = ? AND entry_kind = 'directory'`,
      [GLOBAL_SCOPE, dir],
    );

    await vfs.delete(GLOBAL_SCOPE, dir, { recursive: true });

    await assert.rejects(() => vfs.read(GLOBAL_SCOPE, `${dir}/诗歌.txt`));
    // 查 revision 表确认墓碑版本
    const entryRows = await conn.query<{ entry_id: number }>(
      `SELECT entry_id FROM vfs_entry WHERE scope_key = ? AND path = ?`,
      [GLOBAL_SCOPE, `${dir}/诗歌.txt`],
    );
    // entry 应已被删
    assert.equal(entryRows.length, 0);
  });

  it("T-V1：head 回拨后 write 跳过占号段（MAX+1），ref 配对正确", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const vfs = createVfsService(conn);
    const revisions = new SqliteVfsRevisionRepository(conn);
    const path = `/${testIsolationSuffix()}/tv1.txt`;

    // 写到 v5
    let r = await vfs.write(GLOBAL_SCOPE, path, "c1");
    for (let v = 2; v <= 5; v++) {
      r = await vfs.write(GLOBAL_SCOPE, path, `c${v}`, { expectedVersion: r.version });
    }
    assert.equal(r.version, 5);
    const eid = await entryIdForPath(conn, path);

    // v4/v5 被 checkpoint 钉住，head 拨回 v3（直接 SQL 模拟回拨现场）
    await windHeadBackTo(conn, path, 5, 3, [4, 5]);

    // 回拨后再 write：旧实现发 head+1=4 会撞 UNIQUE(vfs_revision)，新实现发 MAX+1=6
    const w = await vfs.write(GLOBAL_SCOPE, path, "c6", { expectedVersion: 3 });
    assert.equal(w.version, 6);

    const rev6 = await revisions.findByEntryAndVersion(eid, 6);
    assert.ok(rev6, "v6 revision 应已落库");
    assert.equal(rev6!.content, "c6");
    assert.equal(rev6!.status, "active");

    // ref 配对：旧 head v3 −1（归零）、新号 v6 +1（live）；钉住的 v4/v5 引用不动
    assert.equal(await refCountFor(conn, eid, 3), 0);
    assert.equal(await refCountFor(conn, eid, 6), 1);
    assert.equal(await refCountFor(conn, eid, 4), 1);
    assert.equal(await refCountFor(conn, eid, 5), 1);
  });

  it("T-V2：head 回拨后 rm 墓碑取 MAX+1，旧 head 引用释放、entry 删除", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const vfs = createVfsService(conn);
    const path = `/${testIsolationSuffix()}/tv2.txt`;

    let r = await vfs.write(GLOBAL_SCOPE, path, "c1");
    for (let v = 2; v <= 5; v++) {
      r = await vfs.write(GLOBAL_SCOPE, path, `c${v}`, { expectedVersion: r.version });
    }
    const eid = await entryIdForPath(conn, path);

    await windHeadBackTo(conn, path, 5, 3, [4, 5]);

    // 回拨后 rm：旧实现墓碑 head+1=4 撞被钉住的 v4，新实现墓碑 MAX+1=6
    await vfs.delete(GLOBAL_SCOPE, path);

    const tombstone = await conn.query<{ status: string; content_hash: string | null }>(
      `SELECT status, content_hash FROM vfs_revision WHERE entry_id = ? AND version = 6`,
      [eid],
    );
    assert.ok(tombstone.length > 0, "v6 墓碑应已落库");
    assert.equal(tombstone[0]!.status, "deleted");
    assert.equal(tombstone[0]!.content_hash, null);

    // 旧 head v3 释放 live ref（归零）；墓碑自身 ref=1；钉住的 v4/v5 不动
    assert.equal(await refCountFor(conn, eid, 3), 0);
    assert.equal(await refCountFor(conn, eid, 6), 1);
    assert.equal(await refCountFor(conn, eid, 4), 1);
    assert.equal(await refCountFor(conn, eid, 5), 1);

    // entry 已删
    const entryRows = await conn.query<{ entry_id: number }>(
      `SELECT entry_id FROM vfs_entry WHERE scope_key = ? AND path = ?`,
      [GLOBAL_SCOPE, path],
    );
    assert.equal(entryRows.length, 0);
    await assert.rejects(() => vfs.read(GLOBAL_SCOPE, path));
  });

  it("T-V3：部分文件 head 回拨时递归删除，批量墓碑全部成功无 UNIQUE 冲突", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const vfs = createVfsService(conn);
    const root = `/${testIsolationSuffix()}`;
    const dir = `${root}/tv3`;
    await vfs.mkdir(GLOBAL_SCOPE, dir);

    // a.txt 写到 v3 后拨回 v1（v3 被 checkpoint 钉住）；b/c 正常 v1
    const a = `${dir}/a.txt`;
    let r = await vfs.write(GLOBAL_SCOPE, a, "a1");
    r = await vfs.write(GLOBAL_SCOPE, a, "a2", { expectedVersion: r.version });
    r = await vfs.write(GLOBAL_SCOPE, a, "a3", { expectedVersion: r.version });
    assert.equal(r.version, 3);
    const aEid = await entryIdForPath(conn, a);
    await windHeadBackTo(conn, a, 3, 1, [3]);

    const b = `${dir}/b.txt`;
    const c = `${dir}/c.txt`;
    await vfs.write(GLOBAL_SCOPE, b, "b1");
    await vfs.write(GLOBAL_SCOPE, c, "c1");
    const bEid = await entryIdForPath(conn, b);
    const cEid = await entryIdForPath(conn, c);

    // 递归删除：批量墓碑发号 a=max(1,3)+1=4、b/c=max(1,1)+1=2，全部避开占号段
    await vfs.delete(GLOBAL_SCOPE, dir, { recursive: true });

    const tombstones = await conn.query<{ entry_id: number; version: number; status: string }>(
      `SELECT entry_id, version, status FROM vfs_revision
       WHERE entry_id IN (?, ?, ?) AND status = 'deleted'`,
      [aEid, bEid, cEid],
    );
    const byEntry = new Map(tombstones.map((t) => [Number(t.entry_id), Number(t.version)]));
    assert.equal(byEntry.get(aEid), 4, "回拨文件的墓碑应取 MAX+1=4");
    assert.equal(byEntry.get(bEid), 2);
    assert.equal(byEntry.get(cEid), 2);

    // 旧 head live ref 释放：a v1 归零、b/c v1 归零
    assert.equal(await refCountFor(conn, aEid, 1), 0);
    assert.equal(await refCountFor(conn, bEid, 1), 0);
    assert.equal(await refCountFor(conn, cEid, 1), 0);

    // entry 全部删除
    const remain = await conn.query<{ path: string }>(
      `SELECT path FROM vfs_entry WHERE scope_key = ? AND (path = ? OR path LIKE ? || '/%')`,
      [GLOBAL_SCOPE, dir, dir],
    );
    assert.equal(remain.length, 0);
  });

  it("T-V7：发号器回退库（孤儿占号 + seq 压低）repair 后 write/rm 均成功", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const vfs = createVfsService(conn);
    const root = `/${testIsolationSuffix()}`;

    // 造病灶：orphan 写到 v2 后直接删 entry 行（revision 留下占号），再把 sqlite_sequence 压回 max(entry_id)
    const orphan = `${root}/tv7-orphan.txt`;
    let r = await vfs.write(GLOBAL_SCOPE, orphan, "o1");
    r = await vfs.write(GLOBAL_SCOPE, orphan, "o2", { expectedVersion: r.version });
    assert.equal(r.version, 2);
    const orphanEid = await entryIdForPath(conn, orphan);
    await conn.execute(`DELETE FROM vfs_entry WHERE entry_id = ?`, [orphanEid]);
    await conn.execute(
      `UPDATE sqlite_sequence SET seq = (SELECT COALESCE(MAX(entry_id), 0) FROM vfs_entry)
       WHERE name = 'vfs_entry'`,
    );

    // 发号器推号越过孤儿（对齐启动期 entry-sequence repair）
    const op = createVfsEntrySequenceRepairOperation(conn);
    await op.repair();

    // write 新文件：新 entry_id 不撞孤儿，version 从 1 起
    const fresh = `${root}/tv7-fresh.txt`;
    const w = await vfs.write(GLOBAL_SCOPE, fresh, "n1");
    assert.ok(w.version >= 1);
    const freshEid = await entryIdForPath(conn, fresh);
    assert.notEqual(freshEid, orphanEid, "新 entry 不应复用孤儿 entry_id");

    // rm：墓碑按 max(head, MAX)+1 发号，成功落库
    await vfs.delete(GLOBAL_SCOPE, fresh);
    const tombstone = await conn.query<{ status: string }>(
      `SELECT status FROM vfs_revision WHERE entry_id = ? AND version = ?`,
      [freshEid, w.version + 1],
    );
    assert.ok(tombstone.length > 0, "墓碑应已落库");
    assert.equal(tombstone[0]!.status, "deleted");

    const entryRows = await conn.query<{ entry_id: number }>(
      `SELECT entry_id FROM vfs_entry WHERE scope_key = ? AND path = ?`,
      [GLOBAL_SCOPE, fresh],
    );
    assert.equal(entryRows.length, 0);
  });
});

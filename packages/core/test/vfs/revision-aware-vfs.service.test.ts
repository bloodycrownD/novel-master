import { createVfsService } from "@novel-master/core/vfs";
import type { TdbcConnection } from "@novel-master/core";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
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
    const revisions = new SqliteVfsRevisionRepository(conn);
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
});

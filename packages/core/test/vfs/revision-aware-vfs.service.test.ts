import { createVfsService } from "@novel-master/core/vfs";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix } from "../helpers/novel-master-fixture.js";


novelMasterTestFixture();

describe("RevisionAwareVfsService (integration)", () => {
  it("write produces v1 then v2 revisions", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const vfs = createVfsService(conn);
    const revisions = new SqliteVfsRevisionRepository(conn);

    const first = await vfs.write("/rev.txt", "one");
    assert.equal(first.version, 1);

    const rev1 = await revisions.findByPathAndVersion("/rev.txt", 1);
    assert.ok(rev1);
    assert.equal(rev1.content, "one");
    assert.equal(rev1.status, "active");

    const second = await vfs.write("/rev.txt", "two", { expectedVersion: 1 });
    assert.equal(second.version, 2);

    const rev2 = await revisions.findByPathAndVersion("/rev.txt", 2);
    assert.ok(rev2);
    assert.equal(rev2.content, "two");
    assert.equal(rev2.status, "active");
  });

  it("read returns live head content", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const vfs = createVfsService(conn);

    await vfs.write("/head.txt", "first");
    await vfs.write("/head.txt", "second", { expectedVersion: 1 });

    const read = await vfs.read("/head.txt");
    assert.equal(read.content, "second");
    assert.equal(read.version, 2);
  });

  it("old revision remains readable after head advances", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const vfs = createVfsService(conn);
    const revisions = new SqliteVfsRevisionRepository(conn);

    await vfs.write("/history.txt", "v1");
    await vfs.write("/history.txt", "v2", { expectedVersion: 1 });

    const old = await revisions.findByPathAndVersion("/history.txt", 1);
    assert.ok(old);
    assert.equal(old.content, "v1");
    assert.equal(old.status, "active");

    const head = await vfs.read("/history.txt");
    assert.equal(head.content, "v2");
  });

  it("delete appends deleted revision at head+1 and removes entry", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const vfs = createVfsService(conn);
    const revisions = new SqliteVfsRevisionRepository(conn);

    const written = await vfs.write("/del.txt", "content");
    await vfs.delete("/del.txt");

    const deleted = await revisions.findByPathAndVersion(
      "/del.txt",
      written.version + 1,
    );
    assert.ok(deleted);
    assert.equal(deleted.status, "deleted");
    assert.equal(deleted.content, null);
    await assert.rejects(() => vfs.read("/del.txt"));
  });

  it("re-create after delete allocates max revision version + 1", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const vfs = createVfsService(conn);
    const revisions = new SqliteVfsRevisionRepository(conn);

    await vfs.write("/again.txt", "v1");
    await vfs.write("/again.txt", "v2", { expectedVersion: 1 });
    await vfs.delete("/again.txt");

    const restored = await vfs.write("/again.txt", "restored", {
      versionCheck: false,
    });
    assert.equal(restored.version, 4);

    const rev = await revisions.findByPathAndVersion("/again.txt", 4);
    assert.ok(rev);
    assert.equal(rev.content, "restored");
    assert.equal(rev.status, "active");
    assert.equal((await vfs.read("/again.txt")).content, "restored");
  });

  it("recursive delete succeeds when directory row is missing but children exist", async () => {
    const ctx = getNovelMasterTestContext();
    const conn = ctx.conn;
    const vfs = createVfsService(conn);
    const revisions = new SqliteVfsRevisionRepository(conn);
    const root = `/template/${testIsolationSuffix()}`;
    await vfs.mkdir(root);
    const dir = `${root}/55`;
    await vfs.write(`${dir}/诗歌.txt`, "poem", { versionCheck: false });
    await conn.execute(
      `DELETE FROM vfs_entry WHERE path = ? AND entry_kind = 'directory'`,
      [dir],
    );

    await vfs.delete(dir, { recursive: true });

    await assert.rejects(() => vfs.read(`${dir}/诗歌.txt`));
    const deleted = await revisions.findByPathAndVersion(`${dir}/诗歌.txt`, 2);
    assert.ok(deleted);
    assert.equal(deleted.status, "deleted");
  });
});

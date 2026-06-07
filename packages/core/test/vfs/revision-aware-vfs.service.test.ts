import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { openVfsTestConnection } from "./helpers.js";

describe("RevisionAwareVfsService (integration)", () => {
  it("write produces v1 then v2 revisions", async () => {
    const { conn, vfs } = await openVfsTestConnection();
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

    await conn.close();
  });

  it("read returns live head content", async () => {
    const { conn, vfs } = await openVfsTestConnection();

    await vfs.write("/head.txt", "first");
    await vfs.write("/head.txt", "second", { expectedVersion: 1 });

    const read = await vfs.read("/head.txt");
    assert.equal(read.content, "second");
    assert.equal(read.version, 2);

    await conn.close();
  });

  it("old revision remains readable after head advances", async () => {
    const { conn, vfs } = await openVfsTestConnection();
    const revisions = new SqliteVfsRevisionRepository(conn);

    await vfs.write("/history.txt", "v1");
    await vfs.write("/history.txt", "v2", { expectedVersion: 1 });

    const old = await revisions.findByPathAndVersion("/history.txt", 1);
    assert.ok(old);
    assert.equal(old.content, "v1");
    assert.equal(old.status, "active");

    const head = await vfs.read("/history.txt");
    assert.equal(head.content, "v2");

    await conn.close();
  });

  it("seeds baseline revision for pre-existing vfs_entry on bootstrap", async () => {
    const { conn } = await openVfsTestConnection();
    const revisions = new SqliteVfsRevisionRepository(conn);

    await conn.execute(
      `INSERT INTO vfs_entry (path, content, version, head_version, mtime_ms, storage_kind, entry_kind)
       VALUES ('/legacy.txt', 'legacy', 3, 3, 1000, 'inline', 'file')`,
    );
    await conn.execute(`
INSERT INTO vfs_revision (path, version, content, status, mtime_ms, storage_kind)
SELECT path, head_version, content, 'active', mtime_ms, storage_kind
FROM vfs_entry
WHERE entry_kind = 'file'
  AND NOT EXISTS (
    SELECT 1 FROM vfs_revision r
    WHERE r.path = vfs_entry.path AND r.version = vfs_entry.head_version
  )`);

    const baseline = await revisions.findByPathAndVersion("/legacy.txt", 3);
    assert.ok(baseline);
    assert.equal(baseline.content, "legacy");

    await conn.close();
  });
});

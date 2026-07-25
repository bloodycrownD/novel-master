/**
 * T-SC1/SC2/SC3：writeWithRevision 同文短路与乐观锁。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createVfsService, isVfsError } from "@novel-master/core/vfs";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

async function countRevisions(
  conn: { query: (sql: string, params?: unknown[]) => Promise<Array<{ n: number }>> },
  path: string,
): Promise<number> {
  const rows = await conn.query(
    `SELECT COUNT(*) AS n FROM vfs_revision WHERE path = ?`,
    [path],
  );
  return Number(rows[0]!.n);
}

describe("writeWithRevision same-content shortcircuit", () => {
  it("T-SC1: 同文 write 两次，version 与 revision 行数不变", async () => {
    const { conn } = getNovelMasterTestContext();
    const vfs = createVfsService(conn);
    const path = `/sc1-${testIsolationSuffix()}.md`;

    const first = await vfs.write(path, "same-body");
    assert.equal(first.version, 1);
    const revBefore = await countRevisions(conn, path);

    const second = await vfs.write(path, "same-body", {
      expectedVersion: 1,
    });
    assert.equal(second.version, 1);
    assert.equal(await countRevisions(conn, path), revBefore);

    const read = await vfs.read(path);
    assert.equal(read.content, "same-body");
    assert.equal(read.version, 1);
  });

  it("T-SC2: 异文 write 升版；entry/revision 的 content 列为 NULL", async () => {
    const { conn } = getNovelMasterTestContext();
    const vfs = createVfsService(conn);
    const path = `/sc2-${testIsolationSuffix()}.md`;

    await vfs.write(path, "alpha");
    const next = await vfs.write(path, "beta", { expectedVersion: 1 });
    assert.equal(next.version, 2);
    assert.equal(await countRevisions(conn, path), 2);

    const entryRows = await conn.query<{
      content: string | null;
      content_hash: string | null;
    }>(`SELECT content, content_hash FROM vfs_entry WHERE path = ?`, [path]);
    assert.equal(entryRows.length, 1);
    assert.equal(entryRows[0]!.content, null);
    assert.ok(entryRows[0]!.content_hash);

    const revRows = await conn.query<{
      version: number;
      content: string | null;
      content_hash: string | null;
    }>(
      `SELECT version, content, content_hash FROM vfs_revision WHERE path = ? ORDER BY version`,
      [path],
    );
    assert.equal(revRows.length, 2);
    for (const row of revRows) {
      assert.equal(row.content, null);
      assert.ok(row.content_hash);
    }

    assert.equal((await vfs.read(path)).content, "beta");
  });

  it("T-SC3: expectedVersion 过期仍 CONFLICT（同文短路不得绕过）", async () => {
    const { conn } = getNovelMasterTestContext();
    const vfs = createVfsService(conn);
    const path = `/sc3-${testIsolationSuffix()}.md`;

    await vfs.write(path, "live");
    await vfs.write(path, "newer", { expectedVersion: 1 });
    const revBefore = await countRevisions(conn, path);

    await assert.rejects(
      () =>
        vfs.write(path, "live", {
          expectedVersion: 1,
        }),
      (e: unknown) => {
        assert.ok(isVfsError(e, "CONFLICT"));
        return true;
      },
    );

    assert.equal(await countRevisions(conn, path), revBefore);
    const head = await vfs.read(path);
    assert.equal(head.content, "newer");
    assert.equal(head.version, 2);
  });
});

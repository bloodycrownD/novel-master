/**
 * T-SC1/SC2/SC3：writeWithRevision 同文短路与 last-write-wins 行为。
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
  const GLOBAL_SCOPE = "global";

  async function entryIdForPath(
    conn: { query: (sql: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>> },
    scopeKey: string,
    logicalPath: string,
  ): Promise<number | undefined> {
    const rows = await conn.query(
      `SELECT entry_id FROM vfs_entry WHERE scope_key = ? AND path = ?`,
      [scopeKey, logicalPath],
    );
    return rows[0]?.entry_id as number | undefined;
  }

  async function countRevisions(
    conn: { query: (sql: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>> },
    scopeKey: string,
    logicalPath: string,
  ): Promise<number> {
    const eid = await entryIdForPath(conn, scopeKey, logicalPath);
    if (eid == null) return 0;
    const rows = await conn.query(
      `SELECT COUNT(*) AS n FROM vfs_revision WHERE entry_id = ?`,
      [eid],
    );
    return Number((rows[0] as { n: number }).n);
  }

  it("T-SC1: 同文 write 两次，version 与 revision 行数不变", async () => {
    const { conn } = getNovelMasterTestContext();
    const vfs = createVfsService(conn);
    const path = `/sc1-${testIsolationSuffix()}.md`;

    const first = await vfs.write(GLOBAL_SCOPE, path, "same-body");
    assert.equal(first.version, 1);
    const revBefore = await countRevisions(conn, GLOBAL_SCOPE, path);

    const second = await vfs.write(GLOBAL_SCOPE, path, "same-body");
    assert.equal(second.version, 1);
    assert.equal(await countRevisions(conn, GLOBAL_SCOPE, path), revBefore);

    const read = await vfs.read(GLOBAL_SCOPE, path);
    assert.equal(read.content, "same-body");
    assert.equal(read.version, 1);
  });

  it("T-SC2: 异文 write 升版；entry/revision 的 content_hash 非空", async () => {
    const { conn } = getNovelMasterTestContext();
    const vfs = createVfsService(conn);
    const path = `/sc2-${testIsolationSuffix()}.md`;

    await vfs.write(GLOBAL_SCOPE, path, "alpha");
    const next = await vfs.write(GLOBAL_SCOPE, path, "beta");
    assert.equal(next.version, 2);
    assert.equal(await countRevisions(conn, GLOBAL_SCOPE, path), 2);

    const entryRows = await conn.query<{
      content: string | null;
      content_hash: string | null;
    }>(`SELECT content, content_hash FROM vfs_entry WHERE scope_key = ? AND path = ?`, [GLOBAL_SCOPE, path]);
    assert.equal(entryRows.length, 1);
    assert.equal(entryRows[0]!.content, null);
    assert.ok(entryRows[0]!.content_hash);

    const eid = await entryIdForPath(conn, GLOBAL_SCOPE, path);
    const revRows = await conn.query<{
      version: number;
      content_hash: string | null;
    }>(
      `SELECT version, content_hash FROM vfs_revision WHERE entry_id = ? ORDER BY version`,
      [eid],
    );
    assert.equal(revRows.length, 2);
    for (const row of revRows) {
      assert.ok(row.content_hash);
    }

    assert.equal((await vfs.read(GLOBAL_SCOPE, path)).content, "beta");
  });

  it("T-SC3: 版本比对已移除——后写直接覆盖为最新版（last-write-wins）", async () => {
    const { conn } = getNovelMasterTestContext();
    const vfs = createVfsService(conn);
    const path = `/sc3-${testIsolationSuffix()}.md`;

    await vfs.write(GLOBAL_SCOPE, path, "live");
    await vfs.write(GLOBAL_SCOPE, path, "newer");
    const revBefore = await countRevisions(conn, GLOBAL_SCOPE, path);

    // last-write-wins：不做版本比对，后写内容直接覆盖为最新版
    const result = await vfs.write(GLOBAL_SCOPE, path, "live");
    assert.ok(result.version > 2, "覆盖后版本应递增");

    const head = await vfs.read(GLOBAL_SCOPE, path);
    assert.equal(head.content, "live");
    assert.ok(head.version > 2);
  });
});

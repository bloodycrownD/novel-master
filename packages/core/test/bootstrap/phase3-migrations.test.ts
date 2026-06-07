import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bootstrapNovelMaster, open } from "@novel-master/core";
import { createKkvService } from "@novel-master/core/kkv";
import {
  BETTER_SQLITE3_DRIVER_NAME,
  registerBetterSqlite3Driver,
} from "@novel-master/tdbc-driver-better-sqlite3";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";

describe("Phase 3 bootstrap migrations", () => {
  it("adds vfs_entry.entry_kind on legacy table without the column", async () => {
    registerBetterSqlite3Driver();
    const conn = await open("tdbc:sqlite:file::memory:", {
      driver: BETTER_SQLITE3_DRIVER_NAME,
      filename: ":memory:",
    });
    await conn.execute(`
      CREATE TABLE vfs_entry (
        path TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        mtime_ms INTEGER NOT NULL,
        storage_kind TEXT NOT NULL DEFAULT 'inline',
        external_uri TEXT
      )
    `);
    await conn.execute(
      "INSERT INTO vfs_entry (path, content, mtime_ms) VALUES ('/a.txt', 'hi', 1)",
    );

    await bootstrapNovelMaster(conn);

    const cols = await conn.query<{ name: string }>(
      "SELECT name FROM pragma_table_info('vfs_entry')",
    );
    assert.ok(cols.some((c) => c.name === "entry_kind"));
    const rows = await conn.query<{ entry_kind: string }>(
      "SELECT entry_kind FROM vfs_entry WHERE path = '/a.txt'",
    );
    assert.equal(rows[0]?.entry_kind, "file");
    await conn.close();
  });

  it("backfills worktree_dir_rule fill_policy full to hidden", async () => {
    const ctx = await openNovelMasterTestConnection();
    await bootstrapNovelMaster(ctx.conn);
    await ctx.conn.execute(
      `INSERT INTO worktree_dir_rule (
        scope_key, logical_path, rule_enabled, sort_field, sort_order,
        head_count, tail_count, fill_policy
      ) VALUES ('global', '/legacy', 1, 'name', 'asc', 0, 0, 'full')`,
    );

    await bootstrapNovelMaster(ctx.conn);

    const rows = await ctx.conn.query<{ fill_policy: string }>(
      "SELECT fill_policy FROM worktree_dir_rule WHERE logical_path = '/legacy'",
    );
    assert.equal(rows[0]?.fill_policy, "hidden");
    await ctx.conn.close();
  });

  it("purges legacy global-config KKV rows", async () => {
    const ctx = await openNovelMasterTestConnection();
    const kkv = createKkvService(ctx.conn);
    await kkv.set("global-config", "currentProjectId", "legacy");
    await bootstrapNovelMaster(ctx.conn);

    const keys = await kkv.listKeys("global-config");
    assert.deepEqual(keys, []);
    await ctx.conn.close();
  });
});
